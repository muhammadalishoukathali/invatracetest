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

"""Public sighting feed and map - the read side of screened reports.

This is what the map/feed view calls. Only ever returns sightings in
status screened or removed (never processing/rejected/needs_rescan - those
stay private on the reporter's own "my reports" list). Coordinates get
run through app/core/privacy.py before going out, since untrusted reporters'
exact locations shouldn't be publicly pinpointable.
"""

router = APIRouter(prefix="/api/v1/sightings", tags=["sightings"])


# Turns a raw Sighting + joined Species/place data into the public API shape.
# Shared by both list_sightings and sighting_detail so the privacy logic and
# place-source labeling only live in one place.
def serialize_sighting(
    sighting: Sighting,
    species: Species,
    report_count: int,
    last_reported_at: datetime | None,
    area_name: str | None,
    trail_name: str | None,
    confidence: float | None = None,
) -> SightingResponse:
    lat, lng, reduced = public_coordinates(
        sighting_id=str(sighting.id),
        latitude=sighting.latitude,
        longitude=sighting.longitude,
        status=sighting.status,
        reporter_trust=sighting.reporter_trust,
    )
    # Tells the frontend how confident to be about the place label - a real
    # OSM match, one of our seeded reference places, or the generic
    # "somewhere in Malaysia" fallback when we couldn't resolve anything.
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
            area_id=str(sighting.area_id) if sighting.area_id is not None else None,
        ),
        thumbnail_url=storage.presign_get(sighting.thumbnail_key)
        if sighting.thumbnail_key
        else None,
        confidence=confidence,
        nearest_feature_type=sighting.nearest_feature_type,
        nearest_feature_name=sighting.nearest_feature_name,
        nearest_feature_distance_m=(
            float(sighting.nearest_feature_distance_m)
            if sighting.nearest_feature_distance_m is not None
            else None
        ),
    )


# Main feed/map query - backs both the list view and the map's marker
# clustering. Supports filtering by species/status/risk/text search plus
# either a lat/lng box or the bbox alias the map view sends when panning.
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
    bbox: str | None = Query(
        default=None,
        description="AC 4.2.1 alias: comma-separated `west,south,east,north` in EPSG:4326",
    ),
    limit: int = Query(default=200, ge=1, le=500),
    cursor: str | None = None,
    session: Session = Depends(get_session),
) -> SightingListResponse:
    # bbox is just a friendlier alias for min/max lat/lng that the map
    # component sends as one query param instead of four - unpack it into
    # the same variables so the rest of the function doesn't care which
    # style the caller used.
    if bbox is not None:
        parts = bbox.split(",")
        if len(parts) != 4:
            raise ApiProblem(400, "invalid_bbox", "bbox must be west,south,east,north.")
        try:
            west, south, east, north = (float(part) for part in parts)
        except ValueError as error:
            raise ApiProblem(400, "invalid_bbox", "bbox values must be numeric.") from error
        for value, lo, hi in (
            (south, 0.8, 7.5),
            (north, 0.8, 7.5),
            (west, 99.3, 119.5),
            (east, 99.3, 119.5),
        ):
            if not lo <= value <= hi:
                raise ApiProblem(400, "invalid_bbox", "bbox is outside the supported region.")
        min_lat, max_lat, min_lng, max_lng = south, north, west, east
    rate_limiter.check("sightings_read", client_address(request))
    offset = decode_cursor(cursor)
    # ReportSightingLink.active filters out reports that got merged into this
    # sighting and then later unlinked (e.g. an admin fixed a bad merge) - we
    # only want currently-active links counted toward report_count.
    count_expr = func.count(Report.id).filter(ReportSightingLink.active.is_(True))
    latest_expr = func.max(Report.observed_at).filter(ReportSightingLink.active.is_(True))
    # AC 4.2.2 - representative confidence per aggregated sighting = the
    # highest confidence across currently-linked reports. Defined consistently
    # for both list and detail endpoints.
    confidence_expr = func.max(Report.confidence).filter(ReportSightingLink.active.is_(True))
    statement = (
        select(
            Sighting,
            Species,
            count_expr,
            latest_expr,
            MonitoredArea.name,
            Trail.name,
            confidence_expr,
        )
        .join(Species, Species.id == Sighting.species_id)
        .outerjoin(MonitoredArea, MonitoredArea.id == Sighting.area_id)
        .outerjoin(Trail, Trail.id == Sighting.trail_id)
        .outerjoin(ReportSightingLink, ReportSightingLink.sighting_id == Sighting.id)
        .outerjoin(Report, Report.id == ReportSightingLink.report_id)
        # AC 4.2.1 - Iteration 1 public map/list expose only `screened`
        # sightings. `removed` stays in the DB for forward compatibility but
        # is not surfaced through the public API until the AC is amended.
        .where(Sighting.status == "screened")
        .group_by(Sighting.id, Species.id, MonitoredArea.name, Trail.name)
        .order_by(Sighting.updated_at.desc(), Sighting.id.desc())
    )
    if species:
        statement = statement.where(Sighting.species_id.in_(species))
    if status:
        allowed = {"screened"}
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
            serialize_sighting(
                row[0], row[1], int(row[2]), row[3], row[4], row[5],
                confidence=float(row[6]) if row[6] is not None else None,
            )
            for row in rows
        ],
        next_cursor=encode_cursor(offset, len(rows), limit),
    )


# Single-sighting detail page - same privacy rules as the list endpoint, plus
# the removal action guidance the map marker's detail panel shows.
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
        # A malformed id isn't a real 400 - we don't want to leak "this
        # exists but the id was wrong" vs "doesn't exist" so it's just 404.
        raise ApiProblem(404, "sighting_not_found", "Not found") from error
    row = session.execute(
        select(
            Sighting,
            Species,
            func.count(Report.id).filter(ReportSightingLink.active.is_(True)),
            func.max(Report.observed_at).filter(ReportSightingLink.active.is_(True)),
            MonitoredArea.name,
            Trail.name,
            func.max(Report.confidence).filter(ReportSightingLink.active.is_(True)),
        )
        .join(Species, Species.id == Sighting.species_id)
        .outerjoin(MonitoredArea, MonitoredArea.id == Sighting.area_id)
        .outerjoin(Trail, Trail.id == Sighting.trail_id)
        .outerjoin(ReportSightingLink, ReportSightingLink.sighting_id == Sighting.id)
        .outerjoin(Report, Report.id == ReportSightingLink.report_id)
        .where(
            Sighting.id == parsed_id,
            # AC 4.2.1 - Iteration 1 public detail also excludes `removed`.
            Sighting.status == "screened",
        )
        .group_by(Sighting.id, Species.id, MonitoredArea.name, Trail.name)
    ).first()
    if not row:
        raise ApiProblem(404, "sighting_not_found", "Not found")
    summary = serialize_sighting(
        row[0], row[1], int(row[2]), row[3], row[4], row[5],
        confidence=float(row[6]) if row[6] is not None else None,
    )
    return SightingDetailResponse(
        **summary.model_dump(),
        recommended_action=action_summary(row[1]),
        action_guide=current_action_guide(row[1]),
        reporter_trust=row[0].reporter_trust,
    )
