"""Tests for app/core/security.py - recovery codes, keyed hashing, JWTs.

Covers the bits that back the pseudonymous auth model: recovery secrets
you can actually read out to a user, HMAC-style hashing so we never store
a raw credential, and short-lived JWTs bound to a specific installation.
"""

from __future__ import annotations

import re
import uuid

import jwt

from app.config import Settings, get_settings
from app.core.security import issue_access_token, keyed_hash, random_grouped_secret


def test_recovery_secret_uses_unambiguous_grouped_alphabet() -> None:
    # recovery codes get read aloud / copied by hand, so the alphabet
    # deliberately drops lookalikes (no 0/O, 1/I/L) and groups into
    # 4-char chunks. This just checks the shape matches what users are
    # actually shown, not the underlying randomness.
    secret = random_grouped_secret()
    assert re.fullmatch(r"[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){5}-[A-HJ-NP-Z2-9]{2}", secret)


def test_keyed_hash_is_stable_and_key_separated() -> None:
    # same input + same key must always hash the same way (so we can look
    # up a stored credential later), but different keys must produce
    # different hashes - otherwise rotating the hash key wouldn't actually
    # invalidate anything. Also checking the raw secret never ends up
    # sitting in the hash output itself.
    first = Settings(credential_hash_key="first-key")
    second = Settings(credential_hash_key="second-key")
    assert keyed_hash("same-secret", first) == keyed_hash("same-secret", first)
    assert keyed_hash("same-secret", first) != keyed_hash("same-secret", second)
    assert b"same-secret" not in keyed_hash("same-secret", first)


def test_access_token_is_short_lived_and_bound_to_installation(monkeypatch) -> None:
    # the token has to carry both the profile and the specific installation
    # it was issued for (the "ins" claim) - that's what lets us revoke one
    # device without logging out every device on the same profile. Also
    # pinning the TTL so a config change to ACCESS_TOKEN_TTL_MINUTES is
    # reflected in the actual token expiry, not just read and ignored.
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-with-enough-entropy")
    monkeypatch.setenv("ACCESS_TOKEN_TTL_MINUTES", "15")
    get_settings.cache_clear()
    profile_id = uuid.uuid4()
    installation_id = uuid.uuid4()
    token = issue_access_token(profile_id, installation_id)
    payload = jwt.decode(
        token,
        get_settings().jwt_secret,
        algorithms=["HS256"],
        issuer="invatrace-api",
        audience="invatrace-pwa",
    )
    assert payload["sub"] == str(profile_id)
    assert payload["ins"] == str(installation_id)
    assert 14 * 60 <= payload["exp"] - payload["iat"] <= 15 * 60
    # clear the settings cache again so this monkeypatched JWT_SECRET
    # doesn't leak into whatever test runs next.
    get_settings.cache_clear()
