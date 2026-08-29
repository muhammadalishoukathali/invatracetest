# Codebase guide

This guide explains where each responsibility belongs. Keep new work inside the
existing layer and domain boundaries instead of creating parallel abstractions.

## Top-level directories

| Path | Responsibility |
|---|---|
| `src/` | Application source code. |
| `backend/` | FastAPI service, worker, database models, migrations, and backend tests. |
| `e2e/` | Browser journeys that exercise complete user flows. |
| `docs/` | Product, architecture, security, and workflow documentation. |
| `design-system/` | Visual rules and page-specific design guidance. |
| `public/` | Static assets copied into the production bundle. |
| `scripts/` | Reproducible build preparation scripts. |
| `vendor/` | Checksum-verified supplied model kit; do not edit these files. |

Build output, dependency folders, local environment values, and test reports are
excluded through `.gitignore` and are not source code.

## Source directories

| Path | Responsibility |
|---|---|
| `src/app/` | Route registration and application-wide navigation policy. |
| `src/components/` | Reusable application-shell and cross-feature UI. |
| `src/features/` | Screens, state, and components owned by each product area. |
| `src/hooks/` | Reusable browser and accessibility hooks. |
| `src/mocks/` | Development API implementation that mirrors the production HTTP contract. |
| `src/services/` | Shared external-service adapters, including the HTTP client. |
| `src/styles/` | Global tokens and application-wide styles. |
| `src/types/index.ts` | Types shared across routes, stores, API calls, and mocks. |

## Feature directories

| Path | Responsibility |
|---|---|
| `src/features/private-access/` | Profile creation, installation identity, recovery, access management, and route guards. |
| `src/features/map/` | Threat-map screen, filters, selection state, legend, and sighting details. |
| `src/features/scan/` | Image capture, image preparation, model adapter, and scan state. |
| `src/features/report/` | Report wizard, draft state, offline queue, and queue status UI. |
| `src/features/report/ReportTrackingPage.tsx` | Private automated-screening status, scope disclosure, and rescan guidance. |
| `src/features/notifications/` | Notification polling and notification-panel UI. |

## Module boundaries

- Route components coordinate a screen. They may call domain modules and render
  shared components, but they do not own persistence or HTTP behavior.
- Components handle presentation and interaction. Feature state belongs beside
  its screens under `src/features/<feature>/`.
- `src/services/api-client.ts` is the only general HTTP wrapper. It owns request headers,
  access-token attachment, retry-on-session-recovery behavior, and API errors.
- Stores and lifecycle modules own persistence, synchronization, and transitions.
  They expose state and commands for routes to consume.
- Mock handlers reproduce the server contract for development and tests. They
  must not be imported into production application code.
- Shared request and response shapes belong in `src/types/index.ts` so the UI,
  state modules, and mocks agree on the same contract.

## Naming rules

- Full route screens end in `Page`, for example `ThreatMapPage.tsx`.
- A screen inside a multi-step form ends in `Step`, for example
  `ReportConsentStep.tsx`.
- Components that arrange child routes end in `Layout`. Components that decide
  whether a route may open use `Guard` or start with `Require`.
- Zustand modules end in `-store.ts` and name the state they own, such as
  `report-draft-store.ts` and `map-view-store.ts`.
- Browser persistence modules name the stored record, such as
  `installation-storage.ts`. Shared external clients belong in `src/services/`.
- Tests sit beside the module they check and repeat its file name before the
  `.test.ts` suffix.
- Avoid generic file names such as `Utils`, `Helpers`, `Data`, or `Page`. A file
  name should say which feature it belongs to and what responsibility it owns.

## Private access map

| Path | Purpose |
|---|---|
| `src/features/private-access/pages/PrivateAccessLandingPage.tsx` | First-time choice between creating and restoring access. |
| `src/features/private-access/pages/RecoveryKitSetupPage.tsx` | Recovery-kit display, download, confirmation, and optional display name. |
| `src/features/private-access/pages/RestorePrivateAccessPage.tsx` | Profile ID and one-time recovery-code submission. |
| `src/features/private-access/pages/AccessManagementPage.tsx` | Profile details, code rotation, installation list, and revocation. |
| `src/features/private-access/components/` | Reusable visual structure and route guards for the four access screens. |
| `src/features/private-access/private-access-store.ts` | Private profile lifecycle and in-memory application state. |
| `src/features/private-access/installation-storage.ts` | IndexedDB installation record storage and schema migration. |
| `src/features/private-access/recovery-kit.ts` | Local UTF-8 recovery-kit formatting and download. |
| `src/mocks/handlers.ts` | Development implementation of creation, bootstrap, restore, rotation, and revocation endpoints. |
| `src/features/private-access/private-access.css` | Responsive styling shared by the access routes. |

## Change checklist

When changing a user flow:

1. Update the route and its domain module.
2. Update shared request or response types when the API shape changes.
3. Keep the matching mock handler behavior aligned with the production contract.
4. Add or update focused unit tests and the relevant browser journey.
5. Update architecture or workflow documentation when security or state behavior changes.
