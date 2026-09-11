"""Phase 11B - Historical Records map layer endpoint guardrails.

Source-text asserts and TestClient probes over
``/api/v1/historical-occurrences`` so a future edit that relaxes the
country/present/32-species pipeline or drops the mandatory disclaimer
fails a test rather than shipping.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_router_source_bounds_and_shape() -> None:
    src = _read("app/api/routers/historical.py")
    assert 'prefix="/api/v1/historical-occurrences"' in src
    assert "class HistoricalOccurrenceItem" in src
    assert "class HistoricalOccurrencesResponse" in src
    # Mandatory honest-copy line so the map layer never reads as a live
    # census of currently present plants.
    assert "Historical observations do not guarantee current presence" in src
    # Hard cap must stay bounded so a runaway client cannot exfil the
    # whole table in one request.
    assert "_HARD_LIMIT = 2000" in src
    # Bounds must be validated - a silent fallthrough to no-filter would
    # let a client accidentally page through the full table.
    assert "west,south,east,north" in src


def test_endpoint_rejects_malformed_bbox() -> None:
    client = TestClient(create_app())
    r = client.get("/api/v1/historical-occurrences", params={"bbox": "1,2,3"})
    assert r.status_code == 422
    body = r.json()
    assert body.get("code") == "invalid_bbox"


def test_endpoint_rejects_out_of_range_bbox() -> None:
    client = TestClient(create_app())
    r = client.get(
        "/api/v1/historical-occurrences",
        params={"bbox": "-181,0,10,10"},
    )
    assert r.status_code == 422


def test_endpoint_rejects_inverted_bbox() -> None:
    client = TestClient(create_app())
    r = client.get(
        "/api/v1/historical-occurrences",
        params={"bbox": "10,10,5,5"},
    )
    assert r.status_code == 422


def test_endpoint_rejects_bad_year_range() -> None:
    client = TestClient(create_app())
    r = client.get(
        "/api/v1/historical-occurrences",
        params={"year_min": 2020, "year_max": 2010},
    )
    assert r.status_code == 422
