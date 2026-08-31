from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import AdminRepairRequest, AdminRoleUpdateRequest, OkResponse
from app.core.errors import ApiProblem, request_id_var
from app.core.security import AuthContext, require_admin, utcnow
from app.db.base import get_session
from app.db.models import AuditEvent, Notification, Profile, Report, VerificationJob

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


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
