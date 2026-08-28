# Page override — `/report` (Report wizard)

Extends `MASTER.md`.

## Purpose
Turn a scan result into a formal sighting report: location, extent, consent, preview, submit.

## Layout
- Standalone route, its own header (back button + progress subtitle `Step N of 4 · Label`).
- Under the header, a 4-segment progress bar (3 px tall, green filled, border grey).
- Main content maxWidth 520 px, single column.

## Steps
1. **Location.** Auto-request geolocation on mount; show "Locating…", "Denied", "Unavailable", or success card with accuracy in metres. Manual-entry `<details>` opens two decimal inputs, "Apply coordinates" green-tinted button.
2. **Extent.** 3 radio-tile cards: Single plant · Small patch · Large area. Each card 1 icon + title + m² label + one-sentence description. Optional notes textarea (280 char limit, live counter).
3. **Consent.** Two checkboxes, both required to proceed:
   - "This report is accurate to the best of my knowledge"
   - "My photo does not contain personal information"
   Green info banner above explains what happens next. Small print about coordinate precision + pseudonymous installation reporting below.
4. **Preview.** Photo, then metadata card: Species · Outcome · Location (with GPS accuracy or "Manual entry") · Extent · Notes. Model version bar. Big "Submit report" primary button (with Send icon).

## Submission outcomes
- **Success:** confirmation screen with green tick circle, tracking ID (mono, first 8 chars), "Back to map" primary + "Scan another" secondary.
- **Queued (offline):** amber `WifiOff` circle, "Saved for later" message, same two CTAs. Reassures user we'll retry on reconnect.

## Motion
- Step-to-step: instant swap (no slide). Progress bar segment fills 200 ms `ease-out`.
- Submission spinner replaces button text.

## Behaviour
- Back on step 1 = reset draft + return to `/scan/result`.
- Route entered without a draft = redirect to `/scan`.
- Blob URL + ImageBitmap freed on `reset()` via `URL.revokeObjectURL`.

## Anti-patterns
- Do NOT pre-check consent boxes.
- Do NOT allow "Continue" from consent step unless both boxes checked.
- Do NOT store the report to IndexedDB before the user hits Submit.
- Do NOT accept latitudes outside [-90, 90] or longitudes outside [-180, 180]; ideally reject anything outside Malaysia bounds.
- Do NOT clear the offline queue automatically without telling the user.
