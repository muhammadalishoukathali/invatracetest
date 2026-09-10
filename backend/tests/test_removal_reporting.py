"""Iteration 2 Phase 4 - Epic 4 removal reporting invariants.

Text-based asserts against the router / model / rate-limit sources so a
future edit that quietly loosens one of the AC guardrails can't slip
through without a failing test. Follows the same convention as
``test_report_lifecycle.py``: no live DB or docker stack, just the
source-of-truth files.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_sightings_status_check_constraint_allows_removal_reported() -> None:
    source = _read("app/db/models.py")
    # The CHECK constraint literal spans a bracketed multiline string; flatten
    # it before searching so a reformat doesn't invalidate the assertion.
    flat = source.replace("\n", " ")
    assert "'removal_reported'" in flat, (
        "sightings.status CHECK constraint must allow 'removal_reported'"
        " so Epic 4 can flip a sighting when a community member reports a"
        " successful removal. Without it the DB rejects the transition and"
        " the endpoint 500s under load."
    )


def test_sighting_status_history_model_defined() -> None:
    source = _read("app/db/models.py")
    assert "class SightingStatusHistory" in source
    for column in (
        "sighting_id",
        "from_status",
        "to_status",
        "actor_profile_id",
        "submitted_lat",
        "submitted_lon",
        "submitted_accuracy_m",
        "calculated_distance_m",
        "idempotency_key",
    ):
        assert column in source.split("class SightingStatusHistory", 1)[1].split("class ", 1)[0], (
            f"SightingStatusHistory must persist `{column}` so the vicinity"
            " check remains auditable after the fact."
        )


def test_removal_migration_present() -> None:
    source = _read("alembic/versions/20260911_15_sighting_status_history.py")
    assert "CREATE TABLE sighting_status_history" in source
    assert "removal_reported" in source
    assert 'down_revision = "20260911_14"' in source


def test_removal_router_has_error_codes_matrix() -> None:
    source = _read("app/api/routers/removals.py")
    for code in (
        "LOCATION_UNAVAILABLE",
        "LOCATION_INACCURATE",
        "LOCATION_OUT_OF_RANGE",
        "SIGHTING_NOT_ELIGIBLE",
    ):
        assert code in source, (
            f"AC 4.2.2/4.2.3 - removal-report error code `{code}` must be"
            " raised so the client can steer the finder to the right recovery"
            " action instead of a generic 422."
        )


def test_removal_router_reads_ceiling_from_settings_not_literal() -> None:
    source = _read("app/api/routers/removals.py")
    # Must reference the settings fields, not the numeric 250.
    assert "settings.location_accuracy_max_m" in source
    assert "settings.removal_proximity_max_m" in source
    # Guard against a slip that reintroduces a magic number.
    assert " > 250" not in source
    assert " > 250.0" not in source


def test_removal_router_blocks_terminal_statuses() -> None:
    source = _read("app/api/routers/removals.py")
    for status in ("removal_reported", "rejected", "removed", "merged"):
        assert f'"{status}"' in source, (
            f"AC 4.2.1 - status `{status}` must be in the blocked set so a"
            " duplicate/void removal report cannot flip the sighting twice."
        )


def test_removal_router_uses_idempotency_lock() -> None:
    source = _read("app/api/routers/removals.py")
    assert "acquire_idempotency_lock" in source
    assert "IdempotencyRecord" in source
    # Scope must be per-report so a single Idempotency-Key can't leak
    # between two different sightings the same actor is reporting on.
    assert 'f"report.removal:{report_id}"' in source


def test_removal_router_enforces_rate_limits() -> None:
    source = _read("app/api/routers/removals.py")
    for scope in (
        "removal_report_hour",
        "removal_report_day",
        "removal_report_ip_hour",
    ):
        assert scope in source, (
            f"AC 4.2.4 - rate-limit scope `{scope}` must be checked before"
            " running the vicinity query so a flood cannot exhaust the DB."
        )


def test_rate_limit_scopes_registered() -> None:
    source = _read("app/core/rate_limit.py")
    for scope in (
        "removal_report_hour",
        "removal_report_day",
        "removal_report_ip_hour",
    ):
        assert f'"{scope}":' in source, (
            f"Rate-limit scope `{scope}` must exist in the LIMITS map or"
            " the router's ``rate_limiter.check`` call raises KeyError."
        )
    # Both hour scopes must be backed by the env-configured limits.
    assert "settings.removal_rate_limit_per_hour" in source
    assert "settings.removal_rate_limit_per_day" in source


def test_removal_router_registered_in_main() -> None:
    source = _read("app/main.py")
    assert "removals" in source
    assert "removals.router" in source


def test_removal_router_updates_sighting_and_writes_history() -> None:
    source = _read("app/api/routers/removals.py")
    assert 'sighting.status = "removal_reported"' in source
    assert "SightingStatusHistory(" in source
    # Distance must be persisted so an admin review of a disputed removal
    # can see exactly how close the finder was when they submitted.
    assert "calculated_distance_m=" in source
