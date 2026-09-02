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
    parsed = ReportSubmission.model_validate(valid_report())
    assert parsed.species_id == "mikania-micrantha"
    assert parsed.model_dump(by_alias=True)["consent"]["noPII"] is True


def test_report_contract_accepts_gallery_and_rejects_unknown_capture_sources() -> None:
    gallery = valid_report()
    gallery["captureSource"] = "gallery"
    assert ReportSubmission.model_validate(gallery).capture_source == "gallery"

    invalid = valid_report()
    invalid["captureSource"] = "clipboard"
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(invalid)


def test_development_species_seed_exactly_matches_model_catalog() -> None:
    catalog_path = Path(__file__).parents[1] / "app/data/pulih_model1_species_31.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    expected_ids = {
        item["machine_label"].replace("_", "-") for item in catalog["classes"]
    }
    assert len(SPECIES) == catalog["class_count"] == 31
    assert {item["id"] for item in SPECIES} == expected_ids
    assert sum(bool(item["is_invasive"]) for item in SPECIES) == 16
    assert sum(bool(item["reportable"]) for item in SPECIES) == 1
    assert "clidemia-hirta" not in expected_ids


def test_target_requires_species_and_non_target_forbids_it() -> None:
    target = valid_report()
    target["speciesId"] = None
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(target)

    other = valid_report()
    other["outcome"] = "other_plant"
    with pytest.raises(ValidationError):
        ReportSubmission.model_validate(other)


def test_stored_report_details_do_not_reapply_the_submission_window() -> None:
    stored = valid_report()
    stored["observedAt"] = (datetime.now(UTC) - timedelta(days=90)).isoformat()
    stored["speciesId"] = None
    stored["outcome"] = "uncertain"
    parsed = ReportSubmissionDetails.model_validate(stored)
    assert parsed.observed_at < datetime.now(UTC) - timedelta(days=30)


def test_identity_contract_rejects_privilege_injection() -> None:
    with pytest.raises(ValidationError):
        StartProfileRequest.model_validate(
            {"installationToken": "A" * 43, "role": "Admin", "trustLevel": "Steward"}
        )


def test_openapi_contains_the_frontend_contract_and_required_idempotency_headers() -> None:
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
    response = TestClient(app).get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-content-type-options"] == "nosniff"
