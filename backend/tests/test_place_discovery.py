"""Iteration 2 Phase 5 - Epic 5.1 place discovery invariants.

Text-based asserts against the router, model and domain sources so a
future edit that silently loosens an AC guardrail (Euclidean fallback for
undirected waterways, missing catalogue-version filter, ranking that
mixes inside with nearby) fails a test rather than shipping.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_places_migration_present() -> None:
    src = _read("alembic/versions/20260911_16_places_and_occurrences.py")
    assert "CREATE TABLE gbif_occurrences" in src
    assert "CREATE TABLE waterways" in src
    assert "ADD COLUMN IF NOT EXISTS place_type" in src
    assert "ADD COLUMN IF NOT EXISTS geometry_status" in src
    assert 'down_revision = "20260911_15"' in src


def test_gbif_occurrence_model_constrained_to_my_present() -> None:
    src = _read("app/db/models.py")
    assert "class GbifOccurrence" in src
    body = src.split("class GbifOccurrence", 1)[1].split("class ", 1)[0]
    # AC 5.1.5 - occurrence source is filtered at the DB layer, not just
    # the importer. A regression in the importer cannot smuggle absent
    # or non-MY records through.
    assert 'country_code = \'MY\'' in body
    assert 'occurrence_status = \'PRESENT\'' in body
    assert "catalogue_version" in body


def test_waterway_model_has_directed_flag() -> None:
    src = _read("app/db/models.py")
    assert "class Waterway" in src
    body = src.split("class Waterway", 1)[1].split("class ", 1)[0]
    # AC 5.1.4b - undirected segments must never surface an upstream
    # evidence bucket; the model needs the flag so the domain query can
    # filter on it.
    assert "directed" in body
    assert "LINESTRING" in body


def test_monitored_area_gains_place_metadata() -> None:
    src = _read("app/db/models.py")
    for column in ("place_type", "geometry_status", "geometry_version"):
        assert column in src, (
            f"MonitoredArea must expose `{column}` so /places can advertise"
            " whether discovery is supported at this place."
        )


def test_place_discovery_filters_by_current_catalogue_version() -> None:
    src = _read("app/domain/place_discovery.py")
    # AC 5.1.5 - occurrences that pre-date the current catalogue must be
    # excluded so a version bump can drop a discredited row set without
    # leaking through the association endpoint.
    assert "catalogue_version == catalogue_version" in src


def test_place_discovery_never_falls_back_to_euclidean_for_undirected() -> None:
    src = _read("app/domain/place_discovery.py")
    # AC 5.1.4b - the upstream_waterway bucket must be gated on
    # Waterway.directed=True; the query itself must join only directed
    # segments and no Euclidean fallback path may exist.
    assert "Waterway.directed.is_(True)" in src
    # Guardrail: nothing that suggests undirected segments participate.
    assert "directed.is_(False)" not in src


def test_place_discovery_returns_a_disclaimer() -> None:
    src = _read("app/domain/place_discovery.py")
    # AC 5.1.6 - the payload must carry a disclaimer so the UI cannot
    # accidentally render occurrence-based inference as a live census.
    assert "disclaimer:" in src or "disclaimer=" in src
    assert "not a live census" in src


def test_place_discovery_ranking_prefers_inside_over_nearby() -> None:
    src = _read("app/domain/place_discovery.py")
    # AC 5.1.6 - the ranker must sort by inside_area first; a future
    # refactor that reorders these keys would silently downgrade the
    # inside evidence bucket to just another weight.
    assert "not r.inside_area" in src


def test_place_router_registered_in_main() -> None:
    src = _read("app/main.py")
    assert "places," in src
    assert "places.router" in src


def test_place_router_exposes_both_endpoints() -> None:
    src = _read("app/api/routers/places.py")
    assert '"/{place_id}"' in src
    assert '"/{place_id}/plant-associations"' in src
