from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.ml.ovcvi.connector import (
    Checkpoint,
    DelayedLabel,
    OvcviHealth,
    OvcviPrediction,
    StreamObservation,
)


@dataclass
class FakeStreamState:
    version: int = 0
    last_label_event_id: str | None = None


class FakeOvcviProvider:
    """Deterministic contract fake; it does not approximate the research model."""

    model_version = "fake-ovcvi-contract-v1"

    def __init__(self) -> None:
        self.states: dict[str, FakeStreamState] = {}

    def _state(self, stream_id: str) -> FakeStreamState:
        return self.states.setdefault(stream_id, FakeStreamState())

    def health(self, stream_id: str) -> OvcviHealth:
        state = self._state(stream_id)
        return OvcviHealth("ready", self.model_version, f"fake-state-{state.version}", True)

    def predict(self, observation: StreamObservation) -> OvcviPrediction:
        state = self._state(observation.stream_id)
        ordered = ",".join(
            f"{key}:{observation.features[key]}" for key in sorted(observation.features)
        )
        digest = hashlib.sha256(
            f"{observation.stream_id}|{observation.event_id}|{state.version}|{ordered}".encode()
        ).digest()
        centre = int.from_bytes(digest[:4], "big") / 2**32
        samples = [[round(centre + (index - 2) * 0.02, 6)] for index in range(5)]
        return OvcviPrediction(
            stream_id=observation.stream_id,
            event_id=observation.event_id,
            model_version=self.model_version,
            state_version=f"fake-state-{state.version}",
            predictive_samples=samples,
            intervals={"lower95": [samples[0][0]], "upper95": [samples[-1][0]]},
            crps_outputs=None,
            drift_metadata={"provider": "deterministic-contract-fake"},
        )

    def apply_label(self, label: DelayedLabel) -> str:
        state = self._state(label.stream_id)
        state.version += 1
        state.last_label_event_id = label.event_id
        return f"fake-state-{state.version}"

    def checkpoint(self, stream_id: str) -> Checkpoint:
        state = self._state(stream_id)
        payload = f"{state.version}|{state.last_label_event_id or ''}".encode()
        return Checkpoint(
            stream_id=stream_id,
            model_version=self.model_version,
            state_version=f"fake-state-{state.version}",
            payload=payload,
            metadata={"fake": True},
        )

    def restore(self, checkpoint: Checkpoint) -> None:
        version, label_id = checkpoint.payload.decode().split("|", 1)
        self.states[checkpoint.stream_id] = FakeStreamState(int(version), label_id or None)
