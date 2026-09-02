"""AC 4.3.1 / 4.3.2 — nearest OpenStreetMap-derived feature within 5km, with fallback."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from geoalchemy2 import Geography
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.db.base import get_session
from app.db.models import MonitoredArea, MonitoredPlace, Trail

router = APIRouter(prefix="/api/v1/location-context", tags=["location"])

FeatureType = Literal["trail", "park", "forest", "wood", "seed", "none"]


class LocationContextResponse(ApiModel):
    found: bool
    feature_type: FeatureType | None = None
    feature_name: str | None = None
    distance_m: float | None = None
    context_status: Literal["available", "temporarily_unavailable"] = "available"


def _classify_area(name: str, metadata: dict) -> Literal["park", "forest", "wood"]:
    tags = ((metadata or {}).get("tags") or {})
    if tags.get("landuse") == "forest":
        return "forest"
    if tags.get("natural") == "wood":
        return "wood"
    return "park"


@router.get("", response_model=LocationContextResponse)
def location_context(
    lat: float = Query(..., ge=0.8, le=7.5),
    lon: float = Query(..., ge=99.3, le=119.5),
    radius_m: int = Query(default=5000, ge=100, le=10000),
    session: Session = Depends(get_session),
) -> LocationContextResponse:
    try:
        point = func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)
        geography = cast(point, Geography("POINT", srid=4326))

        # AC 4.3.1: prefer named trails (highway=path/footway/track), parks, forests, woods.
        trail = session.execute(
            select(Trail, func.ST_Distance(Trail.geometry, geography))
            .where(func.ST_DWithin(Trail.geometry, geography, radius_m))
            .order_by(func.ST_Distance(Trail.geometry, geography))
            .limit(1)
        ).first()

        area = session.execute(
            select(MonitoredArea, func.ST_Distance(MonitoredArea.geometry, geography))
            .where(func.ST_DWithin(MonitoredArea.geometry, geography, radius_m))
            .order_by(func.ST_Distance(MonitoredArea.geometry, geography))
            .limit(1)
        ).first()

        candidates: list[tuple[FeatureType, str, float]] = []
        if trail is not None:
            candidates.append(("trail", trail[0].name, float(trail[1])))
        if area is not None:
            candidates.append(
                (_classify_area(area[0].name, area[0].metadata_json or {}), area[0].name, float(area[1]))
            )

        if candidates:
            candidates.sort(key=lambda item: item[2])
            feature_type, feature_name, distance = candidates[0]
            return LocationContextResponse(
                found=True,
                feature_type=feature_type,
                feature_name=feature_name,
                distance_m=round(distance, 1),
            )

        # Seed-place fallback (still real data, not fabricated)
        seeded = session.execute(
            select(MonitoredPlace, func.ST_Distance(MonitoredPlace.location, geography))
            .where(func.ST_DWithin(MonitoredPlace.location, geography, radius_m))
            .order_by(func.ST_Distance(MonitoredPlace.location, geography))
            .limit(1)
        ).first()
        if seeded is not None:
            return LocationContextResponse(
                found=True,
                feature_type="seed",
                feature_name=seeded[0].name,
                distance_m=round(float(seeded[1]), 1),
            )

        # AC 4.3.2: no result — surface `found=false`; caller must not fabricate a name.
        return LocationContextResponse(found=False)
    except Exception:
        # AC 4.3.2: OSM/PostGIS failure must not block report publication.
        return LocationContextResponse(
            found=False,
            context_status="temporarily_unavailable",
        )
