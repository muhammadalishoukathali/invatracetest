from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.models import ObjectDeletionJob


def enqueue_object_deletions(session: Session, object_keys: Iterable[str | None]) -> None:
    keys = sorted({key for key in object_keys if key})
    if not keys:
        return
    statement = insert(ObjectDeletionJob).values([{"object_key": key} for key in keys])
    session.execute(statement.on_conflict_do_nothing(index_elements=["object_key"]))
