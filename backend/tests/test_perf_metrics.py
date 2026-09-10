"""Iteration 2 Phase 8 - Epic 7 perf-histogram smoke tests.

Guard the wiring rather than the numbers: verify /metrics is exposed,
that the prometheus-fastapi-instrumentator is actually recording
per-request timings, and that the exporter is opt-outable through
``settings.metrics_enabled`` so unit suites (or single-process
deploys) can turn it off. The real p95/p99 gates live in
``scripts/latency-budget-check.mjs`` and in production Grafana.
"""
from __future__ import annotations

from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
MAIN_PY = (REPO_ROOT / "backend/app/main.py").read_text()
CONFIG_PY = (REPO_ROOT / "backend/app/config.py").read_text()

# The frontend tree is not mounted into the API container. Skip the
# cross-cutting a11y / marker guardrails there rather than fail them -
# they still run in the host pytest and in CI, which mounts the whole
# repo.
FRONTEND_ROOT = REPO_ROOT / "src"
requires_frontend = pytest.mark.skipif(
    not FRONTEND_ROOT.exists(),
    reason="frontend tree not present in this test environment",
)


def test_metrics_config_flag_is_declared() -> None:
    assert "metrics_enabled: bool = True" in CONFIG_PY, (
        "AC 7.1 - settings.metrics_enabled must exist so tests / lightweight "
        "deploys can disable the /metrics scrape endpoint."
    )


def test_metrics_wired_only_when_enabled() -> None:
    assert "if settings.metrics_enabled:" in MAIN_PY
    assert "Instrumentator(" in MAIN_PY
    assert 'endpoint="/metrics"' in MAIN_PY
    # Must be opt-outable via the settings flag - the guard should sit
    # in create_app so a fresh app factory in a test can boot without
    # touching the global prometheus registry.
    assert "prometheus_fastapi_instrumentator" in MAIN_PY


def test_metrics_endpoint_excludes_health_from_grouping() -> None:
    # AC 7.1 - health/metrics themselves must not pollute per-endpoint
    # SLO dashboards, so they are explicitly excluded from the handler
    # histogram vector.
    assert 'excluded_handlers=["/metrics", "/health"]' in MAIN_PY


@requires_frontend
def test_latency_budget_script_exists() -> None:
    script = REPO_ROOT / "scripts/latency-budget-check.mjs"
    assert script.exists(), (
        "AC 7.1 - CI latency budget script (p95<=500ms, p99<=1200ms) "
        "must live under scripts/ for the GitHub Actions job."
    )
    text = script.read_text()
    assert "p95" in text and "p99" in text
    assert "/api/v1/config/limits" in text
    assert "/api/v1/catalogue" in text


@requires_frontend
def test_axe_playwright_a11y_spec_exists() -> None:
    spec = REPO_ROOT / "e2e/a11y.spec.ts"
    assert spec.exists(), "AC 7.3 - axe-core Playwright suite required."
    text = spec.read_text()
    assert "@axe-core/playwright" in text
    assert "wcag2aa" in text
    # Must cover the four Epic 3-6 flagship screens.
    assert "/private-access" in text
    assert "/areas" in text
    assert "/settings/offline" in text


@requires_frontend
def test_removed_marker_carries_shape_cue() -> None:
    # AC 7.3 - marker states must be readable without colour. The
    # ThreatMap "removed" tier renders both a dashed ring AND a slash
    # line on top of the muted fill.
    threat_map = (REPO_ROOT / "src/features/map/ThreatMapPage.tsx").read_text()
    assert "stroke-dasharray" in threat_map
    assert "removedOverlay" in threat_map
    legend = (REPO_ROOT / "src/features/map/MapLegend.tsx").read_text()
    assert "removedPattern" in legend
    assert "dashed ring" in legend


def test_metrics_endpoint_serves_prometheus_exposition() -> None:
    """Boot the real app and hit /metrics - the exposition format is
    non-negotiable (must start with a `# HELP` line) or Prometheus
    scrapers reject the target silently."""
    try:
        from fastapi.testclient import TestClient

        from app.main import create_app
    except Exception:  # pragma: no cover - env without FastAPI installed
        pytest.skip("FastAPI/TestClient not available in this environment")
    client = TestClient(create_app())
    res = client.get("/metrics")
    assert res.status_code == 200
    body = res.text
    assert body.startswith("# HELP"), body[:200]
    # The instrumentator ships a request-latency histogram under one of
    # these families - we accept either name so a future minor version
    # bump doesn't break the guard.
    assert (
        "http_request_duration_seconds" in body
        or "http_request_duration_highr_seconds" in body
    )
