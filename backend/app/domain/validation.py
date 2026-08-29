from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

POLICY_VERSION = "deterministic-rules-v1.0"

ValidationStatus = Literal["screened", "merged", "needs_rescan", "rejected"]


@dataclass(frozen=True)
class ValidationInput:
    image_failure_reasons: tuple[str, ...]
    client_outcome: Literal["target", "other_plant", "uncertain"]
    client_species_id: str | None
    client_model_supported: bool
    location_accuracy_m: int | None
    exact_replay: bool = False
    perceptual_replay: bool = False
    merge_target_id: str | None = None


@dataclass(frozen=True)
class ValidationDecision:
    status: ValidationStatus
    reason_codes: tuple[str, ...]
    retryable: bool


def evaluate(input: ValidationInput) -> ValidationDecision:
    """Apply the Iteration 1 deterministic screening and publication policy."""

    if input.exact_replay:
        return ValidationDecision("rejected", ("exact_photo_replay",), False)
    if input.perceptual_replay:
        return ValidationDecision("rejected", ("perceptual_photo_replay",), False)

    rescan_reasons = list(input.image_failure_reasons)
    if input.location_accuracy_m is None or input.location_accuracy_m > 100:
        rescan_reasons.append("location_accuracy_insufficient")
    if input.client_outcome != "target" or not input.client_species_id:
        rescan_reasons.append("plant_identification_not_reportable")
    if not input.client_model_supported:
        rescan_reasons.append("unsupported_client_model_version")
    if rescan_reasons:
        return ValidationDecision("needs_rescan", tuple(dict.fromkeys(rescan_reasons)), True)
    if input.merge_target_id:
        return ValidationDecision("merged", ("same_species_nearby_recent",), False)
    return ValidationDecision("screened", ("automated_rule_screened",), False)
