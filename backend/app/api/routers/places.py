"""Iteration 2 Phase 5 - Epic 5.1 place-based plant discovery endpoints.

* ``GET  /api/v1/places/{place_id}`` - lightweight place metadata used by
  the map / place-picker to know whether a place supports discovery at
  all (an ``unsupported`` geometry_status short-circuits the UI to a
  friendly "coverage not available here yet" state without hitting the
  associations endpoint).
* ``GET  /api/v1/places/{place_id}/plant-associations`` - ranked
  occurrence-based evidence list for the catalogue's 32 species (see
  ``app.domain.place_discovery``).

Both endpoints are read-only and safe to hit without auth so the map can
render place cards to viewers who have not started a private profile yet.
The place-associations payload includes an ``occurrenceDataUpdatedAt``
timestamp and a mandatory ``disclaimer`` so the UI can be honest about
the inference nature of the data.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.core.errors import ApiProblem
from app.db.base import get_session
from app.domain.place_discovery import (
    PlantAssociation,
    PlaceAssociationsResult,
    PlaceRecord,
    compute_associations,
    load_place,
)


router = APIRouter(prefix="/api/v1/places", tags=["places"])


class PlaceResponse(ApiModel):
    place_id: uuid.UUID
    display_name: str
    place_type: str
    geometry_status: str
    geometry_version: str
    source: str


class EvidenceComponentPayload(ApiModel):
    kind: str
    distance_m: float | None
    weight: float
    qualifying_records: int
    most_recent_year: int | None


class RankingFormulaPayload(ApiModel):
    formula: str
    coefficients: dict[str, float]
    components: list[dict[str, object]] = Field(default_factory=list)


class PlantAssociationPayload(ApiModel):
    species_id: str
    scientific_name: str
    common_names: list[str] = Field(default_factory=list)
    catalogue_link: str
    # AC 5.1.6 - the card renders these directly so it never has to fan
    # out to /catalogue/{id} per row.
    reference_image_url: str | None = None
    evidence_codes: list[str] = Field(default_factory=list)
    malaysian_states: list[str] = Field(default_factory=list)
    evidence: list[EvidenceComponentPayload] = Field(default_factory=list)
    total_score: float
    qualifying_records: int
    most_recent_year: int | None
    closest_distance_m: float | None
    inside_area: bool
    direction_aware_evidence: bool
    ranking_formula: RankingFormulaPayload | None = None


class PlantAssociationsResponse(ApiModel):
    place: PlaceResponse
    associations: list[PlantAssociationPayload] = Field(default_factory=list)
    catalogue_version: str
    occurrence_data_updated_at: str | None
    disclaimer: str


def _place_payload(record: PlaceRecord) -> PlaceResponse:
    return PlaceResponse(
        place_id=record.id,
        display_name=record.name,
        place_type=record.place_type,
        geometry_status=record.geometry_status,
        geometry_version=record.geometry_version,
        source=record.source,
    )


def _association_payload(item: PlantAssociation) -> PlantAssociationPayload:
    return PlantAssociationPayload(
        species_id=item.species_id,
        scientific_name=item.scientific_name,
        common_names=item.common_names,
        catalogue_link=item.catalogue_link,
        reference_image_url=item.reference_image_url,
        evidence_codes=item.evidence_codes,
        malaysian_states=item.malaysian_states,
        evidence=[
            EvidenceComponentPayload(
                kind=c.kind,
                distance_m=c.distance_m,
                weight=c.weight,
                qualifying_records=c.qualifying_records,
                most_recent_year=c.most_recent_year,
            )
            for c in item.evidence
        ],
        total_score=item.total_score,
        qualifying_records=item.qualifying_records,
        most_recent_year=item.most_recent_year,
        closest_distance_m=item.closest_distance_m,
        inside_area=item.inside_area,
        direction_aware_evidence=item.direction_aware_evidence,
        ranking_formula=(
            RankingFormulaPayload(
                formula=item.ranking_formula.formula,
                coefficients=item.ranking_formula.coefficients,
                components=item.ranking_formula.components,
            )
            if item.ranking_formula is not None
            else None
        ),
    )


@router.get("/{place_id}", response_model=PlaceResponse)
def get_place(
    place_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> PlaceResponse:
    record = load_place(session, place_id)
    if record is None:
        raise ApiProblem(404, "place_not_found", "Place not found.")
    if record.geometry_status == "unsupported":
        # AC 5.1.1 - a place whose geometry we cannot support for
        # discovery must be a hard 422 so the client cannot silently
        # render an empty associations list as "no plants here". The
        # UI branches on the machine-readable ``code``.
        raise ApiProblem(
            422,
            "PLACE_GEOMETRY_UNSUPPORTED",
            "This place's geometry is not supported for plant discovery.",
        )
    return _place_payload(record)


@router.get(
    "/{place_id}/plant-associations",
    response_model=PlantAssociationsResponse,
)
def plant_associations(
    place_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> PlantAssociationsResponse:
    result: PlaceAssociationsResult | None = compute_associations(session, place_id)
    if result is None:
        raise ApiProblem(404, "place_not_found", "Place not found.")
    if result.place.geometry_status == "unsupported":
        # AC 5.1.1 - see get_place for rationale.
        raise ApiProblem(
            422,
            "PLACE_GEOMETRY_UNSUPPORTED",
            "This place's geometry is not supported for plant discovery.",
        )
    return PlantAssociationsResponse(
        place=_place_payload(result.place),
        associations=[_association_payload(item) for item in result.associations],
        catalogue_version=result.catalogue_version,
        occurrence_data_updated_at=result.occurrence_data_updated_at,
        disclaimer=result.disclaimer,
    )
