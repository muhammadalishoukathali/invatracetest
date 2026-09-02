"""The actual decision table for what happens to a submitted report.

This is the policy layer, deliberately pure and side-effect free — it takes
a bag of pre-computed facts (image quality, duplicate/replay flags, GPS
accuracy, whether there's a nearby merge candidate) and returns one
decision. The screening worker is responsible for gathering those facts
(via evidence_screening.py, place_association.py, DB lookups for
duplicates/merge candidates) and then calling evaluate() here. Keeping the
policy separate from the data-gathering makes it possible to unit test the
policy against made-up inputs without touching the DB or Pillow at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# bump this if the rules below change, so old AutomatedValidationDecision
# rows stay attributable to the policy version that actually produced them
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
    """Apply the Iteration 1 deterministic screening and publication policy.

    Checked roughly in order of severity: replay/duplicate photos get
    rejected outright (not retryable — resubmitting the same photo again
    won't fix it), then a batch of "needs_rescan" checks that are the user's
    fault and fixable by trying again, then finally a same-species-nearby
    merge before falling through to a clean pass.
    """

    if input.exact_replay:
        return ValidationDecision("rejected", ("exact_photo_replay",), False)
    if input.perceptual_replay:
        return ValidationDecision("rejected", ("perceptual_photo_replay",), False)

    # everything below is recoverable by the user retaking the photo/report,
    # so we collect every reason rather than bailing on the first one — the
    # client can show them all at once instead of a frustrating one-at-a-time
    # rejection loop
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
        # caller already found a same-species sighting nearby within the
        # merge window, so this report reinforces an existing sighting
        # instead of creating a new public entry
        return ValidationDecision("merged", ("same_species_nearby_recent",), False)
    return ValidationDecision("screened", ("automated_rule_screened",), False)
