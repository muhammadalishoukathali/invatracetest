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
    decision = evaluate(valid_input())
    assert decision.status == "screened"
    assert decision.reason_codes == ("automated_rule_screened",)


def test_recent_nearby_same_species_evidence_merges() -> None:
    decision = evaluate(valid_input(merge_target_id="existing-sighting"))
    assert decision.status == "merged"
    assert decision.reason_codes == ("same_species_nearby_recent",)


def test_exact_and_perceptual_replays_are_hard_failures() -> None:
    assert evaluate(valid_input(exact_replay=True)).status == "rejected"
    assert evaluate(valid_input(perceptual_replay=True)).status == "rejected"


def test_image_location_and_e1_metadata_failures_request_a_rescan() -> None:
    image_failure = evaluate(valid_input(image_failure_reasons=("image_too_dark",)))
    assert image_failure.status == "needs_rescan"
    assert evaluate(valid_input(location_accuracy_m=101)).status == "needs_rescan"
    assert evaluate(valid_input(client_model_supported=False)).status == "needs_rescan"
    assert evaluate(valid_input(client_outcome="uncertain", client_species_id=None)).status == (
        "needs_rescan"
    )


def test_policy_inputs_are_strictly_deterministic() -> None:
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
