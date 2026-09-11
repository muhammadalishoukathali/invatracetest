"""Iteration 2 Phase 7 - Epic 6 regression tests for area_activity fixes.

Covers the AC-clarification blockers uncovered in Epic 6 review:

* AC 6.3.5 first-cycle semantics: previous=0, current>0 -> increase
  (not "insufficient_history"), and the +10% edge is inclusive so
  current == prior*1.10 crosses into "increase".
* AC 6.2.2 window anchor: the 30-day window is anchored to UTC 00:00
  midnight, so a report at 23:59Z on the boundary day is included in
  the window that starts at that day's midnight.
* AC 6.3.4 DBSCAN metric eps: three points ~200 m apart cluster into
  one bucket; three points ~500 m apart do not cluster at eps=250 m.

The DBSCAN cases run against the live PostGIS database so we're
exercising ST_ClusterDBSCAN with the projected metric eps, not a
degree-approximation the earlier code used.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest


# ---- Pure-Python semantic tests ----------------------------------------


def test_classify_change_prior_zero_current_positive_is_increase() -> None:
    """AC 6.3.5 - a first cycle with any current activity is an
    increase in absolute terms; the earlier "insufficient_history"
    label pushed brand-new places into a null state on the UI, which
    hid the very reports the adoption was meant to surface.
    """
    from app.domain.area_activity import _classify_change

    direction, pct = _classify_change(5, 0, 10)
    assert direction == "increase"
    assert pct is None  # percentage undefined, do not invent one.


def test_classify_change_inclusive_upper_edge() -> None:
    """AC 6.3.5 - `current >= prior * 1.10` is an increase (inclusive).
    prior=10, current=11 gives delta_pct=10.0; at tolerance_pct=10 the
    band is exclusive, so 10.0 crosses into "increase".
    """
    from app.domain.area_activity import _classify_change

    direction, pct = _classify_change(11, 10, 10)
    assert direction == "increase"
    assert pct == pytest.approx(10.0)


def test_classify_change_within_band_still_unchanged() -> None:
    from app.domain.area_activity import _classify_change

    # 9.9% is still inside the ±10 band and reads as unchanged.
    direction, pct = _classify_change(1099, 1000, 10)
    assert direction == "unchanged"
    assert pct == pytest.approx(9.9, rel=1e-3)


def test_classify_change_symmetric_lower_edge() -> None:
    from app.domain.area_activity import _classify_change

    # prior=10, current=9 -> delta_pct=-10.0, inclusive edge -> decrease.
    direction, pct = _classify_change(9, 10, 10)
    assert direction == "decrease"
    assert pct == pytest.approx(-10.0)


# ---- Live-DB tests -----------------------------------------------------


@pytest.fixture()
def live_session():
    from app.db.base import SessionLocal

    with SessionLocal() as session:
        yield session
        session.rollback()


def _seed_place_and_species(session) -> tuple[uuid.UUID, str, float, float]:
    """Seed a tiny random polygon (~1 km across) around a random anchor
    inside Sabah, well away from the KL-area seed data. Returns the
    anchor lat/lon so tests place their sightings inside the polygon.
    """
    from app.db.models import MonitoredArea, Species

    # Pick a random offset so successive test runs get non-overlapping
    # polygons and leaked sightings from prior runs cannot creep in.
    import random

    anchor_lat = 5.0 + random.random() * 1.0  # 5.0 - 6.0
    anchor_lon = 117.0 + random.random() * 1.0  # 117.0 - 118.0
    half = 0.01  # ~1 km each side
    lo_lat, hi_lat = anchor_lat - half, anchor_lat + half
    lo_lon, hi_lon = anchor_lon - half, anchor_lon + half
    poly = (
        f"SRID=4326;MULTIPOLYGON((("
        f"{lo_lon} {lo_lat},{hi_lon} {lo_lat},{hi_lon} {hi_lat},"
        f"{lo_lon} {hi_lat},{lo_lon} {lo_lat})))"
    )
    place = MonitoredArea(
        name=f"test-area-{uuid.uuid4().hex[:8]}",
        geometry=poly,
        metadata_json={},
        place_type="park",
        geometry_status="authoritative",
        geometry_version="test-v1",
    )
    session.add(place)

    species_id = f"test-sp-{uuid.uuid4().hex[:6]}"
    existing = session.get(Species, species_id)
    if existing is None:
        session.add(
            Species(
                id=species_id,
                name="Test Plant",
                latin_name="Testus plantus",
                common_names=["test plant"],
                is_invasive=True,
                traits=[],
                removal_steps=[],
                do_not_do=[],
                action_guides=[],
            )
        )
    session.commit()
    session.refresh(place)
    return place.id, species_id, anchor_lat, anchor_lon


def _insert_sighting(session, place_id, species_id, lat, lon, created_at) -> uuid.UUID:
    from app.db.models import Sighting

    s = Sighting(
        species_id=species_id,
        status="screened",
        risk="high",
        latitude=lat,
        longitude=lon,
        reporter_trust="Trusted",
        recommended_action="monitor",
        area_id=place_id,
        place_label="test",
    )
    # Force created_at after insert so we can test window boundaries.
    session.add(s)
    session.commit()
    session.execute(
        __import__("sqlalchemy").text(
            "UPDATE sightings SET created_at = :ts, updated_at = :ts WHERE id = :sid"
        ),
        {"ts": created_at, "sid": s.id},
    )
    session.commit()
    return s.id


def test_activity_snapshot_exposes_geometry_version(live_session) -> None:
    """AC 6.3.1 - the snapshot carries the place's geometry_version so
    the client can bust its polygon cache on re-import."""
    from app.domain.area_activity import compute_activity

    place_id, _, _, _ = _seed_place_and_species(live_session)
    snapshot = compute_activity(live_session, place_id)
    assert snapshot is not None
    assert snapshot.geometry_version == "test-v1"
    # AC 6.3.1 continued - the polygon is emitted as GeoJSON so
    # MapLibre can outline the area directly.
    assert snapshot.geometry_geojson is not None
    assert '"MultiPolygon"' in snapshot.geometry_geojson


def test_utc_midnight_window_includes_boundary_day_report(live_session) -> None:
    """AC 6.2.2 - the 30-day window is anchored to UTC 00:00. A report
    at 23:59:59Z on day N should count in the window whose start is
    that day's UTC midnight (since the window is `[start, start+30d)`
    with start = today_utc - 30d).
    """
    from app.domain.area_activity import compute_activity

    place_id, species_id, lat, lon = _seed_place_and_species(live_session)
    now = datetime(2026, 9, 11, 12, 0, 0, tzinfo=UTC)
    # Boundary day is exactly window_start = today - 30d.
    boundary_day = datetime(2026, 8, 12, 23, 59, 0, tzinfo=UTC)
    _insert_sighting(live_session, place_id, species_id, lat, lon, boundary_day)

    snapshot = compute_activity(live_session, place_id, now=now)
    assert snapshot is not None
    # window_start is 2026-08-12T00:00Z, so the 23:59 report is in-window.
    assert snapshot.indicators.reports_new_30d >= 1


def test_dbscan_clusters_points_at_200m(live_session) -> None:
    """AC 6.3.4 - three points ~200 m apart cluster into a single
    DBSCAN bucket at eps=250 m minPts=3. This exercises the
    ST_Transform-to-3857 projection so a degree-approximation
    regression would fail here at MY latitudes.
    """
    from app.domain.area_activity import compute_activity

    place_id, species_id, lat, lon = _seed_place_and_species(live_session)
    now = datetime(2026, 9, 11, 12, 0, 0, tzinfo=UTC)
    when = now - timedelta(days=5)
    # ~200 m spacing: 0.0018 deg lat ~= 200 m; 0.0018 deg lon ~= 200 m near equator.
    _insert_sighting(live_session, place_id, species_id, lat, lon, when)
    _insert_sighting(live_session, place_id, species_id, lat + 0.0018, lon, when)
    _insert_sighting(live_session, place_id, species_id, lat, lon + 0.0018, when)

    snapshot = compute_activity(live_session, place_id, now=now)
    assert snapshot is not None
    assert len(snapshot.clusters) == 1
    assert snapshot.clusters[0].point_count == 3


def test_dbscan_does_not_cluster_points_at_500m(live_session) -> None:
    """AC 6.3.4 - three points ~500 m apart do not cluster at eps=250 m
    (points are outside each other's neighbourhoods, no core points)."""
    from app.domain.area_activity import compute_activity

    place_id, species_id, lat, lon = _seed_place_and_species(live_session)
    now = datetime(2026, 9, 11, 12, 0, 0, tzinfo=UTC)
    when = now - timedelta(days=5)
    # ~500 m spacing: 0.0045 deg ~= 500 m.
    _insert_sighting(live_session, place_id, species_id, lat, lon, when)
    _insert_sighting(live_session, place_id, species_id, lat + 0.0045, lon, when)
    _insert_sighting(live_session, place_id, species_id, lat, lon + 0.0045, when)

    snapshot = compute_activity(live_session, place_id, now=now)
    assert snapshot is not None
    assert snapshot.clusters == []


def test_markers_include_species_name_and_status_fields(live_session) -> None:
    """AC 6.3.2 - markers carry plant_name, community_report_label,
    observation_date and status_date so the map popover renders without
    an N+1 fan-out.
    """
    from app.domain.area_activity import compute_activity

    place_id, species_id, lat, lon = _seed_place_and_species(live_session)
    now = datetime(2026, 9, 11, 12, 0, 0, tzinfo=UTC)
    _insert_sighting(live_session, place_id, species_id, lat, lon, now - timedelta(days=2))

    snapshot = compute_activity(live_session, place_id, now=now)
    assert snapshot is not None
    assert len(snapshot.markers) >= 1
    m = snapshot.markers[0]
    assert m.plant_name  # non-empty
    assert m.community_report_label == "Community-reported sighting"
    assert m.observation_date is not None
    assert m.current_status == "screened"
    assert m.status_date.endswith("Z")


def test_activity_filters_by_species_id(live_session) -> None:
    """AC 6.3.3 - a species filter narrows both markers and counts."""
    from app.db.models import Species
    from app.domain.area_activity import compute_activity

    place_id, species_id, lat, lon = _seed_place_and_species(live_session)
    other_species_id = f"test-sp-{uuid.uuid4().hex[:6]}"
    live_session.add(
        Species(
            id=other_species_id,
            name="Other Plant",
            latin_name="Otherus plantus",
            common_names=[],
            is_invasive=True,
            traits=[],
            removal_steps=[],
            do_not_do=[],
            action_guides=[],
        )
    )
    live_session.commit()

    now = datetime(2026, 9, 11, 12, 0, 0, tzinfo=UTC)
    _insert_sighting(live_session, place_id, species_id, lat, lon, now - timedelta(days=2))
    _insert_sighting(live_session, place_id, other_species_id, lat + 0.001, lon + 0.001, now - timedelta(days=2))

    all_snap = compute_activity(live_session, place_id, now=now)
    filtered = compute_activity(live_session, place_id, now=now, species_id=species_id)
    assert all_snap is not None and filtered is not None
    assert all_snap.indicators.reports_new_30d >= 2
    # Filter must remove the other-species report.
    assert filtered.indicators.reports_new_30d == 1
    assert all(m.species_id == species_id for m in filtered.markers)
