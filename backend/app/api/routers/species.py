from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import SpeciesDetail, SpeciesListResponse, SpeciesSummary
from app.core.errors import ApiProblem
from app.db.base import get_session
from app.db.models import Species
from app.domain.action_guidance import current_action_guide

router = APIRouter(prefix="/api/v1/species", tags=["species"])


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
    if not item or not item.detail_available or not item.risk:
        raise ApiProblem(404, "species_not_found", "Not found")
    return SpeciesDetail(
        id=item.id,
        name=item.name,
        latin_name=item.latin_name,
        common_names=item.common_names,
        is_invasive=item.is_invasive,
        risk=item.risk,
        traits=item.traits,
        native_twin=item.native_twin,
        removal_steps=item.removal_steps,
        do_not_do=item.do_not_do,
        reportable=item.reportable,
        action_guide=current_action_guide(item),
    )
