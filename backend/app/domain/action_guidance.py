from __future__ import annotations

from datetime import UTC, datetime

from app.api.schemas import SeasonalActionGuide
from app.db.models import Species


def current_action_guide(
    species: Species, *, observed_at: datetime | None = None
) -> SeasonalActionGuide | None:
    """Return the versioned guide that covers the observation month.

    Species without a reviewed month-specific guide never receive improvised
    removal permission from the API.
    """

    month = (observed_at or datetime.now(UTC)).month
    for raw in species.action_guides or []:
        if month in raw.get("validMonths", raw.get("valid_months", [])):
            return SeasonalActionGuide.model_validate(raw)
    return None


def action_summary(species: Species, *, observed_at: datetime | None = None) -> str:
    guide = current_action_guide(species, observed_at=observed_at)
    if guide is None:
        return "Report only. No reviewed seasonal removal guide is available."
    return guide.summary
