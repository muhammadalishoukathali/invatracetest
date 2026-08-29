from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol


@dataclass(frozen=True)
class StreamObservation:
    stream_id: str
    event_id: str
    observed_at: datetime
    feature_schema_version: str
    features: dict[str, float]


@dataclass(frozen=True)
class DelayedLabel:
    stream_id: str
    event_id: str
    received_at: datetime
    values: dict[str, float]


@dataclass(frozen=True)
class OvcviPrediction:
    stream_id: str
    event_id: str
    model_version: str
    state_version: str
    predictive_samples: list[list[float]]
    intervals: dict[str, list[float]]
    crps_outputs: dict[str, float] | None
    drift_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class OvcviHealth:
    status: str
    model_version: str | None
    state_version: str | None
    fake: bool


@dataclass(frozen=True)
class Checkpoint:
    stream_id: str
    model_version: str
    state_version: str
    payload: bytes
    metadata: dict[str, Any]


class OvcviProvider(Protocol):
    """Framework-neutral contract for a future complete OVC-VI implementation.

    `predict` receives features and prior state only. A contemporaneous label is
    deliberately absent, so input purification cannot leak the current response.
    `apply_label` is a separate delayed operation and may update the posterior,
    PIP pruning mask, drift metadata, and checkpoint state after prediction.
    """

    def health(self, stream_id: str) -> OvcviHealth: ...

    def predict(self, observation: StreamObservation) -> OvcviPrediction: ...

    def apply_label(self, label: DelayedLabel) -> str: ...

    def checkpoint(self, stream_id: str) -> Checkpoint: ...

    def restore(self, checkpoint: Checkpoint) -> None: ...


class OvcviStateStore(Protocol):
    def existing_prediction(self, stream_id: str, event_id: str) -> OvcviPrediction | None: ...

    def save_prediction(
        self, observation: StreamObservation, prediction: OvcviPrediction
    ) -> None: ...

    def save_label(self, label: DelayedLabel, state_version_after: str) -> None: ...

    def save_checkpoint(self, checkpoint: Checkpoint) -> str: ...


class OvcviConnector:
    """Idempotent orchestration boundary; it is not an OVC-VI implementation."""

    def __init__(self, provider: OvcviProvider, state_store: OvcviStateStore) -> None:
        self.provider = provider
        self.state_store = state_store

    def ingest(self, observation: StreamObservation) -> OvcviPrediction:
        previous = self.state_store.existing_prediction(observation.stream_id, observation.event_id)
        if previous:
            return previous
        prediction = self.provider.predict(observation)
        self.state_store.save_prediction(observation, prediction)
        return prediction

    def apply_delayed_label(self, label: DelayedLabel) -> str:
        if self.state_store.existing_prediction(label.stream_id, label.event_id) is None:
            raise ValueError("an observation must be predicted before its label is applied")
        state_version = self.provider.apply_label(label)
        self.state_store.save_label(label, state_version)
        return state_version

    def persist_checkpoint(self, stream_id: str) -> str:
        return self.state_store.save_checkpoint(self.provider.checkpoint(stream_id))
