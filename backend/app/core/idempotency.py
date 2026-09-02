"""Idempotent-request support for endpoints like report submission.

Clients retry on flaky mobile networks, so the report endpoint accepts an
Idempotency-Key and we need two things: a way to compare "is this the same
request replayed" (canonical_request_hash) and a way to stop two concurrent
requests with the same key racing each other into duplicate rows
(acquire_idempotency_lock). Rows themselves live in IdempotencyRecord,
see app/db/models.py.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session


def canonical_request_hash(payload: Any) -> bytes:
    """Hash a request body so a replay with the same key but a *different* body
    can be told apart from a genuine retry. Keys are sorted and separators are
    tight so the same logical payload always serializes identically.
    """
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).digest()


def acquire_idempotency_lock(
    session: Session,
    *,
    profile_id: uuid.UUID,
    scope: str,
    idempotency_key: str,
) -> None:
    """Serialize one idempotency key for the lifetime of this DB transaction.

    Postgres advisory locks take a bigint, not a string, so we hash the
    (profile, scope, key) triple down to 8 bytes and reinterpret it as a
    signed 64-bit int. pg_advisory_xact_lock auto-releases at commit/rollback,
    which is exactly what we want — no separate unlock call, no risk of
    holding the lock past the transaction. Two requests with the same key
    just queue up here instead of both hitting the insert-then-check race.
    """

    digest = hashlib.sha256(f"{profile_id}:{scope}:{idempotency_key}".encode()).digest()
    lock_key = int.from_bytes(digest[:8], "big", signed=True)
    session.execute(select(func.pg_advisory_xact_lock(lock_key)))
