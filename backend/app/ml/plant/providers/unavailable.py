from app.config import get_settings
from app.ml.plant.provider import ModelHealth, ModelUnavailableError


class UnavailablePlantProvider:
    def health(self) -> ModelHealth:
        settings = get_settings()
        return ModelHealth(
            status="unavailable",
            provider="unavailable",
            version=None,
            device=settings.plant_model_device,
            fake=False,
            detail="No production plant model is configured.",
        )

    @staticmethod
    def _raise() -> None:
        raise ModelUnavailableError("No production plant model is configured.")

    def detect(self, image: bytes):
        self._raise()

    def quality(self, image: bytes):
        self._raise()

    def identify(self, image: bytes):
        self._raise()

    def embed(self, image: bytes):
        self._raise()
