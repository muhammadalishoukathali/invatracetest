"""Public configuration limits endpoint.

Exposes every threshold that error text, gates, and offline logic in the
frontend need to render accurately. Iteration 2 AC 7.3.1 forbids hardcoded
copies of these values in the client - fetch them from here at boot.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.schemas import ApiModel
from app.config import get_settings

router = APIRouter(prefix="/api/v1/config", tags=["config"])


class ConfigLimitsResponse(ApiModel):
    location_accuracy_max_m: int
    removal_proximity_max_m: int
    discovery_park_buffer_m: int
    discovery_trail_buffer_m: int
    discovery_decay_scale_m: int
    waterway_upstream_max_km: int
    occurrence_coord_uncertainty_max_m: int
    adoption_max_per_identity: int
    adoption_rate_limit_per_hour: int
    activity_change_tolerance_pct: int
    removal_rate_limit_per_hour: int
    removal_rate_limit_per_day: int
    removal_idempotency_window_seconds: int
    catalogue_version: str


@router.get("/limits", response_model=ConfigLimitsResponse)
def get_limits() -> ConfigLimitsResponse:
    s = get_settings()
    return ConfigLimitsResponse(
        location_accuracy_max_m=s.location_accuracy_max_m,
        removal_proximity_max_m=s.removal_proximity_max_m,
        discovery_park_buffer_m=s.discovery_park_buffer_m,
        discovery_trail_buffer_m=s.discovery_trail_buffer_m,
        discovery_decay_scale_m=s.discovery_decay_scale_m,
        waterway_upstream_max_km=s.waterway_upstream_max_km,
        occurrence_coord_uncertainty_max_m=s.occurrence_coord_uncertainty_max_m,
        adoption_max_per_identity=s.adoption_max_per_identity,
        adoption_rate_limit_per_hour=s.adoption_rate_limit_per_hour,
        activity_change_tolerance_pct=s.activity_change_tolerance_pct,
        removal_rate_limit_per_hour=s.removal_rate_limit_per_hour,
        removal_rate_limit_per_day=s.removal_rate_limit_per_day,
        removal_idempotency_window_seconds=s.removal_idempotency_window_seconds,
        catalogue_version=s.catalogue_version,
    )
