# UI Change Declaration

Date: 27 August 2026

Branch: `codex/ui-only-batch1-20260826`

This branch contains a frontend UI review and responsive-polish pass. It is
kept separate from `main` for team review.

| Area | Changes |
|---|---|
| Design system | Bundled Inter and IBM Plex Mono locally; improved contrast, borders, focus states and touch targets |
| Responsive UI | Separated desktop, tablet and mobile layouts; added narrow-screen and mobile safe-area handling |
| Map | Improved detail-panel positioning, rounded risk/status accent, attribution, legend, filters and coordinate display |
| Filters | Risk level: High risk and Watch; Status: Candidate, Confirmed and Removed |
| Navigation | Completed the four mobile navigation destinations around the centre scan button without enabling later-iteration pages |
| Other screens | UI polish for Auth, Scan, Report, Verify, Notifications and Offline Queue |
| Accessibility | Improved keyboard focus, dialog closing/focus return, progress semantics and minimum touch-target sizes |

## Scope boundaries

- No backend, API, database, permission or route-guard changes.
- No changes to report submission, offline sync, or Verify decision logic.
- Coordinator remains selectable during registration; this known issue is out
  of scope for this UI branch.
- Removed remains a status internally and is displayed in the Status filter
  group on both desktop and mobile.

## Validation

- TypeScript check passed.
- Vitest passed: 3/3 tests.
- Production build passed; the existing bundle-size warning remains.
- Desktop and mobile layouts were manually checked locally.
- Full Playwright E2E has not been rerun.

After pulling this branch, run `npm install` because local font packages were
added.
