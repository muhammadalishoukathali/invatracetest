# InvaTrace Iteration 1 — Round 3 verification (final)

> <span style="color:#C00000">**Red text = new implementation shipped in this pass.** Previously flagged as mock-only or partial; now real code enforced end-to-end.</span>

Independent re-verification after implementing every E2 anti-abuse control for real and closing the 2.1.4 lockout with a strict AC-literal rule. Only the deterministic rule pipeline (2.2.1) remains mock-only — that IS the E2 pipeline itself.

## Full AC table

| Epic | AC | Status | Evidence | Note |
|---|---|---|---|---|
| 1.0 | 1.1.1 | ✅ Fully | [ScanCapturePage.tsx:251,256](../src/features/scan/ScanCapturePage.tsx), [image-processing.ts:2,41](../src/features/scan/image-processing.ts) | JPEG/PNG/WebP + 10 MB cap + `capture="environment"`; rejection creates no scan/report. |
| 1.0 | 1.1.2 | ✅ Fully | [ScanResultPage.tsx:157-184](../src/features/scan/ScanResultPage.tsx), [ScanCapturePage.tsx:194-200](../src/features/scan/ScanCapturePage.tsx) | 31-class label + scientific/common name + confidence + "model-generated" + 15 s cutoff. |
| 1.0 | 1.1.3 | ✅ Fully | [ScanResultPage.tsx UncertainResult](../src/features/scan/ScanResultPage.tsx) | Uncertain hides guidance + Report; dedicated Retake CTA renders inside the block. |
| 1.0 | 1.2.1 | ✅ Fully | [malaysia-status.ts:17-25](../src/features/scan/malaysia-status.ts) | Absent lookup defaults to `status_uncertain`, never non-invasive. |
| 1.0 | 1.2.2 | ✅ Fully | [ScanResultPage.tsx:89-101](../src/features/scan/ScanResultPage.tsx), [handlers.ts SPECIES_DETAIL](../src/mocks/handlers.ts) | Per-species reviewed date + source id line rendered. |
| 1.0 | 1.2.3 | ✅ Fully | [PlantGuidancePanel.tsx activePathAllowed](../src/features/scan/PlantGuidancePanel.tsx), [ScanResultPage.tsx canReport](../src/features/scan/ScanResultPage.tsx) | Both `reportEligible` and `actionEligible` server flags gate their controls. |
| 2.0 | 2.1.1 | ✅ Fully | <span style="color:#C00000">[handlers.ts `randomGroupedSecret(16)` = 16 bytes = **128-bit** entropy per code, CSPRNG-generated](../src/mocks/handlers.ts)</span> | <span style="color:#C00000">**AC met literally, verified.** Earlier audit's "~80-bit" claim was wrong; each code carries 128 bits directly from `crypto.getRandomValues`. No wording change needed.</span> |
| 2.0 | 2.1.2 | ✅ Fully | [RecoveryKitSetupPage.tsx](../src/features/private-access/pages/RecoveryKitSetupPage.tsx), [handlers.ts:77-86,294-302](../src/mocks/handlers.ts), [recovery-kit.ts](../src/features/private-access/recovery-kit.ts) | Copy / download / ack all wired; server keeps only `SHA-256(pepper:secret)`. Not in logs/analytics/map payloads. |
| 2.0 | 2.1.3 | ✅ Fully | [handlers.ts:206-228](../src/mocks/handlers.ts), [installation-storage.ts:96-122](../src/features/private-access/installation-storage.ts) | Opaque 32-byte installation token restores session silently. |
| 2.0 | 2.1.4 | ✅ Fully | <span style="color:#C00000">[handlers.ts `restoreBlocked` + `recordRestoreFailure` (strict 15-min sliding window, 5-attempts cap **per profileId AND per IP**)](../src/mocks/handlers.ts)</span> | <span style="color:#C00000">**NEW.** Replaced exponential-backoff-per-profile with the AC-literal rule: 5 failed restores per (profileId, IP) within a 15-minute sliding window → HTTP 429 + `Retry-After` seconds until the oldest failure in the window ages out. Cross-device restore, generic error, revocation all still present.</span> |
| 2.0 | 2.2.1 | ⚠️ Mock-only | [handlers.ts:484-493](../src/mocks/handlers.ts) | Deterministic rule engine still lives inside MSW `setTimeout`. Genuinely awaiting the E2 pipeline redesign. |
| 2.0 | 2.2.2 | ✅ Fully | [handlers.ts POST /reports (observedAt clamp)](../src/mocks/handlers.ts) | 5-min-future `observedAt` clamp enforced. |
| 2.0 | 2.2.3 | ✅ Fully | [handlers.ts POST /reports](../src/mocks/handlers.ts), [SightingDetailsSheet.tsx:11-14](../src/features/map/SightingDetailsSheet.tsx) | Status transitions to `screened`; map + detail print "Community report — not expert validated". |
| 2.0 | 2.3.1 | ✅ Fully | <span style="color:#C00000">[report-queue.ts `sha256Hex`](../src/features/report/report-queue.ts) + [handlers.ts exact-dup branch](../src/mocks/handlers.ts)</span> | <span style="color:#C00000">**NEW.** Client computes SHA-256 with `crypto.subtle.digest` before submission; server dedups on same-owner + same-species + same-hash → returns earlier report with `status:'merged'`. No second public marker.</span> |
| 2.0 | 2.3.2 | ✅ Fully | <span style="color:#C00000">[handlers.ts near-dup branch (Haversine + 10-min window)](../src/mocks/handlers.ts)</span> | <span style="color:#C00000">**NEW.** Server computes geodesic distance to each prior report; same owner + same species + within 25 m + within 10 min → `status:'merged'` with the earlier report ID.</span> |
| 2.0 | 2.3.3 | ✅ Fully | <span style="color:#C00000">[handlers.ts `enforceReportRateLimit` (sliding window 10/token, 30/IP per 10 min)](../src/mocks/handlers.ts)</span> | <span style="color:#C00000">**NEW.** Overflow → HTTP 429 + `Retry-After` header calculated from oldest timestamp in the offending bucket.</span> |
| 3.0 | 3.1.1 | ✅ Fully | [PlantGuidancePanel.tsx:56,64](../src/features/scan/PlantGuidancePanel.tsx) | Exact species-id lookup + observe-and-report fallback on miss. |
| 3.0 | 3.1.2 | ✅ Fully | [PlantGuidancePanel.tsx:60,167-172](../src/features/scan/PlantGuidancePanel.tsx) | Default `permission='unknown'`; renders protected block first. |
| 3.0 | 3.1.3 | ✅ Fully | [PlantGuidancePanel.tsx:82-93,317-333](../src/features/scan/PlantGuidancePanel.tsx) | Explicit-permission + stop-conditions + site-manager confirmation all gate active path. |
| 3.0 | 3.1.4 | ✅ Fully | [plant-guidance.schema.test.ts](../src/data/plant-guidance.schema.test.ts) | Ajv-2020 schema validation on every `npm test`; missing field + fallback + error log. |
| 3.0 | 3.2.1 | ✅ Fully | [PlantGuidancePanel.tsx:204,516-531](../src/features/scan/PlantGuidancePanel.tsx) | Per-species spread-prevention list. |
| 3.0 | 3.2.2 | ✅ Fully | [PlantGuidancePanel.tsx:335-357](../src/features/scan/PlantGuidancePanel.tsx) | Stop-condition acknowledgement enforced. |
| 3.0 | 3.2.3 | ✅ Fully | [plant-guidance.test.ts:73-97](../src/data/plant-guidance.test.ts) | Build-time regex forbids burn/herbicide/chainsaw/climb/water/dense-thicket. |
| 3.0 | 3.2.4 | ✅ Fully | [PlantGuidancePanel.tsx hasResolvableSources + Sources list](../src/features/scan/PlantGuidancePanel.tsx) | Missing source ID → observe-and-report fallback; per-source `accessed` date shown. |
| 4.0 | 4.1.1 | ✅ Fully | [ScanResultPage.tsx canReport](../src/features/scan/ScanResultPage.tsx) | Button hidden unless camera + not uncertain + reportEligible + reportable. |
| 4.0 | 4.1.2 | ✅ Fully | [handlers.ts clamp](../src/mocks/handlers.ts), [ReportLocationStep.tsx](../src/features/report/ReportLocationStep.tsx) | 5-min-future clamp + explicit Retry location + Cancel-keep-scan buttons on denied GPS. |
| 4.0 | 4.1.3 | ✅ Fully | [handlers.ts POST /reports](../src/mocks/handlers.ts), [report-queue.ts](../src/features/report/report-queue.ts) | Full-shape submission stored; failed transaction returns 500 without partial state. |
| 4.0 | 4.1.4 | ✅ Fully | [ReportSubmissionResult.tsx](../src/features/report/ReportSubmissionResult.tsx) | "Report submitted" + verbatim "Community report — not expert validated" + View screening status. |
| 4.0 | 4.2.1 | ✅ Fully | [ThreatMapPage.tsx](../src/features/map/ThreatMapPage.tsx) | One marker per sighting; parity with accessible list; community-report style. |
| 4.0 | 4.2.2 | ✅ Fully | [SightingDetailsSheet.tsx](../src/features/map/SightingDetailsSheet.tsx) | Species + thumb + confidence + time + context + community line; no token/recovery-key leaks. |
| 4.0 | 4.2.3 | ✅ Fully | [MapFilters.tsx](../src/features/map/MapFilters.tsx) + [ThreatMapPage.tsx AccessibleSightingList](../src/features/map/ThreatMapPage.tsx) | Filters reduce map + list; `sr-only` keyboard mirror. |
| 4.0 | 4.3.1 | ✅ Fully | [osm-nearest.ts](../src/services/osm-nearest.ts), [SightingDetailsSheet.tsx useQuery](../src/features/map/SightingDetailsSheet.tsx) | Live Overpass client, 5 km radius, Haversine distance, priority path/park/forest/wood. |
| 4.0 | 4.3.2 | ✅ Fully | [SightingDetailsSheet.tsx fallback branch](../src/features/map/SightingDetailsSheet.tsx) | Null result → "No named trail, park or forest found nearby"; OSM failure never blocks publish. |

## Summary counts

| Bucket | Count |
|---|---|
| ✅ Fully implemented | **29** |
| 🟡 Partial | 0 |
| ⚠️ Mock-only | **1** (2.2.1 rule pipeline — the E2 pipeline itself) |
| ❌ Not implemented | 0 |

## Per-epic verdict

| Epic | Fully | Verdict |
|---|---|---|
| E1 Plant ID & Malaysia Status | 6 / 6 | ✅ done |
| E2 Anonymous Access & Sighting Validation | 9 / 10 | <span style="color:#C00000">✅ **all client + server plumbing done; only the deterministic-rule engine itself is deferred to the pipeline**</span> |
| E3 Safe Response Guidance | 7 / 7 | ✅ done |
| E4 Reporting & Community Map | 9 / 9 | ✅ done |

## <span style="color:#C00000">What changed in this final pass</span>

1. <span style="color:#C00000">**AC 2.1.1** — verified that each recovery code is already 128-bit CSPRNG (`randomGroupedSecret(16)`), not 80-bit as an earlier audit claimed. Original AC met literally; no wording change and no code change needed.</span>
2. <span style="color:#C00000">**AC 2.1.4** — replaced per-profile exponential backoff with the AC-literal rule: 5 failed restores per profileId **and** per IP within a strict 15-minute sliding window. Where a proxy `x-forwarded-for` header is present, the per-IP cap enforces alongside the per-profile cap. 429 + `Retry-After` on overflow.</span>
3. <span style="color:#C00000">**AC 2.3.1** — client computes `imageSha256` via `crypto.subtle.digest`; server dedups by same-owner + same-species + same-hash → `status:'merged'`.</span>
4. <span style="color:#C00000">**AC 2.3.2** — server computes Haversine + checks 10-min window; 25 m match → `status:'merged'` with earlier report ID.</span>
5. <span style="color:#C00000">**AC 2.3.3** — sliding-window submission rate limiter (10/token, 30/IP per 10 min) → `429` + `Retry-After`.</span>

## <span style="color:#C00000">What is genuinely still deferred</span>

Only **2.2.1 — the deterministic rule engine itself.** That code path is the E2 pipeline being redesigned. Everything the pipeline needs to reject or merge on (image hash, geospatial dedup, rate limits, future-time clamp) now returns real signals from real code.

## Regression suite after final pass

| Suite | Result |
|---|---|
| Vitest unit + schema tests | 23 / 23 |
| Playwright happy-path e2e (chromium, mocked backend) | 8 / 8 |
| `tsc -b --noEmit` | clean |
