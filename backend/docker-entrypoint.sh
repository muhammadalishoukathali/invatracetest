#!/bin/sh
# AC 1.2.1 - idempotent production startup. Migrates the schema and loads
# reference data (species catalogue + monitored places) before handing off
# to the process passed as CMD (uvicorn by default). Reference-data loader
# is safe to re-run; demo seeding never runs here.
set -eu

alembic upgrade head
python -m app.cli load-reference-data

# Optional: seed the acceptance-criteria demo dataset on a demo/staging deploy
# so mentors can walk every AC row through the live UI. Off by default. Set
# SEED_ACCEPTANCE_DEMO=true on the Render service (or any container host) to
# enable. Idempotent, so a re-deploy with the flag set is a no-op.
case "${SEED_ACCEPTANCE_DEMO:-}" in
  true|True|TRUE|1|yes|Yes|YES)
    python -m app.cli seed-acceptance-demo --allow-production
    ;;
esac

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips "*"
