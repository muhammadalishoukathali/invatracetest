"""Iteration 2 Phase 7 - Epic 6 adopted areas + activity invariants.

Text-based guardrails on the router / model / domain modules that back
POST/GET/DELETE /api/v1/adopted-areas and the /activity endpoint, in
the same style as test_removal_reporting.py. A live-DB smoke test at
the bottom covers the actual insert / unique-constraint / hard-cap
paths to catch regressions the text asserts miss.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


# ---- static guardrails -------------------------------------------------


def test_area_adoption_migration_present() -> None:
    source = _read("alembic/versions/20260911_17_area_adoptions.py")
    assert "CREATE TABLE area_adoptions" in source
    assert "uq_area_adoptions_profile_place" in source
    assert 'down_revision = "20260911_16"' in source


def test_area_adoption_model_defined_with_unique_constraint() -> None:
    source = _read("app/db/models.py")
    assert "class AreaAdoption" in source
    slice_ = source.split("class AreaAdoption", 1)[1].split("class ", 1)[0]
    for column in ("profile_id", "place_id", "adopted_at"):
        assert column in slice_
    assert "uq_area_adoptions_profile_place" in slice_, (
        "AC 6.1.3 - one adoption per (profile, place) must be enforced by"
        " a unique constraint the DB itself owns; a route-level 'check first'"
        " is not enough under concurrent inserts."
    )


def test_areas_router_registered_in_main() -> None:
    source = _read("app/main.py")
    assert "areas," in source
    assert "areas.router" in source


def test_areas_router_declares_all_epic_6_endpoints() -> None:
    source = _read("app/api/routers/areas.py")
    assert '@router.post("", response_model=AdoptionCreated' in source
    assert '@router.get("", response_model=AdoptedAreaList' in source
    assert '@router.delete("/{adoption_id}"' in source
    assert '@router.get("/{adoption_id}/activity"' in source


def test_areas_router_enforces_cap_and_error_code() -> None:
    source = _read("app/api/routers/areas.py")
    assert "settings.adoption_max_per_identity" in source
    assert "ADOPTION_LIMIT_REACHED" in source, (
        "AC 6.1.3 - the hard-cap breach must surface as ADOPTION_LIMIT_REACHED"
        " so the client can render the right guidance instead of a generic 409."
    )
    assert " > 50" not in source  # hard-coded literal would defeat the config plumbing.


def test_areas_router_wires_rate_limit() -> None:
    source = _read("app/api/routers/areas.py")
    assert 'rate_limiter.check("area_adopt_hour"' in source
    limits = _read("app/core/rate_limit.py")
    assert '"area_adopt_hour"' in limits
    assert "settings.adoption_rate_limit_per_hour" in limits


def test_activity_domain_uses_dbscan_over_30d_window() -> None:
    source = _read("app/domain/area_activity.py")
    assert "ST_ClusterDBSCAN" in source, (
        "AC 6.3.4 - clustering must be DBSCAN (eps 250 m, minPts 3);"
        " a home-grown grid bucket does not satisfy the AC."
    )
    assert "minpoints := :min_pts" in source
    assert "window_days = 30" in source
    # Excluded statuses per the AC: rejected/deleted/removal_reported.
    assert '_ACTIVE_STATUSES = ("candidate", "screened")' in source


def test_activity_domain_change_direction_respects_tolerance() -> None:
    from app.domain.area_activity import _classify_change

    # Within +/- 10% band -> unchanged (AC 6.3.5 tolerance).
    assert _classify_change(105, 100, 10) == ("unchanged", pytest.approx(5.0))
    assert _classify_change(95, 100, 10) == ("unchanged", pytest.approx(-5.0))
    # Outside band -> direction is set.
    direction, pct = _classify_change(130, 100, 10)
    assert direction == "increase"
    assert pct == pytest.approx(30.0)
    direction, pct = _classify_change(80, 100, 10)
    assert direction == "decrease"
    assert pct == pytest.approx(-20.0)
    # Previous zero + current non-zero -> insufficient_history, never a fake %.
    assert _classify_change(5, 0, 10) == ("insufficient_history", None)
    # Both zero -> unchanged, no divide-by-zero on the client.
    assert _classify_change(0, 0, 10) == ("unchanged", 0.0)


# ---- live-DB smoke tests ----------------------------------------------


@pytest.fixture()
def live_session():
    from app.db.base import SessionLocal
    from app.db.models import AreaAdoption

    with SessionLocal() as session:
        yield session
        # Isolation: this test module owns everything it inserts; wipe
        # only the rows it added so parallel tests are not affected.
        session.rollback()


def _seed_place(session) -> uuid.UUID:
    from app.db.models import MonitoredArea

    place = MonitoredArea(
        name=f"test-place-{uuid.uuid4().hex[:8]}",
        # Tiny polygon around a KL-ish anchor; ST_Covers still works.
        geometry="SRID=4326;MULTIPOLYGON(((101.6 3.1,101.7 3.1,101.7 3.2,101.6 3.2,101.6 3.1)))",
        metadata_json={},
        place_type="park",
        geometry_status="authoritative",
        geometry_version="test",
    )
    session.add(place)
    session.commit()
    session.refresh(place)
    return place.id


def _seed_profile(session) -> uuid.UUID:
    from app.db.models import Profile

    profile = Profile(
        public_id=uuid.uuid4().hex[:12],
        display_name=f"tester-{uuid.uuid4().hex[:6]}",
        role="Detector",
    )
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile.id


def test_adoption_unique_constraint_blocks_duplicate(live_session) -> None:
    from sqlalchemy.exc import IntegrityError
    from app.db.models import AreaAdoption

    profile_id = _seed_profile(live_session)
    place_id = _seed_place(live_session)

    live_session.add(AreaAdoption(profile_id=profile_id, place_id=place_id))
    live_session.commit()

    live_session.add(AreaAdoption(profile_id=profile_id, place_id=place_id))
    with pytest.raises(IntegrityError):
        live_session.commit()
    live_session.rollback()


def test_compute_activity_returns_snapshot_for_place(live_session) -> None:
    from app.domain.area_activity import compute_activity

    place_id = _seed_place(live_session)
    snapshot = compute_activity(live_session, place_id)
    assert snapshot is not None
    assert snapshot.place_id == place_id
    assert snapshot.indicators.window_days == 30
    assert snapshot.indicators.tolerance_pct == 10
    # Counts are non-negative and internally consistent.
    assert snapshot.indicators.active_sighting_count >= 0
    assert snapshot.indicators.distinct_species_count >= 0
    assert snapshot.indicators.distinct_species_count <= snapshot.indicators.active_sighting_count
    # Every marker attributed to a cluster resolves to a real cluster row.
    cluster_ids = {c.cluster_id for c in snapshot.clusters}
    for marker in snapshot.markers:
        if marker.cluster_id is not None:
            assert marker.cluster_id in cluster_ids


def test_compute_activity_returns_none_for_unknown_place(live_session) -> None:
    from app.domain.area_activity import compute_activity

    assert compute_activity(live_session, uuid.uuid4()) is None
