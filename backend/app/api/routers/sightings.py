from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.schemas import (
    GeoPoint,
    PlaceAssociation,
    SightingDetailResponse,
    SightingListResponse,
    SightingResponse,
)
from app.core.errors import ApiProblem
from app.core.pagination import decode_cursor, encode_cursor
from app.core.privacy import public_coordinates
from app.core.rate_limit import client_address, rate_limiter
from app.db.base import get_session
from app.db.models import MonitoredArea, Report, ReportSightingLink, Sighting, Species, Trail
from app.domain.action_guidance import action_summary, current_action_guide
from app.services.storage import storage

router = APIRouter(prefix="/api/v1/sightings", tags=["sightings"])


def serialize_sighting(
    sighting: Sighting,
    species: Species,
    report_count: int,
    last_reported_at: datetime | None,
    area_name: str | None,
    trail_name: str | None,
) -> SightingResponse:
    lat, lng, reduced = public_coordinates(
        sighting_id=str(sighting.id),
        latitude=sighting.latitude,
        longitude=sighting.longitude,
        status=sighting.status,
        reporter_trust=sighting.reporter_trust,
    )
    place_source = (
        "osm"
        if area_name or trail_name
        else ("fallback" if sighting.place_label == "Reported location, Malaysia" else "seed")
    )
    return SightingResponse(
        id=str(sighting.id),
        species_id=species.id,
        species_name=species.name,
        latin_name=species.latin_name,
        status=sighting.status,
        risk=sighting.risk,
        location=GeoPoint(lat=lat, lng=lng),
        precision_reduced=reduced,
        report_count=report_count,
        last_reported_at=last_reported_at or sighting.created_at,
        place=PlaceAssociation(
            display_name=sighting.place_label,
            area_name=area_name,
            trail_name=trail_name,
            source=place_source,
        ),
        thumbnail_url=storage.presign_get(sighting.thumbnail_key)
        if sighting.thumbnail_key
        else None,
    )


@router.get("", response_model=SightingListResponse)
def list_sightings(
    request: Request,
    species: Annotated[list[str] | None, Query()] = None,
    status: Annotated[list[str] | None, Query()] = None,
    risk: Annotated[list[str] | None, Query()] = None,
    q: str | None = Query(default=None, max_length=120),
    min_lat: float | None = Query(default=None, ge=0.8, le=7.5),
    max_lat: float | None = Query(default=None, ge=0.8, le=7.5),
    min_lng: float | None = Query(default=None, ge=99.3, le=119.5),
    max_lng: float | None = Query(default=None, ge=99.3, le=119.5),
    limit: int = Query(default=200, ge=1, le=500),
    cursor: str | None = None,
    session: Session = Depends(get_session),
) -> SightingListResponse:
    rate_limiter.check("sightings_read", client_address(request))
    offset = decode_cursor(cursor)
    count_expr = func.count(Report.id).filter(ReportSightingLink.active.is_(True))
    latest_expr = func.max(Report.observed_at).filter(ReportSightingLink.active.is_(True))
    statement = (
        select(
            Sighting,
            Species,
            count_expr,
            latest_expr,
            MonitoredArea.name,
            Trail.name,
        )
        .join(Species, Species.id == Sighting.species_id)
        .outerjoin(MonitoredArea, MonitoredArea.id == Sighting.area_id)
        .outerjoin(Trail, Trail.id == Sighting.trail_id)
        .outerjoin(ReportSightingLink, ReportSightingLink.sighting_id == Sighting.id)
        .outerjoin(Report, Report.id == ReportSightingLink.report_id)
        .where(Sighting.status.in_(["screened", "removed"]))
        .group_by(Sighting.id, Species.id, MonitoredArea.name, Trail.name)
        .order_by(Sighting.updated_at.desc(), Sighting.id.desc())
    )
    if species:
        statement = statement.where(Sighting.species_id.in_(species))
    if status:
        allowed = {"screened", "removed"}
        if not set(status).issubset(allowed):
            raise ApiProblem(400, "invalid_filter", "The status filter is invalid.")
        statement = statement.where(Sighting.status.in_(status))
    if risk:
        if not set(risk).issubset({"high", "watch"}):
            raise ApiProblem(400, "invalid_filter", "The risk filter is invalid.")
        statement = statement.where(Sighting.risk.in_(risk))
    if q:
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            or_(Species.name.ilike(pattern), Species.latin_name.ilike(pattern))
        )
    if None not in {min_lat, max_lat, min_lng, max_lng}:
        if min_lat > max_lat or min_lng > max_lng:
            raise ApiProblem(400, "invalid_bbox", "The bounding box is invalid.")
        statement = statement.where(
            Sighting.latitude.between(min_lat, max_lat),
            Sighting.longitude.between(min_lng, max_lng),
        )
    rows = session.execute(statement.offset(offset).limit(limit)).all()
    return SightingListResponse(
        items=[
            serialize_sighting(row[0], row[1], int(row[2]), row[3], row[4], row[5]) for row in rows
        ],
        next_cursor=encode_cursor(offset, len(rows), limit),
    )


@router.get("/{sighting_id}", response_model=SightingDetailResponse)
def sighting_detail(
    sighting_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> SightingDetailResponse:
    rate_limiter.check("sightings_read", client_address(request))
    try:
        import uuid

        parsed_id = uuid.UUID(sighting_id)
    except ValueError as error:
        raise ApiProblem(404, "sighting_not_found", "Not found") from error
    row = session.execute(
        select(
            Sighting,
            Species,
            func.count(Report.id).filter(ReportSightingLink.active.is_(True)),
            func.max(Report.observed_at).filter(ReportSightingLink.active.is_(True)),
            MonitoredArea.name,
            Trail.name,
        )
        .join(Species, Species.id == Sighting.species_id)
        .outerjoin(MonitoredArea, MonitoredArea.id == Sighting.area_id)
        .outerjoin(Trail, Trail.id == Sighting.trail_id)
        .outerjoin(ReportSightingLink, ReportSightingLink.sighting_id == Sighting.id)
        .outerjoin(Report, Report.id == ReportSightingLink.report_id)
        .where(
            Sighting.id == parsed_id,
            Sighting.status.in_(["screened", "removed"]),
        )
        .group_by(Sighting.id, Species.id, MonitoredArea.name, Trail.name)
    ).first()
    if not row:
        raise ApiProblem(404, "sighting_not_found", "Not found")
    summary = serialize_sighting(row[0], row[1], int(row[2]), row[3], row[4], row[5])
    return SightingDetailResponse(
        **summary.model_dump(),
        recommended_action=action_summary(row[1]),
        action_guide=current_action_guide(row[1]),
        reporter_trust=row[0].reporter_trust,
    )
