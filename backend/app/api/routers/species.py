from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import MalaysiaStatus, SpeciesDetail, SpeciesListResponse, SpeciesSummary
from app.config import get_settings
from app.core.errors import ApiProblem
from app.db.base import get_session
from app.db.models import Species
from app.domain.action_guidance import current_action_guide

router = APIRouter(prefix="/api/v1/species", tags=["species"])
model_config_router = APIRouter(prefix="/api/v1/model-config", tags=["model"])


@model_config_router.get("")
def model_config() -> dict[str, object]:
    settings = get_settings()
    return {
        "acceptanceThreshold": settings.model_acceptance_threshold,
        "supportedVersions": settings.e1_model_versions,
    }


_STATUS_TO_UI: dict[str, MalaysiaStatus] = {
    "invasive": "invasive",
    "alien_not_marked_invasive": "information_only",
    "common_cultivated_status_not_inferred": "information_only",
    "introduced": "information_only",
    "status_requires_expert_review": "status_uncertain",
    "cryptogenic_uncertain": "status_uncertain",
    "watchlist_not_present": "status_uncertain",
}


def _ui_malaysia_status(item: Species) -> MalaysiaStatus:
    raw = (item.malaysia_status or "").strip()
    if raw in _STATUS_TO_UI:
        return _STATUS_TO_UI[raw]
    # AC 1.2.1: absent or failed lookup must return Status uncertain.
    return "status_uncertain"


@router.get("", response_model=SpeciesListResponse)
def list_species(session: Session = Depends(get_session)) -> SpeciesListResponse:
    species = session.scalars(select(Species).order_by(Species.name)).all()
    return SpeciesListResponse(
        items=[
            SpeciesSummary(
                id=item.id,
                name=item.name,
                latin_name=item.latin_name,
                is_invasive=item.is_invasive,
            )
            for item in species
        ]
    )


@router.get("/{species_id}", response_model=SpeciesDetail)
def species_detail(species_id: str, session: Session = Depends(get_session)) -> SpeciesDetail:
    item = session.get(Species, species_id)
    if not item:
        raise ApiProblem(404, "species_not_found", "Not found")
    ui_status = _ui_malaysia_status(item)
    guide = current_action_guide(item)
    # AC 1.2.3: information-only / uncertain MUST have action_eligible=false and report_eligible=false
    has_active_guide = guide is not None and guide.guidance_mode != "report_only"
    action_eligible = bool(item.action_eligible) and ui_status == "invasive" and has_active_guide
    report_eligible = bool(item.reportable) and ui_status == "invasive"
    return SpeciesDetail(
        id=item.id,
        name=item.name,
        latin_name=item.latin_name,
        common_names=item.common_names,
        is_invasive=item.is_invasive,
        risk=item.risk or "watch",
        traits=item.traits,
        native_twin=item.native_twin,
        removal_steps=item.removal_steps,
        do_not_do=item.do_not_do,
        reportable=item.reportable,
        action_guide=guide,
        malaysia_status=ui_status,
        status_source_id=item.status_source,
        status_reviewed_at=item.status_reviewed_at,
        general_information=item.general_information,
        action_eligible=action_eligible,
        report_eligible=report_eligible,
    )
