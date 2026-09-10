"""Tests for the /api/v1/config/limits endpoint (Iteration 2 AC 7.3.1).

Every threshold that error text or a client gate depends on must be
served here so the frontend has a single source of truth.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


REQUIRED_FIELDS = {
    "locationAccuracyMaxM",
    "removalProximityMaxM",
    "discoveryParkBufferM",
    "discoveryTrailBufferM",
    "discoveryDecayScaleM",
    "waterwayUpstreamMaxKm",
    "occurrenceCoordUncertaintyMaxM",
    "adoptionMaxPerIdentity",
    "adoptionRateLimitPerHour",
    "activityChangeTolerancePct",
    "removalRateLimitPerHour",
    "removalRateLimitPerDay",
    "removalIdempotencyWindowSeconds",
    "catalogueVersion",
}


def test_limits_endpoint_returns_every_required_field() -> None:
    client = TestClient(create_app())
    response = client.get("/api/v1/config/limits")
    assert response.status_code == 200
    body = response.json()
    assert REQUIRED_FIELDS.issubset(body.keys()), (
        f"missing fields: {REQUIRED_FIELDS - body.keys()}"
    )


def test_limits_defaults_match_acceptance_criteria() -> None:
    client = TestClient(create_app())
    body = client.get("/api/v1/config/limits").json()
    # AC 3.3.4 / 4.5.3
    assert body["locationAccuracyMaxM"] == 250
    assert body["removalProximityMaxM"] == 250
    # AC 5.1.3
    assert body["discoveryParkBufferM"] == 1000
    assert body["discoveryTrailBufferM"] == 750
    # AC 5.1.5
    assert body["discoveryDecayScaleM"] == 250
    # AC 5.1.4
    assert body["waterwayUpstreamMaxKm"] == 5
    # AC 5.1.2
    assert body["occurrenceCoordUncertaintyMaxM"] == 1000
    # AC 6.1.7
    assert body["adoptionMaxPerIdentity"] == 50
    assert body["adoptionRateLimitPerHour"] == 30
    # AC 6.3.5
    assert body["activityChangeTolerancePct"] == 10
    # AC 4.5.8
    assert body["removalRateLimitPerHour"] == 20
    assert body["removalRateLimitPerDay"] == 100
    # AC 4.5.7
    assert body["removalIdempotencyWindowSeconds"] == 60


def test_screening_and_iteration_2_accuracy_thresholds_stay_aligned() -> None:
    from app.config import Settings

    with __import__("pytest").raises(Exception):
        Settings(location_accuracy_max_m=200, screening_location_accuracy_max_m=250)
