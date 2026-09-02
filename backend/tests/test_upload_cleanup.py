"""Tests for app/services/upload_cleanup.py.

Covers two separate janitorial jobs: expiring presigned-but-never-used
uploads sitting under "uploads/...", and retrying the deletion queue for
objects that failed to delete from storage the first time round. Both
need to be safe to run repeatedly (cron-style) without double-deleting or
losing track of failures.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.core.errors import ApiProblem
from app.services import upload_cleanup


# stands in for the SQLAlchemy `.scalars(...).all()` result of a query.
class ScalarResult:
    def __init__(self, items: list[object]) -> None:
        self.items = items

    def all(self) -> list[object]:
        return self.items


# fake Session where each call to scalars() pops the next pre-scripted
# "batch" of rows off a list - lets a test simulate "first run finds two
# rows, second run finds none" without a real database.
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
    # "unexpected" here is a grant row pointing at an evidence/ key rather
    # than uploads/ - it shouldn't happen in practice, but the cleanup
    # should still remove the stale DB row for it while leaving the
    # object itself alone (it's not staging, so it's not ours to delete).
    # Running it twice checks the job is idempotent when there's nothing
    # left to do.
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
    # keys that look almost right (wrong profile id, non-UUID filename,
    # wrong extension) should never trigger a storage delete call - we
    # only want to touch objects we're certain we generated ourselves.
    # Still clean up the DB rows for these, just skip the storage call.
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


def test_object_deletion_retries_after_storage_recovers(monkeypatch) -> None:
    # first attempt: storage throws (R2/MinIO down or whatever), so the
    # job should record the failure on the row and bail without deleting
    # the DB record - we still need to retry it later. Second attempt:
    # storage works, so this time the row actually gets removed.
    job = SimpleNamespace(
        id=uuid.uuid4(),
        object_key=f"evidence/{uuid.uuid4()}/{uuid.uuid4()}.jpg",
        attempts=0,
        available_at=None,
        last_error=None,
    )
    session = FakeSession([[job], [job]])
    calls = 0

    def delete_object(_key: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ApiProblem(503, "storage_unavailable", "Object storage unavailable")

    monkeypatch.setattr(upload_cleanup.storage, "delete", delete_object)

    assert upload_cleanup.remove_pending_objects(session) == 0
    assert job.attempts == 1
    assert job.last_error == "storage_unavailable"
    assert session.deleted == []

    assert upload_cleanup.remove_pending_objects(session) == 1
    assert session.deleted == [job]
    assert session.commits == 2
