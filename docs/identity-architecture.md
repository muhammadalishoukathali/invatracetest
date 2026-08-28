# InvaTrace identity architecture

## Security boundary

InvaTrace uses server-backed pseudonymous profiles, not conventional user
accounts. A profile has an opaque public ID, optional display name,
server-authoritative role and trust level, and timestamps. The public profile ID
is an identifier, not an authenticator.

Each authorized installation owns a 256-bit opaque token generated with
`crypto.getRandomValues`. The browser stores that token in the versioned
`invatrace-identity` IndexedDB record. Short-lived API access tokens remain in
module memory. Raw recovery codes remain in memory only while the recovery
screen or a newly rotated batch is visible.

The production server must store only keyed hashes of installation tokens and
recovery codes using a server-held secret or an equivalently appropriate
secret-verification design. It must never log raw credentials. IndexedDB does
not protect an installation token from malicious same-origin JavaScript, so
content security policy, dependency integrity, output encoding, and the wider
XSS boundary remain security-critical.

## Records

Production persistence should separate:

- `profiles`: opaque ID, optional display name, role, trust level, recovery
  setup acknowledgement, created and updated timestamps;
- `installations`: ID, profile ID, keyed installation-token hash, created,
  last-used and revoked timestamps;
- `recovery_code_batches`: ID, profile ID, created and invalidated timestamps;
- `recovery_codes`: ID, batch ID, profile ID, keyed code hash, created and used
  timestamps.

Client input never selects role or trust. New profiles always begin as
`Detector` / `New` unless a server-side policy says otherwise.

## Session transitions

`POST /api/v1/profiles/bootstrap` accepts a known installation token, updates
its last-used time, and returns a short-lived access token plus the authoritative
profile. It never creates a profile. An unknown installation returns the typed
`installation_not_found` response used for first-run routing; a revoked
installation returns `installation_revoked`.

`POST /api/v1/profiles/restore` validates the public profile ID and one recovery
code, consumes the code, and binds a freshly generated installation token in a
single transaction. A conditional update or row lock must guarantee that two
concurrent attempts cannot consume the same code. Restoration adds an
installation and never revokes earlier devices.

Recovery rotation invalidates all unused codes in every older batch before
returning ten new codes once. Interrupted initial setup remains server-tracked:
bootstrap reports `recoverySetupRequired`, the client rotates the unseen batch,
and explicit acknowledgement closes setup.

## Transport and abuse controls

Every identity response uses `Cache-Control: no-store`; the service worker uses
`NetworkOnly` for `/api/v1/profiles*`. Production must add strict schemas and
length limits, generic restore errors, per-IP and per-profile rate limiting,
exponential backoff, constant-time comparisons, secret-safe structured logs,
and CSRF protection appropriate to the chosen bearer-token/cookie transport.

## Offline and loss behavior

An established installation can restore its local `Detector` / `New` fallback
profile offline and continue using the report queue. First-time start and
restoration require the network once. Clearing browser data removes the local
installation token; it does not revoke other installations or the profile.
Losing every active installation and every unused recovery code makes the
profile permanently unrecoverable.

## Development mock

`src/mocks/handlers.ts` mirrors the contract for frontend and end-to-end tests.
It persists only SHA-256-derived token/code hashes in a development-only local
store and serializes mock restoration in one JavaScript state update. This is
not a substitute for production keyed hashing, database transactions,
distributed rate limiting, CSRF controls, or durable server persistence.
