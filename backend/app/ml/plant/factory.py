from __future__ import annotations

from functools import lru_cache

from app.config import get_settings
from app.ml.plant.provider import PlantModelProvider
from app.ml.plant.providers.fake import FakePlantProvider
from app.ml.plant.providers.unavailable import UnavailablePlantProvider


@lru_cache
def get_plant_provider() -> PlantModelProvider:
    settings = get_settings()
    if settings.plant_model_provider == "fake":
        if settings.app_env == "production":
            raise RuntimeError("the fake plant provider cannot run in production")
        return FakePlantProvider()
    return UnavailablePlantProvider()
