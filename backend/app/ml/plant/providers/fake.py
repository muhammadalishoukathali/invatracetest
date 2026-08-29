from __future__ import annotations

import hashlib

from app.config import get_settings
from app.ml.plant.provider import (
    BoundingBox,
    DetectionResult,
    IdentificationResult,
    ModelHealth,
    QualityResult,
)


class FakePlantProvider:
    """Deterministic development/test provider; never valid in production."""

    def __init__(self) -> None:
        settings = get_settings()
        self.version = settings.plant_model_version
        self.device = settings.plant_model_device

    @staticmethod
    def _digest(image: bytes) -> bytes:
        return hashlib.sha256(image).digest()

    def health(self) -> ModelHealth:
        return ModelHealth(
            status="ready",
            provider="fake",
            version=self.version,
            device=self.device,
            fake=True,
        )

    def detect(self, image: bytes) -> DetectionResult:
        if not image:
            return DetectionResult(box=None)
        return DetectionResult(box=BoundingBox(x=0.1, y=0.1, width=0.8, height=0.8))

    def quality(self, image: bytes) -> QualityResult:
        if len(image) < 3:
            return QualityResult(
                ok=False,
                reason="Image data is too small.",
                spoof_probability=0.01,
                ood_probability=0.95,
            )
        return QualityResult(
            ok=True,
            reason=None,
            spoof_probability=0.01,
            ood_probability=0.03,
        )

    def identify(self, image: bytes) -> IdentificationResult:
        bucket = self._digest(image)[1] % 10
        if bucket < 6:
            return IdentificationResult("target", "mikania-micrantha", 0.87, self.version)
        if bucket < 8:
            return IdentificationResult("other_plant", None, 0.73, self.version)
        return IdentificationResult("uncertain", None, 0.42, self.version)

    def embed(self, image: bytes) -> list[float]:
        digest = self._digest(image)
        return [round((value / 127.5) - 1.0, 6) for value in digest[:16]]
