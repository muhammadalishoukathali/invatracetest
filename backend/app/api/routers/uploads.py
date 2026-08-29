from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.schemas import IDEMPOTENCY_PATTERN, PresignRequest, PresignResponse
from app.config import get_settings
from app.core.errors import ApiProblem
from app.core.idempotency import acquire_idempotency_lock, canonical_request_hash
from app.core.rate_limit import rate_limiter
from app.core.security import AuthContext, require_auth, utcnow
from app.db.base import get_session
from app.db.models import IdempotencyRecord, Profile, UploadGrant
from app.services.storage import storage

router = APIRouter(prefix="/api/v1/uploads", tags=["uploads"])


@router.post("/presign", response_model=PresignResponse)
def presign_upload(
    body: PresignRequest,
    response: Response,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> PresignResponse:
    settings = get_settings()
    rate_limiter.check("upload_presign", str(auth.profile.id))
    if not IDEMPOTENCY_PATTERN.fullmatch(idempotency_key):
        raise ApiProblem(400, "invalid_idempotency_key", "A valid Idempotency-Key is required.")
    if body.size_bytes > settings.upload_max_bytes:
        raise ApiProblem(413, "upload_too_large", "Image exceeds 8MB limit")
    now = utcnow()
    scope = "upload.presign"
    request_hash = canonical_request_hash(body.model_dump(mode="json", by_alias=True))
    acquire_idempotency_lock(
        session,
        profile_id=auth.profile.id,
        scope=scope,
        idempotency_key=idempotency_key,
    )
    existing = session.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.profile_id == auth.profile.id,
            IdempotencyRecord.scope == scope,
            IdempotencyRecord.idempotency_key == idempotency_key,
        )
    )
    if existing and existing.expires_at > now:
        if existing.request_hash != request_hash:
            raise ApiProblem(
                409,
                "idempotency_conflict",
                "This Idempotency-Key was already used for a different upload.",
            )
        response.status_code = existing.response_status
        return PresignResponse.model_validate(existing.response_json)
    if existing:
        session.execute(delete(IdempotencyRecord).where(IdempotencyRecord.id == existing.id))

    session.execute(select(Profile.id).where(Profile.id == auth.profile.id).with_for_update())
    active_grants = session.scalar(
        select(func.count(UploadGrant.id)).where(
            UploadGrant.profile_id == auth.profile.id,
            UploadGrant.consumed_at.is_(None),
            UploadGrant.expires_at > now,
        )
    )
    if (active_grants or 0) >= settings.upload_active_grants_per_profile:
        raise ApiProblem(
            429,
            "upload_quota_reached",
            "Too many uploads are waiting. Submit an existing upload or try again later.",
        )

    upload_id = uuid.uuid4()
    object_key = f"uploads/{auth.profile.id}/{upload_id}.jpg"
    expires_at = now + timedelta(seconds=settings.upload_url_ttl_seconds)
    grant = UploadGrant(
        id=upload_id,
        profile_id=auth.profile.id,
        object_key=object_key,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        expires_at=expires_at,
    )
    session.add(grant)
    payload = PresignResponse(
        upload_id=str(upload_id),
        upload_url=storage.presign_put(object_key, body.content_type, body.size_bytes),
        photo_key=object_key,
        expires_at=expires_at,
    )
    session.add(
        IdempotencyRecord(
            profile_id=auth.profile.id,
            scope=scope,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response_status=200,
            response_json=payload.model_dump(mode="json", by_alias=True),
            expires_at=expires_at,
        )
    )
    session.commit()
    return payload
