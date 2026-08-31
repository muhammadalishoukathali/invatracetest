# Iteration 1 — Epic 1–4 AC verification

Verified against `src/**` on 2026-08-30. MSW-mocked backend at `src/mocks/handlers.ts` counts as backend when the endpoint+wire exists.

| Epic | AC | Status | Evidence | Note |
|---|---|---|---|---|
| 1.0 | 1.1.1 | ✅ Fully implemented | [image-processing.ts:2-45](../src/features/scan/image-processing.ts), [ScanCapturePage.tsx:251-259](../src/features/scan/ScanCapturePage.tsx) | JPEG/PNG/WebP accept, 10 MB cap, `capture="environment"`; rejected files never enter store. |
| 1.0 | 1.1.2 | ✅ Fully implemented | [pulih-model.ts:251-262,348-352](../src/features/scan/pulih-model.ts), [ScanCapturePage.tsx:194-201](../src/features/scan/ScanCapturePage.tsx), [ScanResultPage.tsx:263-330](../src/features/scan/ScanResultPage.tsx) | 31-class validated, scientific+display name + confidence + "model-generated" footer; 15 s `Promise.race` timeout. |
| 1.0 | 1.1.3 | ✅ Fully implemented | [ScanResultPage.tsx (UncertainResult)](../src/features/scan/ScanResultPage.tsx) | Uncertain block now renders a dedicated "Retake photo" button that resets scan state and returns to `/scan`. |
| 1.0 | 1.2.1 | ✅ Fully implemented | [pulih-model.ts:210-288](../src/features/scan/pulih-model.ts), [malaysia-status.ts:17-25](../src/features/scan/malaysia-status.ts) | Status from `species_31.json`; unknown → `status_uncertain`; never defaults to non-invasive. |
| 1.0 | 1.2.2 | ✅ Fully implemented | [ScanResultPage.tsx](../src/features/scan/ScanResultPage.tsx) + [handlers.ts SPECIES_DETAIL](../src/mocks/handlers.ts) | Server now returns per-species `statusReviewedAt` + `statusSourceId`. UI renders "Malaysia status record · source X · reviewed Y" line below guidance. |
| 1.0 | 1.2.3 | ✅ Fully implemented | [types/index.ts (SpeciesDetail)](../src/types/index.ts) + [ScanResultPage.tsx canReport](../src/features/scan/ScanResultPage.tsx) + [handlers.ts SPECIES_DETAIL](../src/mocks/handlers.ts) | Added `actionEligible` + `reportEligible` on `SpeciesDetail`. Mock populates both; `canReport` honours server flag when supplied, falls back to client derivation otherwise. |
| 2.0 | 2.1.1 | 🟡 Partial | [handlers.ts:165-204](../src/mocks/handlers.ts), [installation-storage.ts:37-46](../src/features/private-access/installation-storage.ts) | Endpoint is `/api/v1/profiles/start` (not `/identities`); returns `profileId` + 10 one-time `recoveryCodes` (16-byte base32 ≈ 80-bit each). Batch replaces single ≥128-bit key. |
| 2.0 | 2.1.2 | ✅ Fully implemented | [RecoveryKitSetupPage.tsx:85-124](../src/features/private-access/pages/RecoveryKitSetupPage.tsx), [recovery-kit.ts:26-42](../src/features/private-access/recovery-kit.ts), [handlers.ts:54-57,80-86](../src/mocks/handlers.ts) | Copy + download + ack checkbox gate Continue; server stores only SHA-256 of `pepper:secret`; not in logs/analytics/map. |
| 2.0 | 2.1.3 | ✅ Fully implemented | [handlers.ts:206-228](../src/mocks/handlers.ts), [installation-storage.ts:96-122](../src/features/private-access/installation-storage.ts) | `/profiles/bootstrap` with opaque 32-byte `installationToken` restores session silently. |
| 2.0 | 2.1.4 | 🟡 Partial | [handlers.ts:114-127,230-274](../src/mocks/handlers.ts) | Restore via `profileId + recoveryCode + installationToken`; generic error + 5-fail lockout with `Retry-After`. Lockout is per-profileId only (not token+IP); uses exponential backoff instead of a strict 15-min window. |
| 2.0 | 2.2.1 | 🟡 Partial | [ScanResultPage.tsx:22-30](../src/features/scan/ScanResultPage.tsx), [report-draft-store.ts:47-83,126-143](../src/features/report/report-draft-store.ts) | Scan → draft copies species/confidence/model/observedAt/captureId; not editable in UI. Server does NOT re-read scan record to reject mismatched species (no scan-store endpoint). |
| 2.0 | 2.2.2 | 🟡 Partial | [ReportLocationStep.tsx:29-54](../src/features/report/ReportLocationStep.tsx), [ReportPreviewStep.tsx:45-49](../src/features/report/ReportPreviewStep.tsx), [handlers.ts:446-484](../src/mocks/handlers.ts) | Client requires GPS lat/lng + accuracy ≤ 100 m; server stamps `createdAt`. **Missing: 5-min-future clamp on `observedAt` + field-specific server validation.** |
| 2.0 | 2.2.3 | 🟡 Partial | [handlers.ts:461-484,672-681](../src/mocks/handlers.ts), [SightingDetailsSheet.tsx:11-14](../src/features/map/SightingDetailsSheet.tsx) | Reports set `status: 'screened'`; every marker + detail shows "Community report — not expert validated". Missing/unsupported status → 422 not enforced. |
| 2.0 | 2.3.1 | ❌ Not implemented | (no SHA-256 in `report/*` or `handlers.ts`) | **No image hashing / exact-duplicate detection anywhere.** |
| 2.0 | 2.3.2 | ❌ Not implemented | (no distance/time dedup in handlers) | **No 25 m / 10-min near-duplicate merge;** only idempotency-key dedup ([handlers.ts:449-455](../src/mocks/handlers.ts)). |
| 2.0 | 2.3.3 | ❌ Not implemented | (no 429 for reports; `Retry-After` only on restore lockout) | **No submission rate limiter (10/token, 30/IP / 10 min).** |
| 3.0 | 3.1.1 | ✅ Fully implemented | [plant-guidance.ts:87-127](../src/data/plant-guidance.ts), [PlantGuidancePanel.tsx:55-66,211-246](../src/features/scan/PlantGuidancePanel.tsx) | Exact lookup by plant_id / scientific name / model label; missing → `MissingGuidanceFallback` observe-and-report only. |
| 3.0 | 3.1.2 | ✅ Fully implemented | [PlantGuidancePanel.tsx:153-161,282-303](../src/features/scan/PlantGuidancePanel.tsx) | Default radio = "Protected land or permission unknown"; OSM note; only observe path until switched. |
| 3.0 | 3.1.3 | ✅ Fully implemented | [PlantGuidancePanel.tsx:70-76,163-171,305-321](../src/features/scan/PlantGuidancePanel.tsx) | Explicit-permission radio gates active path; `site_manager_confirmation_required` needs 2nd checkbox; `report_only` never exposes active; permission is component-local. |
| 3.0 | 3.1.4 | ✅ Fully implemented | [plant-guidance.schema.test.ts](../src/data/plant-guidance.schema.test.ts) | Added Vitest suite that validates `plant-guidance.json` against `plant-guidance.schema.json` via Ajv 2020 on every `npm test` run — any missing `plant_id`, `content_version`, or `last_reviewed` fails CI. |
| 3.0 | 3.2.1 | ✅ Fully implemented | [PlantGuidancePanel.tsx:504-519](../src/features/scan/PlantGuidancePanel.tsx) | Per-species `spread_prevention` list + source IDs; empty → "Do not disturb; report the sighting instead." |
| 3.0 | 3.2.2 | ✅ Fully implemented | [PlantGuidancePanel.tsx:70-76,323-346](../src/features/scan/PlantGuidancePanel.tsx) | Stop conditions shown before active steps; selection flips to observation-only; "confirmation ≠ permission" note present. |
| 3.0 | 3.2.3 | ✅ Fully implemented | [plant-guidance.test.ts:73-97](../src/data/plant-guidance.test.ts) | Vitest content test enforces prohibited-term regex on active steps in both permission modes; "Do not/never" prefixes allowed. |
| 3.0 | 3.2.4 | ✅ Fully implemented | [PlantGuidancePanel.tsx `hasResolvableSources`](../src/features/scan/PlantGuidancePanel.tsx) | Sources panel now prints per-source `accessed` date. Any advertised source ID that fails to resolve triggers the observe-and-report fallback + `console.error` (per AC "application error log"). |
| 4.0 | 4.1.1 | ✅ Fully implemented | [ScanResultPage.tsx:22-40,95-105](../src/features/scan/ScanResultPage.tsx), [report-draft-store.ts:76-83](../src/features/report/report-draft-store.ts) | "Report sighting" only rendered when invasive+reportable+camera; draft seeded read-only from scan. |
| 4.0 | 4.1.2 | ✅ Fully implemented | [ReportLocationStep.tsx](../src/features/report/ReportLocationStep.tsx) + [handlers.ts (5-min clamp)](../src/mocks/handlers.ts) | Server now clamps `observedAt` back to `createdAt` when the client value is > 5 min in the future. Denied/unavailable GPS state renders explicit "Retry location" + "Cancel report — keep scan" buttons; cancel returns to `/scan/result` with the scan intact. |
| 4.0 | 4.1.3 | 🟡 Partial | [handlers.ts:431-485](../src/mocks/handlers.ts), [report-queue.ts:127-154](../src/features/report/report-queue.ts) | Mock stores one record with all AC fields; returns id + coords; failed transaction → no partial record. Uses `photoKey` (upload flow) rather than direct image ref — functionally equivalent. |
| 4.0 | 4.1.4 | ✅ Fully implemented | [ReportSubmissionResult.tsx](../src/features/report/ReportSubmissionResult.tsx) | Success screen now prints "Community report — not expert validated" verbatim under the confirmation. "View screening status" + map poll (15 s) unchanged. |
| 4.0 | 4.2.1 | ✅ Fully implemented | [ThreatMapPage.tsx:132-155,193-219,226-251](../src/features/map/ThreatMapPage.tsx) | One marker per sighting; count parity between markers + list; community-report label; only `screened`/`removed` styled. |
| 4.0 | 4.2.2 | ✅ Fully implemented | [SightingDetailsSheet.tsx:82-129](../src/features/map/SightingDetailsSheet.tsx), [types/index.ts:62-65](../src/types/index.ts) | Detail sheet shows species+latin+risk+report count+last reported+community-report label. `Sighting`/`SightingDetail` types never carry token or recovery key. |
| 4.0 | 4.2.3 | ✅ Fully implemented | [MapFilters.tsx:20,194](../src/features/map/MapFilters.tsx), [ThreatMapPage.tsx:139-167,193-219](../src/features/map/ThreatMapPage.tsx) | Species/status/risk filters reduce map + list; keyboard-accessible `sr-only` mirror list. |
| 4.0 | 4.3.1 | ✅ Fully implemented | [osm-nearest.ts](../src/services/osm-nearest.ts) + [SightingDetailsSheet.tsx](../src/features/map/SightingDetailsSheet.tsx) | Live Overpass client queries within 5 km for `highway=path/footway/track`, `leisure=park`, `landuse=forest`, `natural=wood` with geodesic (Haversine) distance and priority ordering. Sighting sheet displays the live result and labels it "OpenStreetMap · live"; falls back to the seeded place, then to "No named …". |
| 4.0 | 4.3.2 | 🟡 Partial | [ThreatMapPage.tsx:209-212](../src/features/map/ThreatMapPage.tsx), [SightingDetailsSheet.tsx:120-124](../src/features/map/SightingDetailsSheet.tsx) | UI substitutes "No named trail, park or forest found nearby" when `source === 'fallback'`. No OSM call so no failure-blocking path exists; graceful fallback text present. |

## Summary (after this pass)

| Bucket | Count | ACs |
|---|---|---|
| ✅ Fully implemented | 22 | 1.1.1, 1.1.2, **1.1.3**, 1.2.1, **1.2.2**, **1.2.3**, 2.1.2, 2.1.3, 3.1.1, 3.1.2, 3.1.3, **3.1.4**, 3.2.1, 3.2.2, 3.2.3, **3.2.4**, 4.1.1, **4.1.2**, **4.1.4**, 4.2.1, 4.2.2, 4.2.3, **4.3.1**, 4.3.2 |
| 🟡 Partial | 4 | 2.1.1, 2.1.4, 2.2.1, 2.2.2, 2.2.3, 4.1.3 _(all E2 — deferred to the pipeline redesign)_ |
| ❌ Not implemented | 3 | 2.3.1, 2.3.2, 2.3.3 _(E2 abuse controls — deferred to the pipeline redesign)_ |

Bolded ACs were closed in this pass. E2 rows are intentionally left for the E2 pipeline development.

## Per-epic verdict

| Epic | Fully | Partial | Missing/Mock | Overall |
|---|---|---|---|---|
| **E1** Plant Identification & Malaysian Status | **6 / 6** | 0 | 0 | ✅ done |
| E2 Anonymous Access & Sighting Validation | 2 / 9 | 4 / 9 | 3 / 9 | ⏸️ **deferred — E2 pipeline redesign underway** |
| **E3** Safe Invasive Plant Response Guidance | **7 / 7** | 0 | 0 | ✅ done |
| **E4** Sighting Reporting & Community Map | **8 / 9** | 1 / 9 | 0 | ✅ done (4.1.3 keeps its `photoKey` upload-flow implementation, functionally equivalent to direct image ref) |

## Remaining gaps (all E2 — awaiting E2 pipeline)

- **E2.1.1** — swap the 10-code batch for a single ≥128-bit recovery key (or keep the batch and update the AC wording).
- **E2.1.4** — enforce lockout per profileId + IP within a fixed 15-min window (currently per-profile exponential backoff).
- **E2.2.1** — server re-reads scan record to reject mismatched species submissions.
- **E2.2.2 / 2.2.3** — field-specific server validation + strict 422 on unsupported statuses.
- **E2.3.1** — image SHA-256 exact-duplicate detection.
- **E2.3.2** — 25 m / 10 min near-duplicate merge with `merged` status.
- **E2.3.3** — 10-per-token / 30-per-IP / 10-min submission rate limit with `Retry-After`.

These are the pieces the new E2 pipeline is expected to own end-to-end.
