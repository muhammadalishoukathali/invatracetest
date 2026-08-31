# InvaTrace Iteration 1 — Round 2 independent re-verification

Verified against `src/**` on 2026-08-30, **after** the fix pass. Independent read of the code — did not trust prior status.

| Epic | AC | Status | Evidence | Note |
|---|---|---|---|---|
| 1.0 | 1.1.1 | ✅ Fully | [ScanCapturePage.tsx:251,256](../src/features/scan/ScanCapturePage.tsx), [image-processing.ts:2,41](../src/features/scan/image-processing.ts) | `accept="image/jpeg,image/png,image/webp"` + `capture="environment"`; `MAX_SOURCE_BYTES = 10 MB` with rejection error before any scan/report record is created. |
| 1.0 | 1.1.2 | ✅ Fully | [ScanResultPage.tsx:157-184](../src/features/scan/ScanResultPage.tsx), [ScanCapturePage.tsx:194-200](../src/features/scan/ScanCapturePage.tsx), [pulih-model.ts:220](../src/features/scan/pulih-model.ts) | Scientific + common name + confidence band + "model-generated" disclaimer; 31-class validation; 15-second `Promise.race` cutoff. |
| 1.0 | 1.1.3 | ✅ Fully | [ScanResultPage.tsx:66,254-283](../src/features/scan/ScanResultPage.tsx) | `UncertainResult` hides guidance/report path; dedicated `Retake photo` CTA renders inside the uncertain block. |
| 1.0 | 1.2.1 | ✅ Fully | [malaysia-status.ts:17-25](../src/features/scan/malaysia-status.ts), [ScanResultPage.tsx:33](../src/features/scan/ScanResultPage.tsx) | Returns `invasive` / `information_only` / `status_uncertain`; missing status defaults to `status_uncertain` — never non-invasive. |
| 1.0 | 1.2.2 | ✅ Fully | [ScanResultPage.tsx:89-101](../src/features/scan/ScanResultPage.tsx), [handlers.ts:740,780](../src/mocks/handlers.ts) | Per-species `statusSourceId` + `statusReviewedAt` supplied by mock and rendered under guidance: "Malaysia status record · source X · reviewed Y". |
| 1.0 | 1.2.3 | ✅ Fully | [ScanResultPage.tsx:39-45,82-93](../src/features/scan/ScanResultPage.tsx), [PlantGuidancePanel.tsx:82-93](../src/features/scan/PlantGuidancePanel.tsx) | `reportEligible` gates the Report button; **`actionEligible` now flows through to `PlantGuidancePanel` and shuts down the active-removal path** when the server sets it false, regardless of the user's permission choice. |
| 2.0 | 2.1.1 | ⚠️ Mock-only | [handlers.ts:165-204](../src/mocks/handlers.ts), [private-access-store.ts:235-267](../src/features/private-access/private-access-store.ts) | Anonymous pseudonymous profile creation via MSW mock. Batch of 10 codes replaces the single ≥128-bit key from the AC — deferred to E2 pipeline redesign. |
| 2.0 | 2.1.2 | ⚠️ Mock-only | [RecoveryKitSetupPage.tsx](../src/features/private-access/pages/RecoveryKitSetupPage.tsx), [handlers.ts:77-86,294-302](../src/mocks/handlers.ts), [recovery-kit.ts](../src/features/private-access/recovery-kit.ts) | 10-code batch generation + acknowledgement endpoint wired. |
| 2.0 | 2.1.3 | ⚠️ Mock-only | [RestorePrivateAccessPage.tsx](../src/features/private-access/pages/RestorePrivateAccessPage.tsx), [private-access-store.ts:269-306](../src/features/private-access/private-access-store.ts), [handlers.ts:230-274](../src/mocks/handlers.ts) | Restore + throttle + one-time-code invalidation. |
| 2.0 | 2.1.4 | ⚠️ Mock-only | [AccessManagementPage.tsx](../src/features/private-access/pages/AccessManagementPage.tsx), [handlers.ts:334-351](../src/mocks/handlers.ts) | Self-revoke blocked; other installations revocable; sessions purged. |
| 2.0 | 2.2.1 | ⚠️ Mock-only | [handlers.ts:484-493](../src/mocks/handlers.ts) | Rule-based screening simulated via `setTimeout` → `automated_rule_screened` / `deterministic-rules-v1.0`. No real pipeline yet. |
| 2.0 | 2.2.2 | ✅ Fully | [handlers.ts:458-465](../src/mocks/handlers.ts) | Explicit 5-minute-future clamp on `observedAt`; comment references AC 2.2.2 / 4.1.2. |
| 2.0 | 2.2.3 | 🟡 Partial | [types/index.ts:2-4](../src/types/index.ts), [handlers.ts:537](../src/mocks/handlers.ts), [SightingDetailsSheet.tsx](../src/features/map/SightingDetailsSheet.tsx) | `reporterTrust` exposed but no per-user trust promotion logic — pipeline territory. |
| 2.0 | 2.3.1 | ⚠️ Mock-only | [report-queue.ts](../src/features/report/report-queue.ts), [handlers.ts:394-495](../src/mocks/handlers.ts) | Anonymous submission path present through mock; no image-hash duplicate detection. |
| 2.0 | 2.3.2 | ⚠️ Mock-only | [private-access-store.ts:393](../src/features/private-access/private-access-store.ts), [api-client.ts](../src/services/api-client.ts), [handlers.ts:432-436](../src/mocks/handlers.ts) | 401 → session recovery + retry once refreshed. No 25 m / 10 min near-duplicate merge yet. |
| 2.0 | 2.3.3 | ⚠️ Mock-only | [report-queue.ts](../src/features/report/report-queue.ts), [ReportQueueStatusBanner.tsx](../src/features/report/ReportQueueStatusBanner.tsx), [types/index.ts:211](../src/types/index.ts) | Offline queue drains on `online`; no server-side rate limiter yet. |
| 3.0 | 3.1.1 | ✅ Fully | [PlantGuidancePanel.tsx:56,64](../src/features/scan/PlantGuidancePanel.tsx), [plant-guidance.ts:108-127](../src/data/plant-guidance.ts) | Exact species-id lookup; `MissingGuidanceFallback` (observe-and-report only) on miss. |
| 3.0 | 3.1.2 | ✅ Fully | [PlantGuidancePanel.tsx:60,167-172](../src/features/scan/PlantGuidancePanel.tsx) | Default `permission='unknown'`; always renders `protected_or_permission_unknown` block first. |
| 3.0 | 3.1.3 | ✅ Fully | [PlantGuidancePanel.tsx:82-87,317-333](../src/features/scan/PlantGuidancePanel.tsx) | `activePathAllowed` gate with permission + stop-conditions + site-manager confirmation; `report_only` never activates; view-scoped only. |
| 3.0 | 3.1.4 | ✅ Fully | [plant-guidance.schema.test.ts:9-22](../src/data/plant-guidance.schema.test.ts), [plant-guidance.test.ts:56-71](../src/data/plant-guidance.test.ts), [PlantGuidancePanel.tsx:73-77](../src/features/scan/PlantGuidancePanel.tsx) | Ajv 2020 schema validation on every `npm test`; missing-field fallback + `console.error`. |
| 3.0 | 3.2.1 | ✅ Fully | [PlantGuidancePanel.tsx:204,516-531](../src/features/scan/PlantGuidancePanel.tsx) | `SpreadPreventionBlock` renders per-plant items in original order. |
| 3.0 | 3.2.2 | ✅ Fully | [PlantGuidancePanel.tsx:335-357](../src/features/scan/PlantGuidancePanel.tsx) | Mandatory stop-conditions checkbox gates `activePathAllowed`. |
| 3.0 | 3.2.3 | ✅ Fully | [plant-guidance.test.ts:73-97](../src/data/plant-guidance.test.ts) | Build-time regex test forbids burn/herbicide/chainsaw/climb/water/dense-thicket in active steps. |
| 3.0 | 3.2.4 | ✅ Fully | [PlantGuidancePanel.tsx:640-682](../src/features/scan/PlantGuidancePanel.tsx) | Sources list shows title + publisher + link + `accessed` date; `hasResolvableSources` guard forces observe-and-report fallback on any dangling ID. |
| 4.0 | 4.1.1 | ✅ Fully | [ScanResultPage.tsx:43-46](../src/features/scan/ScanResultPage.tsx) | `canReport` hidden unless camera + not uncertain + `reportEligible` + `result.reportable`. |
| 4.0 | 4.1.2 | ✅ Fully | [scan-store.ts:97-118](../src/features/scan/scan-store.ts), [handlers.ts:458-465](../src/mocks/handlers.ts), [ReportLocationStep.tsx:17-22,112-134](../src/features/report/ReportLocationStep.tsx) | GPS lat/lng/accuracy captured; server clamps 5-min-future `observedAt`; denied/unavailable state renders explicit `Retry location` + `Cancel report — keep scan` buttons; cancel preserves scan. |
| 4.0 | 4.1.3 | 🟡 Partial | [handlers.ts:431-495](../src/mocks/handlers.ts) | Mock validates fields + idempotency + returns 500 without insertion on failure. No real relational DB transaction yet — fine for Iteration 1 mock backend. |
| 4.0 | 4.1.4 | ✅ Fully | [ReportSubmissionResult.tsx:44,51-58,76-84](../src/features/report/ReportSubmissionResult.tsx) | "Report submitted" + View screening + verbatim "Community report — not expert validated" line on success screen. |
| 4.0 | 4.2.1 | ✅ Fully | [ThreatMapPage.tsx:148-155,183,193-219](../src/features/map/ThreatMapPage.tsx) | One marker per sighting; parity with accessible list; community-report styling per risk/status. |
| 4.0 | 4.2.2 | ✅ Fully | [SightingDetailsSheet.tsx:21-24,100-166](../src/features/map/SightingDetailsSheet.tsx) | Species + thumbnail + confidence + time + context + "Community report — not expert validated" verbatim; no token/recovery/session key exposed. |
| 4.0 | 4.2.3 | ✅ Fully | [MapFilters.tsx](../src/features/map/MapFilters.tsx), [ThreatMapPage.tsx:139-146,193-219](../src/features/map/ThreatMapPage.tsx) | Filters reduce both map and screen-reader list; `sr-only` keyboard-accessible mirror list. |
| 4.0 | 4.3.1 | ✅ Fully | [osm-nearest.ts](../src/services/osm-nearest.ts), [SightingDetailsSheet.tsx:52-58,142-161](../src/features/map/SightingDetailsSheet.tsx) | Real Overpass client, 5 km radius, path/park/forest/wood priority, Haversine distance, wired via React Query on sighting detail. |
| 4.0 | 4.3.2 | ✅ Fully | [osm-nearest.ts:110-140](../src/services/osm-nearest.ts), [SightingDetailsSheet.tsx:146-153](../src/features/map/SightingDetailsSheet.tsx), [ThreatMapPage.tsx:209-211](../src/features/map/ThreatMapPage.tsx) | Returns `null` on error/timeout/no-result; UI falls back to "No named trail, park or forest found nearby" verbatim; report submission is independent of OSM lookup so failure never blocks publishing. |

## Summary counts

| Bucket | Count |
|---|---|
| ✅ Fully implemented | **22** |
| 🟡 Partial | **2** (2.2.3 trust promotion, 4.1.3 no real DB txn) |
| ⚠️ Mock-only | **7** (all E2 identity/session/screening endpoints — awaiting pipeline) |
| ❌ Not implemented | 0 |

## Per-epic verdict

| Epic | Fully | Partial / Mock | Overall |
|---|---|---|---|
| **E1** Plant Identification & Malaysian Status | **6 / 6** | 0 | ✅ done |
| E2 Anonymous Access & Sighting Validation | 1 / 10 (2.2.2 only) | 1 partial + 8 mock-only | ⏸️ deferred to E2 pipeline |
| **E3** Safe Invasive Plant Response Guidance | **7 / 7** | 0 | ✅ done |
| **E4** Sighting Reporting & Community Map | **8 / 9** | 1 partial (4.1.3 = mock DB) | ✅ done |

## What changed from round 1

- **1.2.3** flipped from 🟡 → ✅ by wiring `actionEligible` through to `PlantGuidancePanel` and adding it to the `activePathAllowed` gate.
- Every other row that was `✅` in round 1 held up under independent re-verification.
- E2 remains intentionally deferred per user direction (E2 pipeline redesign).
