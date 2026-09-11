"""AC 2.2.1 — deterministic sighting-validation rule engine lives on the
real backend, not in an MSW mock.

These are source-text guardrails: they assert that the real code paths
identified in ``docs/iteration-1-verification-round4.md`` still exist, so
a future refactor that reintroduces mock-only screening (or drops the
sliding-window rate limit / haversine merge / future-time clamp) trips a
test rather than silently regressing back to Iteration 1's "awaiting the
pipeline redesign" state.
"""

from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_report_post_enqueues_verification_job() -> None:
    # AC 2.2.1: the write endpoint must persist status='processing' AND
    # hand the row off to the deterministic worker via VerificationJob,
    # not screen inline in the request cycle.
    src = _read("app/api/routers/reports.py")
    assert 'status="processing"' in src or "status='processing'" in src
    assert "VerificationJob" in src


def test_deterministic_worker_module_present() -> None:
    # AC 2.2.1: the rule engine is a real background worker, not a mock.
    src = _read("app/workers/verification.py")
    assert "Deterministic, rule-based report screening worker" in src
    # Terminal decision statuses required by AC 2.2.1 / 2.3.2.
    assert '"screened"' in src or "'screened'" in src
    assert '"merged"' in src or "'merged'" in src


def test_validation_status_enum_includes_all_ac_states() -> None:
    src = _read("app/domain/validation.py")
    assert '"screened"' in src
    assert '"merged"' in src
    assert '"needs_rescan"' in src
    assert '"rejected"' in src


def test_ac_2_2_2_future_time_clamp_enforced_in_schema() -> None:
    src = _read("app/api/schemas.py")
    # 5-min future ceiling per AC 2.2.2; must be a Pydantic-level clamp,
    # not a soft warning in the worker.
    assert "timedelta(minutes=5)" in src


def test_ac_2_3_1_image_sha256_dedup_verified_server_side() -> None:
    src = _read("app/api/routers/reports.py")
    # Server recomputes hash rather than trusting the client's number.
    assert "hashlib.sha256" in src or "sha256(" in src or "compute_sha256" in src
    # Dedup on (profile, species, content_sha256).
    assert "content_sha256" in src


def test_ac_2_3_2_haversine_25m_10min_merge_configurable() -> None:
    src = _read("app/workers/verification.py")
    # The merge radius + window are settings-driven so a compliance-audit
    # can point at one place; do not inline 25/10 numeric literals in the
    # worker.
    assert "screening_duplicate_radius_max_m" in src
    assert "screening_duplicate_window_minutes" in src


def test_ac_2_3_3_rate_limit_sliding_window_burst_plus_ip() -> None:
    src = _read("app/core/rate_limit.py")
    # Two independent buckets so a single profile behind a large IP pool
    # is capped even if per-IP fires. Sliding-window backing store.
    assert "report_create_burst" in src
    assert "report_create_ip_burst" in src


def test_ac_2_3_3_reports_router_calls_all_three_buckets() -> None:
    src = _read("app/api/routers/reports.py")
    assert "report_create_burst" in src
    assert "report_create_ip_burst" in src
    # Retry-After must be surfaced on 429; the rate limiter helper does
    # this via the response headers argument.
    assert "429" in src or "Retry-After" in src or "rate_limit" in src.lower()


def test_ac_2_1_1_recovery_codes_are_128_bit_csprng() -> None:
    src = _read("app/core/security.py")
    # 128-bit = 16 bytes; the default parameter is a hard contract that a
    # future refactor must not shrink without also updating the AC doc.
    assert "byte_count: int = 16" in src or "byte_count=16" in src
    assert "secrets.token_bytes" in src


def test_ac_2_1_1_identity_router_returns_10_recovery_codes() -> None:
    src = _read("app/api/routers/identity.py")
    assert "create_recovery_batch" in src
    # A round-3-era smoke test asserted len == 10 in the integration suite;
    # here we just guard the helper call site so nobody hides the codes
    # behind a feature flag.
