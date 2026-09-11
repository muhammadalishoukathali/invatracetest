"""Phase 11B - Historical Records map layer.

Read-only feed of cleaned GBIF occurrences suitable for a **separate,
opt-in map layer** so viewers can see where the catalogue's 32 species
have been historically recorded without confusing that evidence with
live community sightings.

* ``GET /api/v1/historical-occurrences`` - bbox-filtered, capped list.

The endpoint is deliberately narrow: only occurrences already present in
``gbif_occurrences`` (i.e. through the ingest pipeline that enforces
country=MY, occurrenceStatus=PRESENT, coordinate uncertainty ≤ 1000 m,
species in the approved 32) are returned. No further filtering is done
on the wire.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.core.errors import ApiProblem
from app.db.base import get_session
from app.db.models import GbifOccurrence, Species


router = APIRouter(prefix="/api/v1/historical-occurrences", tags=["historical"])


class HistoricalOccurrenceItem(ApiModel):
    id: str
    species_id: str
    scientific_name: str
    common_name: str | None = None
    latitude: float
    longitude: float
    event_year: int | None = None
    event_date: date | None = None
    coordinate_uncertainty_m: float | None = None
    basis_of_record: str | None = None
    state_province: str | None = None
    dataset_name: str | None = None
    licence: str | None = None
    source_url: str | None = None
    record_uid: str | None = None


class HistoricalOccurrencesResponse(ApiModel):
    items: list[HistoricalOccurrenceItem] = Field(default_factory=list)
    total_returned: int
    truncated: bool
    disclaimer: str = (
        "Historical observations do not guarantee current presence. "
        "Source: GBIF occurrence records filtered to Malaysia."
    )


_HARD_LIMIT = 2000


@router.get("", response_model=HistoricalOccurrencesResponse)
def list_historical_occurrences(
    bbox: str | None = Query(
        None,
        description="west,south,east,north bounding box (WGS84 decimal degrees).",
    ),
    species_id: str | None = Query(None, description="Filter to a single catalogue species_id."),
    year_min: int | None = Query(None, ge=1900, le=2100, description="Minimum event_year."),
    year_max: int | None = Query(None, ge=1900, le=2100, description="Maximum event_year."),
    limit: int = Query(500, ge=1, le=_HARD_LIMIT),
    session: Session = Depends(get_session),
) -> HistoricalOccurrencesResponse:
    """Return cleaned GBIF occurrences for the Historical Records map layer.

    Bounding-box filter is applied with a plain latitude/longitude range
    (not PostGIS) because the incoming bbox is already axis-aligned in
    WGS84 and the numeric range hits the (latitude, longitude) btree
    without a cast. Ordering is stable-ish by descending event_year so
    a small ``limit`` still surfaces the most recent records first.
    """
    parsed_bbox: tuple[float, float, float, float] | None = None
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
        except ValueError:
            raise ApiProblem(
                422,
                "invalid_bbox",
                "bbox must be 4 comma-separated numbers: west,south,east,north.",
            )
        if len(parts) != 4:
            raise ApiProblem(
                422,
                "invalid_bbox",
                "bbox must be 4 comma-separated numbers: west,south,east,north.",
            )
        west, south, east, north = parts
        if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= 90 and -90 <= north <= 90):
            raise ApiProblem(422, "invalid_bbox", "bbox coordinates out of range.")
        if west > east or south > north:
            raise ApiProblem(422, "invalid_bbox", "bbox must be west<=east and south<=north.")
        parsed_bbox = (west, south, east, north)

    if year_min is not None and year_max is not None and year_min > year_max:
        raise ApiProblem(422, "invalid_year_range", "year_min must be <= year_max.")

    stmt = (
        select(GbifOccurrence, Species.name, Species.latin_name)
        .join(Species, Species.id == GbifOccurrence.species_id)
    )
    if parsed_bbox is not None:
        west, south, east, north = parsed_bbox
        stmt = stmt.where(
            GbifOccurrence.latitude >= south,
            GbifOccurrence.latitude <= north,
            GbifOccurrence.longitude >= west,
            GbifOccurrence.longitude <= east,
        )
    if species_id:
        stmt = stmt.where(GbifOccurrence.species_id == species_id)
    if year_min is not None:
        stmt = stmt.where(GbifOccurrence.event_year >= year_min)
    if year_max is not None:
        stmt = stmt.where(GbifOccurrence.event_year <= year_max)

    stmt = stmt.order_by(GbifOccurrence.event_year.desc().nullslast(), GbifOccurrence.id).limit(limit + 1)

    rows = session.execute(stmt).all()
    truncated = len(rows) > limit
    rows = rows[:limit]

    items: list[HistoricalOccurrenceItem] = []
    for occ, common_name, latin_name in rows:
        items.append(
            HistoricalOccurrenceItem(
                id=str(occ.id),
                species_id=occ.species_id,
                scientific_name=latin_name or "",
                common_name=common_name,
                latitude=float(occ.latitude),
                longitude=float(occ.longitude),
                event_year=occ.event_year,
                event_date=occ.event_date,
                coordinate_uncertainty_m=(
                    float(occ.coordinate_uncertainty_m)
                    if occ.coordinate_uncertainty_m is not None
                    else None
                ),
                basis_of_record=occ.basis_of_record,
                state_province=occ.state_province,
                dataset_name=occ.dataset_name,
                licence=occ.licence,
                source_url=occ.source_url,
                record_uid=occ.record_uid,
            )
        )

    return HistoricalOccurrencesResponse(
        items=items,
        total_returned=len(items),
        truncated=truncated,
    )
