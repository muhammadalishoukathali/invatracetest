"""Iteration 2 catalogue endpoints (AC 5.2.1 - 5.2.6).

Serves the 32-species evidence catalogue with its ``catalogue_version`` and
``reviewed_at`` metadata so the app never has to hardcode any of it. Search
is deliberately server-side: case-insensitive substring on scientific name
plus common names, no fuzzy match, empty query returns the full list. The
detail endpoint deep-links from every surface (bestiary card, scan result,
place-discovery hit) so ``/api/v1/catalogue/{species_id}`` is the one and
only reference for a plant.
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
from app.db.models import CatalogueVersion, Species
from app.domain.evidence_catalogue import load_evidence_catalogue

router = APIRouter(prefix="/api/v1/catalogue", tags=["catalogue"])


class CatalogueSpecies(ApiModel):
    species_id: str
    scientific_name: str
    accepted_name_usage: str | None = None
    common_names: list[str]
    evidence_codes: list[str]
    evidence_sources: list[str]
    malaysian_states: list[str]
    habitat: str | None = None
    reference_image_url: str | None = None


class SourceEntry(ApiModel):
    """AC 5.2.5 - structured source rendered by the bestiary drawer."""

    title: str
    url_or_id: str
    image_creator: str | None = None
    licence: str | None = None
    review_date: str | None = None


class CatalogueDetail(CatalogueSpecies):
    identifying_characteristics: str | None = None
    typical_habitat: str | None = None
    documented_impacts: str | None = None
    image_attribution: dict | None = None
    # AC 5.2.4 - never compute severity from model confidence; when we do not
    # have a reviewed formal assessment we say so instead of inventing one.
    formal_severity_assessment_available: bool = Field(default=False)
    beginner_safe_action_available: bool = Field(default=False)
    last_reviewed_at: date | None = None
    # AC 5.2.5 - structured sources with title, url_or_id, optional image
    # creator/licence and per-source review date.
    sources: list[SourceEntry] = Field(default_factory=list)


class CatalogueListResponse(ApiModel):
    catalogue_version: str
    reviewed_at: date
    total_species_count: int
    items: list[CatalogueSpecies]


def _row_to_summary(item: Species) -> CatalogueSpecies:
    return CatalogueSpecies(
        species_id=item.id,
        scientific_name=item.latin_name,
        accepted_name_usage=item.accepted_name_usage,
        common_names=list(item.common_names or []),
        evidence_codes=list(item.evidence_codes or []),
        evidence_sources=list(item.evidence_sources or []),
        malaysian_states=list(item.malaysian_states or []),
        habitat=item.habitat,
        reference_image_url=item.reference_image_url,
    )


@router.get("", response_model=CatalogueListResponse)
def list_catalogue(session: Session = Depends(get_session)) -> CatalogueListResponse:
    manifest = load_evidence_catalogue()
    version_row = session.get(CatalogueVersion, manifest.catalogue_version)
    reviewed_at = version_row.reviewed_at if version_row else manifest.reviewed_at
    total = version_row.total_species_count if version_row else manifest.total_species_count
    species = session.scalars(
        select(Species)
        .where(Species.catalogue_version == manifest.catalogue_version)
        .order_by(Species.latin_name)
    ).all()
    return CatalogueListResponse(
        catalogue_version=manifest.catalogue_version,
        reviewed_at=reviewed_at,
        total_species_count=total,
        items=[_row_to_summary(s) for s in species],
    )


@router.get("/search", response_model=CatalogueListResponse)
def search_catalogue(
    q: str = Query(default="", max_length=120),
    session: Session = Depends(get_session),
) -> CatalogueListResponse:
    query = q.strip().lower()
    manifest = load_evidence_catalogue()
    species = session.scalars(
        select(Species)
        .where(Species.catalogue_version == manifest.catalogue_version)
        .order_by(Species.latin_name)
    ).all()
    if query:
        def _hit(item: Species) -> bool:
            haystacks = [item.latin_name.lower()]
            haystacks.extend((c or "").lower() for c in (item.common_names or []))
            if item.accepted_name_usage:
                haystacks.append(item.accepted_name_usage.lower())
            return any(query in h for h in haystacks)

        species = [s for s in species if _hit(s)]
    return CatalogueListResponse(
        catalogue_version=manifest.catalogue_version,
        reviewed_at=manifest.reviewed_at,
        total_species_count=manifest.total_species_count,
        items=[_row_to_summary(s) for s in species],
    )


@router.get("/{species_id}", response_model=CatalogueDetail)
def catalogue_detail(species_id: str, session: Session = Depends(get_session)) -> CatalogueDetail:
    manifest = load_evidence_catalogue()
    item = session.get(Species, species_id)
    if item is None or item.catalogue_version != manifest.catalogue_version:
        raise ApiProblem(404, "species_not_found", "Not found")
    return CatalogueDetail(
        species_id=item.id,
        scientific_name=item.latin_name,
        accepted_name_usage=item.accepted_name_usage,
        common_names=list(item.common_names or []),
        evidence_codes=list(item.evidence_codes or []),
        evidence_sources=list(item.evidence_sources or []),
        malaysian_states=list(item.malaysian_states or []),
        habitat=item.habitat,
        reference_image_url=item.reference_image_url,
        identifying_characteristics=item.identifying_characteristics,
        typical_habitat=item.typical_habitat,
        documented_impacts=item.documented_impacts,
        image_attribution=item.image_attribution,
        formal_severity_assessment_available=bool(item.severity_assessment_available),
        beginner_safe_action_available=bool(item.beginner_safe_action_available),
        last_reviewed_at=(
            item.last_reviewed_at.date() if item.last_reviewed_at else None
        ),
        sources=[
            SourceEntry(**s) for s in (item.sources or []) if isinstance(s, dict)
        ],
    )
