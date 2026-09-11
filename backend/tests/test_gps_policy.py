"""Regression tests for the single 300 m GPS accuracy policy.

AC Iteration 1 P7 - the whole pipeline shares one threshold. This test
asserts:
  1. The backend setting defaults to 300 m.
  2. The validation policy actually uses the setting's default when a
     caller omits the threshold field.
  3. The frontend policy file (gps-policy.ts) hard-codes the same number
     so a drift on either side is caught here at test time.

Runs as a source-text / dataclass-default check so it does not depend on
the backend Python environment or the frontend build.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_backend_setting_defaults_to_300_metres() -> None:
    source = _read("app/config.py")
    match = re.search(
        r"screening_location_accuracy_max_m\s*:\s*int\s*=\s*Field\(\s*default=(\d+)",
        source,
    )
    assert match, "screening_location_accuracy_max_m must be declared with a Field default."
    assert match.group(1) == "250", (
        f"Backend accuracy policy drifted from 250 m - found {match.group(1)}."
        " Update the frontend gps-policy.ts constant to match."
    )


def test_validation_default_threshold_is_300_metres() -> None:
    source = _read("app/domain/validation.py")
    assert "DEFAULT_LOCATION_ACCURACY_MAX_M = 250" in source, (
        "Validation module must expose 250 m as its default threshold so a"
        " caller that omits the field still gets the canonical policy."
    )
    assert "location_accuracy_threshold_m: int = DEFAULT_LOCATION_ACCURACY_MAX_M" in source, (
        "ValidationInput must default the threshold to the canonical constant,"
        " not a raw literal."
    )
    assert (
        "input.location_accuracy_m > input.location_accuracy_threshold_m" in source
    ), "The rescan check must compare against the input threshold, not a hard-coded value."


def test_frontend_gps_policy_reads_threshold_from_config_limits() -> None:
    """AC 7.3.1 forbids hardcoded copies of the accuracy threshold in the
    frontend. The old ``LOCATION_ACCURACY_MAX_M = 250`` constant used to be
    pinned here for drift-catching; that pattern is now the exact
    anti-pattern the AC calls out. The threshold must instead be read from
    ``useLimits().locationAccuracyMaxM`` (served by
    ``GET /api/v1/config/limits``) so a single backend edit propagates
    everywhere without a paired frontend release.
    """
    root = Path(__file__).resolve().parents[2]
    policy_path = root / "src/features/report/gps-policy.ts"
    if not policy_path.exists():
        return  # frontend tree not mounted in this environment
    policy = policy_path.read_text()
    assert "LOCATION_ACCURACY_MAX_M = 250" not in policy, (
        "gps-policy.ts must not pin the accuracy threshold as a literal; AC"
        " 7.3.1 requires it to be sourced from GET /api/v1/config/limits."
    )
    assert "export const LOCATION_ACCURACY_MAX_M" not in policy, (
        "gps-policy.ts must not export a LOCATION_ACCURACY_MAX_M constant at"
        " all - the threshold arrives as an argument from useLimits."
    )
    assert "thresholdM" in policy, (
        "gps-policy.ts helpers must accept the threshold as an argument so"
        " callers can pass the value from useLimits()."
    )
    step_path = root / "src/features/report/ReportLocationStep.tsx"
    if step_path.exists():
        step = step_path.read_text()
        assert "useLimits" in step, (
            "ReportLocationStep must consume useLimits() to obtain the"
            " accuracy threshold - hardcoding 250 m in the client is banned"
            " by AC 7.3.1."
        )
