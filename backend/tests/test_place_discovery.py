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


# ---------------------------------------------------------------------------
# Regression tests for the AC 5.1.x guardrails that were re-tightened
# after the iteration-2 audit.
# ---------------------------------------------------------------------------


def test_trail_places_use_trail_buffer_not_park_buffer() -> None:
    """AC 5.1.3 - trail places must draw evidence from a 750m buffer around
    the line, not the 1000m park buffer. A regression to a single
    park-buffer-for-all-place-types would leak trail evidence in from
    250m further out than the AC allows.
    """
    src = _read("app/domain/place_discovery.py")
    # A branch on place_type must select the trail buffer setting.
    assert "discovery_trail_buffer_m" in src
    assert "_TRAIL_PLACE_TYPES" in src
    # Trails must skip the inside bucket - a thin polygon-representation
    # of a trail can technically ST_Cover a point but that is not the
    # semantics the AC intends.
    assert "not is_trail" in src


def test_upstream_uses_line_locate_point_not_euclidean() -> None:
    """AC 5.1.4 - the upstream bucket must use ST_LineLocatePoint /
    ST_LineSubstring to compute a real along-line distance. A Euclidean
    fallback (ST_Distance between the point and the polygon) would let
    a downstream occurrence surface as evidence for an upstream place.
    """
    src = _read("app/domain/place_discovery.py")
    assert "ST_LineLocatePoint" in src
    assert "ST_LineSubstring" in src
    # occurrence fraction must be strictly less than place fraction -
    # OSM waterway linestrings are stored in flow direction.
    assert "occ_frac < place_frac" in src
    # And the along-line distance capped by upstream_max_m.
    assert "along_dist_m <= upstream_max_m" in src


def test_upstream_and_place_ride_same_waterway_segment() -> None:
    """AC 5.1.4 - both the occurrence and the place must intersect a
    buffer of the SAME waterway line, or we cannot claim the occurrence
    is upstream of the place.
    """
    src = _read("app/domain/place_discovery.py")
    # Two separate ST_DWithin gates against Waterway.line.
    assert src.count("Waterway.line") >= 2
    assert "_WATERWAY_SNAP_TOLERANCE_M" in src


def test_distances_are_geodesic_metres_not_degrees() -> None:
    """AC 5.1.3 - ST_Distance / ST_DWithin must run on ``geography``
    values so the units are metres. A ``cast(..., Geometry)`` on either
    side of these calls silently downgrades to degrees, breaking every
    downstream distance-in-metres assertion.
    """
    src = _read("app/domain/place_discovery.py")
    # The distance/DWithin calls must reference the geography columns
    # directly - not wrapped in cast(..., Geometry).
    assert (
        "func.ST_Distance(MonitoredArea.geometry, GbifOccurrence.location)" in src
    )
    assert (
        "func.ST_DWithin(MonitoredArea.geometry, GbifOccurrence.location" in src
    )
    # And the distance / DWithin expressions themselves must not wrap the
    # geography columns in cast(..., Geometry) - a legitimate cast for
    # ST_LineLocatePoint / ST_LineSubstring is allowed further down but
    # never inside a distance/DWithin call.
    assert "ST_Distance(cast(MonitoredArea.geometry, Geometry)" not in src
    assert "ST_DWithin(cast(MonitoredArea.geometry, Geometry)" not in src
    assert "ST_DWithin(cast(Waterway.line, Geometry)" not in src


def test_unsupported_geometry_returns_422_not_200() -> None:
    """AC 5.1.1 - a place whose geometry_status is ``unsupported`` must
    fail with a 422 and a machine-readable ``PLACE_GEOMETRY_UNSUPPORTED``
    code. Returning 200 with an empty associations list would let a
    client render "no invasive plants here" as if it were the real
    answer.
    """
    src = _read("app/api/routers/places.py")
    assert "PLACE_GEOMETRY_UNSUPPORTED" in src
    assert "422" in src


def test_place_response_carries_source_field() -> None:
    """Audit follow-up - the place card in the UI needs a ``source``
    field alongside geometry_status so it can attribute the polygon.
    """
    src = _read("app/api/routers/places.py")
    assert "source: str" in src


def test_ranking_response_includes_formula_block() -> None:
    """AC 5.1.5 - each association row must carry a ``ranking_formula``
    block showing formula, coefficients, and per-component contribution
    so the UI can explain the score.
    """
    src = _read("app/domain/place_discovery.py")
    assert "RankingFormula" in src
    assert "inside_weight" in src
    assert "nearby_weight" in src
    assert "upstream_weight" in src
    assert "decay_scale_m" in src
    router_src = _read("app/api/routers/places.py")
    assert "ranking_formula" in router_src


def test_place_discovery_never_casts_waterway_line_to_geometry_for_distance() -> None:
    """AC 5.1.3 - Waterway.line is a geography column. ST_DWithin against
    it must use it directly so the tolerance argument is metres, not
    degrees.
    """
    src = _read("app/domain/place_discovery.py")
    # The DWithin against Waterway.line must not go through
    # cast(Waterway.line, Geometry) - it must use the geography column
    # directly so the tolerance argument is metres.
    assert "ST_DWithin(cast(Waterway.line, Geometry)" not in src
    assert "ST_DWithin(\n                    cast(Waterway.line, Geometry)" not in src
    assert "ST_DWithin(\n                        cast(Waterway.line, Geometry)" not in src
