"""Queues object-storage keys up for later deletion.

We never delete an R2/MinIO object inline while handling a request -
if a report or sighting gets deleted, its evidence/thumbnail keys go
into the object_deletion_jobs table instead, and the cleanup worker
(app/services/upload_cleanup.py, remove_pending_objects) picks them up
and retries with backoff if storage is briefly unavailable.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.models import ObjectDeletionJob


def enqueue_object_deletions(session: Session, object_keys: Iterable[str | None]) -> None:
    # Call sites pass in keys that may be None (e.g. a sighting without a
    # thumbnail yet) - filter those out and dedupe before writing.
    keys = sorted({key for key in object_keys if key})
    if not keys:
        return
    statement = insert(ObjectDeletionJob).values([{"object_key": key} for key in keys])
    # on_conflict_do_nothing so re-queuing the same key (e.g. caller retries
    # after a partial failure) doesn't error or create a duplicate job.
    session.execute(statement.on_conflict_do_nothing(index_elements=["object_key"]))
