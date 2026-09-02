"""AC 2.2.1 — persist client-side scan results so report submissions can be re-verified."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import ScanCreateRequest, ScanResponse
from app.core.errors import ApiProblem
from app.core.security import AuthContext, require_auth
from app.db.base import get_session
from app.db.models import Scan, Species

router = APIRouter(prefix="/api/v1/scans", tags=["scans"])


@router.post("", response_model=ScanResponse, status_code=201)
def create_scan(
    body: ScanCreateRequest,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> ScanResponse:
    if body.outcome == "target" and not body.predicted_species_id:
        raise ApiProblem(422, "scan_missing_species", "Target scans must include predictedSpeciesId.")
    if body.outcome != "target" and body.predicted_species_id is not None:
        raise ApiProblem(422, "scan_species_not_allowed", "Only target scans may include predictedSpeciesId.")
    if body.predicted_species_id and not session.get(Species, body.predicted_species_id):
        raise ApiProblem(422, "unknown_species", "The predicted species is not supported.")

    existing = session.scalar(
        select(Scan).where(
            Scan.capture_id == body.capture_id,
            Scan.profile_id == auth.profile.id,
        )
    )
    if existing:
        return _to_response(existing)

    image_hash = bytes.fromhex(body.image_sha256_hex) if body.image_sha256_hex else None
    scan = Scan(
        profile_id=auth.profile.id,
        capture_id=body.capture_id,
        predicted_species_id=body.predicted_species_id,
        outcome=body.outcome,
        confidence=body.confidence,
        model_version=body.model_version,
        image_sha256=image_hash,
    )
    session.add(scan)
    session.commit()
    session.refresh(scan)
    return _to_response(scan)


def _to_response(scan: Scan) -> ScanResponse:
    return ScanResponse(
        id=str(scan.id),
        capture_id=scan.capture_id,
        predicted_species_id=scan.predicted_species_id,
        outcome=scan.outcome,
        confidence=float(scan.confidence),
        model_version=scan.model_version,
        created_at=scan.created_at,
    )
