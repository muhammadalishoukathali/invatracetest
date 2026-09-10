"""Iteration 2 Phase 4 - Epic 4 community sighting-removal reporting.

Handles ``POST /api/v1/reports/{report_id}/removal``. A finder tells us the
plant they earlier reported is now gone; we verify they are physically at
the sighting (server-authoritative point-in-radius check against the
public Sighting coordinates), rate-limit per identity + IP, and flip the
sighting to ``removal_reported`` with an append-only history row. The
underlying Report is left untouched - the photo, coords, species and
timestamp of the original observation stay authoritative.

Separate router so reports.py keeps its create/list/status shape.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import Field
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session
from geoalchemy2 import Geography

from app.api.schemas import IDEMPOTENCY_PATTERN, ApiModel
from app.config import get_settings
from app.core.errors import ApiProblem, request_id_var
from app.core.idempotency import acquire_idempotency_lock, canonical_request_hash
from app.core.rate_limit import client_address, rate_limiter
from app.core.security import AuthContext, require_auth, utcnow
from app.db.base import get_session
from app.db.models import (
    AuditEvent,
    IdempotencyRecord,
    Report,
    ReportSightingLink,
    Sighting,
    SightingStatusHistory,
)
from app.domain.reporting import coordinate


router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


# Status values that mean the sighting can no longer receive a removal
# report. ``removal_reported`` already recorded a removal; ``rejected``
# was thrown out by screening; ``removed`` is an admin/system takedown.
# ``merged`` folds into another sighting so any removal belongs on the
# canonical parent, not this row.
_BLOCKED_STATUSES = frozenset({"removal_reported", "rejected", "removed", "merged"})


RemovalErrorCode = Literal[
    "LOCATION_UNAVAILABLE",
    "LOCATION_INACCURATE",
    "LOCATION_OUT_OF_RANGE",
    "LOCATION_PERMISSION_DENIED",
    "RATE_LIMITED",
    "SIGHTING_NOT_ELIGIBLE",
    "SIGHTING_NOT_FOUND",
]


class RemovalReportSubmission(ApiModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    accuracy_m: float = Field(ge=0.0, le=1_000_000.0)


class RemovalReportResponse(ApiModel):
    sighting_id: uuid.UUID
    report_id: uuid.UUID
    from_status: str
    to_status: str
    calculated_distance_m: float
    proximity_max_m: int
    accuracy_ceiling_m: int
    event_time_utc: str


def _digest(body: RemovalReportSubmission) -> bytes:
    return canonical_request_hash(body.model_dump(mode="json", by_alias=True))


def _problem(status: int, code: RemovalErrorCode, message: str, **headers: str) -> ApiProblem:
    return ApiProblem(status, code, message, headers=headers or None)


@router.post(
    "/{report_id}/removal",
    response_model=RemovalReportResponse,
    status_code=200,
)
def submit_removal_report(
    report_id: uuid.UUID,
    body: RemovalReportSubmission,
    request: Request,
    response: Response,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> RemovalReportResponse:
    if not IDEMPOTENCY_PATTERN.fullmatch(idempotency_key):
        raise ApiProblem(400, "invalid_idempotency_key", "A valid Idempotency-Key is required.")

    settings = get_settings()

    # AC 4.2.4 - identity + IP caps. Check IP first so a shared network
    # doesn't fund a burst against everyone's per-identity budget, then the
    # per-identity ones. Hitting either raises 429 + Retry-After.
    rate_limiter.check("removal_report_ip_hour", client_address(request))
    rate_limiter.check("removal_report_hour", str(auth.profile.id))
    rate_limiter.check("removal_report_day", str(auth.profile.id))

    # Grab an idempotency lock keyed on the specific report the actor is
    # trying to mark removed. Retries from the offline queue land here with
    # the same key and get the stored response replayed instead of
    # double-flipping status.
    scope = f"report.removal:{report_id}"
    acquire_idempotency_lock(
        session,
        profile_id=auth.profile.id,
        scope=scope,
        idempotency_key=idempotency_key,
    )
    digest = _digest(body)
    existing = session.scalar(
        select(IdempotencyRecord)
        .where(
            IdempotencyRecord.profile_id == auth.profile.id,
            IdempotencyRecord.scope == scope,
            IdempotencyRecord.idempotency_key == idempotency_key,
        )
        .with_for_update()
    )
    if existing:
        if existing.request_hash != digest:
            raise ApiProblem(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used with different coordinates.",
            )
        response.status_code = existing.response_status
        return RemovalReportResponse.model_validate(existing.response_json)

    report = session.scalar(
        select(Report).where(Report.id == report_id)
    )
    if report is None:
        raise _problem(404, "SIGHTING_NOT_FOUND", "Report not found.")

    sighting_id = session.scalar(
        select(ReportSightingLink.sighting_id).where(
            ReportSightingLink.report_id == report_id,
            ReportSightingLink.active.is_(True),
        )
    )
    if sighting_id is None:
        raise _problem(
            422,
            "SIGHTING_NOT_ELIGIBLE",
            "This report has not been published as a public sighting yet.",
        )

    sighting = session.scalar(
        select(Sighting).where(Sighting.id == sighting_id).with_for_update()
    )
    if sighting is None:
        raise _problem(404, "SIGHTING_NOT_FOUND", "Sighting not found.")

    if sighting.status in _BLOCKED_STATUSES:
        raise ApiProblem(
            422,
            "SIGHTING_NOT_ELIGIBLE",
            f"Sighting is in status '{sighting.status}' and cannot accept a removal report.",
            headers={"X-InvaTrace-Sighting-Status": sighting.status},
        )

    # AC 4.2.2 - accuracy ceiling. Anything worse than the server ceiling is
    # rejected outright before we compute distance so a wildly imprecise fix
    # can't accidentally satisfy the vicinity radius.
    if body.accuracy_m > float(settings.location_accuracy_max_m):
        raise _problem(
            422,
            "LOCATION_INACCURATE",
            (
                f"Location accuracy ({body.accuracy_m:.0f} m) is worse than the "
                f"{settings.location_accuracy_max_m} m ceiling required to confirm a removal."
            ),
        )

    # AC 4.2.3 - geodesic vicinity check using the sighting's raw geography
    # column. Using ST_Distance on geography returns metres directly.
    submitter_wkt = f"SRID=4326;POINT({body.longitude} {body.latitude})"
    distance_m = session.scalar(
        select(
            func.ST_Distance(
                cast(Sighting.location, Geography()),
                func.ST_GeogFromText(submitter_wkt),
            )
        ).where(Sighting.id == sighting.id)
    )
    if distance_m is None:
        raise _problem(
            422,
            "LOCATION_UNAVAILABLE",
            "Could not compute distance to the sighting; try again once you have a location fix.",
        )
    distance_val = float(distance_m)
    if distance_val > float(settings.removal_proximity_max_m):
        raise ApiProblem(
            422,
            "LOCATION_OUT_OF_RANGE",
            (
                f"You are {distance_val:.0f} m from the sighting - within "
                f"{settings.removal_proximity_max_m} m is required to confirm a removal."
            ),
            headers={"X-InvaTrace-Distance-M": f"{distance_val:.2f}"},
        )

    now = utcnow()
    from_status = sighting.status
    sighting.status = "removal_reported"
    sighting.updated_at = now

    history = SightingStatusHistory(
        sighting_id=sighting.id,
        from_status=from_status,
        to_status="removal_reported",
        actor_profile_id=auth.profile.id,
        submitted_lat=coordinate(body.latitude),
        submitted_lon=coordinate(body.longitude),
        submitted_accuracy_m=int(body.accuracy_m),
        calculated_distance_m=Decimal(f"{distance_val:.2f}"),
        idempotency_key=idempotency_key,
        event_time_utc=now,
    )
    session.add(history)
    session.add(
        AuditEvent(
            event_type="sighting.removal_reported",
            acting_profile_id=auth.profile.id,
            subject_type="sighting",
            subject_id=str(sighting.id),
            request_id=request_id_var.get(),
            metadata_json={
                "report_id": str(report_id),
                "distance_m": distance_val,
                "accuracy_m": body.accuracy_m,
                "from_status": from_status,
            },
        )
    )

    payload = RemovalReportResponse(
        sighting_id=sighting.id,
        report_id=report_id,
        from_status=from_status,
        to_status="removal_reported",
        calculated_distance_m=distance_val,
        proximity_max_m=settings.removal_proximity_max_m,
        accuracy_ceiling_m=settings.location_accuracy_max_m,
        event_time_utc=now.isoformat().replace("+00:00", "Z"),
    )

    session.add(
        IdempotencyRecord(
            profile_id=auth.profile.id,
            scope=scope,
            idempotency_key=idempotency_key,
            request_hash=digest,
            response_status=200,
            response_json=payload.model_dump(mode="json", by_alias=True),
            expires_at=now + timedelta(days=30),
        )
    )
    session.commit()
    return payload
