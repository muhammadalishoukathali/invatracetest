from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.services import upload_cleanup


class ScalarResult:
    def __init__(self, items: list[object]) -> None:
        self.items = items

    def all(self) -> list[object]:
        return self.items


class FakeSession:
    def __init__(self, batches: list[list[object]]) -> None:
        self.batches = batches
        self.deleted: list[object] = []
        self.commits = 0

    def scalars(self, _statement) -> ScalarResult:
        return ScalarResult(self.batches.pop(0))

    def delete(self, item: object) -> None:
        self.deleted.append(item)

    def commit(self) -> None:
        self.commits += 1


def grant(object_key: str, profile_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), object_key=object_key, profile_id=profile_id)


def test_cleanup_is_repeatable_and_only_deletes_staging_objects(monkeypatch) -> None:
    profile_id = uuid.uuid4()
    staging = grant(f"uploads/{profile_id}/{uuid.uuid4()}.jpg", profile_id)
    unexpected = grant(f"evidence/{profile_id}/{uuid.uuid4()}.jpg", profile_id)
    session = FakeSession([[staging, unexpected], []])
    deleted_objects: list[str] = []
    monkeypatch.setattr(upload_cleanup.storage, "delete", deleted_objects.append)

    assert upload_cleanup.remove_expired_uploads(session) == 2
    assert upload_cleanup.remove_expired_uploads(session) == 0

    assert deleted_objects == [staging.object_key]
    assert session.deleted == [staging, unexpected]
    assert session.commits == 2


def test_cleanup_rejects_similar_but_invalid_staging_keys(monkeypatch) -> None:
    profile_id = uuid.uuid4()
    invalid = [
        grant(f"uploads/{uuid.uuid4()}/{uuid.uuid4()}.jpg", profile_id),
        grant(f"uploads/{profile_id}/not-a-uuid.jpg", profile_id),
        grant(f"uploads/{profile_id}/{uuid.uuid4()}.png", profile_id),
    ]
    session = FakeSession([invalid])
    deleted_objects: list[str] = []
    monkeypatch.setattr(upload_cleanup.storage, "delete", deleted_objects.append)

    assert upload_cleanup.remove_expired_uploads(session) == len(invalid)
    assert deleted_objects == []
