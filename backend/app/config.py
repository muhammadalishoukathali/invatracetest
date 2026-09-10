"""Central settings object for the whole backend.

Everything from DB/Redis URLs to upload limits and the screening
worker's thresholds lives here, pulled from environment variables (or
a .env file) via pydantic-settings. Grab it through get_settings()
rather than instantiating Settings() directly - see the note on that
function below for why.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+psycopg://invatrace:invatrace@localhost:5432/invatrace"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    # These defaults are obviously-fake dev values on purpose - production_safety()
    # below refuses to boot in prod if any of them are still set to this.
    jwt_secret: str = "development-only-jwt-secret-change-me"
    credential_hash_key: str = "development-only-credential-key-change-me"
    location_privacy_key: str = "development-only-location-key-change-me"
    access_token_ttl_minutes: int = Field(default=15, ge=1, le=60)
    rate_limit_enabled: bool = True
    # AC 2.3.3 - env-backed sliding submission rate limits.
    report_create_burst_limit: int = Field(default=10, ge=1, le=10_000)
    report_create_ip_burst_limit: int = Field(default=30, ge=1, le=10_000)
    report_create_burst_window_seconds: int = Field(default=600, ge=1, le=86_400)

    # S3-compatible object storage config. Two endpoints because MinIO/R2 need a
    # different host for server-side calls (internal) vs the presigned URLs we
    # hand to the browser (public) - see app/services/storage.py.
    s3_endpoint_url: str | None = "http://localhost:9000"
    s3_public_endpoint_url: str | None = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_bucket: str = "invatrace-private"
    s3_access_key_id: str = "minioadmin"
    s3_secret_access_key: str = "minioadmin"
    s3_force_path_style: bool = True
    upload_max_bytes: int = Field(default=10 * 1024 * 1024, ge=1024, le=32 * 1024 * 1024)
    model_acceptance_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    upload_url_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    upload_active_grants_per_profile: int = Field(default=10, ge=1, le=100)
    upload_cleanup_interval_seconds: int = Field(default=3600, ge=60, le=86_400)

    # Which on-device E1 classifier versions the server still trusts. If the
    # client reports something outside this list the screening worker treats
    # the outcome as unsupported rather than blindly accepting it - see
    # client_model_supported in app/workers/verification.py.
    e1_model_versions: Annotated[list[str], NoDecode] = ["oe_v4_31class_web_fp16"]
    screening_minimum_image_dimension: int = Field(default=320, ge=128, le=2048)
    screening_perceptual_hamming_threshold: int = Field(default=6, ge=0, le=16)
    screening_duplicate_radius_max_m: int = Field(default=25, ge=10, le=100)
    screening_duplicate_window_hours: int = Field(default=24, ge=1, le=168)
    screening_duplicate_window_minutes: int = Field(default=10, ge=1, le=1440)
    # AC Iteration 1 P7 - a single 300 m GPS accuracy policy governs the
    # entire pipeline: client soft warning, server hard rescan, audit trail.
    # The frontend does not enforce this as a hard block per AC 4.1.2, but
    # it must show the same 300 m threshold as the server so a user who
    # submits at 350 m does not first hear about the policy after screening.
    screening_location_accuracy_max_m: int = Field(default=250, ge=10, le=10_000)
    # Turn off exact + perceptual duplicate-image checks so usability testers
    # can reuse the same reference photo across scans/reports without hitting
    # replay rejection. Off by default in prod; flip to true in the test env.
    screening_disable_duplicate_check: bool = False
    worker_poll_seconds: float = Field(default=2, ge=0.1, le=60)
    worker_max_attempts: int = Field(default=5, ge=1, le=20)
    worker_job_lease_seconds: int = Field(default=300, ge=30, le=3600)
    # Free-tier deploys don't get a separate worker service; when true the API
    # process spawns the verification + cleanup loops as background asyncio
    # tasks (each hop runs in a thread so its blocking DB calls don't block
    # the event loop). Off by default so tests / dev with the standalone
    # `invatrace worker` CLI don't double-run.
    run_workers_in_api: bool = False

    # Iteration 2 - single source of truth for all thresholds surfaced through
    # GET /api/v1/config/limits. Any hardcoded copy of these values in FE or BE
    # code is a bug; render error text and gate submission using this endpoint.
    location_accuracy_max_m: int = Field(default=250, ge=10, le=10_000)
    removal_proximity_max_m: int = Field(default=250, ge=10, le=10_000)
    discovery_park_buffer_m: int = Field(default=1000, ge=50, le=20_000)
    discovery_trail_buffer_m: int = Field(default=750, ge=50, le=20_000)
    discovery_decay_scale_m: int = Field(default=250, ge=10, le=20_000)
    waterway_upstream_max_km: int = Field(default=5, ge=1, le=100)
    occurrence_coord_uncertainty_max_m: int = Field(default=1000, ge=10, le=100_000)
    adoption_max_per_identity: int = Field(default=50, ge=1, le=10_000)
    adoption_rate_limit_per_hour: int = Field(default=30, ge=1, le=10_000)
    activity_change_tolerance_pct: int = Field(default=10, ge=0, le=100)
    removal_rate_limit_per_hour: int = Field(default=20, ge=1, le=10_000)
    removal_rate_limit_per_day: int = Field(default=100, ge=1, le=100_000)
    removal_idempotency_window_seconds: int = Field(default=60, ge=1, le=86_400)
    # Catalogue version served by /api/v1/catalogue and echoed on /config/limits
    # so clients can invalidate offline packs when the evidence set changes.
    catalogue_version: str = Field(default="v2026-09-08", min_length=1, max_length=32)
    # AC 7.1 - Prometheus histogram exporter for per-endpoint latency SLOs.
    # Off by default in tests so the /metrics scrape endpoint (and the
    # global process-wide registry the instrumentator installs into) does
    # not leak state across app factories in the unit suite.
    metrics_enabled: bool = True

    @field_validator("cors_origins", "e1_model_versions", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        # These two fields want a list but env vars only give us strings, so
        # accept either a JSON array (`["a","b"]`) or a plain comma-separated
        # string (`a,b`) depending on how someone set the env var.
        if isinstance(value, str):
            if value.lstrip().startswith("["):
                return json.loads(value)
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def production_safety(self) -> Settings:
        # Belt-and-braces check so a misconfigured prod deploy fails loudly at
        # startup instead of quietly running with dev secrets / wide-open CORS.
        if self.app_env != "production":
            return self
        weak_values = (
            self.jwt_secret,
            self.credential_hash_key,
            self.location_privacy_key,
            self.s3_secret_access_key,
        )
        if any(
            len(value) < 32 or "development-only" in value or "change-me" in value
            for value in weak_values
        ):
            raise ValueError("production secrets must be supplied through the environment")
        if not self.cors_origins or "*" in self.cors_origins:
            raise ValueError("production CORS origins must be explicit")
        if not self.e1_model_versions:
            raise ValueError("at least one supported E1 model version is required")
        return self

    @model_validator(mode="after")
    def iteration_2_accuracy_alignment(self) -> Settings:
        # AC 3.3.4: every 250 m accuracy threshold must read from the same
        # source. Guard against a deploy that sets one but not the other.
        if self.location_accuracy_max_m != self.screening_location_accuracy_max_m:
            raise ValueError(
                "location_accuracy_max_m must equal screening_location_accuracy_max_m"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    # Cached so Settings() (which re-reads the environment/.env file) only
    # runs once per process - callers can just call get_settings() wherever
    # instead of passing settings around everywhere.
    return Settings()
