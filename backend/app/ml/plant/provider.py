from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Protocol


class ModelUnavailableError(RuntimeError):
    """Raised when production inference was requested without a configured model."""


class InvalidModelOutputError(RuntimeError):
    """Raised when a provider returns values outside the agreed model contract."""


@dataclass(frozen=True)
class ModelHealth:
    status: Literal["ready", "unavailable", "error"]
    provider: str
    version: str | None
    device: str
    fake: bool
    detail: str | None = None


@dataclass(frozen=True)
class BoundingBox:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class DetectionResult:
    box: BoundingBox | None


@dataclass(frozen=True)
class QualityResult:
    ok: bool
    reason: str | None = None
    spoof_probability: float = 0.0
    ood_probability: float = 0.0


@dataclass(frozen=True)
class IdentificationResult:
    outcome: Literal["target", "other_plant", "uncertain"]
    species_id: str | None
    confidence: float
    model_version: str


class PlantModelProvider(Protocol):
    def health(self) -> ModelHealth: ...

    def detect(self, image: bytes) -> DetectionResult: ...

    def quality(self, image: bytes) -> QualityResult: ...

    def identify(self, image: bytes) -> IdentificationResult: ...

    def embed(self, image: bytes) -> list[float]: ...


def validate_model_output(
    detection: DetectionResult,
    quality: QualityResult,
    identification: IdentificationResult,
    embedding: list[float],
) -> None:
    probabilities = (
        quality.spoof_probability,
        quality.ood_probability,
        identification.confidence,
    )
    if any(not math.isfinite(value) or not 0 <= value <= 1 for value in probabilities):
        raise InvalidModelOutputError("model probabilities must be finite values from 0 to 1")

    if identification.outcome == "target" and not identification.species_id:
        raise InvalidModelOutputError("target identification requires a species ID")
    if identification.outcome != "target" and identification.species_id is not None:
        raise InvalidModelOutputError("non-target identification cannot include a species ID")
    if not identification.model_version.strip():
        raise InvalidModelOutputError("model version is required")

    if detection.box is not None:
        box = detection.box
        values = (box.x, box.y, box.width, box.height)
        if any(not math.isfinite(value) for value in values):
            raise InvalidModelOutputError("detection box values must be finite")
        if (
            box.x < 0
            or box.y < 0
            or box.width <= 0
            or box.height <= 0
            or box.x + box.width > 1
            or box.y + box.height > 1
        ):
            raise InvalidModelOutputError("detection box must use normalized image coordinates")

    if not embedding or len(embedding) > 4096:
        raise InvalidModelOutputError("embedding length is invalid")
    if any(not math.isfinite(value) for value in embedding):
        raise InvalidModelOutputError("embedding values must be finite")
