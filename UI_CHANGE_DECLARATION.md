# UI Change Declaration

Date: 28 August 2026

Branch: `codex/ui-only-batch1-20260826`

This branch contains the responsive-polish pass plus intentional Private access,
recovery, and installation management for pseudonymous profiles.

| Area | Changes |
|---|---|
| Design system | Bundled Inter and IBM Plex Mono locally; improved contrast, borders, focus states and touch targets |
| Responsive UI | Separated desktop, tablet and mobile layouts; added narrow-screen and mobile safe-area handling |
| Map | Improved detail-panel positioning, rounded risk/status accent, attribution, legend, filters and coordinate display |
| Filters | Risk level: High risk and Watch; Status: Candidate, Confirmed and Removed |
| Navigation | Completed the four mobile navigation destinations around the centre scan button without enabling later-iteration pages |
| Entry flow | First-time visitors intentionally start or restore Private access; known installations still bootstrap directly into the map |
| Recovery | Public profile ID, ten in-memory one-time codes, local UTF-8 recovery-kit download, interrupted-setup rotation and generic restore failure |
| Access management | Optional display name, unused-code count, replacement batches, active installations and non-current revocation |
| Other screens | UI polish for Scan, Report, Verify, Notifications and Offline Queue |
| Accessibility | Improved keyboard focus, dialog closing/focus return, progress semantics and minimum touch-target sizes |

## Scope boundaries

- The production backend is not implemented here; MSW mirrors the complete private-access contract with development-only hashing and persistence.
- Report submission behavior is unchanged, but reconnect now restores the API session before draining the offline queue.
- Privileged verification remains guarded by the server-authoritative role.
- Removed remains a status internally and is displayed in the Status filter
  group on both desktop and mobile.

## Validation

- ESLint passed.
- TypeScript check passed.
- Vitest passed: 9/9 tests.
- Production build passed; the existing bundle-size warning remains.
- A service-worker-controlled production preview restored the same installation
  token after a true offline reload and contained no API responses in Cache Storage.
- Desktop and mobile layouts were manually checked locally.
- Playwright passed: 10/10 end-to-end scenarios.

After pulling this branch, run `npm install` because local font packages and
the IndexedDB test adapter are declared development dependencies.
