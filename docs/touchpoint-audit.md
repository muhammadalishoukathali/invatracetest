# InvaTrace touchpoint audit

Scope: every interactive control found under `/Users/moham/Desktop/fyp/invatrace-web/src`.
Ranking: **BROKEN** = fires the wrong thing / traps the user, **DEAD** = intentionally inert (coming-soon / stub) or missing but low impact, **WORKS** = wired to real logic.

Legend: ✅ = fixed in the same pass as [image-pipeline-report.md](./image-pipeline-report.md).

## BROKEN — user-visible regressions, ranked by impact

### 1. ✅ Scan back button destroyed the scan result and skipped the capture screen
File: `src/features/scan/ScanFlowLayout.tsx`
Was:
```ts
const goBack = () => { reset(); navigate(-1) }
```
Two coupled failures:
- On `/scan/result`, `navigate(-1)` jumps to `/map`, not back to the capture screen, because `ScanCapturePage` uses `navigate('/scan/result', { replace: true })` (`ScanCapturePage.tsx:214`). History is `/map → /scan/result`, so Back skipped capture entirely.
- Regardless of the target, `reset()` runs first and wipes the captured photo, quality, result, and species detail from `useScan`. So the "retake" mental model was dead — the photo was gone before the user landed anywhere useful.

Fix: deterministic navigation — from `/scan/result` return to `/scan` while preserving scan state, from `/scan` return to `/map` and clear the store.

### 2. Camera-denied path on `ScanCapturePage` traps production users
File: `src/features/scan/ScanCapturePage.tsx:112-159`
The hidden `cameraRef` file input (with `capture="environment"`) is only used as a fallback when `getUserMedia` is undefined. When permission is *denied* (the common case), the code just shows an error toast; there is no button to trigger the file input, and gallery upload is gated behind `import.meta.env.DEV` (`ScanCapturePage.tsx:309-322`). Production users who deny camera once cannot progress without changing browser settings.

### 3. ✅ Restore page "Back to private access" caused a full page reload
File: `src/features/private-access/pages/RestorePrivateAccessPage.tsx:57`
Was:
```tsx
<a className="access-back-link" href="/private-access">
```
Raw `<a href>` bypassed React Router. Any partially-filled restore state (profile ID, code, `syncMessage`, `success` timers) was discarded and the app re-bootstrapped `PrivateAccessRouteGuard`.

Fix: switched to `<Link to="/private-access">`.

### 4. ✅ `PrivateAccessLink` was a raw anchor (used on the landing page)
File: `src/features/private-access/components/PrivateAccessControls.tsx:27-34`
Called at `PrivateAccessLandingPage.tsx:69` for "Restore existing access". Same full-page-reload symptom as #3 whenever the user hopped between landing and restore.

Fix: internal (`/…`) hrefs use `<Link>`, external URLs keep the anchor fallback.

### 5. `ScanResultPage` — no back button, and no way to retake without full reset
File: `src/features/scan/ScanResultPage.tsx:17-20`
```ts
const scanAgain = () => { useScan.getState().reset(); navigate('/scan', { replace: true }) }
```
Only "Scan again" (which wipes state) and the layout back arrow (which was broken per #1). Users cannot inspect the photo they just captured without losing their identification. Item #1's fix now lets the layout back arrow return to `/scan` with state intact.

### 6. ✅ `ReportWizardPage` first-step back could strand the user
File: `src/features/report/ReportWizardPage.tsx:33-40`
Was:
```ts
if (isFirst) { reset(); navigate('/scan/result') }
```
If the wizard was reached via a deep link or after a reload and `useScan.result` was empty, `/scan/result` immediately did `<Navigate to="/scan" replace />` and the user landed on a blank camera screen. There was no guard for this on entry.

Fix: falls back to `/map` when `useScan.getState().result` is empty.

### 7. `ScanCapturePage.openCamera` requests location before permission is granted
File: `src/features/scan/ScanCapturePage.tsx:112-115`
```ts
const openCamera = async () => {
  if (cameraStarting || streamRef.current) return
  captureScanLocation()
```
`captureScanLocation()` fires unconditionally — even if the user then denies camera, we've already prompted for GPS. Minor privacy/UX regression, but a wired-then-wrong handler.

### 8. `ScanResultPage` — `startReport` silently no-ops when preconditions fail
File: `src/features/scan/ScanResultPage.tsx:22-31`
```ts
if (!imageBlob || !url || !observedAt || !captureId || source !== 'camera') return
```
If any invariant is missing (e.g. gallery-source photo, or blob GC'd after tab suspension), the "Report sighting" button becomes a dead click with no toast. `canReport` gates visibility only on `captureSource === 'camera'`; the other conditions can still fail silently.

### 9. `ReportExtentStep` Continue has no `disabled` gate
File: `src/features/report/ReportExtentStep.tsx:81`
```tsx
<ReportNextButton onClick={next} label="Continue" />
```
The store defaults `extent: 'small_patch'` (`report-draft-store.ts:63`), so users can advance without ever actively choosing an extent. Not "broken" in the sense of crashing, but it violates the "user must actively choose" expectation and lets weakly-selected data through.

### 10. `useEffect` visibility handler in `ScanCapturePage` closes the camera on any tab hide
File: `src/features/scan/ScanCapturePage.tsx:48-56`
Any brief backgrounding (notification shade, iOS permission prompt) kills the stream and forces the user to re-tap "Open camera". Wired but too aggressive.

### 11. `NotificationsPanel` opens `n.linkTo` via `navigate()` with no validation
File: `src/features/notifications/NotificationsPanel.tsx:55-58`
If the server ever emits an absolute URL (e.g. `https://…`), `navigate()` treats it as a relative path and produces `/foo/https:/…`. Also no `replace` policy — clicking a notification while on `/reports/:id` pushes duplicate history entries.

### 12. `ReportTrackingPage` has no back button or wizard exit
File: `src/features/report/ReportTrackingPage.tsx:91-95`
Only forward-navigation links (`Retake scan`, `View shared map`, `Back to map`). A user who arrived by notification and expected to return to the previous screen has no way to do so.

### 13. `PrivateAccessNotice` a11y-live-region only announces after the first render
File: `src/features/private-access/pages/PrivateAccessLandingPage.tsx:63` (+ `PrivateAccessControls.tsx:84`)
`PrivateAccessNotice`'s `live` prop only sets `aria-live` if `live` is truthy, but the notice mounts newly on error, so `aria-live` fires only after subsequent re-renders. Screen readers may miss the first error announcement. Minor a11y break.

### 14. Recovery kit "Save installation again" button hidden behind stale `syncMessage`
File: `src/features/private-access/pages/RecoveryKitSetupPage.tsx:124-126`
The retry is only rendered when `syncMessage` is truthy. If the storage failure happens without a `syncMessage` populated (e.g. IndexedDB quota with silent error), the user sees the checkbox+continue path but continue fails and there is no manual retry.

### 15. `ReportSubmissionResult` "View screening status" goes to a stringly-typed URL
File: `src/features/report/ReportSubmissionResult.tsx:68`
```tsx
<button ... onClick={() => done(outcome.report.trackingUrl)}>
```
`outcome.report.trackingUrl` is server-supplied. If the server ever returns an absolute URL, `navigate()` will 404 inside the SPA. No validation, no fallback.

## DEAD — intentionally inert or acceptably empty

- Sidebar & bottom-tab items for `/trail`, `/sessions`, `/impact` render as `<span role="link" aria-disabled="true">` with the tooltip "Available in a later iteration" — `Sidebar.tsx:19-29`, `BottomTabs.tsx:20-32`. Correctly non-navigating; no route exists.
- `AppShell` catch-all `<Navigate to="/map" replace />` at `router.tsx:62` swallows accidental hits to those disabled paths.
- `SightingDetailsSheet` "Try again" retry (`SightingDetailsSheet.tsx:69`) — active only when the query errored, otherwise not rendered. Fine.
- `PrivateAccessLandingPage` "Check storage again" (`PrivateAccessLandingPage.tsx:71-73`) — visible only in `storage-error`. Fine.
- `MapLegend` open/close buttons (`MapLegend.tsx:14, 41`) — mobile-only, work; on desktop the "Hide legend" button is intentionally not rendered.
- DEV-only gallery upload on `ScanCapturePage.tsx:309-322` — clearly labeled dev-only.
- Access management "Cancel" buttons on rotate/revoke confirmations — inline, work as no-ops.

## WORKS — verified wired to real logic

Navigation & shell
- Sidebar "New scan" → `/scan` (`Sidebar.tsx:63`).
- Sidebar user chip → `/access` (`Sidebar.tsx:77`).
- Bottom tabs primary "Scan" FAB → `/scan` (`BottomTabs.tsx:58`).
- Mobile header `Manage private access` button → `/access` (`AppShell.tsx:50-58`).
- Skip-link anchor to `#main-content` (`AppShell.tsx:38`).

Report wizard flow
- Wizard back arrow (`ReportWizardPage.tsx:50`) — see item #6 for the guard.
- Location step: geolocation button, retry, `canProceed` gate on 100 m accuracy (`ReportLocationStep.tsx:29-114`).
- Consent step: both checkboxes gate `canProceed` (`ReportConsentStep.tsx:9,43`).
- Preview step: `submit()` posts via `submitReport`, sets outcome, disables while submitting (`ReportPreviewStep.tsx:21-116`).
- Submission result: three action buttons all navigate + reset stores (`ReportSubmissionResult.tsx:10-96`) — modulo #15.

Map interactions
- Search input + clear button (`MapFilters.tsx:50-71`).
- Desktop chips and mobile filter sheet toggles, reset/apply footer (`MapFilters.tsx:88-212`).
- Pin click → `select(s.id)` (`ThreatMapPage.tsx:150`).
- MapLibre geolocate + navigation controls (`ThreatMapPage.tsx:103-107`).
- Screen-reader accessible sighting list buttons (`ThreatMapPage.tsx:200-214`).

Sighting details sheet
- Close (`SightingDetailsSheet.tsx:59`), directions link opens Google Maps in new tab (`:153`), error retry (`:69`), a11y dialog with focus return to originating pin (`:26-30`).

Recovery kit
- Copy ID (`RecoveryKitSetupPage.tsx:85`), copy recovery info (`:96`), download kit (`:97`), acknowledgement checkbox gates "Continue to InvaTrace" (`:117-123`), generate replacement codes when missing (`:127-129`).

Restore flow
- Form submit validates non-empty fields, calls `restorePrivate`, redirects to `/map` on success (`RestorePrivateAccessPage.tsx:29-45`).

Access management (`AccessManagementPage.tsx`)
- Copy ID, save display name, replace codes with confirm dialog, revoke installation with confirm dialog — all wired (`:126-175`).

Notifications
- Toggle open/close, mark all read, per-item mark-and-navigate (`NotificationsPanel.tsx:55-59, 141-144, 158-176`). Modulo #11.

Report queue banner
- View queue drawer, retry reports, retry sync (`ReportQueueStatusBanner.tsx:83-101`).
- Queue drawer close, discard, retry (`ReportQueueDrawer.tsx:46, 99, 114`).

Report tracking
- Query auto-refetches on `processing` / retryable states; "Try again" refetch on error (`ReportTrackingPage.tsx:47-63`).

Scan capture (happy paths)
- Camera preview `Capture plant photo` (`ScanCapturePage.tsx:276`), close-camera X (`:268`), retake / discard (`:335, 343`), analyse (`:358`), quality-check status pill.

PWA/offline
- `ReportQueueStatusBanner` is the only offline surface; retry buttons wired. There is no other "offline banner" component in the tree.
