"""Maps the Report ORM model onto the API response schemas.

Kept out of the routers so the shaping logic (what counts as retryable,
which screening method label to show) is testable on its own and reusable
between the submit endpoint and the report-status endpoint.
"""

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
    """Round an incoming float coordinate to 5 decimal places (~1m) before it
    goes anywhere near the DB. Using Decimal + explicit rounding rather than
    just round() so we get consistent half-up behaviour instead of Python's
    banker's rounding, which would occasionally round a .5 the "wrong" way.
    """
    return Decimal(str(value)).quantize(FIVE_PLACES, rounding=ROUND_HALF_UP)


def report_submission(report: Report) -> ReportSubmissionDetails:
    """Echoes back what the client submitted, mostly so the confirmation
    screen can show "here's what we received" without the client having to
    hang onto its own copy of the request.
    """
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
    """Build the full report status response the client polls after submitting.

    validation_retryable is passed in rather than derived purely from the
    report row because "validation_unavailable" can mean different things
    depending on whether the screening worker is expected to pick it back up
    (e.g. Redis/DB was briefly down) — that context lives with the caller,
    not on the Report itself.
    """
    return ReportResponse(
        id=str(report.id),
        status=report.status,
        created_at=report.created_at,
        submission=report_submission(report),
        tracking_url=f"/reports/{report.id}",
        validation=ReportValidation(
            reason_codes=report.validation_reasons or [],
            # needs_rescan is always retryable by definition; validation_unavailable
            # only is if the caller says the underlying outage has cleared
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
