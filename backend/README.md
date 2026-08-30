# InvaTrace backend

FastAPI service for the InvaTrace React/Vite PWA. It implements pseudonymous
private access, S3-compatible photo uploads, idempotent reporting, PostGIS
sightings, deterministic automated screening, notifications, and a durable
screening worker.

## Local stack

The repository Compose stack provides PostgreSQL 16 with PostGIS, Redis, MinIO,
the migration and seed jobs, the API, a screening worker, and an hourly
expired-upload cleanup worker.

```bash
docker compose up --build
curl http://localhost:8000/health/live
curl http://localhost:8000/health/ready
```

Run the frontend against that stack in another terminal:

```bash
npm install
npm run dev:real
```

The API is at `http://localhost:8000`, OpenAPI is at
`http://localhost:8000/docs`, and the MinIO console is at
`http://localhost:9001` with the local-only `minioadmin` credentials declared in
`compose.yaml`.

## Backend-only development

Python 3.12 or later is required. This keeps all packages inside the repository
instead of installing global tools.

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements-dev.lock
backend/.venv/bin/python -m pip install --no-deps -e backend
backend/.venv/bin/ruff check backend
backend/.venv/bin/pytest backend
backend/.venv/bin/pip-audit -r backend/requirements.lock
```

With `docker compose up --build` healthy, run the opt-in integration journey:

```bash
RUN_INVATRACE_INTEGRATION=1 backend/.venv/bin/pytest \
  backend/tests/integration/test_full_stack.py -q
```

It uses `http://localhost:8000` and the local Compose database by default. Set
`INVATRACE_INTEGRATION_BASE_URL` to target a different isolated test deployment.

With the Compose dependencies running, a host process can use
`backend/.env.example`:

```bash
cp backend/.env.example backend/.env
cd backend
.venv/bin/alembic upgrade head
.venv/bin/python -m app.cli seed
.venv/bin/uvicorn app.main:app --reload --port 8000
```

The container path is simpler and is the supported full-stack workflow.

## Migrations and seed data

```bash
docker compose run --rm migrate
docker compose run --rm seed
docker compose exec api alembic current
docker compose exec api alembic check
```

The seed command is idempotent. It loads the species/details/places and sample
public sightings used by the frontend mock so mock and real-backend views have
the same starting content.

To grant a pseudonymous profile an operational role in development, use the
audited admin command rather than changing client storage:

```bash
docker compose exec api python -m app.cli set-profile-access \
  --profile-id IVT-XXXX-XXXX \
  --role Volunteer \
  --trust Trusted
```

## Runtime processes

- API: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Worker: `python -m app.cli worker`
- One worker pass for diagnostics: `python -m app.cli worker --once`
- OSM import: `python -m app.cli import-osm malaysia.osm.pbf --source-date
  2026-08-01T00:00:00+00:00 --confirm-malaysia-clipped`
- Expired upload cleanup: `python -m app.cli cleanup-uploads`
- Scheduled expired upload cleanup: `python -m app.cli cleanup-worker`
- Migrate: `alembic upgrade head`
- Seed: `invatrace seed`

The worker uses PostgreSQL row locking with `SKIP LOCKED`; multiple worker
instances can safely poll the same durable queue. No in-process background task
is required for correctness.

The cleanup worker runs immediately at startup and then at
`UPLOAD_CLEANUP_INTERVAL_SECONDS`. It only deletes expired, unconsumed objects
whose keys match the `uploads/<profile>/<uuid>.jpg` staging namespace. Submitted
`evidence/` and `thumbnails/` objects are never cleanup targets.

## Safety properties

- Installation tokens and recovery codes are stored only as HMAC-SHA256 values.
- Recovery code use, rotation, and installation revocation are transactional.
- Access JWTs are short-lived and bound to one installation.
- Role and trust are server-authoritative and absent from start/restore inputs.
- Upload grants are private, exact-size/type checked, expiry bounded, and
  single-use. Submitted photos are copied to an immutable evidence key.
- Upload and report idempotency keys are serialized with PostgreSQL transaction
  advisory locks to make concurrent retries safe.
- Public endpoints expose only rule-screened and removed sightings. Screened
  sightings from `New` reporters use a stable 100 metre keyed displacement.
- Automated decisions are row-locked, append immutable decision/audit records,
  reject exact and perceptual photo replays, and merge recent nearby reports of
  the same E1 species.
- The worker performs transparent JPEG size, exposure, contrast, edge-detail,
  duplicate, location, and E1-version checks.
- Redis-backed report limits allow at most 10 submissions per profile in ten
  minutes and 50 per day. Production fails closed when Redis, storage, or the
  database required by screening is unavailable.

See [backend architecture](../docs/backend-architecture.md),
[ML integration](../docs/ml-integration.md), and
[deployment](../docs/deployment.md).
