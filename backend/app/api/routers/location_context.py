"""Iteration 2 Phase 3 - Epic 3 safe-response location context.

POST /api/v1/location-context takes a fresh device coordinate (lat/lon +
reported accuracy in metres) and answers three questions the scan flow
needs before it can offer any active removal guidance:

  * inside_protected_area  - the point falls inside a gazetted boundary,
    so the app must show the site rules and hide the removal steps.
  * no_intersection        - the point is outside every known protected
    boundary; ``action_eligible`` still gated on the caller re-confirming
    the general active-guidance consent (existing explicit-permission
    step - the response only says "no boundary hit here").
  * boundary_uncertain     - either the reported accuracy exceeds
    LOCATION_ACCURACY_MAX_M, the caller sits outside the dataset's
    coverage box, or the PIP itself errored. This is the fail-closed
    branch (AC 3.3.1c / 3.3.2) - never default to "outside".

The server is authoritative: no client-side polygon check is trusted
because the accuracy gate must not be bypassable, and the boundary
version/source is returned so the UI can attribute what it hit.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from geoalchemy2 import Geometry
from pydantic import Field
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.config import get_settings
from app.db.base import get_session
from app.db.models import ProtectedArea

router = APIRouter(prefix="/api/v1/location-context", tags=["location"])

ContextState = Literal[
    "inside_protected_area", "no_intersection", "boundary_uncertain"
]


class LocationContextRequest(ApiModel):
    # Malaysia bbox - anything outside is treated as boundary_uncertain
    # rather than 422'd, because a coord that far out is almost always a
    # sensor glitch and we should tell the caller so, not blow up.
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    accuracy_m: float = Field(..., ge=0.0, le=100_000.0)


class LocationContextResult(ApiModel):
    context_state: ContextState
    action_eligible: bool
    boundary_source: str | None = None
    boundary_version: str | None = None
    boundary_name: str | None = None
    checked_at: datetime
    # Echo the server-side accuracy ceiling so the UI's disclaimer text
    # stays in sync with the ``config/limits`` value (AC 7.3.1).
    accuracy_ceiling_m: int


# Roughly Malaysia's bounding box - queries whose lat/lon fall outside
# are declared uncertain rather than run through PIP, since our dataset
# only ever covers MY. Keep in sync with location.py's Query() bounds.
_MY_MIN_LAT, _MY_MAX_LAT = 0.5, 7.6
_MY_MIN_LON, _MY_MAX_LON = 99.0, 119.8


def _within_coverage(lat: float, lon: float) -> bool:
    return _MY_MIN_LAT <= lat <= _MY_MAX_LAT and _MY_MIN_LON <= lon <= _MY_MAX_LON


@router.post("", response_model=LocationContextResult)
def location_context(
    payload: LocationContextRequest,
    session: Session = Depends(get_session),
) -> LocationContextResult:
    settings = get_settings()
    checked_at = datetime.now(timezone.utc)
    ceiling = settings.location_accuracy_max_m

    # AC 3.3.1c - fail closed on low-quality fixes. Never say "outside".
    if payload.accuracy_m > ceiling:
        return LocationContextResult(
            context_state="boundary_uncertain",
            action_eligible=False,
            checked_at=checked_at,
            accuracy_ceiling_m=ceiling,
        )

    if not _within_coverage(payload.latitude, payload.longitude):
        return LocationContextResult(
            context_state="boundary_uncertain",
            action_eligible=False,
            checked_at=checked_at,
            accuracy_ceiling_m=ceiling,
        )

    try:
        # PostGIS ST_Contains is a geometry-space predicate, so we drop the
        # stored geography down to geometry for the check. Accuracy on a
        # sub-km polygon at Malaysian latitudes is well under a metre, which
        # is far smaller than any boundary we care about here.
        point_geom = func.ST_SetSRID(
            func.ST_MakePoint(payload.longitude, payload.latitude), 4326
        )
        row = session.execute(
            select(ProtectedArea)
            .where(
                func.ST_Contains(
                    cast(ProtectedArea.geometry, Geometry("MULTIPOLYGON", srid=4326)),
                    point_geom,
                )
            )
            .limit(1)
        ).scalar_one_or_none()
    except Exception:
        # AC 3.3.2 - service or PostGIS error must not default to outside.
        return LocationContextResult(
            context_state="boundary_uncertain",
            action_eligible=False,
            checked_at=checked_at,
            accuracy_ceiling_m=ceiling,
        )

    if row is not None:
        return LocationContextResult(
            context_state="inside_protected_area",
            action_eligible=False,
            boundary_source=row.source,
            boundary_version=row.dataset_version,
            boundary_name=row.name,
            checked_at=checked_at,
            accuracy_ceiling_m=ceiling,
        )

    # AC 3.3.1b - outside every known boundary. Active removal still needs
    # the caller's explicit-permission consent step downstream, so
    # ``action_eligible`` stays False until that gate flips it.
    return LocationContextResult(
        context_state="no_intersection",
        action_eligible=False,
        checked_at=checked_at,
        accuracy_ceiling_m=ceiling,
    )
