from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.schemas import NotificationListResponse, NotificationResponse, OkResponse
from app.core.pagination import decode_cursor, encode_cursor
from app.core.security import AuthContext, require_auth
from app.db.base import get_session
from app.db.models import Notification

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = None,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> NotificationListResponse:
    offset = decode_cursor(cursor)
    rows = session.scalars(
        select(Notification)
        .where(Notification.profile_id == auth.profile.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    unread = (
        session.scalar(
            select(func.count(Notification.id)).where(
                Notification.profile_id == auth.profile.id,
                Notification.read_at.is_(None),
            )
        )
        or 0
    )
    return NotificationListResponse(
        items=[
            NotificationResponse(
                id=str(item.id),
                kind=item.kind,
                title=item.title,
                body=item.body,
                created_at=item.created_at,
                read=item.read_at is not None,
                link_to=item.link_to,
            )
            for item in rows
        ],
        unread=unread,
        next_cursor=encode_cursor(offset, len(rows), limit),
    )


@router.post("/read-all", response_model=OkResponse)
def read_all(
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> OkResponse:
    session.execute(
        update(Notification)
        .where(Notification.profile_id == auth.profile.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    session.commit()
    return OkResponse()


@router.post("/{notification_id}/read", response_model=OkResponse)
def read_one(
    notification_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> OkResponse:
    session.execute(
        update(Notification)
        .where(
            Notification.id == notification_id,
            Notification.profile_id == auth.profile.id,
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    session.commit()
    return OkResponse()
