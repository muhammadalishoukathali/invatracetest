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
        "plant_model_provider": "unavailable",
    }
    values.update(overrides)
    return Settings(**values)


def test_production_accepts_explicit_origins_and_unavailable_model() -> None:
    settings = production_settings()
    assert settings.app_env == "production"
    assert settings.plant_model_provider == "unavailable"


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
    monkeypatch.setenv("CORS_ORIGINS", raw)
    assert Settings().cors_origins == expected


@pytest.mark.parametrize(
    "override",
    [
        {"jwt_secret": "development-only-jwt-secret-change-me"},
        {"cors_origins": ["*"]},
        {"plant_model_provider": "fake"},
    ],
)
def test_production_rejects_unsafe_configuration(override: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        production_settings(**override)
