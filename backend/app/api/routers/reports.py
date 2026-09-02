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
from app.config import get_settings
from app.core.errors import ApiProblem, request_id_var
from app.core.idempotency import acquire_idempotency_lock, canonical_request_hash
from app.core.pagination import decode_cursor, encode_cursor
from app.core.rate_limit import client_address, rate_limiter
from app.core.security import AuthContext, require_auth, utcnow
from app.db.base import get_session
from app.db.models import (
    AuditEvent,
    IdempotencyRecord,
    Notification,
    Report,
    ReportSightingLink,
    Scan,
    Species,
    UploadGrant,
    VerificationJob,
)
from app.domain.reporting import coordinate, report_response
from app.services.object_deletion import enqueue_object_deletions
from app.services.storage import storage

"""Report submission, listing, and status — the core "I found a plant" flow.

A report starts private (status="processing") and only becomes a public
Sighting once the deterministic screening worker approves it. This module
is the backend for the report-submission screen (create_report), "my
reports" history, and single-report status polling/deletion.
"""

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


# Hash of the submitted body, used to detect an Idempotency-Key being replayed
# with genuinely different content (see acquire_idempotency_lock below).
def request_digest(body: ReportSubmission) -> bytes:
    return canonical_request_hash(body.model_dump(mode="json", by_alias=True))


# Report submission — called by the app right after a photo finishes
# uploading via the presigned URL from uploads.py. Flaky mobile networks mean
# clients retry this a lot, so most of the function is guarding against
# double-submission and stale/invalid state rather than the "happy path" insert.
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
    # Burst + daily limits per profile, plus a per-IP burst check to slow down
    # someone spinning up fresh profiles to dodge the per-profile limit.
    rate_limiter.check("report_create_burst", str(auth.profile.id))
    rate_limiter.check("report_create_daily", str(auth.profile.id))
    rate_limiter.check("report_create_ip_burst", client_address(request))
    if not IDEMPOTENCY_PATTERN.fullmatch(idempotency_key):
        raise ApiProblem(400, "invalid_idempotency_key", "A valid Idempotency-Key is required.")
    digest = request_digest(body)
    # Grabs a lock on this idempotency key so two in-flight retries of the
    # same submission (common with the client's offline queue) can't both
    # slip past the "existing" check below and create two reports.
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
        # Same key, different payload — someone (or some bug) is reusing an
        # Idempotency-Key for a different report, which isn't allowed.
        if existing.request_hash != digest:
            raise ApiProblem(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with a different report.",
            )
        # True retry of an already-handled request — just replay the stored
        # response instead of doing the work again.
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
    # Cross-check the object actually sitting in R2/MinIO against what the
    # presign grant promised — catches a client that presigned for one file
    # then uploaded something else (size/type swap).
    metadata = storage.head(grant.object_key)
    if metadata.size_bytes != grant.size_bytes or metadata.content_type != grant.content_type:
        raise ApiProblem(409, "upload_mismatch", "The uploaded image does not match its grant.")
    species = session.get(Species, body.species_id) if body.species_id else None
    if body.species_id and not species:
        raise ApiProblem(400, "unknown_species", "The species is not supported.")
    # AC 2.2.1 — if the client persisted a scan for this capture, re-read it and reject
    # any submission that tries to swap the species from what the model actually returned.
    scan_record = session.scalar(
        select(Scan).where(
            Scan.capture_id == body.capture_id,
            Scan.profile_id == auth.profile.id,
        )
    )
    if scan_record is not None:
        if scan_record.outcome != body.outcome:
            raise ApiProblem(
                422,
                "scan_outcome_mismatch",
                "Report outcome does not match the recorded scan.",
            )
        if (scan_record.predicted_species_id or None) != (body.species_id or None):
            raise ApiProblem(
                422,
                "scan_species_mismatch",
                "Report species does not match the recorded scan.",
            )
    if body.outcome == "target" and species and not species.reportable:
        raise ApiProblem(
            422,
            "species_not_reportable",
            "This model class does not yet have reviewed field guidance and cannot be reported.",
        )
    # AC 1.1.3: reports whose confidence is below the server-configured threshold cannot be
    # published as invasive; the client must surface them as Uncertain instead.
    settings = get_settings()
    if body.outcome == "target" and float(body.confidence) < settings.model_acceptance_threshold:
        raise ApiProblem(
            422,
            "confidence_below_threshold",
            (
                f"Prediction confidence is below the acceptance threshold"
                f" ({settings.model_acceptance_threshold:.2f})."
            ),
        )

    # Move the object out of the temporary uploads/ prefix into evidence/ once
    # we've committed to actually using it — keeps unused uploads easy to
    # garbage-collect separately from real evidence photos.
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

    # This is what the screening worker actually picks up — see wherever it
    # polls VerificationJob for status="pending" rows.
    session.add(VerificationJob(report_id=report.id, status="pending"))
    if queued_retry:
        # Client flags this when the report was sitting in its offline queue
        # (PWA was offline when the user submitted) and only just made it to
        # the server — nice to tell the user their report wasn't lost.
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
    # Stash the response so a retry with the same Idempotency-Key (see the
    # "existing" check up top) gets exactly this back instead of erroring or
    # creating a duplicate. 30 days is generous but the client's retry queue
    # can sit offline for a while.
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


# "My reports" history screen — every report this profile has ever
# submitted, whatever its screening status, unlike the public sightings
# feed which only shows screened/removed ones.
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


# Small helper for the single-report endpoint below — batched version lives
# inline in my_reports since doing N+1 queries there would be silly.
def _sighting_id(session: Session, report_id: uuid.UUID) -> uuid.UUID | None:
    return session.scalar(
        select(ReportSightingLink.sighting_id).where(
            ReportSightingLink.report_id == report_id,
            ReportSightingLink.active.is_(True),
        )
    )


# Lets a user retract their own report, e.g. they realize they misidentified
# the plant before it's been screened. Called from the "my reports" screen.
@router.delete("/{report_id}", response_model=None, status_code=204)
def delete_report(
    report_id: uuid.UUID,
    request: Request,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> Response:
    report = session.scalar(
        select(Report)
        .where(Report.id == report_id, Report.profile_id == auth.profile.id)
        .with_for_update()
    )
    if not report:
        raise ApiProblem(404, "report_not_found", "Not found")
    # Owner may only delete reports that never became a published sighting.
    # Screened/merged reports back a public sighting and require an admin flow.
    if report.status in {"screened", "merged"}:
        raise ApiProblem(
            409,
            "report_published",
            "Published reports cannot be deleted by the reporter.",
        )
    photo_key = report.photo_key
    prior_status = report.status
    session.execute(
        ReportSightingLink.__table__.delete().where(ReportSightingLink.report_id == report.id)
    )
    session.execute(
        VerificationJob.__table__.delete().where(VerificationJob.report_id == report.id)
    )
    session.delete(report)
    enqueue_object_deletions(session, [photo_key])
    session.add(
        AuditEvent(
            event_type="report.deleted",
            acting_profile_id=auth.profile.id,
            subject_type="report",
            subject_id=str(report_id),
            request_id=request_id_var.get(),
            metadata_json={"photo_key": photo_key, "prior_status": prior_status},
        )
    )
    session.commit()
    return Response(status_code=204)


# Single-report status check — the client polls this while a report is
# stuck in "processing" so the tracking screen can update once screening finishes.
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
