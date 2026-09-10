"""FastAPI app factory and process-wide wiring.

Builds the actual FastAPI instance: registers every router, sets up
CORS, structlog, and a request-context middleware that stamps a
request ID and a handful of security headers onto every response.
Uvicorn/gunicorn point at the `app` object created at the bottom of
this file.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import (
    admin,
    catalogue,
    config,
    health,
    identity,
    location,
    location_context,
    notifications,
    offline_pack,
    places,
    removals,
    reports,
    scans,
    sightings,
    species,
    uploads,
)
from app.config import get_settings
from app.core.errors import install_error_handlers, request_id_var

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger("invatrace.api")
# Client-supplied X-Request-ID has to look like this before we trust it and echo
# it back - otherwise we just generate our own uuid4 below.
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,100}$")


async def _run_worker_loop(name: str, sync_step, poll_seconds: float) -> None:
    """Wrap a blocking sync worker step in an asyncio loop. Each iteration runs
    in a worker thread (SQLAlchemy Session, time.sleep, etc. are blocking), so
    the API event loop stays responsive."""
    while True:
        try:
            await asyncio.to_thread(sync_step)
        except Exception:
            log.exception("in_process_worker_step_failed", worker=name)
        await asyncio.sleep(poll_seconds)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Optionally spawn verification + cleanup workers inside the API process.
    Enabled by RUN_WORKERS_IN_API=1 for free-tier deploys that can't run a
    separate worker service."""
    settings = get_settings()
    tasks: list[asyncio.Task] = []
    if settings.run_workers_in_api:
        from app.cli import cleanup_uploads_once
        from app.workers.verification import run_worker

        tasks.append(asyncio.create_task(
            _run_worker_loop("verification", lambda: run_worker(once=True), settings.worker_poll_seconds),
            name="invatrace.verification-worker",
        ))
        tasks.append(asyncio.create_task(
            _run_worker_loop("cleanup", lambda: cleanup_uploads_once(500), settings.upload_cleanup_interval_seconds),
            name="invatrace.cleanup-worker",
        ))
        log.info("in_process_workers_started")
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


def create_app() -> FastAPI:
    """Assemble the FastAPI app. Called once at import time to build the
    module-level `app` object below - keeping it in a function (rather than
    top-level statements) makes it easy to spin up a fresh app in tests."""
    settings = get_settings()
    app = FastAPI(
        title="InvaTrace API",
        version="0.1.0",
        docs_url="/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
        lifespan=_lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-InvaTrace-Queued",
            # AC Iteration 1 P1 - the report submission sends the client's
            # bundled catalogue version + SHA so the server can reject a
            # submission built against a stale offline catalogue. Both
            # headers MUST be preflight-allowed or CORS blocks the POST.
            "X-InvaTrace-Catalogue-Version",
            "X-InvaTrace-Catalogue-Sha256",
            "X-Request-ID",
        ],
        expose_headers=["Retry-After", "X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        # Reuse an incoming request id (useful when a client/gateway already
        # set one, e.g. for tracing across services) as long as it's not junk;
        # otherwise mint our own so every log line and response can be tied
        # back to a single request.
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if REQUEST_ID_PATTERN.fullmatch(incoming) else str(uuid.uuid4())
        token = request_id_var.set(request_id)
        structlog.contextvars.bind_contextvars(request_id=request_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "no-referrer"
            # API is JSON-only; block all sub-resource loads if a response
            # is ever rendered directly in a browser tab.
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
            )
            response.headers["X-Frame-Options"] = "DENY"
            if settings.app_env == "production":
                response.headers["Strict-Transport-Security"] = (
                    "max-age=31536000; includeSubDomains"
                )
            # Profile data and anything sent with an auth header is per-identity and
            # private - make sure a shared proxy/browser cache never keeps a copy.
            if request.url.path.startswith("/api/v1/profiles") or request.headers.get(
                "authorization"
            ):
                response.headers["Cache-Control"] = "private, no-store"
                response.headers["Pragma"] = "no-cache"
            log.info(
                "request.complete",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
            )
            return response
        finally:
            structlog.contextvars.clear_contextvars()
            request_id_var.reset(token)

    install_error_handlers(app)
    # Order doesn't matter for routing (paths are distinct) but keeping health
    # first is nice for readability when scanning the OpenAPI docs.
    for router in (
        health.router,
        config.router,
        identity.router,
        catalogue.router,
        species.router,
        species.model_config_router,
        notifications.router,
        uploads.router,
        scans.router,
        reports.router,
        removals.router,
        sightings.router,
        location.router,
        location_context.router,
        places.router,
        offline_pack.router,
        admin.router,
    ):
        app.include_router(router)
    return app


app = create_app()
