"""AC 4.1.1 (immutability of scan-derived fields) and AC 4.1.3 (atomic
rollback) - source-text regression tests. These are cheaper than spinning
up docker+PG for every CI run and pin the invariants the integration test
already covers, so a refactor that accidentally moves a `Report(...)`
instantiation before one of the field-mismatch guards fails here first.

The invariants are:
  1. `create_report` in `app/api/routers/reports.py` MUST raise a 422 with
     an exact, field-specific error code for each of species / outcome /
     confidence / model_version / capture_source / image_hash mismatch.
  2. Every one of those `raise ApiProblem(422, ...)` statements MUST appear
     before the `report = Report(...)` instantiation and before the
     `storage.finalize_upload(...)` call, so a rejected attempt cannot
     create a report row or move an object into the evidence prefix.
  3. `Report.status` starts as `"processing"` - not something looser like
     `"pending"` - so a partially-written row cannot be misinterpreted by
     the worker if it does exist.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

_SOURCE = (REPO_ROOT / "app/api/routers/reports.py").read_text()

REQUIRED_FIELD_MISMATCH_CODES = (
    "scan_species_mismatch",
    "scan_outcome_mismatch",
    "scan_confidence_mismatch",
    "scan_model_version_mismatch",
    "scan_capture_source_mismatch",
    "scan_image_hash_mismatch",
    "image_hash_mismatch",
)


def _create_report_body() -> str:
    """Return the body of the create_report route function."""
    marker = "def create_report("
    start = _SOURCE.index(marker)
    # The next top-level `def ` after `create_report` bounds the function.
    tail = _SOURCE[start + len(marker):]
    next_def = tail.find("\ndef ")
    if next_def == -1:
        return _SOURCE[start:]
    return _SOURCE[start : start + len(marker) + next_def]


def test_every_scan_field_mismatch_raises_field_specific_422() -> None:
    body = _create_report_body()
    for code in REQUIRED_FIELD_MISMATCH_CODES:
        assert f'"{code}"' in body, (
            f"create_report must raise 422 with error code `{code}` when the "
            f"corresponding scan field mismatches; that code is missing."
        )


def test_field_mismatch_guards_run_before_any_report_row_is_written() -> None:
    body = _create_report_body()
    report_ctor_idx = body.index("report = Report(")
    for code in (
        "scan_species_mismatch",
        "scan_outcome_mismatch",
        "scan_confidence_mismatch",
        "scan_model_version_mismatch",
        "scan_capture_source_mismatch",
        "scan_image_hash_mismatch",
    ):
        guard_idx = body.index(f'"{code}"')
        assert guard_idx < report_ctor_idx, (
            f"AC 4.1.1/4.1.3: the `{code}` guard must raise before the "
            f"`report = Report(...)` instantiation so a rejected attempt "
            f"cannot leave a row behind."
        )


def test_image_hash_mismatch_runs_before_finalize_upload() -> None:
    """AC 4.1.3 - moving the uploaded object into the evidence/ prefix is
    the side-effect that is not covered by the SQL transaction. Rejecting
    a bad-hash upload MUST happen before finalize_upload runs, or the
    object storage state ends up out of sync with the (rolled-back) DB.
    """
    body = _create_report_body()
    finalize_idx = body.index("storage.finalize_upload(")
    image_hash_guard_idx = body.index('"image_hash_mismatch"')
    assert image_hash_guard_idx < finalize_idx, (
        "The client/server hash-mismatch guard must fire before "
        "storage.finalize_upload so a bad-hash upload never gets moved out "
        "of the temporary uploads/ prefix."
    )


def test_scan_field_guards_run_before_finalize_upload() -> None:
    body = _create_report_body()
    finalize_idx = body.index("storage.finalize_upload(")
    for code in (
        "scan_species_mismatch",
        "scan_outcome_mismatch",
        "scan_confidence_mismatch",
        "scan_model_version_mismatch",
        "scan_capture_source_mismatch",
        "scan_image_hash_mismatch",
    ):
        guard_idx = body.index(f'"{code}"')
        assert guard_idx < finalize_idx, (
            f"AC 4.1.3: the `{code}` guard must fire before "
            f"storage.finalize_upload so a rejected attempt does not leave "
            f"the object in the evidence/ prefix."
        )


def test_new_report_starts_in_processing_state() -> None:
    body = _create_report_body()
    assert 'status="processing"' in body, (
        "AC 4.1.4 relies on new reports starting in `processing` so the "
        "tracking UI can poll processing→screened. Any other initial state "
        "would either skip the pending UI or misclassify the row for the "
        "screening worker."
    )
