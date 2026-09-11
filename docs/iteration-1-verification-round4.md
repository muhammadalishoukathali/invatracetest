# Iteration 1 verification - round 4 (closes the last mock-only AC)

Independent re-verification post-Iteration-2. Purpose: close out AC 2.2.1,
which round 3 marked as "mock-only - deferred to the E2 pipeline
redesign." The E2 pipeline redesign has since landed on the real FastAPI
backend, so the AC is no longer mock-only.

## Summary

| Status | Count | ACs |
|---|---|---|
| ✅ Fully | **10** (was 9) | 1.x, 2.1.x, 2.2.x, 2.3.x, 3.x, 4.x |
| ⚠️ Mock-only | **0** (was 1) | - |
| ❌ Not implemented | 0 | - |

## AC 2.2.1 - deterministic sighting-validation rule engine

Round 3 verdict: `⚠️ Mock-only` — deterministic rule engine still lives
inside MSW `setTimeout` at `src/mocks/handlers.ts:484-493`. Genuinely
awaiting the E2 pipeline redesign.

**Round 4 verdict: ✅ Fully — real backend rule engine now runs end to end.**

Evidence:

| Piece | File:line |
|---|---|
| POST endpoint | [reports.py:61](../backend/app/api/routers/reports.py) — creates row with `status="processing"` at :250 and enqueues a `VerificationJob(status="pending")` at :275. |
| Deterministic worker | [verification.py](../backend/app/workers/verification.py) — module docstring "Deterministic, rule-based report screening worker." Pipeline body at :172. Produces `screened` / `merged` at :270, :284, :299. |
| Decision policy | [validation.py:22-92](../backend/app/domain/validation.py) — `ValidationStatus = Literal["screened","merged","needs_rescan","rejected"]`; default success returns `ValidationDecision("screened", …)`. |
| 5-min future clamp (AC 2.2.2) | [schemas.py:346-350](../backend/app/api/schemas.py). Plus 30-day past reject at :354. |
| SHA-256 image dedup (AC 2.3.1) | [reports.py:156-190](../backend/app/api/routers/reports.py) — server recomputes hash, verifies client's, dedups per `(profile, species, content_sha256)`. Perceptual near-dup lock also at [verification.py:239](../backend/app/workers/verification.py). |
| Haversine 25 m / 10-min merge (AC 2.3.2) | [verification.py:572-597](../backend/app/workers/verification.py) — radius/window from settings `screening_duplicate_radius_max_m` / `screening_duplicate_window_minutes`; SQL delta computation on the server. |
| Rate limit + 429 + Retry-After (AC 2.3.3) | [rate_limit.py:61-70](../backend/app/core/rate_limit.py) defines `report_create_burst` and `report_create_ip_burst` sliding windows; enforced in [reports.py:93-95](../backend/app/api/routers/reports.py). |
| Anti-abuse controls | 5-min future clamp, image SHA-256 dedup, haversine 25 m / 10-min merge, sliding-window rate limit — all AC-literal on the real backend, no mock. |

## AC 2.1.1 - 128-bit CSPRNG recovery codes

Round 3 verdict: `✅ Fully`. Re-verified in round 4.

- [identity.py:120,144-150](../backend/app/api/routers/identity.py) — `start_profile` issues 10 codes via `create_recovery_batch` and returns them in `ProfileStartResponse.recovery_codes`.
- [security.py:55-61](../backend/app/core/security.py) — `random_grouped_secret(byte_count=16)` uses `secrets.token_bytes(16)` (128-bit CSPRNG), Crockford base32-encodes, dash-groups into 4-char blocks. Persisted as HMAC-SHA256 hashes only.
- Integration coverage: `backend/tests/integration/test_full_stack.py::test_private_access_and_automated_validation_end_to_end` asserts `len(started["recoveryCodes"]) == 10` (:273) and drives the restore + rotate flows off real backend responses.

## What is left mock-only

Nothing on the AC surface. The MSW handlers under `src/mocks/handlers.ts`
remain in place for the dev workflow (fresh `npm run dev` without a
backend running); they are gated to `import.meta.env.DEV` in
[main.tsx:12-16](../src/main.tsx) and [api-client.ts:7-9](../src/services/api-client.ts),
so production always hits the real backend.

## Regression suite after this pass

| Suite | Result |
|---|---|
| `docker exec invatrace-api-1 python -m pytest tests/test_historical_occurrences.py -q` | 5 / 5 |
| Backend AC guardrails on `test_deterministic_screening`, `test_evidence_screening`, `test_near_duplicate_merge`, `test_gps_policy` | unchanged, green |
| Frontend `tsc -b --noEmit` | clean |
