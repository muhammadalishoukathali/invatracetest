from __future__ import annotations

import uuid
from decimal import ROUND_HALF_UP, Decimal

from app.api.schemas import (
    Consent,
    GeoPoint,
    ReportResponse,
    ReportSubmissionDetails,
    ReportValidation,
)
from app.db.models import Report

FIVE_PLACES = Decimal("0.00001")


def coordinate(value: float) -> Decimal:
    return Decimal(str(value)).quantize(FIVE_PLACES, rounding=ROUND_HALF_UP)


def report_submission(report: Report) -> ReportSubmissionDetails:
    return ReportSubmissionDetails(
        photo_key=report.photo_key,
        species_id=report.species_id,
        outcome=report.outcome,
        confidence=float(report.confidence),
        model_version=report.client_model_version,
        observed_at=report.observed_at,
        capture_id=report.capture_id,
        capture_source=report.capture_source,
        location=GeoPoint(lat=float(report.latitude), lng=float(report.longitude)),
        location_accuracy_m=report.location_accuracy_m,
        extent=report.extent,
        notes=report.notes,
        consent=Consent(accurate=report.consent_accurate, noPII=report.consent_no_pii),
    )


def report_response(
    report: Report,
    *,
    sighting_id: uuid.UUID | None = None,
    validation_retryable: bool = False,
) -> ReportResponse:
    return ReportResponse(
        id=str(report.id),
        status=report.status,
        created_at=report.created_at,
        submission=report_submission(report),
        tracking_url=f"/reports/{report.id}",
        validation=ReportValidation(
            reason_codes=report.validation_reasons or [],
            retryable=report.status == "needs_rescan"
            or (report.status == "validation_unavailable" and validation_retryable),
            policy_version=report.validation_policy_version,
            screening_method=(
                "deterministic_rules"
                if report.validation_policy_version == "deterministic-rules-v1.0"
                else None
            ),
        ),
        sighting_id=str(sighting_id) if sighting_id else None,
    )
