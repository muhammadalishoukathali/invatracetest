"""Tests for app/domain/validation.py - the deterministic screening rules.

This is the "decide what happens to a report" logic that runs after
evidence screening: pass straight through, merge into an existing
sighting, get flagged for a rescan, or get rejected outright. Kept
deterministic on purpose (no ML in the loop) so the outcome for a given
set of inputs is always reproducible and explainable.
"""

from app.domain.validation import ValidationInput, evaluate


def valid_input(**changes) -> ValidationInput:
    values = {
        "image_failure_reasons": (),
        "client_outcome": "target",
        "client_species_id": "mikania-micrantha",
        "client_model_supported": True,
        "location_accuracy_m": 15,
    }
    values.update(changes)
    return ValidationInput(**values)


def test_passed_rules_publish_as_screened_without_human_review() -> None:
    # the baseline happy path - clean image, known species, decent GPS
    # accuracy, no replay/merge signals - should go straight to "screened"
    # without anyone needing to look at it.
    decision = evaluate(valid_input())
    assert decision.status == "screened"
    assert decision.reason_codes == ("automated_rule_screened",)


def test_recent_nearby_same_species_evidence_merges() -> None:
    # if there's already a recent sighting of the same species nearby,
    # this report should get folded into it rather than creating a
    # duplicate pin on the map.
    decision = evaluate(valid_input(merge_target_id="existing-sighting"))
    assert decision.status == "merged"
    assert decision.reason_codes == ("same_species_nearby_recent",)


def test_exact_and_perceptual_replays_are_hard_failures() -> None:
    # replay detection (same photo, or a near-identical one via perceptual
    # hash) is a straight rejection - no rescan, no benefit of the doubt.
    # This is the main defence against someone farming reports off one photo.
    assert evaluate(valid_input(exact_replay=True)).status == "rejected"
    assert evaluate(valid_input(perceptual_replay=True)).status == "rejected"


def test_image_location_and_e1_metadata_failures_request_a_rescan() -> None:
    # these are all "something's off but it might just be a bad capture" -
    # a failed quality check, GPS accuracy worse than 100m, an
    # unsupported/mismatched model version, or an ambiguous outcome
    # without a species id. All of them ask for a rescan rather than
    # rejecting outright, since the reporter might just need to try again.
    image_failure = evaluate(valid_input(image_failure_reasons=("image_too_dark",)))
    assert image_failure.status == "needs_rescan"
    assert evaluate(valid_input(location_accuracy_m=101)).status == "needs_rescan"
    assert evaluate(valid_input(client_model_supported=False)).status == "needs_rescan"
    assert evaluate(valid_input(client_outcome="uncertain", client_species_id=None)).status == (
        "needs_rescan"
    )


def test_policy_inputs_are_strictly_deterministic() -> None:
    # locks down the exact field set on ValidationInput so nobody quietly
    # adds a new input (e.g. some ML confidence score) without updating
    # this test and thinking about whether it breaks determinism.
    assert set(ValidationInput.__dataclass_fields__) == {
        "image_failure_reasons",
        "client_outcome",
        "client_species_id",
        "client_model_supported",
        "location_accuracy_m",
        "exact_replay",
        "perceptual_replay",
        "merge_target_id",
    }
