from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.schemas import HealthResponse
from app.core.rate_limit import rate_limiter
from app.db.base import get_session
from app.db.models import VerificationJob
from app.services.storage import storage

router = APIRouter(tags=["health"])


@router.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health", response_model=HealthResponse)
def health(response: Response, session: Session = Depends(get_session)) -> HealthResponse:
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
    except SQLAlchemyError:
        database = "unavailable"
        response.status_code = 503
    return HealthResponse(status="ok" if database == "ok" else "unavailable", database=database)


@router.get("/health/ready", response_model=HealthResponse)
def ready(response: Response, session: Session = Depends(get_session)) -> HealthResponse:
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
        backlog = (
            session.scalar(
                select(func.count(VerificationJob.id)).where(
                    VerificationJob.status.in_(["pending", "retry", "running", "unavailable"])
                )
            )
            or 0
        )
    except SQLAlchemyError:
        database = "unavailable"
        backlog = None
    redis_status = "ok" if rate_limiter.ping() else "unavailable"
    storage_status = "ok" if storage.ping() else "unavailable"
    core_ready = database == redis_status == storage_status == "ok"
    if not core_ready:
        response.status_code = 503
    return HealthResponse(
        status="ok" if core_ready else "unavailable",
        database=database,
        redis=redis_status,
        storage=storage_status,
        screening="ready" if core_ready else "unavailable",
        verification_backlog=backlog,
    )
