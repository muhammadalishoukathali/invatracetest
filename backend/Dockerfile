FROM python:3.12.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# AC 1.2.1 - build context is the repository root so the image can copy
# both backend/ and shared/catalogue/. The predictable layout is:
#   /service/
#     shared/catalogue/
#     backend/{app, alembic, alembic.ini, pyproject.toml, requirements.lock}
# and app.domain.catalogue resolves /service/backend/app/domain/../../../shared/catalogue,
# i.e. /service/shared/catalogue.
WORKDIR /service/backend

# libexpat1 is a pyosmium runtime dependency; curl is used by the container
# HEALTHCHECK so the image does not need a Python-only probe hop.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 curl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system invatrace \
    && adduser --system --ingroup invatrace invatrace

COPY backend/requirements.lock ./
RUN python -m pip install --no-cache-dir -r requirements.lock

COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./alembic.ini

# AC 1.2.1 - bundle the authoritative Malaysian plant-status catalogue that
# the frontend also ships. app.domain.catalogue reads this at container
# startup (load-reference-data) and on every report submission (version /
# checksum guard), so the deployed image and the PWA are one source of truth.
COPY shared/catalogue /service/shared/catalogue

# AC 5.3.2 - reference image bytes for the offline pack. The PWA also
# serves the same tree under /reference-images/*, so shipping one copy
# in the backend image keeps the offline pack resolver deterministic
# without a second asset store. `_resolve_image_bytes` reads from
# settings.reference_image_root (defaults to /service/reference-images).
COPY public/reference-images /service/reference-images

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER invatrace
EXPOSE 8000

# AC Iteration 1 P11 - container-level readiness probe. Render's own
# healthCheckPath handles restart-on-failure at the platform level; this
# HEALTHCHECK gives docker/compose users the same signal locally.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail --silent --show-error --max-time 4 \
        http://127.0.0.1:8000/health/live || exit 1

# AC 1.2.1 - entrypoint runs `alembic upgrade head` then
# `python -m app.cli load-reference-data` before exec'ing uvicorn with
# --proxy-headers / --forwarded-allow-ips="*" so Render's X-Forwarded-For
# reaches client_address() in app/core/rate_limit.py.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
