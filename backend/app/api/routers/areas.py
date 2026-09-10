"""Iteration 2 Phase 7 - Epic 6 adopted areas + activity.

Endpoints:

* ``POST   /api/v1/adopted-areas``            (AC 6.1.1 - 6.1.4)
* ``GET    /api/v1/adopted-areas``            (AC 6.2.2 - 6.2.6)
* ``DELETE /api/v1/adopted-areas/{adoption_id}`` (ownership-checked)
* ``GET    /api/v1/adopted-areas/{adoption_id}/activity`` (AC 6.3.*)

The list endpoint returns the 30-day indicator bundle per adopted place
so the AreasPage does not need a fan-out N+1 for its dashboard. The
activity endpoint returns the DBSCAN clusters + marker list scoped to
the place polygon so AreaActivityMap can render both layers off one
call.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.config import get_settings
from app.core.errors import ApiProblem
from app.core.rate_limit import client_address, rate_limiter
from app.core.security import AuthContext, require_auth
from app.db.base import get_session
from app.db.models import AreaAdoption, MonitoredArea
from app.domain.area_activity import compute_activity


router = APIRouter(prefix="/api/v1/adopted-areas", tags=["adopted-areas"])


class AdoptionCreate(ApiModel):
    place_id: uuid.UUID


class AdoptedAreaIndicators(ApiModel):
    active_sighting_count: int
    distinct_species_count: int
    reports_new_30d: int
    removal_reported_30d: int
    days_since_most_recent: int | None
    reports_previous_30d: int
    change_direction: Literal[
        "increase", "decrease", "unchanged", "insufficient_history"
    ]
    change_pct: float | None
    tolerance_pct: int
    window_days: int


class AdoptedAreaSummary(ApiModel):
    adoption_id: uuid.UUID
    place_id: uuid.UUID
    place_name: str
    place_type: str
    adopted_at: str
    indicators: AdoptedAreaIndicators


class AdoptionCreated(ApiModel):
    adoption_id: uuid.UUID
    place_id: uuid.UUID
    place_name: str
    adopted_at: str


class AdoptedAreaList(ApiModel):
    items: list[AdoptedAreaSummary]
    total: int
    max_per_identity: int


class ActivityCluster(ApiModel):
    cluster_id: int
    point_count: int
    centroid_lat: float
    centroid_lon: float
    species_ids: list[str]


class ActivityMarker(ApiModel):
    sighting_id: uuid.UUID
    species_id: str
    status: str
    latitude: float
    longitude: float
    observed_at: str
    cluster_id: int | None


class ActivitySnapshotResponse(ApiModel):
    adoption_id: uuid.UUID
    place_id: uuid.UUID
    place_name: str
    place_type: str
    window_start_utc: str
    window_end_utc: str
    indicators: AdoptedAreaIndicators
    clusters: list[ActivityCluster] = Field(default_factory=list)
    markers: list[ActivityMarker] = Field(default_factory=list)


SortKey = Literal["adopted_at", "active_sighting_count", "reports_new_30d", "place_name"]


def _to_indicators_payload(indicators) -> AdoptedAreaIndicators:
    return AdoptedAreaIndicators(
        active_sighting_count=indicators.active_sighting_count,
        distinct_species_count=indicators.distinct_species_count,
        reports_new_30d=indicators.reports_new_30d,
        removal_reported_30d=indicators.removal_reported_30d,
        days_since_most_recent=indicators.days_since_most_recent,
        reports_previous_30d=indicators.reports_previous_30d,
        change_direction=indicators.change_direction,
        change_pct=indicators.change_pct,
        tolerance_pct=indicators.tolerance_pct,
        window_days=indicators.window_days,
    )


def _iso(dt) -> str:
    return dt.isoformat().replace("+00:00", "Z")


@router.post("", response_model=AdoptionCreated, status_code=201)
def adopt_area(
    body: AdoptionCreate,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> AdoptionCreated:
    settings = get_settings()

    # AC 6.1.4 - per-identity + per-IP hourly cap. Sliding window so a
    # burst can't creep past the cap by hitting a fixed reset boundary.
    rate_limiter.check("area_adopt_hour", str(auth.profile.id))
    rate_limiter.check("area_adopt_hour", client_address(request))

    place = session.get(MonitoredArea, body.place_id)
    if place is None:
        raise ApiProblem(404, "place_not_found", "Place not found.")

    # Idempotent per (identity, place). A retry lands on the existing
    # adoption instead of surfacing a unique-constraint error.
    existing = session.scalar(
        select(AreaAdoption).where(
            AreaAdoption.profile_id == auth.profile.id,
            AreaAdoption.place_id == body.place_id,
        )
    )
    if existing:
        response.status_code = 200
        return AdoptionCreated(
            adoption_id=existing.id,
            place_id=existing.place_id,
            place_name=place.name,
            adopted_at=_iso(existing.adopted_at),
        )

    # AC 6.1.3 - hard cap on adoptions per identity. Count first, then
    # insert; the unique constraint is the belt-and-suspenders for a
    # concurrent double-insert race that the count could otherwise miss.
    current = session.scalar(
        select(func.count(AreaAdoption.id)).where(AreaAdoption.profile_id == auth.profile.id)
    ) or 0
    if int(current) >= settings.adoption_max_per_identity:
        raise ApiProblem(
            409,
            "ADOPTION_LIMIT_REACHED",
            (
                f"You already have {settings.adoption_max_per_identity} adopted areas - "
                "remove one before adopting another."
            ),
            headers={
                "X-InvaTrace-Adoption-Max": str(settings.adoption_max_per_identity),
                "X-InvaTrace-Adoption-Count": str(int(current)),
            },
        )

    adoption = AreaAdoption(profile_id=auth.profile.id, place_id=body.place_id)
    session.add(adoption)
    session.commit()
    session.refresh(adoption)
    return AdoptionCreated(
        adoption_id=adoption.id,
        place_id=adoption.place_id,
        place_name=place.name,
        adopted_at=_iso(adoption.adopted_at),
    )


@router.get("", response_model=AdoptedAreaList)
def list_adopted_areas(
    sort: SortKey = Query(default="adopted_at"),
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> AdoptedAreaList:
    settings = get_settings()
    rows = session.execute(
        select(AreaAdoption, MonitoredArea)
        .join(MonitoredArea, MonitoredArea.id == AreaAdoption.place_id)
        .where(AreaAdoption.profile_id == auth.profile.id)
    ).all()

    items: list[AdoptedAreaSummary] = []
    for adoption, place in rows:
        snapshot = compute_activity(session, place.id)
        if snapshot is None:
            continue
        items.append(
            AdoptedAreaSummary(
                adoption_id=adoption.id,
                place_id=place.id,
                place_name=place.name,
                place_type=place.place_type,
                adopted_at=_iso(adoption.adopted_at),
                indicators=_to_indicators_payload(snapshot.indicators),
            )
        )

    # AC 6.2.5 - client-selectable sort. Kept server-side so the empty
    # state and the sort read from the same source of truth.
    if sort == "active_sighting_count":
        items.sort(key=lambda x: x.indicators.active_sighting_count, reverse=True)
    elif sort == "reports_new_30d":
        items.sort(key=lambda x: x.indicators.reports_new_30d, reverse=True)
    elif sort == "place_name":
        items.sort(key=lambda x: x.place_name.lower())
    else:
        items.sort(key=lambda x: x.adopted_at, reverse=True)

    return AdoptedAreaList(
        items=items,
        total=len(items),
        max_per_identity=settings.adoption_max_per_identity,
    )


@router.delete("/{adoption_id}", status_code=204)
def remove_adoption(
    adoption_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> Response:
    adoption = session.get(AreaAdoption, adoption_id)
    if adoption is None or adoption.profile_id != auth.profile.id:
        # 404 for either "not found" or "not yours" so we don't leak the
        # existence of another identity's adoption ids.
        raise ApiProblem(404, "adoption_not_found", "Adoption not found.")
    session.delete(adoption)
    session.commit()
    return Response(status_code=204)


@router.get("/{adoption_id}/activity", response_model=ActivitySnapshotResponse)
def adoption_activity(
    adoption_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> ActivitySnapshotResponse:
    adoption = session.get(AreaAdoption, adoption_id)
    if adoption is None or adoption.profile_id != auth.profile.id:
        raise ApiProblem(404, "adoption_not_found", "Adoption not found.")
    snapshot = compute_activity(session, adoption.place_id)
    if snapshot is None:
        raise ApiProblem(404, "place_not_found", "Place not found.")
    return ActivitySnapshotResponse(
        adoption_id=adoption.id,
        place_id=snapshot.place_id,
        place_name=snapshot.place_name,
        place_type=snapshot.place_type,
        window_start_utc=snapshot.window_start_utc,
        window_end_utc=snapshot.window_end_utc,
        indicators=_to_indicators_payload(snapshot.indicators),
        clusters=[
            ActivityCluster(
                cluster_id=c.cluster_id,
                point_count=c.point_count,
                centroid_lat=c.centroid_lat,
                centroid_lon=c.centroid_lon,
                species_ids=c.species_ids,
            )
            for c in snapshot.clusters
        ],
        markers=[
            ActivityMarker(
                sighting_id=m.sighting_id,
                species_id=m.species_id,
                status=m.status,
                latitude=m.latitude,
                longitude=m.longitude,
                observed_at=m.observed_at,
                cluster_id=m.cluster_id,
            )
            for m in snapshot.markers
        ],
    )
