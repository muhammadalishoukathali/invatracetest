from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session


def canonical_request_hash(payload: Any) -> bytes:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).digest()


def acquire_idempotency_lock(
    session: Session,
    *,
    profile_id: uuid.UUID,
    scope: str,
    idempotency_key: str,
) -> None:
    """Serialize one idempotency key for the lifetime of this DB transaction."""

    digest = hashlib.sha256(f"{profile_id}:{scope}:{idempotency_key}".encode()).digest()
    lock_key = int.from_bytes(digest[:8], "big", signed=True)
    session.execute(select(func.pg_advisory_xact_lock(lock_key)))
