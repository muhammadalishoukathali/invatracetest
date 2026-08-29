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

    jwt_secret: str = "development-only-jwt-secret-change-me"
    credential_hash_key: str = "development-only-credential-key-change-me"
    location_privacy_key: str = "development-only-location-key-change-me"
    access_token_ttl_minutes: int = Field(default=15, ge=1, le=60)
    rate_limit_enabled: bool = True

    s3_endpoint_url: str | None = "http://localhost:9000"
    s3_public_endpoint_url: str | None = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_bucket: str = "invatrace-private"
    s3_access_key_id: str = "minioadmin"
    s3_secret_access_key: str = "minioadmin"
    s3_force_path_style: bool = True
    upload_max_bytes: int = Field(default=8 * 1024 * 1024, ge=1024, le=32 * 1024 * 1024)
    upload_url_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    upload_active_grants_per_profile: int = Field(default=10, ge=1, le=100)
    upload_cleanup_interval_seconds: int = Field(default=3600, ge=60, le=86_400)

    e1_model_versions: Annotated[list[str], NoDecode] = ["oe_v4_31class_web_fp16"]
    screening_minimum_image_dimension: int = Field(default=320, ge=128, le=2048)
    screening_perceptual_hamming_threshold: int = Field(default=6, ge=0, le=16)
    screening_duplicate_radius_max_m: int = Field(default=50, ge=10, le=100)
    screening_duplicate_window_hours: int = Field(default=24, ge=1, le=168)
    worker_poll_seconds: float = Field(default=2, ge=0.1, le=60)
    worker_max_attempts: int = Field(default=5, ge=1, le=20)
    worker_job_lease_seconds: int = Field(default=300, ge=30, le=3600)

    @field_validator("cors_origins", "e1_model_versions", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            if value.lstrip().startswith("["):
                return json.loads(value)
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def production_safety(self) -> Settings:
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
    return Settings()
