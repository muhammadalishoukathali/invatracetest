from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import (
    AdminRepairRequest,
    AdminRoleUpdateRequest,
    AdminSightingRemoveRequest,
    OkResponse,
)
from app.core.errors import ApiProblem, request_id_var
from app.core.security import AuthContext, require_admin, utcnow
from app.db.base import get_session
from app.db.models import (
    AuditEvent,
    Notification,
    Profile,
    Report,
    ReportSightingLink,
    Sighting,
    VerificationJob,
)
from app.services.object_deletion import enqueue_object_deletions

"""Admin-only endpoints — role moderation, report repair, sighting takedown.

Everything here sits behind require_admin, so it's the backend for the
(presumably small) admin panel rather than anything a normal user hits.
Every mutation writes an AuditEvent so there's a paper trail of who changed
what and why — useful given we don't have real user accounts to fall back on.
"""

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# Lets an admin manually push a report out of a stuck/exceptional screening
# state (e.g. the worker crashed mid-job, or a report needs a second look).
# expected_status is an optimistic-lock guard so two admins acting on stale
# UI state can't stomp on each other.
@router.post("/reports/{report_id}/repair", response_model=OkResponse)
def repair_report(
    report_id: uuid.UUID,
    body: AdminRepairRequest,
    request: Request,
    auth: AuthContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> OkResponse:
    report = session.scalar(select(Report).where(Report.id == report_id).with_for_update())
    if not report:
        raise ApiProblem(404, "report_not_found", "Not found")
    if report.status != body.expected_status:
        raise ApiProblem(
            409, "state_conflict", "The report state changed; refresh before retrying."
        )
    if report.status in {"screened", "merged"}:
        raise ApiProblem(
            409, "published_report_immutable", "Published reports cannot be repaired here."
        )

    before = report.status
    job = session.scalar(
        select(VerificationJob).where(VerificationJob.report_id == report.id).with_for_update()
    )
    if body.action == "requeue":
        # Reset the job back to pending so the screening worker (see
        # app/services/scan_service.py or wherever it lives) picks it up fresh.
        report.status = "processing"
        report.validation_reasons = ["admin_requeued"]
        if not job:
            job = VerificationJob(report_id=report.id)
            session.add(job)
        job.status = "pending"
        job.attempts = 0
        job.available_at = utcnow()
        job.locked_at = None
        job.last_error_code = None
    else:
        # Otherwise the admin is just forcing a terminal state without
        # re-running the automated checks.
        report.status = "needs_rescan" if body.action == "set_needs_rescan" else "rejected"
        report.validation_reasons = ["admin_integrity_repair"]
        if job:
            job.status = "completed"

    session.add(
        AuditEvent(
            event_type="report.admin_repair",
            acting_profile_id=auth.profile.id,
            subject_type="report",
            subject_id=str(report.id),
            request_id=request_id_var.get(),
            metadata_json={
                "before": before,
                "after": report.status,
                "action": body.action,
                "reason": body.reason,
            },
        )
    )
    session.add(
        Notification(
            profile_id=report.profile_id,
            kind="system",
            title="Report status updated",
            body="An administrator repaired an exceptional screening state.",
            link_to=f"/reports/{report.id}",
        )
    )
    session.commit()
    return OkResponse()


# Promotes/demotes a profile's role (Detector/Volunteer/Expert/Admin). Used by
# the admin user-management screen.
@router.post("/profiles/{profile_id}/role", response_model=OkResponse)
def update_profile_role(
    profile_id: uuid.UUID,
    body: AdminRoleUpdateRequest,
    request: Request,
    auth: AuthContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> OkResponse:
    profile = session.scalar(select(Profile).where(Profile.id == profile_id).with_for_update())
    if not profile:
        raise ApiProblem(404, "profile_not_found", "Not found")
    # Stops an admin from locking themselves out by demoting their own account.
    if profile.id == auth.profile.id and body.role != "Admin":
        raise ApiProblem(
            409, "self_demote_forbidden", "Admins cannot demote themselves."
        )
    before = profile.role
    if before == body.role:
        return OkResponse()
    profile.role = body.role
    session.add(
        AuditEvent(
            event_type="profile.role_updated",
            acting_profile_id=auth.profile.id,
            subject_type="profile",
            subject_id=str(profile.id),
            request_id=request_id_var.get(),
            metadata_json={"before": before, "after": body.role, "reason": body.reason},
        )
    )
    session.add(
        Notification(
            profile_id=profile.id,
            kind="system",
            title="Account role updated",
            body=f"Your role changed from {before} to {body.role}.",
            link_to="/account",
        )
    )
    session.commit()
    return OkResponse()


# Takedown for a public sighting (bad photo, wrong species, whatever). Called
# from the admin moderation view — once removed, the sighting still exists in
# the DB (status="removed") but drops off the public map/feed. See
# app/api/routers/sightings.py, which only ever returns screened/removed rows.
@router.post("/sightings/{sighting_id}/remove", response_model=OkResponse)
def remove_sighting(
    sighting_id: uuid.UUID,
    body: AdminSightingRemoveRequest,
    request: Request,
    auth: AuthContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> OkResponse:
    sighting = session.scalar(
        select(Sighting).where(Sighting.id == sighting_id).with_for_update()
    )
    if not sighting:
        raise ApiProblem(404, "sighting_not_found", "Not found")
    if sighting.status == "removed":
        # Already gone — treat as a no-op so retries/double-clicks don't error.
        return OkResponse()
    thumbnail_key = sighting.thumbnail_key
    sighting.status = "removed"
    sighting.thumbnail_key = None
    linked_report_ids = list(
        session.scalars(
            select(ReportSightingLink.report_id).where(
                ReportSightingLink.sighting_id == sighting.id
            )
        ).all()
    )
    # A sighting can be backed by multiple merged reports (see the screening
    # worker's merge logic) — reject all of them, not just the "primary" one.
    photo_keys: list[str] = []
    for report_id in linked_report_ids:
        report = session.scalar(select(Report).where(Report.id == report_id).with_for_update())
        if report and report.photo_key:
            photo_keys.append(report.photo_key)
            report.status = "rejected"
    session.add(
        AuditEvent(
            event_type="sighting.admin_removed",
            acting_profile_id=auth.profile.id,
            subject_type="sighting",
            subject_id=str(sighting.id),
            request_id=request_id_var.get(),
            metadata_json={
                "reason": body.reason,
                "thumbnail_key": thumbnail_key,
                "linked_report_ids": [str(r) for r in linked_report_ids],
            },
        )
    )
    # Don't delete objects from R2/MinIO inline in the request — queue it up
    # so a slow storage backend can't hang this endpoint (see object_deletion.py).
    enqueue_object_deletions(session, [thumbnail_key, *photo_keys])
    session.commit()
    return OkResponse()
