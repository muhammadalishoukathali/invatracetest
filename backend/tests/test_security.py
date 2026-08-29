from __future__ import annotations

import re
import uuid

import jwt

from app.config import Settings, get_settings
from app.core.security import issue_access_token, keyed_hash, random_grouped_secret


def test_recovery_secret_uses_unambiguous_grouped_alphabet() -> None:
    secret = random_grouped_secret()
    assert re.fullmatch(r"[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){5}-[A-HJ-NP-Z2-9]{2}", secret)


def test_keyed_hash_is_stable_and_key_separated() -> None:
    first = Settings(credential_hash_key="first-key")
    second = Settings(credential_hash_key="second-key")
    assert keyed_hash("same-secret", first) == keyed_hash("same-secret", first)
    assert keyed_hash("same-secret", first) != keyed_hash("same-secret", second)
    assert b"same-secret" not in keyed_hash("same-secret", first)


def test_access_token_is_short_lived_and_bound_to_installation(monkeypatch) -> None:
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
    get_settings.cache_clear()
