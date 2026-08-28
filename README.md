# InvaTrace — web client

Iteration 1 (E1–E4) frontend. React 18 + Vite + TypeScript, installable PWA.
InvaTrace uses intentional **Private access**: server-backed pseudonymous
profiles without email/password registration.

Build plan: `../InvaTrace_Frontend_Build_Plan.md`
Architecture: `../InvaTrace_System_Architecture.docx`

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run build` · `npm run typecheck` · `npm test`

## Private access

A first-time visitor chooses **Start privately** or **Restore existing access**.
Starting creates a server-backed pseudonymous profile with a public profile ID,
ten one-time recovery codes, the server-authoritative `Detector` role, and `New`
trust. No email, phone number, legal name, or password is requested. A display
name is optional and can be changed or removed later.

The public profile ID is not secret. Installation tokens and recovery codes are
secrets. The long-lived installation token is stored only in the
`invatrace-identity` IndexedDB database; short-lived API access tokens and raw
recovery codes stay in memory. Recovery kits are generated locally as UTF-8
text files and bypass analytics. Identity API calls use `cache: no-store`,
responses require `Cache-Control: no-store`, and the PWA service worker routes
all `/api/v1/profiles*` requests through `NetworkOnly`.

Restoring consumes one recovery code and adds a new authorized installation;
earlier devices remain active. Rotating recovery codes invalidates every unused
code in previous batches. Clearing browser data removes this installation's
credential but does not revoke the server profile. If every active installation
and every unused recovery code is lost, the pseudonymous profile cannot be
recovered.

Existing installations still start and queue reports offline. A new or restored
installation requires a connection once; the client never creates an accidental
non-recoverable offline profile. See [identity architecture](docs/identity-architecture.md)
and [private-access flow](docs/private-access-flow.md).

## Backend boundary

This repository implements the frontend contract and development-only MSW
model. The production service and database are not present. The mock persists
only SHA-256-derived secret hashes in a browser-local development store so
reloads can exercise the flow; it is not a production hashing, rate-limiting,
transaction, or persistence design.

## Conventions

- **Design tokens** live in `src/styles/tokens.css`, lifted verbatim from the approved
  prototype. Do not introduce new colour values; extend that file.
- **Navigation** is data-driven from `src/app/nav.ts`. A destination's `iteration`
  field decides whether its tab is live or inert; `roles` decides whether it is
  visible at all (Arch §11 authorisation).
- **Icons** are listed explicitly in `src/components/Icon.tsx`. Never barrel-import
  from `lucide-react` — it costs ~790 kB against the Arch §12 payload budget.
- **API** calls go through `src/lib/api.ts`. The short-lived access token is
  held in memory only. Production may additionally use a secure httpOnly
  cookie to refresh the API session.
- **Mocks** in `src/mocks/handlers.ts` mirror the Arch §7 endpoint table, so screens
  are built before the backend exists. Mock handlers are loaded only in development;
  the generated public MSW worker asset is inert in production.

## Phase status

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, tokens, app shell, navigation gating, PWA, MSW | Done |
| 1 | Private access, recovery, installation management and role-gated routes | Done |
| 2 | Scan flow and model adapter | |
| 3 | Report flow, upload, offline queue | |
| 4 | Threat map | |
| 5 | Verify queue | |
| 6 | Notifications, offline sync, error states | |
| 7 | Accessibility audit, end-to-end tests, backend swap-in | |
