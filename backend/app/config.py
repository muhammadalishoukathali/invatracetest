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
    worker_poll_seconds: float = Field(default=2, ge=0.1, le=60)
    worker_max_attempts: int = Field(default=5, ge=1, le=20)
    worker_job_lease_seconds: int = Field(default=300, ge=30, le=3600)

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


@lru_cache
def get_settings() -> Settings:
    # Cached so Settings() (which re-reads the environment/.env file) only
    # runs once per process - callers can just call get_settings() wherever
    # instead of passing settings around everywhere.
    return Settings()
