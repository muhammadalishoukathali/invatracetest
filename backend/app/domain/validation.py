from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

POLICY_VERSION = "automated-v1.0"

ValidationStatus = Literal["confirmed", "merged", "needs_rescan", "rejected"]


@dataclass(frozen=True)
class ValidationInput:
    quality_ok: bool
    plant_detected: bool
    spoof_probability: float
    ood_probability: float
    server_outcome: Literal["target", "other_plant", "uncertain"]
    server_species_id: str | None
    server_confidence: float
    client_outcome: Literal["target", "other_plant", "uncertain"]
    client_species_id: str | None
    submitter_trust: Literal["New", "Trusted", "Steward"]
    location_accuracy_m: int | None
    exact_replay: bool = False
    merge_target_id: str | None = None


@dataclass(frozen=True)
class ValidationDecision:
    status: ValidationStatus
    reason_codes: tuple[str, ...]
    retryable: bool


def evaluate(input: ValidationInput) -> ValidationDecision:
    """Apply deterministic automated publication policy.

    Trust can lower only the soft confidence threshold. It cannot override
    replay, spoof, out-of-distribution, quality, or species-agreement checks.
    """

    if input.exact_replay:
        return ValidationDecision("rejected", ("exact_photo_replay",), False)
    if input.spoof_probability >= 0.80:
        return ValidationDecision("rejected", ("suspected_spoof",), False)

    rescan_reasons: list[str] = []
    if not input.quality_ok:
        rescan_reasons.append("image_quality_failed")
    if not input.plant_detected:
        rescan_reasons.append("plant_not_detected")
    if input.ood_probability >= 0.50:
        rescan_reasons.append("out_of_distribution")
    if input.location_accuracy_m is None or input.location_accuracy_m > 100:
        rescan_reasons.append("location_accuracy_insufficient")
    if input.server_outcome != "target" or not input.server_species_id:
        rescan_reasons.append("server_id_uncertain")
    if (
        input.client_outcome == "target"
        and input.client_species_id
        and input.server_species_id
        and input.client_species_id != input.server_species_id
    ):
        rescan_reasons.append("client_server_species_mismatch")

    confidence_threshold = {"New": 0.84, "Trusted": 0.80, "Steward": 0.78}[input.submitter_trust]
    if input.server_confidence < confidence_threshold:
        rescan_reasons.append("server_confidence_below_threshold")
    if rescan_reasons:
        return ValidationDecision("needs_rescan", tuple(dict.fromkeys(rescan_reasons)), True)
    if input.merge_target_id:
        return ValidationDecision("merged", ("same_plant_observation",), False)
    return ValidationDecision("confirmed", ("automated_checks_passed",), False)
