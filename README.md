# InvaTrace

Iteration 1 full stack: React 18 + Vite + TypeScript installable PWA, FastAPI,
PostgreSQL/PostGIS, Redis, S3-compatible private storage, and a separate
deterministic screening worker.
InvaTrace uses intentional **Private access**: server-backed pseudonymous
profiles without email/password registration.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run build` · `npm run typecheck` · `npm test`

The model, app logos, and plant reference photos are stored losslessly under
`assets/runtime-packed/`. Development and production builds restore the exact
runtime files automatically and verify their SHA-256 values. Run
`npm run prepare:model` before tooling that reads public assets without starting
Vite; `npm run pack:assets` is only for an intentional source-asset update.

To run the complete backend and real frontend contract locally:

```bash
docker compose up --build
npm run dev:real
```

See [backend setup](backend/README.md) for migrations, seed data, automated
screening workers, OSM imports, and test commands.

## Project documentation

- [Codebase guide](docs/codebase-guide.md) — directory ownership and module boundaries.
- [Product overview](docs/product.md) — users, purpose, constraints, and identity model.
- [Identity architecture](docs/identity-architecture.md) — client/server security contract.
- [Private access flow](docs/private-access-flow.md) — creation, recovery, and management states.
- [Backend architecture](docs/backend-architecture.md) — services, ERDs, API sequences, and privacy.
- [ML integration](docs/ml-integration.md) — browser E1 and deferred research boundaries.
- [Deployment](docs/deployment.md) — Cloudflare Pages/R2, Render, and Neon runbook.
- [Design system](design-system/invatrace/README.md) — tokens, components, and page-specific guidance.

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

The production backend is implemented under `backend/`. The MSW layer remains a
development-only frontend simulator and mirrors the same endpoint shapes. The
backend persists pseudonymous identity secrets only as keyed hashes, enforces
server-side roles/trust, uses transactional recovery and idempotency, validates
private uploads, and applies PostGIS-backed location privacy and deterministic
automated screening rules. Rule-screened map records passed the documented
image-quality, replay, location, and submission checks.

## Conventions

- **Design tokens** live in `src/styles/tokens.css`. Do not introduce new colour
  values inside components; extend the token file and update the
  [design-system guide](design-system/invatrace/README.md).
- **Navigation** is data-driven from `src/app/nav.ts`. A destination's `iteration`
  field decides whether its tab is live or inert; `roles` decides whether it is
  visible to the current profile.
- **Icons** are listed explicitly in `src/components/Icon.tsx`. Never barrel-import
  from `lucide-react`, because that would add the full icon library to the bundle.
- **API** calls go through `src/services/api-client.ts`. The short-lived access token is
  held in memory only. When it expires, the client uses the installation
  credential from IndexedDB to obtain a replacement token.
- **Mocks** in `src/mocks/handlers.ts` match the planned production endpoints so
  screens can be tested before the backend exists. Mock handlers load only in
  development; the public mock worker is inactive in production.

## Phase status

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, tokens, app shell, navigation gating, PWA, MSW | Done |
| 1 | Private access, recovery, installation management and role-gated routes | Done |
| 2 | Supplied PULIH E1 model, local inference, look-alike safety | Done |
| 3 | Report flow, upload, offline queue, status tracking | Done |
| 4 | Rule-screened live map and OSM-derived place association | Done |
| 5 | Deterministic E2 screening and auditable lifecycle | Done |
| 6 | Notifications, offline sync, error states | Done |
| 7 | Accessibility, end-to-end tests, backend swap-in | Done |
