"""Iteration 2 Phase 3 - POST /api/v1/location-context.

Locks the three response states + the fail-closed behaviour on low-quality
fixes (AC 3.3.1c) and out-of-coverage coordinates (AC 3.3.2). The endpoint
must NEVER answer ``no_intersection`` for uncertain input, and
``action_eligible`` must never be true from this call alone (the client
still needs to run its explicit-permission gate downstream).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def _post(client: TestClient, body: dict) -> dict:
    resp = client.post("/api/v1/location-context", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_high_accuracy_falls_through_to_boundary_uncertain() -> None:
    client = TestClient(create_app())
    body = _post(
        client,
        {"latitude": 3.1497, "longitude": 101.6412, "accuracyM": 400},
    )
    # AC 3.3.1c - fixes worse than the ceiling never resolve to "outside".
    assert body["contextState"] == "boundary_uncertain"
    assert body["actionEligible"] is False
    assert body["accuracyCeilingM"] == 250
    # No boundary attribution when we did not run the PIP.
    assert body["boundarySource"] is None
    assert body["boundaryName"] is None


def test_coord_outside_coverage_is_boundary_uncertain() -> None:
    client = TestClient(create_app())
    body = _post(
        client,
        # Somewhere in the Pacific - outside the Malaysia coverage bbox.
        {"latitude": -20.0, "longitude": 150.0, "accuracyM": 10},
    )
    assert body["contextState"] == "boundary_uncertain"
    assert body["actionEligible"] is False


def test_within_coverage_and_good_accuracy_resolves_to_a_state() -> None:
    client = TestClient(create_app())
    body = _post(
        client,
        # KL city centre, good fix - depending on seed state this is either
        # inside a protected polygon or no_intersection, but never uncertain.
        {"latitude": 3.1500, "longitude": 101.6900, "accuracyM": 15},
    )
    assert body["contextState"] in {"inside_protected_area", "no_intersection"}
    # AC 3.3.1 - never grant action_eligible from location-context alone.
    assert body["actionEligible"] is False


def test_accuracy_ceiling_mirrors_config_limits() -> None:
    client = TestClient(create_app())
    limits = client.get("/api/v1/config/limits").json()
    body = _post(
        client,
        {"latitude": 3.1497, "longitude": 101.6412, "accuracyM": 20},
    )
    assert body["accuracyCeilingM"] == limits["locationAccuracyMaxM"]


def test_response_carries_utc_timestamp() -> None:
    client = TestClient(create_app())
    body = _post(
        client,
        {"latitude": 3.1497, "longitude": 101.6412, "accuracyM": 20},
    )
    # UTC timestamp lets the UI show "checked at" without inventing a clock.
    assert isinstance(body["checkedAt"], str)
    assert body["checkedAt"].endswith("Z") or "+00:00" in body["checkedAt"]


def test_missing_body_field_is_rejected_with_422() -> None:
    client = TestClient(create_app())
    resp = client.post(
        "/api/v1/location-context",
        json={"latitude": 3.15, "longitude": 101.7},
    )
    assert resp.status_code == 422
