"""Rate limiting, backed by Redis.

Two flavours depending on the scope. Most scopes use a plain fixed-window
counter (INCR + EXPIRE) because it's simple and good enough. The submission
and restore scopes use a sliding window (sorted set of timestamps) because
the ACs literally say "no more than N in the last X minutes" and fixed
windows let you sneak 2N through by hitting the boundary - I didn't want
to argue about that in the report.

The restore scope only counts *failed* attempts, so identity.py checks
first, does the work, then records failure or clears on success. Otherwise
a legit user who typos once then gets in would still be aging out a
counter they didn't deserve.

In prod, if Redis is down we fail closed with a 503. In dev we let
requests through so I can actually work without Redis running.
"""

from __future__ import annotations

import hashlib
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Literal

from fastapi import Request
from redis import Redis
from redis.exceptions import RedisError

from app.config import get_settings
from app.core.errors import ApiProblem

logger = logging.getLogger(__name__)

Algorithm = Literal["fixed", "sliding"]


@dataclass(frozen=True)
class Limit:
    requests: int
    window_seconds: int
    algorithm: Algorithm = "fixed"


def _build_limits() -> dict[str, Limit]:
    settings = get_settings()
    return {
        "profile_start": Limit(10, 60),
        "profile_bootstrap": Limit(30, 60),
        # AC 2.1.4 - sliding, counted per *failed* restore attempt only. The
        # restore router calls ``check_pre_failure`` before doing work and
        # ``record_failure`` / ``record_success`` after.
        "profile_restore": Limit(5, 15 * 60, algorithm="sliding"),
        "profile_restore_ip": Limit(5, 15 * 60, algorithm="sliding"),
        "recovery_rotate": Limit(5, 60 * 60),
        "installation_revoke": Limit(20, 60 * 60),
        "upload_presign": Limit(30, 60),
        # AC 2.3.3 - env-backed sliding submission limits.
        "report_create_burst": Limit(
            settings.report_create_burst_limit,
            settings.report_create_burst_window_seconds,
            algorithm="sliding",
        ),
        "report_create_ip_burst": Limit(
            settings.report_create_ip_burst_limit,
            settings.report_create_burst_window_seconds,
            algorithm="sliding",
        ),
        "report_create_daily": Limit(50, 24 * 60 * 60),
        # AC 4.2.4 - community removal-report caps (Epic 4). Sliding window so
        # a burst at the hour boundary can't slip 2x through a fixed reset.
        "removal_report_hour": Limit(
            settings.removal_rate_limit_per_hour,
            60 * 60,
            algorithm="sliding",
        ),
        "removal_report_day": Limit(
            settings.removal_rate_limit_per_day,
            24 * 60 * 60,
            algorithm="sliding",
        ),
        "removal_report_ip_hour": Limit(
            settings.removal_rate_limit_per_hour,
            60 * 60,
            algorithm="sliding",
        ),
        "sightings_read": Limit(120, 60),
        # AC 6.1 - per-identity adoption rate cap. Sliding so a burst at
        # the hour boundary can't push a bot past ADOPTION_MAX_PER_IDENTITY
        # before the fixed-window resets.
        "area_adopt_hour": Limit(
            settings.adoption_rate_limit_per_hour,
            60 * 60,
            algorithm="sliding",
        ),
    }


# Populated lazily so tests can override settings before the module is imported.
LIMITS: dict[str, Limit] = {}


def _limit_for(scope: str) -> Limit:
    if not LIMITS:
        LIMITS.update(_build_limits())
    return LIMITS[scope]


def reload_limits() -> None:
    """Rebuild the LIMITS map from current settings; used by tests that flip
    the report_* env vars."""
    LIMITS.clear()
    LIMITS.update(_build_limits())


def client_address(request: Request) -> str:
    # best-effort IP for the *_ip scoped limits. Real client address must
    # already have been unwrapped from X-Forwarded-For by the trusted-proxy
    # middleware in main.py - this reads Starlette's resolved client.host.
    return request.client.host if request.client else "unknown"


class RateLimiter:
    def __init__(self) -> None:
        settings = get_settings()
        self.enabled = settings.rate_limit_enabled
        self.fail_closed = settings.app_env == "production"
        self.redis = Redis.from_url(settings.redis_url, decode_responses=True)
        # Log the flag state at boot so a future prod incident where the AC
        # caps stop firing is one grep away instead of another guess-and-push
        # loop like the one that caught this the first time.
        logger.info(
            "rate_limiter.init enabled=%s fail_closed=%s app_env=%s",
            self.enabled,
            self.fail_closed,
            settings.app_env,
        )

    @staticmethod
    def _safe_key(value: str) -> str:
        # identity (profile id, IP, whatever) gets hashed before it goes into the
        # Redis key so raw IPs/ids aren't sitting around in a keyspace someone
        # might dump for debugging
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def _key(self, scope: str, identity: str) -> str:
        return f"invatrace:limit:{scope}:{self._safe_key(identity)}"

    # ---- fixed-window primitives ---------------------------------------

    def _fixed_incr(self, scope: str, identity: str, limit: Limit) -> None:
        key = self._key(scope, identity)
        try:
            pipeline = self.redis.pipeline(transaction=True)
            pipeline.incr(key)
            pipeline.ttl(key)
            count, ttl = pipeline.execute()
            if ttl < 0:
                self.redis.expire(key, limit.window_seconds)
                ttl = limit.window_seconds
        except RedisError as error:
            if self.fail_closed:
                raise ApiProblem(
                    503, "rate_limit_unavailable", "Service temporarily unavailable"
                ) from error
            return
        if int(count) > limit.requests:
            raise ApiProblem(
                429,
                "rate_limited",
                "Too many requests. Try again later.",
                headers={"Retry-After": str(max(1, int(ttl)))},
            )

    # ---- sliding-window primitives ------------------------------------

    def _sliding_count(self, scope: str, identity: str, limit: Limit) -> tuple[int, int]:
        """Return (current_count, retry_after_seconds) for the sliding key.

        The oldest surviving member's timestamp determines Retry-After: the
        client has to wait until that member ages out of the window before
        another attempt is allowed.
        """
        key = self._key(scope, identity)
        now = time.time()
        cutoff = now - limit.window_seconds
        try:
            pipeline = self.redis.pipeline(transaction=True)
            pipeline.zremrangebyscore(key, "-inf", cutoff)
            pipeline.zrange(key, 0, 0, withscores=True)
            pipeline.zcard(key)
            _, oldest, count = pipeline.execute()
        except RedisError as error:
            if self.fail_closed:
                raise ApiProblem(
                    503, "rate_limit_unavailable", "Service temporarily unavailable"
                ) from error
            return 0, 0
        retry_after = 0
        if oldest:
            _, score = oldest[0]
            retry_after = max(1, int(score + limit.window_seconds - now))
        return int(count), retry_after

    def _sliding_add(self, scope: str, identity: str, limit: Limit) -> None:
        key = self._key(scope, identity)
        now = time.time()
        member = f"{now:.6f}:{uuid.uuid4().hex}"
        try:
            pipeline = self.redis.pipeline(transaction=True)
            pipeline.zadd(key, {member: now})
            pipeline.expire(key, limit.window_seconds)
            pipeline.execute()
        except RedisError as error:
            if self.fail_closed:
                raise ApiProblem(
                    503, "rate_limit_unavailable", "Service temporarily unavailable"
                ) from error

    def _sliding_clear(self, scope: str, identity: str) -> None:
        key = self._key(scope, identity)
        try:
            self.redis.delete(key)
        except RedisError:
            # Clearing on success is best-effort; a failure just means the
            # failure counter will age out naturally.
            return

    # ---- public API ----------------------------------------------------

    def check(self, scope: str, identity: str) -> None:
        """Record an attempt against ``(scope, identity)`` and raise 429 if
        the resulting count exceeds the configured limit. This is the "count
        every request" path used by submission and read scopes.
        """
        if not self.enabled:
            # Loud on purpose — if this ever shows up in prod it means the AC
            # rate caps are silently off and testers can walk past them, which
            # is exactly the bug this warning exists to catch early.
            logger.warning("rate_limiter.skipped scope=%s reason=disabled", scope)
            return
        limit = _limit_for(scope)
        if limit.algorithm == "sliding":
            self._sliding_add(scope, identity, limit)
            count, retry_after = self._sliding_count(scope, identity, limit)
            if count > limit.requests:
                raise ApiProblem(
                    429,
                    "rate_limited",
                    "Too many requests. Try again later.",
                    headers={"Retry-After": str(max(1, retry_after))},
                )
            return
        self._fixed_incr(scope, identity, limit)

    def check_pre_failure(self, scope: str, identity: str) -> None:
        """Count-only precheck for scopes that record on failure. Raises 429
        if the identity is already over its limit from previously recorded
        failures within the current sliding window.
        """
        if not self.enabled:
            return
        limit = _limit_for(scope)
        count, retry_after = self._sliding_count(scope, identity, limit)
        if count >= limit.requests:
            raise ApiProblem(
                429,
                "rate_limited",
                "Too many attempts. Try again later.",
                headers={"Retry-After": str(max(1, retry_after))},
            )

    def record_failure(self, scope: str, identity: str) -> None:
        """Register a failed attempt in the sliding-window key so subsequent
        ``check_pre_failure`` calls see it."""
        if not self.enabled:
            return
        self._sliding_add(scope, identity, _limit_for(scope))

    def record_success(self, scope: str, identity: str) -> None:
        """Clear the sliding-window failure state after a successful attempt.
        AC 2.1.4 - a successful restore must not leave stale failure counters
        that push a genuine user toward the 429 threshold.
        """
        if not self.enabled:
            return
        self._sliding_clear(scope, identity)

    def ping(self) -> bool:
        if not self.enabled:
            return True
        try:
            return bool(self.redis.ping())
        except RedisError:
            return False


rate_limiter = RateLimiter()
