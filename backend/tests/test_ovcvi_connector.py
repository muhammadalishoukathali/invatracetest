from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.ml.ovcvi.connector import (
    Checkpoint,
    DelayedLabel,
    OvcviConnector,
    OvcviPrediction,
    StreamObservation,
)
from app.ml.ovcvi.fake import FakeOvcviProvider


class MemoryStateStore:
    def __init__(self) -> None:
        self.predictions: dict[tuple[str, str], OvcviPrediction] = {}
        self.labels: list[tuple[DelayedLabel, str]] = []
        self.checkpoints: list[Checkpoint] = []

    def existing_prediction(self, stream_id: str, event_id: str) -> OvcviPrediction | None:
        return self.predictions.get((stream_id, event_id))

    def save_prediction(self, observation: StreamObservation, prediction: OvcviPrediction) -> None:
        self.predictions[(observation.stream_id, observation.event_id)] = prediction

    def save_label(self, label: DelayedLabel, state_version_after: str) -> None:
        self.labels.append((label, state_version_after))

    def save_checkpoint(self, checkpoint: Checkpoint) -> str:
        self.checkpoints.append(checkpoint)
        return checkpoint.state_version


def observation(event_id: str = "event-1") -> StreamObservation:
    return StreamObservation(
        stream_id="stream-a",
        event_id=event_id,
        observed_at=datetime.now(UTC),
        feature_schema_version="features-v1",
        features={"temperature": 28.4, "humidity": 0.81},
    )


def test_ingest_is_idempotent_and_predicts_before_update() -> None:
    provider = FakeOvcviProvider()
    store = MemoryStateStore()
    connector = OvcviConnector(provider, store)
    first = connector.ingest(observation())
    second = connector.ingest(observation())
    assert first == second
    assert first.state_version == "fake-state-0"
    assert len(store.predictions) == 1

    state = connector.apply_delayed_label(
        DelayedLabel("stream-a", "event-1", datetime.now(UTC), {"response": 1.0})
    )
    assert state == "fake-state-1"
    assert store.labels[0][1] == "fake-state-1"


def test_label_without_prediction_is_rejected() -> None:
    connector = OvcviConnector(FakeOvcviProvider(), MemoryStateStore())
    with pytest.raises(ValueError, match="predicted before"):
        connector.apply_delayed_label(
            DelayedLabel("stream-a", "missing", datetime.now(UTC), {"response": 1.0})
        )


def test_checkpoint_round_trip_preserves_fake_state() -> None:
    provider = FakeOvcviProvider()
    store = MemoryStateStore()
    connector = OvcviConnector(provider, store)
    connector.ingest(observation())
    connector.apply_delayed_label(
        DelayedLabel("stream-a", "event-1", datetime.now(UTC), {"response": 1.0})
    )
    assert connector.persist_checkpoint("stream-a") == "fake-state-1"

    restored = FakeOvcviProvider()
    restored.restore(store.checkpoints[0])
    assert restored.health("stream-a").state_version == "fake-state-1"
