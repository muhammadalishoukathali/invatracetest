"""Turns the raw JSON blobs on Species.action_guides into API-ready guidance.

Removal advice is seasonal (a plant might be fine to pull in the dry season
and a bad idea to disturb while seeding), so a species can have several
guides, each valid for a set of months. This module picks the one that
covers a given observation date and normalises the messy stored shape into
a proper SeasonalActionGuide schema.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.api.schemas import GuidanceSource, SeasonalActionGuide
from app.db.models import Species


# older seeded guides used an "action_mode" field with different values than
# what the API contract settled on later ("guidance_mode") — this maps the
# old vocabulary forward so we don't have to backfill every stored guide
_OLD_TO_NEW_MODE = {
    "remove": "active_guidance",
    "contain": "active_guidance",
    "report_only": "report_only",
    "site_manager_confirmation_required": "site_manager_confirmation_required",
    "active_guidance": "active_guidance",
}


def _hydrate_guide(species: Species, raw: dict[str, Any]) -> SeasonalActionGuide:
    """Fill AC-required fields on a stored guide dict, deriving from species where missing.

    The stored JSON is a bit of a grab-bag — some guides were written with
    camelCase keys, some snake_case, some fields live on the guide itself and
    others fell back to species.guidance_metadata over time. Every .get()
    chain below is working around that inconsistency rather than anything
    being wrong with the current data model.
    """
    action_mode = raw.get("actionMode") or raw.get("action_mode") or "report_only"
    guidance_mode = raw.get("guidanceMode") or raw.get("guidance_mode")
    if not guidance_mode:
        guidance_mode = _OLD_TO_NEW_MODE.get(action_mode, "report_only")
    metadata = species.guidance_metadata or {}
    sources_raw = raw.get("sources") or metadata.get("sources") or []
    sources = [GuidanceSource.model_validate(item) for item in sources_raw]
    stop_conditions = raw.get("stopConditions") or raw.get("stop_conditions") or metadata.get("stop_conditions") or []
    spread_prevention = raw.get("spreadPrevention") or raw.get("spread_prevention") or metadata.get("spread_prevention") or []
    prohibited_actions = raw.get("prohibitedActions") or raw.get("prohibited_actions") or metadata.get("prohibited_actions") or []
    content_version = (
        raw.get("contentVersion")
        or raw.get("content_version")
        or species.guidance_content_version
        or raw.get("revision", "unversioned")
    )
    return SeasonalActionGuide(
        action_mode=action_mode,
        guidance_mode=guidance_mode,
        plant_id=raw.get("plantId") or raw.get("plant_id") or species.id,
        content_version=content_version,
        last_reviewed=species.guidance_last_reviewed,
        title=raw.get("title", ""),
        summary=raw.get("summary", ""),
        valid_months=raw.get("validMonths") or raw.get("valid_months") or [],
        steps=raw.get("steps") or [],
        do_not_do=raw.get("doNotDo") or raw.get("do_not_do") or [],
        ppe=raw.get("ppe") or [],
        decontamination=raw.get("decontamination") or [],
        stop_conditions=stop_conditions,
        spread_prevention=spread_prevention,
        prohibited_actions=prohibited_actions,
        sources=sources,
        revision=raw.get("revision", content_version),
    )


def current_action_guide(
    species: Species, *, observed_at: datetime | None = None
) -> SeasonalActionGuide | None:
    """Return the versioned guide that covers the observation month.

    Species without a reviewed month-specific guide never receive improvised
    removal permission from the API — they receive an observe-and-report
    fallback stub (AC 3.1.1) so the client always renders a guidance record.
    """

    month = (observed_at or datetime.now(UTC)).month
    for raw in species.action_guides or []:
        if month in raw.get("validMonths", raw.get("valid_months", [])):
            return _hydrate_guide(species, raw)
    return _observe_and_report_fallback(species)


def _observe_and_report_fallback(species: Species) -> SeasonalActionGuide:
    # used when a species has no guide covering the current month (or no
    # guides at all) — the client should never render an empty guidance
    # screen, so this stub always gives it something to show, just with
    # removal actively discouraged rather than silently omitted
    metadata = species.guidance_metadata or {}
    sources_raw = metadata.get("sources") or []
    return SeasonalActionGuide(
        action_mode="report_only",
        guidance_mode="report_only",
        plant_id=species.id,
        content_version=species.guidance_content_version or "observe-and-report-fallback-v1",
        last_reviewed=species.guidance_last_reviewed,
        title="Observe and report",
        summary="No reviewed removal guidance is available for this plant. Please observe and report.",
        valid_months=list(range(1, 13)),
        steps=[],
        do_not_do=[
            "Do not attempt removal without reviewed guidance",
            "Do not disturb the plant",
        ],
        ppe=[],
        decontamination=[],
        stop_conditions=metadata.get("stop_conditions") or [],
        spread_prevention=metadata.get("spread_prevention") or [],
        prohibited_actions=metadata.get("prohibited_actions") or [],
        sources=[GuidanceSource.model_validate(item) for item in sources_raw],
        revision="observe-and-report-fallback-v1",
    )


def action_summary(species: Species, *, observed_at: datetime | None = None) -> str:
    # short one-liner for places that just need summary text (e.g. a
    # notification body) and don't want the full guide object
    guide = current_action_guide(species, observed_at=observed_at)
    if guide is None:
        return "Report only. No reviewed seasonal removal guide is available."
    return guide.summary
