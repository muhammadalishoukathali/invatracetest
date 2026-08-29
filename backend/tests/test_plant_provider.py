from __future__ import annotations

import pytest

from app.config import get_settings
from app.ml.plant import get_plant_provider
from app.ml.plant.provider import (
    BoundingBox,
    DetectionResult,
    IdentificationResult,
    InvalidModelOutputError,
    QualityResult,
    validate_model_output,
)


def test_fake_provider_is_explicit_and_deterministic(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("PLANT_MODEL_PROVIDER", "fake")
    get_settings.cache_clear()
    get_plant_provider.cache_clear()
    provider = get_plant_provider()
    first = provider.identify(b"same-image")
    second = provider.identify(b"same-image")
    assert first == second
    assert provider.health().fake is True
    assert provider.embed(b"same-image") == provider.embed(b"same-image")
    get_plant_provider.cache_clear()
    get_settings.cache_clear()


def test_provider_output_rejects_non_finite_probabilities() -> None:
    with pytest.raises(InvalidModelOutputError):
        validate_model_output(
            DetectionResult(BoundingBox(0.1, 0.1, 0.8, 0.8)),
            QualityResult(ok=True, spoof_probability=float("nan"), ood_probability=0.1),
            IdentificationResult("target", "mikania-micrantha", 0.9, "test-v1"),
            [0.1, 0.2],
        )


def test_provider_output_rejects_invalid_detection_box() -> None:
    with pytest.raises(InvalidModelOutputError):
        validate_model_output(
            DetectionResult(BoundingBox(0.8, 0.1, 0.4, 0.8)),
            QualityResult(ok=True, spoof_probability=0.1, ood_probability=0.1),
            IdentificationResult("target", "mikania-micrantha", 0.9, "test-v1"),
            [0.1, 0.2],
        )
