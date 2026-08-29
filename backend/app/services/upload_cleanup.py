from __future__ import annotations

import uuid

import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.db.models import UploadGrant
from app.services.storage import storage

log = structlog.get_logger("invatrace.upload_cleanup")


def _is_staging_key(grant: UploadGrant) -> bool:
    parts = grant.object_key.split("/")
    if len(parts) != 3 or parts[:2] != ["uploads", str(grant.profile_id)]:
        return False
    filename = parts[2]
    if not filename.endswith(".jpg"):
        return False
    try:
        uuid.UUID(filename.removesuffix(".jpg"))
    except ValueError:
        return False
    return True


def remove_expired_uploads(session: Session, *, limit: int = 500) -> int:
    grants = session.scalars(
        select(UploadGrant)
        .where(
            UploadGrant.consumed_at.is_(None),
            UploadGrant.expires_at <= utcnow(),
        )
        .order_by(UploadGrant.expires_at)
        .with_for_update(skip_locked=True)
        .limit(limit)
    ).all()
    for grant in grants:
        if _is_staging_key(grant):
            storage.delete(grant.object_key)
        else:
            log.warning(
                "expired_upload_key_outside_staging_namespace",
                grant_id=str(grant.id),
                object_key=grant.object_key,
            )
        session.delete(grant)
    session.commit()
    return len(grants)
