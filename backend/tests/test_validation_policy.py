from app.domain.validation import ValidationInput, evaluate


def valid_input(**changes) -> ValidationInput:
    values = {
        "quality_ok": True,
        "plant_detected": True,
        "spoof_probability": 0.01,
        "ood_probability": 0.03,
        "server_outcome": "target",
        "server_species_id": "mikania-micrantha",
        "server_confidence": 0.90,
        "client_outcome": "target",
        "client_species_id": "mikania-micrantha",
        "submitter_trust": "New",
        "location_accuracy_m": 15,
    }
    values.update(changes)
    return ValidationInput(**values)


def test_passed_checks_publish_without_human_review() -> None:
    assert evaluate(valid_input()).status == "confirmed"


def test_same_plant_evidence_merges_instead_of_creating_a_pin() -> None:
    decision = evaluate(valid_input(merge_target_id="existing-sighting"))
    assert decision.status == "merged"
    assert decision.reason_codes == ("same_plant_observation",)


def test_exact_replay_and_spoof_are_hard_failures() -> None:
    assert evaluate(valid_input(exact_replay=True)).status == "rejected"
    assert evaluate(valid_input(spoof_probability=0.95)).status == "rejected"


def test_trust_never_overrides_integrity_or_species_checks() -> None:
    trusted_bad_image = valid_input(
        submitter_trust="Steward", quality_ok=False, ood_probability=0.8
    )
    assert evaluate(trusted_bad_image).status == "needs_rescan"
    mismatch = valid_input(submitter_trust="Steward", server_species_id="chromolaena-odorata")
    assert evaluate(mismatch).status == "needs_rescan"


def test_trust_only_adjusts_the_soft_confidence_threshold() -> None:
    assert evaluate(valid_input(server_confidence=0.80)).status == "needs_rescan"
    assert (
        evaluate(valid_input(server_confidence=0.80, submitter_trust="Trusted")).status
        == "confirmed"
    )
