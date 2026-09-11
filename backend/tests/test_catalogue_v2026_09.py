"""Iteration 2 Phase 2 - evidence catalogue v2026-09-08.

The 32-species JSON file backing ``/api/v1/catalogue`` is the authoritative
source of truth for Iteration 2 UI copy. These tests guard against silent
drift: exactly 32 unique records, the deliberately excluded species stay
excluded, the model->catalogue bridge only names species that live in the
list, and the endpoint returns the catalogue with its version + reviewed
date.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.domain.evidence_catalogue import load_evidence_catalogue
from app.domain.model_to_catalogue import (
    MODEL_LABEL_TO_SPECIES_ID,
    resolve_model_label,
)
from app.main import create_app


def test_evidence_catalogue_has_exactly_32_unique_species() -> None:
    catalogue = load_evidence_catalogue()
    ids = [r.species_id for r in catalogue.records]
    assert catalogue.total_species_count == 32
    assert len(ids) == 32
    assert len(set(ids)) == 32
    assert catalogue.catalogue_version == "v2026-09-08"


def test_ageratina_adenophora_stays_excluded() -> None:
    catalogue = load_evidence_catalogue()
    names = {r.scientific_name.lower() for r in catalogue.records}
    assert "ageratina adenophora" not in names


def test_every_record_carries_evidence_and_habitat() -> None:
    for record in load_evidence_catalogue().records:
        assert record.evidence_codes, f"{record.species_id} has no evidence code"
        assert record.evidence_sources, f"{record.species_id} cites no source"
        assert record.habitat, f"{record.species_id} has no habitat"


def test_model_bridge_only_names_species_in_the_catalogue() -> None:
    known = {r.species_id for r in load_evidence_catalogue().records}
    for label, species_id in MODEL_LABEL_TO_SPECIES_ID.items():
        assert species_id in known, f"bridge points {label!r} at unknown {species_id}"


def test_model_bridge_flags_unsupported_labels() -> None:
    result = resolve_model_label("Fictional plantus")
    assert result.species_id is None
    assert result.unsupported_for_catalogue is True


def test_model_bridge_resolves_a_supported_label() -> None:
    result = resolve_model_label("Mikania micrantha")
    assert result.species_id == "mikania-micrantha"
    assert result.unsupported_for_catalogue is False


def test_catalogue_endpoint_reports_version_metadata_even_when_db_empty() -> None:
    # With no seed, the endpoint should still surface catalogue version + count
    # from the manifest so the UI never renders "unknown".
    client = TestClient(create_app())
    resp = client.get("/api/v1/catalogue")
    assert resp.status_code == 200
    body = resp.json()
    assert body["catalogueVersion"] == "v2026-09-08"
    assert body["totalSpeciesCount"] == 32
    assert body["reviewedAt"] == "2026-09-08"


def test_search_endpoint_accepts_empty_query() -> None:
    client = TestClient(create_app())
    resp = client.get("/api/v1/catalogue/search")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["items"], list)


@pytest.mark.parametrize(
    "species_id",
    ["not-a-real-species", "definitely-missing-plant-xyz"],
)
def test_detail_endpoint_404s_for_unknown_species(species_id: str) -> None:
    # Endpoint must fail closed with 404 for species IDs outside the
    # curated 32-species catalogue rather than returning a partial record.
    client = TestClient(create_app())
    resp = client.get(f"/api/v1/catalogue/{species_id}")
    assert resp.status_code == 404
