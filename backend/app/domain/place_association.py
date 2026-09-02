"""Turns a bare lat/lng into a human-readable place label for a sighting.

Nobody wants to read "3.12345, 101.6789" on a sighting card, so this looks
up whatever OSM-imported area/trail the point falls inside (or is near),
and falls back through a couple of tiers if nothing matches. Called once
per report during screening (see the reporting/screening worker) and the
label gets stored on Sighting.place_label rather than recomputed per read.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from geoalchemy2 import Geography
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.db.models import MonitoredArea, MonitoredPlace, Trail


@dataclass(frozen=True)
class AssociatedPlace:
    display_name: str
    area_id: uuid.UUID | None
    area_name: str | None
    trail_id: uuid.UUID | None
    trail_name: str | None
    # where the match came from: "osm" (area/trail), "seed" (hand-entered
    # MonitoredPlace), or "fallback" (nothing nearby, generic label)
    source: str


def associate_place(
    session: Session, *, latitude: float, longitude: float, accuracy_m: int | None
) -> AssociatedPlace:
    """Best-effort place lookup, tried in order: OSM area/trail, then a seeded
    place within 5km, then a generic "somewhere in Malaysia" fallback so the
    caller always gets something to display.
    """
    point = func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326)
    geography = cast(point, Geography("POINT", srid=4326))
    # smallest covering area wins — if a point falls inside a big national
    # park that itself contains a smaller reserve, we want the specific one
    area = session.execute(
        select(MonitoredArea, func.ST_Area(MonitoredArea.geometry))
        .where(func.ST_Covers(MonitoredArea.geometry, geography))
        .order_by(func.ST_Area(MonitoredArea.geometry))
        .limit(1)
    ).first()
    # search radius scales with the report's own GPS accuracy (worse accuracy
    # -> search wider), clamped so we're never searching an unreasonably
    # small or large radius regardless of what the device reported
    trail_radius = min(250, max(100, (accuracy_m or 50) * 2))
    trail = session.execute(
        select(Trail, func.ST_Distance(Trail.geometry, geography))
        .where(func.ST_DWithin(Trail.geometry, geography, trail_radius))
        .order_by(func.ST_Distance(Trail.geometry, geography))
        .limit(1)
    ).first()
    if area or trail:
        area_item = area[0] if area else None
        trail_item = trail[0] if trail else None
        # a point can be inside an area AND near a trail at once (e.g. "Bukit
        # Kiara · Main Trail") — join whichever of the two we actually found
        label = " · ".join(
            value
            for value in (
                area_item.name if area_item else None,
                trail_item.name if trail_item else None,
            )
            if value
        )
        return AssociatedPlace(
            display_name=label,
            area_id=area_item.id if area_item else None,
            area_name=area_item.name if area_item else None,
            trail_id=trail_item.id if trail_item else None,
            trail_name=trail_item.name if trail_item else None,
            source="osm",
        )

    # no OSM coverage nearby — fall back to the small hand-seeded list before
    # giving up entirely
    seeded = session.execute(
        select(MonitoredPlace, func.ST_Distance(MonitoredPlace.location, geography))
        .where(func.ST_DWithin(MonitoredPlace.location, geography, 5_000))
        .order_by(func.ST_Distance(MonitoredPlace.location, geography))
        .limit(1)
    ).first()
    if seeded:
        return AssociatedPlace(seeded[0].name, None, None, None, None, "seed")
    return AssociatedPlace("Reported location, Malaysia", None, None, None, None, "fallback")
