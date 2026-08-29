from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import (
    IDEMPOTENCY_PATTERN,
    ReportListResponse,
    ReportResponse,
    ReportSubmission,
)
from app.core.errors import ApiProblem, request_id_var
from app.core.idempotency import acquire_idempotency_lock, canonical_request_hash
from app.core.pagination import decode_cursor, encode_cursor
from app.core.rate_limit import rate_limiter
from app.core.security import AuthContext, require_auth, utcnow
from app.db.base import get_session
from app.db.models import (
    AuditEvent,
    IdempotencyRecord,
    Notification,
    Report,
    ReportSightingLink,
    Species,
    UploadGrant,
    VerificationJob,
)
from app.domain.reporting import coordinate, report_response
from app.services.storage import storage

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


def request_digest(body: ReportSubmission) -> bytes:
    return canonical_request_hash(body.model_dump(mode="json", by_alias=True))


@router.post("", response_model=ReportResponse, status_code=201)
def create_report(
    body: ReportSubmission,
    request: Request,
    response: Response,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    queued_retry: bool = Header(default=False, alias="X-InvaTrace-Queued"),
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> ReportResponse:
    rate_limiter.check("report_create", str(auth.profile.id))
    if not IDEMPOTENCY_PATTERN.fullmatch(idempotency_key):
        raise ApiProblem(400, "invalid_idempotency_key", "A valid Idempotency-Key is required.")
    digest = request_digest(body)
    acquire_idempotency_lock(
        session,
        profile_id=auth.profile.id,
        scope="report.create",
        idempotency_key=idempotency_key,
    )
    existing = session.scalar(
        select(IdempotencyRecord)
        .where(
            IdempotencyRecord.profile_id == auth.profile.id,
            IdempotencyRecord.scope == "report.create",
            IdempotencyRecord.idempotency_key == idempotency_key,
        )
        .with_for_update()
    )
    if existing:
        if existing.request_hash != digest:
            raise ApiProblem(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with a different report.",
            )
        response.status_code = existing.response_status
        return ReportResponse.model_validate(existing.response_json)

    grant = session.scalar(
        select(UploadGrant)
        .where(
            UploadGrant.object_key == body.photo_key,
            UploadGrant.profile_id == auth.profile.id,
        )
        .with_for_update()
    )
    now = utcnow()
    if not grant:
        raise ApiProblem(400, "upload_not_issued", "The photo key is invalid.")
    if grant.expires_at <= now:
        raise ApiProblem(410, "upload_expired", "The upload grant has expired.")
    if grant.consumed_at is not None:
        raise ApiProblem(409, "upload_already_used", "The upload was already used.")
    metadata = storage.head(grant.object_key)
    if metadata.size_bytes != grant.size_bytes or metadata.content_type != grant.content_type:
        raise ApiProblem(409, "upload_mismatch", "The uploaded image does not match its grant.")
    species = session.get(Species, body.species_id) if body.species_id else None
    if body.species_id and not species:
        raise ApiProblem(400, "unknown_species", "The species is not supported.")
    if body.outcome == "target" and species and not species.reportable:
        raise ApiProblem(
            422,
            "species_not_reportable",
            "This model class does not yet have reviewed field guidance and cannot be reported.",
        )

    evidence_key = f"evidence/{auth.profile.id}/{grant.id}.jpg"
    storage.finalize_upload(grant.object_key, evidence_key, metadata)

    report = Report(
        profile_id=auth.profile.id,
        species_id=body.species_id,
        status="processing",
        photo_key=evidence_key,
        outcome=body.outcome,
        confidence=body.confidence,
        client_model_version=body.model_version,
        observed_at=body.observed_at,
        capture_id=body.capture_id,
        capture_source=body.capture_source,
        latitude=coordinate(body.location.lat),
        longitude=coordinate(body.location.lng),
        location_accuracy_m=body.location_accuracy_m,
        extent=body.extent,
        notes=body.notes,
        consent_accurate=body.consent.accurate,
        consent_no_pii=body.consent.no_pii,
        submitter_trust=auth.profile.trust_level,
        idempotency_key=idempotency_key,
    )
    session.add(report)
    session.flush()

    session.add(VerificationJob(report_id=report.id, status="pending"))
    if queued_retry:
        session.add(
            Notification(
                profile_id=auth.profile.id,
                kind="sync_ok",
                title="Queued report synced",
                body="Your offline report reached the server after reconnecting.",
                link_to=f"/reports/{report.id}",
            )
        )
    grant.consumed_at = now
    grant.consumed_by_report_id = report.id
    session.add(
        AuditEvent(
            event_type="report.created",
            acting_profile_id=auth.profile.id,
            subject_type="report",
            subject_id=str(report.id),
            request_id=request_id_var.get(),
            metadata_json={"queuedRetry": queued_retry},
        )
    )
    session.flush()
    payload = report_response(report)
    session.add(
        IdempotencyRecord(
            profile_id=auth.profile.id,
            scope="report.create",
            idempotency_key=idempotency_key,
            request_hash=digest,
            response_status=201,
            response_json=payload.model_dump(mode="json", by_alias=True),
            expires_at=now + timedelta(days=30),
        )
    )
    session.commit()
    return payload


@router.get("/mine", response_model=ReportListResponse)
def my_reports(
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = None,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> ReportListResponse:
    offset = decode_cursor(cursor)
    reports = session.scalars(
        select(Report)
        .where(Report.profile_id == auth.profile.id)
        .order_by(Report.created_at.desc(), Report.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    report_ids = [report.id for report in reports]
    sighting_ids = dict(
        session.execute(
            select(ReportSightingLink.report_id, ReportSightingLink.sighting_id).where(
                ReportSightingLink.report_id.in_(report_ids),
                ReportSightingLink.active.is_(True),
            )
        ).all()
    )
    job_statuses = dict(
        session.execute(
            select(VerificationJob.report_id, VerificationJob.status).where(
                VerificationJob.report_id.in_(report_ids)
            )
        ).all()
    )
    return ReportListResponse(
        items=[
            report_response(
                item,
                sighting_id=sighting_ids.get(item.id),
                validation_retryable=job_statuses.get(item.id)
                in {"pending", "running", "retry", "unavailable"},
            )
            for item in reports
        ],
        next_cursor=encode_cursor(offset, len(reports), limit),
    )


def _sighting_id(session: Session, report_id: uuid.UUID) -> uuid.UUID | None:
    return session.scalar(
        select(ReportSightingLink.sighting_id).where(
            ReportSightingLink.report_id == report_id,
            ReportSightingLink.active.is_(True),
        )
    )


@router.get("/{report_id}", response_model=ReportResponse)
def report_status(
    report_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> ReportResponse:
    report = session.scalar(
        select(Report).where(Report.id == report_id, Report.profile_id == auth.profile.id)
    )
    if not report:
        raise ApiProblem(404, "report_not_found", "Not found")
    job_status = session.scalar(
        select(VerificationJob.status).where(VerificationJob.report_id == report.id)
    )
    return report_response(
        report,
        sighting_id=_sighting_id(session, report.id),
        validation_retryable=job_status in {"pending", "running", "retry", "unavailable"},
    )
