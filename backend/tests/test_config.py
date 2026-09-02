"""Tests for app/config.py.

Mostly about making sure "production" mode actually locks things down -
dev defaults (weak secrets, wildcard CORS) should get rejected once
app_env flips to production, not silently accepted.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def production_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": "production",
        "jwt_secret": "j" * 48,
        "credential_hash_key": "c" * 48,
        "location_privacy_key": "l" * 48,
        "s3_secret_access_key": "s" * 48,
        "cors_origins": ["https://invatrace.pages.dev"],
    }
    values.update(overrides)
    return Settings(**values)


def test_production_accepts_explicit_origins_and_deterministic_screening() -> None:
    # sanity check that a properly-configured production Settings object
    # actually builds without blowing up - the "happy path" companion to
    # the rejection tests below.
    settings = production_settings()
    assert settings.app_env == "production"
    assert settings.e1_model_versions == ["oe_v4_31class_web_fp16"]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (
            "https://one.example, https://two.example",
            ["https://one.example", "https://two.example"],
        ),
        (
            '["https://one.example","https://two.example"]',
            ["https://one.example", "https://two.example"],
        ),
    ],
)
def test_cors_environment_accepts_comma_and_json_forms(
    monkeypatch, raw: str, expected: list[str]
) -> None:
    # ops might set CORS_ORIGINS as a plain comma list or as a JSON array
    # depending on where it's deployed - both should parse to the same list.
    monkeypatch.setenv("CORS_ORIGINS", raw)
    assert Settings().cors_origins == expected


@pytest.mark.parametrize(
    "override",
    [
        {"jwt_secret": "development-only-jwt-secret-change-me"},
        {"cors_origins": ["*"]},
        {"e1_model_versions": []},
    ],
)
def test_production_rejects_unsafe_configuration(override: dict[str, object]) -> None:
    # each of these is a "someone forgot to change the .env.example value
    # before deploying" scenario: leftover dev JWT secret, wildcard CORS,
    # or an empty screening model list. All should hard-fail startup
    # rather than run insecurely in prod.
    with pytest.raises(ValidationError):
        production_settings(**override)
