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

"""Health/readiness probes for whatever's running this service (Docker, k8s, uptime checks).

No auth, no business logic — just "is the process up" vs "are its
dependencies (Postgres, Redis, object storage) actually reachable."
"""

router = APIRouter(tags=["health"])


# Dumbest possible liveness check — just proves the process is running and
# can respond. Doesn't touch the DB or anything else, so it won't false-alarm
# a container restart just because Postgres had a blip.
@router.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


# Slightly heavier check that also pings Postgres. Mostly here for
# load balancers / monitoring dashboards that want a quick ok/not-ok plus
# a 503 they can alert on.
@router.get("/health", response_model=HealthResponse)
def health(response: Response, session: Session = Depends(get_session)) -> HealthResponse:
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
    except SQLAlchemyError:
        database = "unavailable"
        response.status_code = 503
    return HealthResponse(status="ok" if database == "ok" else "unavailable", database=database)


# Full readiness probe — checks every dependency the app actually needs to
# serve traffic (Postgres, Redis for rate limiting, R2/MinIO for photos) plus
# the size of the screening backlog, so ops can tell "up" from "up but drowning
# in unprocessed reports."
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
