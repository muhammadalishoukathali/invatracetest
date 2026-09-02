"""Contract tests between the frontend PWA and this API.

Checks the camelCase <-> snake_case boundary on ReportSubmission, that the
seeded species list actually matches the ONNX model's class catalog, and
that the OpenAPI schema still exposes the routes/headers the frontend
depends on. These are the tests most likely to catch a silent breaking
change before the frontend team notices.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.schemas import ReportSubmission, ReportSubmissionDetails, StartProfileRequest
from app.main import app
from app.seed import SPECIES


def valid_report() -> dict[str, object]:
    return {
        "photoKey": "photos/profile/photo.jpg",
        "speciesId": "mikania-micrantha",
        "outcome": "target",
        "confidence": 0.91,
        "modelVersion": "client-onnx-v1",
        "observedAt": datetime.now(UTC).isoformat(),
        "captureId": str(uuid.uuid4()),
        "captureSource": "camera",
        "location": {"lat": 3.139, "lng": 101.6869},
        "locationAccuracyM": 12,
        "extent": "single",
        "notes": "Near the trail marker",
        "consent": {"accurate": True, "noPII": True},
    }


def test_report_contract_uses_frontend_camel_case() -> None:
    # the frontend sends camelCase JSON, the Python side works in
    # snake_case internally - this just confirms the alias mapping goes
    # both ways (parse in, dump back out) without losing fields.
    parsed = ReportSubmission.model_validate(valid_report())
    assert parsed.species_id == "mikania-micrantha"
    assert parsed.model_dump(by_alias=True)["consent"]["noPII"] is True


def test_report_contract_accepts_gallery_and_rejects_unknown_capture_sources() -> None:
    # captureSource is a closed set (camera/gallery) - anything else should
    # get rejected at the schema level rather than falling through to
    # whatever downstream code does with an unrecognised value.
    gallery = valid_report()
    gallery["captureSource"] = "gallery"
    assert ReportSubmission.model_validate(gallery).capture_source == "gallery"

    invalid = valid_report()
    invalid["captureSource"] = "clipboard"
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(invalid)


def test_development_species_seed_exactly_matches_model_catalog() -> None:
    # this is the one I'd actually worry about breaking silently: the seed
    # data in app/seed.py has to line up 1:1 with the ONNX model's class
    # list, or predictions come back for species the API doesn't know
    # about. Comparing against the raw catalog json here rather than
    # trusting the seed module to be right.
    catalog_path = Path(__file__).parents[1] / "app/data/pulih_model1_species_31.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    expected_ids = {
        item["machine_label"].replace("_", "-") for item in catalog["classes"]
    }
    assert len(SPECIES) == catalog["class_count"] == 31
    assert {item["id"] for item in SPECIES} == expected_ids
    assert sum(bool(item["is_invasive"]) for item in SPECIES) == 16
    # AC 1.2.2: every invasive species must expose the Report control (report_eligible=true).
    assert sum(bool(item["reportable"]) for item in SPECIES) == 16
    assert "clidemia-hirta" not in expected_ids


def test_target_requires_species_and_non_target_forbids_it() -> None:
    # outcome and speciesId are linked fields: "target" needs a species id,
    # anything else must NOT have one. Checking both directions since a
    # schema that only enforces one side is half-broken.
    target = valid_report()
    target["speciesId"] = None
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(target)

    other = valid_report()
    other["outcome"] = "other_plant"
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(other)


def test_stored_report_details_do_not_reapply_the_submission_window() -> None:
    # ReportSubmission (the create-time schema) enforces a "must be recent"
    # window on observedAt so people can't backdate reports. But once a
    # report is already stored, reading it back with the *Details variant
    # shouldn't re-validate that window - old reports need to stay
    # readable forever, not just for 30 days after they were made.
    stored = valid_report()
    stored["observedAt"] = (datetime.now(UTC) - timedelta(days=90)).isoformat()
    stored["speciesId"] = None
    stored["outcome"] = "uncertain"
    parsed = ReportSubmissionDetails.model_validate(stored)
    assert parsed.observed_at < datetime.now(UTC) - timedelta(days=30)


def test_identity_contract_rejects_privilege_injection() -> None:
    # StartProfileRequest is what an anonymous client sends to create a
    # profile - it should only ever carry installationToken. If role or
    # trustLevel leak through as accepted fields, a client could just ask
    # to be created as an Admin/Steward, which would be bad.
    with pytest.raises(ValidationError):
        StartProfileRequest.model_validate(
            {"installationToken": "A" * 43, "role": "Admin", "trustLevel": "Steward"}
        )


def test_openapi_contains_the_frontend_contract_and_required_idempotency_headers() -> None:
    # generated OpenAPI schema is basically the source of truth the
    # frontend codegens against, so this locks down the route list and
    # makes sure the old /api/v1/verify/* routes are actually gone (not
    # just unused) and that write endpoints still demand an
    # Idempotency-Key header rather than it quietly becoming optional.
    schema = app.openapi()
    required_paths = {
        "/health",
        "/api/v1/profiles/start",
        "/api/v1/profiles/bootstrap",
        "/api/v1/profiles/restore",
        "/api/v1/profiles/me",
        "/api/v1/species",
        "/api/v1/notifications",
        "/api/v1/uploads/presign",
        "/api/v1/reports",
        "/api/v1/reports/mine",
        "/api/v1/reports/{report_id}",
        "/api/v1/sightings",
        "/api/v1/admin/reports/{report_id}/repair",
    }
    assert required_paths.issubset(schema["paths"])
    assert not any(path.startswith("/api/v1/verify") for path in schema["paths"])
    for path in ("/api/v1/uploads/presign", "/api/v1/reports"):
        parameters = schema["paths"][path]["post"]["parameters"]
        header = next(item for item in parameters if item["name"] == "Idempotency-Key")
        assert header["required"] is True


def test_liveness_needs_no_external_dependency() -> None:
    # /health/live is the "is the process even up" probe - it must not
    # touch the DB/Redis/storage, otherwise a slow dependency takes down
    # the liveness check too and the orchestrator kills a container that's
    # actually fine. Readiness (DB/Redis/etc) is a separate endpoint.
    response = TestClient(app).get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-content-type-options"] == "nosniff"
