"""Iteration 2 Phase 5 / Phase 10 Wave 2a - place discovery invariants.

Two flavours of test live here:

* Text-based asserts against the migration, models and router source
  so a future edit that silently loosens an AC guardrail (catalogue
  version filter, ranking that mixes inside with nearby, 422 for
  unsupported geometry) fails a test rather than shipping.
* Pure-python unit tests against the direction-aware Dijkstra layer
  (``compute_upstream_evidence``'s in-memory graph). These exercise the
  same-way and cross-way branches with hand-built ``Segment`` fixtures
  so we can trap regressions without a live PostGIS session.

The DB-backed integration paths (ST_LineLocatePoint snap, ST_Distance in
metres, real WaterwayWay rows) run in the docker Compose integration
suite - see backend/tests/integration/.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.domain.place_discovery import (
    EvidenceComponent,
    OccurrenceCandidate,
    PlantAssociation,
    RankingFormula,
    Segment,
    SnapPoint,
    build_adjacency,
    dijkstra_upstream_distance,
    rank,
    segments_from_way,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


# ---------------------------------------------------------------------------
# Migration / model / router source-text guardrails (unchanged in spirit).
# ---------------------------------------------------------------------------


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
    assert 'country_code = \'MY\'' in body
    assert 'occurrence_status = \'PRESENT\'' in body
    assert "catalogue_version" in body
    # Wave 2a - the row-level gating flag for the upstream bucket.
    assert "eligible_for_waterway_direction" in body


def test_waterway_way_model_carries_node_order_and_geometry() -> None:
    src = _read("app/db/models.py")
    assert "class WaterwayWay" in src
    body = src.split("class WaterwayWay", 1)[1].split("class ", 1)[0]
    # AC 5.1.4 - direction basis is OSM node order, so the runtime needs
    # the node_ids array to split each way into directed segments.
    assert "node_ids" in body
    assert "LINESTRING" in body
    assert "direction_basis" in body


def test_species_dispersal_trait_model_gates_upstream_bucket() -> None:
    src = _read("app/db/models.py")
    assert "class SpeciesDispersalTrait" in src
    body = src.split("class SpeciesDispersalTrait", 1)[1].split("class ", 1)[0]
    # Curated review flag is the sole permitted gate - habitat string
    # matching is explicitly forbidden as a substitute.
    assert "waterway_direction_eligible" in body


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


def test_place_discovery_uses_curated_trait_not_habitat() -> None:
    src = _read("app/domain/place_discovery.py")
    # AC 5.1.4 - direction-aware upstream evidence is gated on the
    # curated SpeciesDispersalTrait review row, never on Species.habitat.
    assert "SpeciesDispersalTrait" in src
    assert "waterway_direction_eligible" in src
    # And the occurrence row's own gating flag must be honoured too.
    assert "eligible_for_waterway_direction" in src
    # Guardrail: no lingering habitat-string matching for water eligibility.
    assert "_WATER_DISPERSAL_HABITATS" not in src


def test_place_discovery_returns_a_disclaimer() -> None:
    src = _read("app/domain/place_discovery.py")
    assert "disclaimer=" in src
    assert "not a live census" in src


def test_place_discovery_ranking_prefers_inside_over_nearby() -> None:
    src = _read("app/domain/place_discovery.py")
    # AC 5.1.6 - the ranker must sort by tier first (inside > nearby >
    # upstream-only). A future refactor that reorders these keys would
    # silently downgrade the inside evidence bucket.
    assert "-r.tier" in src


def test_place_router_registered_in_main() -> None:
    src = _read("app/main.py")
    assert "places," in src
    assert "places.router" in src


def test_place_router_exposes_both_endpoints() -> None:
    src = _read("app/api/routers/places.py")
    assert '"/{place_id}"' in src
    assert '"/{place_id}/plant-associations"' in src


def test_place_discovery_uses_config_snap_tolerance_not_hardcoded() -> None:
    src = _read("app/domain/place_discovery.py")
    # Config-driven, not the retired hardcoded 250 m constant.
    assert "waterway_snap_tolerance_m" in src
    assert "_WATERWAY_SNAP_TOLERANCE_M" not in src


def test_place_discovery_uses_fetch_radius_setting() -> None:
    src = _read("app/domain/place_discovery.py")
    # Handover doc 2 - spatial fetch uses waterway_fetch_radius_km.
    assert "waterway_fetch_radius_km" in src


def test_trail_places_use_trail_buffer_not_park_buffer() -> None:
    src = _read("app/domain/place_discovery.py")
    assert "discovery_trail_buffer_m" in src
    assert "_TRAIL_PLACE_TYPES" in src


def test_distances_are_geodesic_metres_not_degrees() -> None:
    src = _read("app/domain/place_discovery.py")
    # AC 5.1.3 - the inside/nearby query must run against the geography
    # columns directly so ST_Distance/ST_DWithin return metres.
    assert (
        "func.ST_Distance(MonitoredArea.geometry, GbifOccurrence.location)" in src
    )
    assert (
        "func.ST_DWithin(MonitoredArea.geometry, GbifOccurrence.location" in src
    )
    # And no cast-to-Geometry wrapper on either side of those calls.
    assert "ST_Distance(cast(MonitoredArea.geometry, Geometry)" not in src
    assert "ST_DWithin(cast(MonitoredArea.geometry, Geometry)" not in src


def test_unsupported_geometry_returns_422_not_200() -> None:
    src = _read("app/api/routers/places.py")
    assert "PLACE_GEOMETRY_UNSUPPORTED" in src
    assert "422" in src


def test_place_response_carries_source_field() -> None:
    src = _read("app/api/routers/places.py")
    assert "source: str" in src


def test_ranking_response_includes_formula_block() -> None:
    src = _read("app/domain/place_discovery.py")
    assert "RankingFormula" in src
    assert "inside_weight" in src
    assert "nearby_weight" in src
    assert "upstream_weight" in src
    assert "decay_scale_m" in src
    router_src = _read("app/api/routers/places.py")
    assert "ranking_formula" in router_src


# ---------------------------------------------------------------------------
# Dijkstra layer - pure-python unit tests (no DB).
# ---------------------------------------------------------------------------


def _way(way_uuid: uuid.UUID, osm_way_id: int, nodes: list[int], length_m: float) -> list[Segment]:
    return segments_from_way(way_uuid, osm_way_id, "stream", nodes, length_m)


def test_upstream_same_way_respects_line_fractions() -> None:
    """Occurrence at frac 0.2, place at frac 0.6 on the same 1000 m way
    -> along-line distance ~ 400 m."""
    way_id = uuid.uuid4()
    # 5 segments of 200 m each. Frac 0.2 = end of seg 0, frac 0.6 = mid of seg 2.
    segs = _way(way_id, 1, [1, 2, 3, 4, 5, 6], 1000.0)
    way_segments = {way_id: segs}
    adj = build_adjacency(segs)
    # Occurrence at frac 0.2 -> segment_index 1 local_frac 0.
    occ = SnapPoint(way_id=way_id, segment_index=1, local_frac=0.0, distance_to_way_m=0.0)
    # Place at frac 0.6 -> segment_index 3 local_frac 0.
    place = SnapPoint(way_id=way_id, segment_index=3, local_frac=0.0, distance_to_way_m=0.0)
    d = dijkstra_upstream_distance(occ, place, way_segments, adj, 5_000.0)
    assert d is not None
    # (1 - 0)*200 + 200 + 0*200 = 400.
    assert abs(d - 400.0) < 1e-6


def test_upstream_same_way_downstream_omitted() -> None:
    """Reverse order (occurrence at a larger frac than the place) -> no
    upstream evidence."""
    way_id = uuid.uuid4()
    segs = _way(way_id, 2, [1, 2, 3, 4, 5, 6], 1000.0)
    way_segments = {way_id: segs}
    adj = build_adjacency(segs)
    occ = SnapPoint(way_id=way_id, segment_index=3, local_frac=0.0, distance_to_way_m=0.0)
    place = SnapPoint(way_id=way_id, segment_index=1, local_frac=0.0, distance_to_way_m=0.0)
    assert dijkstra_upstream_distance(occ, place, way_segments, adj, 5_000.0) is None


def test_upstream_cross_way_connected_included() -> None:
    """Two ways joined at a shared node, cumulative distance under 5 km."""
    way_a = uuid.uuid4()
    way_b = uuid.uuid4()
    # Way A: nodes 1-2-3 (500m each = 1000m total). Way B starts at 3.
    segs_a = _way(way_a, 10, [1, 2, 3], 1000.0)
    segs_b = _way(way_b, 11, [3, 4, 5], 800.0)
    way_segments = {way_a: segs_a, way_b: segs_b}
    adj = build_adjacency(segs_a + segs_b)
    # Occurrence on way A near the START (segment 0 local_frac 0.0).
    occ = SnapPoint(way_id=way_a, segment_index=0, local_frac=0.0, distance_to_way_m=0.0)
    # Place on way B at segment 1 local_frac 0 -> from_node = 4.
    place = SnapPoint(way_id=way_b, segment_index=1, local_frac=0.0, distance_to_way_m=0.0)
    d = dijkstra_upstream_distance(occ, place, way_segments, adj, 5_000.0)
    assert d is not None
    # 1000 (all of way A) + 400 (first seg of way B) = 1400.
    assert abs(d - 1400.0) < 1e-6


def test_upstream_cross_way_disconnected_omitted() -> None:
    way_a = uuid.uuid4()
    way_b = uuid.uuid4()
    segs_a = _way(way_a, 20, [1, 2, 3], 1000.0)
    segs_b = _way(way_b, 21, [10, 11, 12], 800.0)  # no shared node
    way_segments = {way_a: segs_a, way_b: segs_b}
    adj = build_adjacency(segs_a + segs_b)
    occ = SnapPoint(way_id=way_a, segment_index=0, local_frac=0.0, distance_to_way_m=0.0)
    place = SnapPoint(way_id=way_b, segment_index=1, local_frac=0.0, distance_to_way_m=0.0)
    assert dijkstra_upstream_distance(occ, place, way_segments, adj, 5_000.0) is None


def test_upstream_over_5km_omitted() -> None:
    way_id = uuid.uuid4()
    segs = _way(way_id, 30, [1, 2, 3], 10_000.0)  # two 5000 m segments
    way_segments = {way_id: segs}
    adj = build_adjacency(segs)
    occ = SnapPoint(way_id=way_id, segment_index=0, local_frac=0.0, distance_to_way_m=0.0)
    place = SnapPoint(way_id=way_id, segment_index=1, local_frac=0.5, distance_to_way_m=0.0)
    # Route length = 5000 + 0.5*5000 = 7500 m > 5000 m cap.
    assert dijkstra_upstream_distance(occ, place, way_segments, adj, 5_000.0) is None


def test_upstream_snap_tolerance_boundary() -> None:
    """A candidate whose nearest way is beyond the configured snap
    tolerance is dropped before Dijkstra runs. We assert on the pure-
    python helper by simulating a missing snap - the caller either
    returns SnapPoint or None.
    """
    from app.domain.place_discovery import _snap_from_fraction

    way_id = uuid.uuid4()
    segs = _way(way_id, 31, [1, 2], 100.0)
    # Fraction outside 0..1 gets clamped, but a missing way -> None.
    assert _snap_from_fraction(uuid.uuid4(), 0.5, 10.0, {way_id: segs}) is None
    snap = _snap_from_fraction(way_id, 0.5, 10.0, {way_id: segs})
    assert snap is not None
    assert snap.segment_index == 0
    assert 0.499 <= snap.local_frac <= 0.501


def test_upstream_species_without_trait_omitted() -> None:
    """The DB-side fetch joins SpeciesDispersalTrait with an INNER JOIN
    plus waterway_direction_eligible=True; a species without a trait
    row therefore never surfaces. Source-text guardrail.
    """
    src = _read("app/domain/place_discovery.py")
    assert "SpeciesDispersalTrait.waterway_direction_eligible.is_(True)" in src


def test_upstream_species_row_flag_false_omitted() -> None:
    src = _read("app/domain/place_discovery.py")
    # AC 5.1.4 - the occurrence row's own flag must be honoured, not
    # only the species-level trait.
    assert "GbifOccurrence.eligible_for_waterway_direction.is_(True)" in src


def test_trail_buffer_used_for_trail_place() -> None:
    src = _read("app/domain/place_discovery.py")
    # A place_type of ``trail`` or ``line`` selects the trail buffer and
    # tags the evidence component with a distinct kind so the UI can
    # render it separately from a park's ``nearby`` bucket.
    assert '"trail"' in src
    assert '"line"' in src
    assert '"trail_buffer"' in src


def test_ranking_inside_beats_nearby_beats_upstream_only() -> None:
    """Three species: one inside, one nearby, one upstream-only.
    Ranked list must come out in that tier order."""
    inside = PlantAssociation(
        species_id="A", scientific_name="A sp.", common_names=[],
        catalogue_link="/plants/A",
        evidence=[EvidenceComponent(kind="inside", distance_m=0.0, weight=1.0,
                                    qualifying_records=1, most_recent_year=2024)],
        total_score=1.5, inside_area=True, closest_distance_m=0.0,
    )
    nearby = PlantAssociation(
        species_id="B", scientific_name="B sp.", common_names=[],
        catalogue_link="/plants/B",
        evidence=[EvidenceComponent(kind="nearby", distance_m=500.0, weight=0.5,
                                    qualifying_records=1, most_recent_year=2024)],
        total_score=0.5, closest_distance_m=500.0,
    )
    upstream = PlantAssociation(
        species_id="C", scientific_name="C sp.", common_names=[],
        catalogue_link="/plants/C",
        evidence=[EvidenceComponent(kind="upstream_waterway", distance_m=2000.0,
                                    weight=0.3, qualifying_records=1,
                                    most_recent_year=2024)],
        total_score=0.12, direction_aware_evidence=True, closest_network_m=2000.0,
    )
    ranked = rank([upstream, nearby, inside], buffer_m=1000.0, upstream_max_m=5000.0)
    assert [r.species_id for r in ranked] == ["A", "B", "C"]
    assert ranked[0].tier == 3
    assert ranked[1].tier == 2
    assert ranked[2].tier == 1


def test_upstream_only_species_tier_1() -> None:
    """A species whose only evidence is an upstream_waterway component
    still surfaces (tier 1) - it does NOT get filtered out just because
    it has no nearby/inside bucket."""
    upstream = PlantAssociation(
        species_id="Z", scientific_name="Z sp.", common_names=[],
        catalogue_link="/plants/Z",
        evidence=[EvidenceComponent(kind="upstream_waterway", distance_m=1000.0,
                                    weight=0.4, qualifying_records=2,
                                    most_recent_year=2023)],
        total_score=0.16, direction_aware_evidence=True, closest_network_m=1000.0,
    )
    ranked = rank([upstream], buffer_m=1000.0, upstream_max_m=5000.0)
    assert len(ranked) == 1
    assert ranked[0].tier == 1


def test_segments_from_way_equal_share_length() -> None:
    way_id = uuid.uuid4()
    segs = segments_from_way(way_id, 42, "river", [1, 2, 3, 4], 900.0)
    assert len(segs) == 3
    for s in segs:
        assert abs(s.length_m - 300.0) < 1e-9
    assert segs[0].from_node_id == 1 and segs[0].to_node_id == 2
    assert segs[-1].to_node_id == 4


def test_segments_from_way_rejects_degenerate_input() -> None:
    assert segments_from_way(uuid.uuid4(), 1, "stream", [], 0.0) == []
    assert segments_from_way(uuid.uuid4(), 1, "stream", [42], 100.0) == []


def test_dijkstra_respects_pop_budget() -> None:
    """A pathological many-branch graph must halt at the max_pops cap
    rather than running unbounded."""
    way_a = uuid.uuid4()
    way_b = uuid.uuid4()
    segs_a = _way(way_a, 50, [1, 2], 100.0)
    # 500 parallel dead-end edges from node 2 - a Dijkstra without a
    # cap would explore all of them before giving up.
    dead_end_segs: list[Segment] = []
    for i in range(500):
        dead_end_segs.append(
            Segment(
                way_id=way_b,
                osm_way_id=51,
                waterway_type="stream",
                from_node_id=2,
                to_node_id=1000 + i,
                segment_index=0,
                n_segments=1,
                length_m=1.0,
                way_frac_start=0.0,
                way_frac_end=1.0,
            )
        )
    way_segments = {way_a: segs_a, way_b: dead_end_segs}
    adj = build_adjacency(segs_a + dead_end_segs)
    occ = SnapPoint(way_id=way_a, segment_index=0, local_frac=0.0, distance_to_way_m=0.0)
    # Place on an unreachable way.
    unreachable = uuid.uuid4()
    unreachable_segs = _way(unreachable, 99, [7000, 7001], 100.0)
    way_segments[unreachable] = unreachable_segs
    place = SnapPoint(way_id=unreachable, segment_index=0, local_frac=0.5, distance_to_way_m=0.0)
    # Cap pops very low; must return None (no path) without hanging.
    d = dijkstra_upstream_distance(
        occ, place, way_segments, adj, 5_000.0, max_pops=50
    )
    assert d is None
