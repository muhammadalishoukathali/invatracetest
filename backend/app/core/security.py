"""Pseudonymous auth: installation tokens, recovery codes, and JWT sessions.

InvaTrace has no email/password. A "profile" is created on first launch and
identified by an opaque public id (IVT-XXXX-...); the app itself holds an
installation token that proves it's talking to that profile, and recovery
codes let someone re-link a profile on a new device if they lose the
installation token. Nothing here is stored in plaintext — see keyed_hash.
This module is what app/api/routers/* depend on for require_auth/require_admin.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.errors import ApiProblem
from app.db.base import get_session
from app.db.models import Installation, Profile

# no 0/1/I/O/L etc, so a human reading a recovery code out loud (or typing it
# back in) doesn't hit an ambiguous character
BASE32_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
bearer = HTTPBearer(auto_error=False)


def utcnow() -> datetime:
    return datetime.now(UTC)


def keyed_hash(secret: str, settings: Settings | None = None) -> bytes:
    """HMAC installation tokens / recovery codes before they touch the DB.

    We only ever need to check "does this secret match", never read the
    secret back out, so there's no reason to store it any way other than
    hashed. Keyed (vs plain SHA-256) so a DB leak alone isn't enough to brute
    force the tokens without also having credential_hash_key.
    """
    active = settings or get_settings()
    return hmac.new(
        active.credential_hash_key.encode("utf-8"), secret.encode("utf-8"), hashlib.sha256
    ).digest()


def random_grouped_secret(byte_count: int = 16) -> str:
    """Generate a random secret, base32-encoded and chunked into groups of 4
    with dashes, for installation tokens and recovery codes. Grouping is
    purely cosmetic — makes it easier to read/copy by eye — the entropy comes
    entirely from secrets.token_bytes.
    """
    raw = secrets.token_bytes(byte_count)
    bits = 0
    value = 0
    output = ""
    for byte in raw:
        value = (value << 8) | byte
        bits += 8
        while bits >= 5:
            output += BASE32_ALPHABET[(value >> (bits - 5)) & 31]
            bits -= 5
    if bits:
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
    return "-".join(output[index : index + 4] for index in range(0, len(output), 4))


def new_profile_public_id() -> str:
    return f"IVT-{random_grouped_secret(12)}"


def issue_access_token(profile_id: uuid.UUID, installation_id: uuid.UUID) -> str:
    """Short-lived JWT the PWA attaches as a bearer token on every request.

    Binds both the profile and the specific installation, so revoking one
    installation (see Installation.revoked_at) invalidates just that
    device's tokens without touching the profile's other installations.
    """
    settings = get_settings()
    now = utcnow()
    payload = {
        "sub": str(profile_id),
        "ins": str(installation_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_ttl_minutes),
        "iss": "invatrace-api",
        "aud": "invatrace-pwa",
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@dataclass(frozen=True)
class AuthContext:
    profile: Profile
    installation: Installation


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: Session = Depends(get_session),
) -> AuthContext:
    """FastAPI dependency for any route that needs an authenticated profile.

    Decodes and validates the bearer JWT, then re-checks the installation
    against the DB rather than trusting the token's claims blindly — a
    token issued before a device was revoked would otherwise still decode
    fine right up until it expires. Every failure path collapses to a
    generic 401 (no "wrong password" vs "unknown user" distinction) so we
    don't hand out hints about which profiles/installations exist.
    """
    if not credentials or credentials.scheme.lower() != "bearer":
        raise ApiProblem(401, "session_unavailable", "API session unavailable")
    settings = get_settings()
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=["HS256"],
            audience="invatrace-pwa",
            issuer="invatrace-api",
        )
        profile_id = uuid.UUID(payload["sub"])
        installation_id = uuid.UUID(payload["ins"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as error:
        raise ApiProblem(401, "session_expired", "API session expired") from error

    installation = session.scalar(
        select(Installation).where(
            Installation.id == installation_id,
            Installation.profile_id == profile_id,
        )
    )
    if not installation or installation.revoked_at is not None:
        raise ApiProblem(401, "installation_revoked", "Installation unavailable")
    profile = session.get(Profile, profile_id)
    if not profile:
        raise ApiProblem(401, "session_unavailable", "API session unavailable")
    return AuthContext(profile=profile, installation=installation)


def require_admin(auth: AuthContext = Depends(require_auth)) -> AuthContext:
    """Stacks on top of require_auth for the handful of admin-only routes."""
    if auth.profile.role != "Admin":
        raise ApiProblem(403, "forbidden", "Forbidden")
    return auth
