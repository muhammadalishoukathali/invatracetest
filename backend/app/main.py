"""FastAPI app factory and process-wide wiring.

Builds the actual FastAPI instance: registers every router, sets up
CORS, structlog, and a request-context middleware that stamps a
request ID and a handful of security headers onto every response.
Uvicorn/gunicorn point at the `app` object created at the bottom of
this file.
"""

from __future__ import annotations

import re
import uuid

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import (
    admin,
    health,
    identity,
    location,
    notifications,
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
        identity.router,
        species.router,
        species.model_config_router,
        notifications.router,
        uploads.router,
        scans.router,
        reports.router,
        sightings.router,
        location.router,
        admin.router,
    ):
        app.include_router(router)
    return app


app = create_app()
