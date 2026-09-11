"""Regression tests for the production deploy blueprint.

AC 1.2.1 + AC Iteration 1 P11 - the prod init on Render must satisfy a
handful of non-obvious constraints that only bite once traffic hits the
deployment:

  1. Schema migrations and reference-data loading run BEFORE the new image
     serves traffic. On the free plan Render's paid `preDeployCommand`
     hook is not available, so this is done by the container entrypoint
     (backend/docker-entrypoint.sh).
  2. The backend Docker build context is the repository root so the image
     bundles both `backend/` and `shared/catalogue/` - one source of truth
     for the plant-status catalogue between the PWA and the API.
  3. Uvicorn trusts Render's proxy headers, otherwise every request looks
     like it comes from Render's edge IP and the per-IP burst rate limit
     collapses to one shared bucket across the platform.
  4. Duplicate detection stays on in prod - the dev-only kill switch
     must not silently follow a rebased branch to production.
  5. The single 250 m GPS policy is pinned explicitly at the platform
     level so a config drift is visible in code review, not surfaced by
     a rescan whose threshold does not match anything in the UI.
  6. Static frontend headers: long-lived `Cache-Control` on hashed
     assets, `no-store` on the service-worker entry point so an update
     replaces the shell instead of a stale copy being served forever.
  7. Production startup never runs demo-data seeding.
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.skipif(
    not (REPO_ROOT / "render.yaml").exists(),
    reason=(
        "Deploy-config regression tests require the repository root "
        "(render.yaml + backend/Dockerfile + backend/docker-entrypoint.sh) "
        "on disk. Skip when running inside the production image, which "
        "only ships /service/backend."
    ),
)


def _read(relative: str) -> str:
    return (REPO_ROOT / relative).read_text()


def test_render_yaml_backend_uses_repo_root_build_context() -> None:
    render = _read("render.yaml")
    # rootDir would scope the Docker context to backend/ and lose shared/.
    assert "rootDir: backend" not in render, (
        "AC 1.2.1 - backend Docker build must run from the repository root so"
        " both backend/ and shared/catalogue/ land in the image."
    )
    assert "dockerfilePath: ./backend/Dockerfile" in render, (
        "Dockerfile path must be resolved from the repository root."
    )


def test_render_yaml_no_paid_predeploy_command_for_free_plan_backend() -> None:
    render = _read("render.yaml")
    # preDeployCommand is a paid-plan-only feature; the container entrypoint
    # owns migration + reference-data init instead.
    assert "preDeployCommand:" not in render, (
        "AC 1.2.1 - free-plan deploy must not rely on preDeployCommand;"
        " docker-entrypoint.sh runs migrations and load-reference-data."
    )


def test_render_yaml_declares_the_gps_and_dedup_policy_env_vars_explicitly() -> None:
    render = _read("render.yaml")
    assert 'key: SCREENING_LOCATION_ACCURACY_MAX_M\n        value: "250"' in render, (
        "The single 250 m GPS policy must be pinned explicitly at deploy time"
        " so a config drift is caught in review, not by a surprise rescan."
    )
    assert 'key: SCREENING_DISABLE_DUPLICATE_CHECK\n        value: "false"' in render, (
        "The dev-only duplicate-check kill switch must be forced off in prod."
    )


def test_render_yaml_declares_expected_frontend_cache_headers() -> None:
    render = _read("render.yaml")
    assert "path: /assets/*" in render
    assert "public, max-age=31536000, immutable" in render
    assert "path: /sw.js" in render
    assert "value: no-store" in render


def test_render_yaml_health_check_hits_the_liveness_endpoint() -> None:
    render = _read("render.yaml")
    assert "healthCheckPath: /health/live" in render


def test_backend_dockerfile_copies_shared_catalogue_into_the_image() -> None:
    dockerfile = _read("backend/Dockerfile")
    assert "COPY shared/catalogue /service/shared/catalogue" in dockerfile, (
        "AC 1.2.1 - the shared plant-status catalogue must be baked into the"
        " backend image at /service/shared/catalogue so app.domain.catalogue"
        " resolves the same JSON the PWA ships."
    )
    assert "COPY backend/app ./app" in dockerfile, (
        "Backend source must be copied from its repo-root path now that the"
        " build context is the repository root."
    )


def test_backend_dockerfile_workdir_matches_catalogue_resolution() -> None:
    dockerfile = _read("backend/Dockerfile")
    assert "WORKDIR /service/backend" in dockerfile, (
        "app/domain/catalogue.py resolves parents[3]/shared/catalogue; the"
        " WORKDIR must be /service/backend so that resolves to"
        " /service/shared/catalogue in the running container."
    )


def test_backend_dockerfile_uses_entrypoint_script() -> None:
    dockerfile = _read("backend/Dockerfile")
    assert 'ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]' in dockerfile
    assert "COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh" in dockerfile


def test_backend_dockerfile_healthcheck_uses_the_liveness_endpoint() -> None:
    dockerfile = _read("backend/Dockerfile")
    assert "HEALTHCHECK" in dockerfile
    assert "/health/live" in dockerfile


def test_docker_entrypoint_runs_migrations_and_reference_data_before_uvicorn() -> None:
    entrypoint = _read("backend/docker-entrypoint.sh")
    lines = [line.strip() for line in entrypoint.splitlines() if line.strip() and not line.strip().startswith("#")]
    # AC 1.2.1 - alembic upgrade then reference-data load must both precede
    # the exec uvicorn line so a fresh production database is ready before
    # the API accepts traffic.
    assert lines[0] == "set -eu", "Entrypoint must exit on error (set -eu)."
    alembic_idx = next(i for i, line in enumerate(lines) if line == "alembic upgrade head")
    load_idx = next(i for i, line in enumerate(lines) if line == "python -m app.cli load-reference-data")
    uvicorn_idx = next(i for i, line in enumerate(lines) if line.startswith("exec uvicorn"))
    assert alembic_idx < load_idx < uvicorn_idx, (
        "Entrypoint order must be: alembic upgrade, load-reference-data, exec uvicorn."
    )
    assert "--proxy-headers" in entrypoint
    assert '--forwarded-allow-ips "*"' in entrypoint
    assert "${PORT:-8000}" in entrypoint


def test_docker_entrypoint_never_seeds_demo_data() -> None:
    entrypoint = _read("backend/docker-entrypoint.sh")
    # AC 1.2.1 - production start-up must never insert sample sightings.
    assert "seed-demo-data" not in entrypoint
    assert "invatrace seed" not in entrypoint


def test_backend_dockerfile_never_seeds_demo_data() -> None:
    dockerfile = _read("backend/Dockerfile")
    assert "seed-demo-data" not in dockerfile


def test_docker_entrypoint_is_executable() -> None:
    path = REPO_ROOT / "backend" / "docker-entrypoint.sh"
    assert path.is_file(), "docker-entrypoint.sh must exist."
    mode = path.stat().st_mode
    assert mode & 0o111, "docker-entrypoint.sh must be executable."
    # POSIX line endings only - a stray CRLF makes `/bin/sh` fail with a
    # cryptic "not found" on the shebang line.
    raw = path.read_bytes()
    assert b"\r\n" not in raw, "docker-entrypoint.sh must use LF line endings."
    assert raw.startswith(b"#!/bin/sh"), "Entrypoint must begin with a POSIX shebang."
