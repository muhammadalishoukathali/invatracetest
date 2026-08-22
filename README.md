# InvaTrace — web client

Iteration 1 (E1–E4) frontend. React 18 + Vite + TypeScript, installable PWA.

Build plan: `../InvaTrace_Frontend_Build_Plan.md`
Architecture: `../InvaTrace_System_Architecture.docx`

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run build` · `npm run typecheck` · `npm test`

## Conventions

- **Design tokens** live in `src/styles/tokens.css`, lifted verbatim from the approved
  prototype. Do not introduce new colour values; extend that file.
- **Navigation** is data-driven from `src/app/nav.ts`. A destination's `iteration`
  field decides whether its tab is live or inert; `roles` decides whether it is
  visible at all (Arch §11 authorisation).
- **Icons** are registered explicitly in `src/components/Icon.tsx`. Never barrel-import
  from `lucide-react` — it costs ~790 kB against the Arch §12 payload budget.
- **API** calls go through `src/lib/api.ts`. The access token is held in memory only;
  the refresh token travels as an httpOnly cookie (Arch §7.1).
- **Mocks** in `src/mocks/handlers.ts` mirror the Arch §7 endpoint table, so screens
  are built before the backend exists. Dev-only — excluded from production builds.

## Phase status

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, tokens, app shell, navigation gating, PWA, MSW | Done |
| 1 | Auth, pseudonymous bootstrap, role-gated routes | Next |
| 2 | Scan flow and model adapter | |
| 3 | Report flow, upload, offline queue | |
| 4 | Threat map | |
| 5 | Verify queue | |
| 6 | Notifications, offline sync, error states | |
| 7 | Accessibility audit, end-to-end tests, backend swap-in | |
