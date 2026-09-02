from __future__ import annotations

import hmac
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.schemas import (
    AccessOverviewResponse,
    BootstrapRequest,
    BootstrapResponse,
    InstallationResponse,
    ProfileResponse,
    RecoveryBatchResponse,
    RestoreRequest,
    RestoreResponse,
    StartProfileRequest,
    StartProfileResponse,
    UpdateProfileRequest,
)
from app.core.errors import ApiProblem, request_id_var
from app.core.rate_limit import client_address, rate_limiter
from app.core.security import (
    AuthContext,
    issue_access_token,
    keyed_hash,
    new_profile_public_id,
    random_grouped_secret,
    require_auth,
    utcnow,
)
from app.db.base import get_session
from app.db.models import (
    AuditEvent,
    Installation,
    Profile,
    RecoveryCode,
    RecoveryCodeBatch,
)

"""Pseudonymous "private access" auth — no email/password, just an installation secret.

Covers the whole account lifecycle for InvaTrace's identity model: a profile
gets created on first app open (start), an existing installation re-derives
its access token on later opens (bootstrap), and a lost device gets a fresh
installation via a recovery code (restore). Also handles profile settings,
recovery code rotation, and installation management (the "my devices" list).
This is the backend for the app's onboarding flow and the account/settings screen.
"""

router = APIRouter(prefix="/api/v1/profiles", tags=["private access"])
# Deliberately vague — don't tell an attacker whether the profile ID or the
# recovery code was the wrong part.
GENERIC_RESTORE_ERROR = (
    "We couldn’t restore this access. Check the profile ID and recovery code, then try again."
)


# Shared shape for returning a Profile out of any of the endpoints below.
def profile_response(profile: Profile) -> ProfileResponse:
    return ProfileResponse(
        id=profile.public_id,
        display_name=profile.display_name,
        role=profile.role,
        trust_level=profile.trust_level,
    )


# Small wrapper so every identity-related mutation leaves an AuditEvent behind
# without repeating the same six kwargs everywhere.
def audit(
    session: Session,
    event_type: str,
    subject_type: str,
    subject_id: str,
    acting_profile_id: uuid.UUID | None,
    metadata: dict[str, object] | None = None,
) -> None:
    session.add(
        AuditEvent(
            event_type=event_type,
            subject_type=subject_type,
            subject_id=subject_id,
            acting_profile_id=acting_profile_id,
            request_id=request_id_var.get(),
            metadata_json=metadata or {},
        )
    )


# Generates a fresh set of 10 one-time recovery codes and stores their hashes
# (never the raw codes — those only exist in the response, once). Used on
# first profile creation and whenever the user rotates their codes.
def create_recovery_batch(session: Session, profile_id: uuid.UUID) -> tuple[list[str], datetime]:
    now = utcnow()
    raw_codes = [random_grouped_secret(16) for _ in range(10)]
    batch = RecoveryCodeBatch(profile_id=profile_id, created_at=now)
    session.add(batch)
    session.flush()
    session.add_all(
        RecoveryCode(
            batch_id=batch.id,
            profile_id=profile_id,
            code_hash=keyed_hash(code),
            created_at=now,
        )
        for code in raw_codes
    )
    return raw_codes, now


# First-run flow — called once when the app is freshly installed. Client
# generates a random installation_token locally (this endpoint never sees a
# password) and we mint a brand new pseudonymous profile for it, starting at
# trust_level="New" (see app/core/privacy.py for what that restricts).
@router.post("/start", response_model=StartProfileResponse, status_code=201)
def start_profile(
    body: StartProfileRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> StartProfileResponse:
    rate_limiter.check("profile_start", client_address(request))
    token_hash = keyed_hash(body.installation_token)
    # Same token used twice would mean two profiles sharing one installation
    # secret, which breaks the whole "one installation = one profile" model.
    if session.scalar(select(Installation.id).where(Installation.token_hash == token_hash)):
        raise ApiProblem(409, "installation_exists", "Private access could not be started.")

    profile = Profile(
        public_id=new_profile_public_id(),
        display_name=body.display_name,
        role="Detector",
        trust_level="New",
        recovery_setup_acknowledged=False,
    )
    session.add(profile)
    session.flush()
    installation = Installation(profile_id=profile.id, token_hash=token_hash)
    session.add(installation)
    session.flush()
    codes, _created_at = create_recovery_batch(session, profile.id)
    audit(session, "profile.started", "profile", profile.public_id, profile.id)
    session.commit()
    return StartProfileResponse(
        access_token=issue_access_token(profile.id, installation.id),
        profile=profile_response(profile),
        recovery_codes=codes,
        installation_id=str(installation.id),
    )


# Called every time the PWA opens on a device that already has an
# installation_token in local storage — exchanges it for a short-lived access
# token. This is basically "log in silently" since there's no password to type.
@router.post("/bootstrap", response_model=BootstrapResponse)
def bootstrap(
    body: BootstrapRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> BootstrapResponse:
    rate_limiter.check("profile_bootstrap", client_address(request))
    token_hash = keyed_hash(body.installation_token)
    installation = session.scalar(
        select(Installation).where(Installation.token_hash == token_hash).with_for_update()
    )
    if not installation:
        raise ApiProblem(404, "installation_not_found", "Installation not found")
    if installation.revoked_at is not None:
        raise ApiProblem(401, "installation_revoked", "Installation unavailable")
    profile = session.get(Profile, installation.profile_id)
    if not profile:
        raise ApiProblem(404, "installation_not_found", "Installation not found")
    installation.last_used_at = utcnow()
    session.commit()
    return BootstrapResponse(
        access_token=issue_access_token(profile.id, installation.id),
        profile=profile_response(profile),
        recovery_setup_required=not profile.recovery_setup_acknowledged,
    )


# Recovery flow for "I got a new phone / cleared my browser storage" — trades
# a profile ID + one of the 10 recovery codes for a new installation on the
# same profile. Called from the app's "restore access" screen.
@router.post("/restore", response_model=RestoreResponse)
def restore(
    body: RestoreRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> RestoreResponse:
    rate_limiter.check("profile_restore", body.profile_id)
    rate_limiter.check("profile_restore_ip", client_address(request))
    token_hash = keyed_hash(body.installation_token)
    if session.scalar(select(Installation.id).where(Installation.token_hash == token_hash)):
        raise ApiProblem(400, "restore_failed", GENERIC_RESTORE_ERROR)

    profile = session.scalar(
        select(Profile).where(Profile.public_id == body.profile_id).with_for_update()
    )
    supplied_hash = keyed_hash(body.recovery_code)
    matched_code: RecoveryCode | None = None
    if profile:
        active_codes = session.scalars(
            select(RecoveryCode)
            .join(RecoveryCodeBatch, RecoveryCodeBatch.id == RecoveryCode.batch_id)
            .where(
                RecoveryCode.profile_id == profile.id,
                RecoveryCode.used_at.is_(None),
                RecoveryCodeBatch.invalidated_at.is_(None),
            )
            .order_by(RecoveryCode.created_at)
            .with_for_update()
        ).all()
        for candidate in active_codes:
            if hmac.compare_digest(candidate.code_hash, supplied_hash):
                matched_code = candidate
    else:
        # No such profile — still do a dummy hash comparison so the response
        # time doesn't leak "profile exists" vs "profile doesn't exist" via
        # a timing side channel.
        hmac.compare_digest(keyed_hash("dummy-recovery-code"), supplied_hash)

    if not profile or not matched_code:
        session.rollback()
        raise ApiProblem(400, "restore_failed", GENERIC_RESTORE_ERROR)

    now = utcnow()
    # Conditional UPDATE on used_at IS NULL — if two requests race to spend
    # the same code, only one rowcount comes back as 1. Cheap way to make
    # "spend this one-time code" atomic without a separate lock.
    result = session.execute(
        update(RecoveryCode)
        .where(RecoveryCode.id == matched_code.id, RecoveryCode.used_at.is_(None))
        .values(used_at=now)
    )
    if result.rowcount != 1:
        session.rollback()
        raise ApiProblem(400, "restore_failed", GENERIC_RESTORE_ERROR)
    installation = Installation(
        profile_id=profile.id,
        token_hash=token_hash,
        created_at=now,
        last_used_at=now,
    )
    session.add(installation)
    session.flush()
    audit(
        session,
        "profile.restored",
        "installation",
        str(installation.id),
        profile.id,
        {"profileId": profile.public_id},
    )
    session.commit()
    return RestoreResponse(
        access_token=issue_access_token(profile.id, installation.id),
        profile=profile_response(profile),
        installation_id=str(installation.id),
    )


# Called from the account settings screen when the user edits their display name.
@router.patch("/me", response_model=ProfileResponse)
def update_profile(
    body: UpdateProfileRequest,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> ProfileResponse:
    auth.profile.display_name = body.display_name
    audit(session, "profile.updated", "profile", auth.profile.public_id, auth.profile.id)
    session.commit()
    return profile_response(auth.profile)


# User confirms they've actually saved their recovery codes somewhere — flips
# a flag so we stop nagging them on every app open (see recovery_setup_required
# on the bootstrap response).
@router.post("/me/recovery-setup/acknowledge", status_code=204)
def acknowledge_recovery_setup(
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> Response:
    auth.profile.recovery_setup_acknowledged = True
    audit(
        session,
        "recovery_setup.acknowledged",
        "profile",
        auth.profile.public_id,
        auth.profile.id,
    )
    session.commit()
    return Response(status_code=204)


# Burns any unused codes from previous batches and issues 10 new ones — for
# when a user suspects their old codes leaked, or just wants a clean set.
@router.post("/me/recovery-codes/rotate", response_model=RecoveryBatchResponse)
def rotate_recovery_codes(
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> RecoveryBatchResponse:
    rate_limiter.check("recovery_rotate", str(auth.profile.id))
    now = utcnow()
    # Invalidate the whole previous batch rather than deleting rows, so old
    # codes fail cleanly instead of just disappearing from the table.
    session.execute(
        update(RecoveryCodeBatch)
        .where(
            RecoveryCodeBatch.profile_id == auth.profile.id,
            RecoveryCodeBatch.invalidated_at.is_(None),
        )
        .values(invalidated_at=now)
    )
    codes, created_at = create_recovery_batch(session, auth.profile.id)
    audit(
        session,
        "recovery_codes.rotated",
        "profile",
        auth.profile.public_id,
        auth.profile.id,
    )
    session.commit()
    return RecoveryBatchResponse(recovery_codes=codes, created_at=created_at)


# Powers the "devices & recovery" section of account settings — how many
# unused recovery codes are left and which installations (devices) are
# currently linked to this profile.
@router.get("/me/access", response_model=AccessOverviewResponse)
def access_overview(
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> AccessOverviewResponse:
    unused = (
        session.scalar(
            select(func.count(RecoveryCode.id))
            .join(RecoveryCodeBatch, RecoveryCodeBatch.id == RecoveryCode.batch_id)
            .where(
                RecoveryCode.profile_id == auth.profile.id,
                RecoveryCode.used_at.is_(None),
                RecoveryCodeBatch.invalidated_at.is_(None),
            )
        )
        or 0
    )
    installations = session.scalars(
        select(Installation)
        .where(Installation.profile_id == auth.profile.id)
        .order_by(Installation.created_at.desc())
    ).all()
    return AccessOverviewResponse(
        profile_id=auth.profile.public_id,
        unused_recovery_code_count=unused,
        installations=[
            InstallationResponse(
                id=str(item.id),
                created_at=item.created_at,
                last_used_at=item.last_used_at,
                revoked_at=item.revoked_at,
                current=item.id == auth.installation.id,
            )
            for item in installations
        ],
    )


# Lets a user kick a lost/old device off their profile from the device list.
@router.post("/me/installations/{installation_id}/revoke", status_code=204)
def revoke_installation(
    installation_id: uuid.UUID,
    auth: AuthContext = Depends(require_auth),
    session: Session = Depends(get_session),
) -> Response:
    rate_limiter.check("installation_revoke", str(auth.profile.id))
    # Can't revoke the device you're currently using — that'd lock you out
    # mid-request with no way back in.
    if installation_id == auth.installation.id:
        raise ApiProblem(
            400, "current_installation", "The current installation cannot revoke itself."
        )
    installation = session.scalar(
        select(Installation)
        .where(
            Installation.id == installation_id,
            Installation.profile_id == auth.profile.id,
            Installation.revoked_at.is_(None),
        )
        .with_for_update()
    )
    if not installation:
        raise ApiProblem(404, "installation_not_found", "Installation not found.")
    installation.revoked_at = datetime.now(UTC)
    audit(
        session,
        "installation.revoked",
        "installation",
        str(installation.id),
        auth.profile.id,
    )
    session.commit()
    return Response(status_code=204)
