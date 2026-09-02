"""Redis-backed rate limiting, one fixed window per (scope, identity) pair.

Fairly blunt fixed-window counters rather than a sliding log — good enough
for our traffic and much cheaper to reason about. The important behavioural
detail is fail_closed: in production, if Redis is down we reject requests
rather than let them through unlimited (see RateLimiter.check below).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from fastapi import Request
from redis import Redis
from redis.exceptions import RedisError

from app.config import get_settings
from app.core.errors import ApiProblem


@dataclass(frozen=True)
class Limit:
    requests: int
    window_seconds: int


# one entry per rate-limited scope in the app — request counts and windows
# were picked to make abuse expensive without getting in the way of a normal
# volunteer submitting a handful of sightings on a walk
LIMITS = {
    "profile_start": Limit(10, 60),
    "profile_bootstrap": Limit(30, 60),
    "profile_restore": Limit(5, 15 * 60),
    "profile_restore_ip": Limit(5, 15 * 60),
    "recovery_rotate": Limit(5, 60 * 60),
    "installation_revoke": Limit(20, 60 * 60),
    "upload_presign": Limit(30, 60),
    "report_create_burst": Limit(10, 10 * 60),
    "report_create_ip_burst": Limit(30, 10 * 60),
    "report_create_daily": Limit(50, 24 * 60 * 60),
    "sightings_read": Limit(120, 60),
}


def client_address(request: Request) -> str:
    # best-effort IP for the *_ip scoped limits — falls back to "unknown" rather
    # than raising, since we'd rather rate-limit a weird proxy setup too
    # aggressively than crash the request over it
    return request.client.host if request.client else "unknown"


class RateLimiter:
    def __init__(self) -> None:
        settings = get_settings()
        self.enabled = settings.rate_limit_enabled
        # only production fails closed — local/staging shouldn't grind to a
        # halt just because someone's Redis container isn't running
        self.fail_closed = settings.app_env == "production"
        self.redis = Redis.from_url(settings.redis_url, decode_responses=True)

    @staticmethod
    def _safe_key(value: str) -> str:
        # identity (profile id, IP, whatever) gets hashed before it goes into the
        # Redis key so raw IPs/ids aren't sitting around in a keyspace someone
        # might dump for debugging
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def check(self, scope: str, identity: str) -> None:
        """Raise ApiProblem(429) if this scope+identity is over its limit for the
        current window, otherwise just increment the counter and return.
        """
        if not self.enabled:
            return
        limit = LIMITS[scope]
        key = f"invatrace:limit:{scope}:{self._safe_key(identity)}"
        try:
            # INCR+TTL in one pipeline so we're not making two round trips, and
            # transaction=True keeps them atomic against a concurrent request
            pipeline = self.redis.pipeline(transaction=True)
            pipeline.incr(key)
            pipeline.ttl(key)
            count, ttl = pipeline.execute()
            if ttl < 0:
                # key was just created by the INCR above and has no expiry yet —
                # this is the first request in a fresh window, so start the clock
                self.redis.expire(key, limit.window_seconds)
                ttl = limit.window_seconds
        except RedisError as error:
            # production: no Redis means no ability to enforce limits, and letting
            # traffic through unmetered is worse than a degraded response — fail
            # closed. Non-prod: don't let a dev's local Redis outage block them.
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

    def ping(self) -> bool:
        # used by the health check endpoint, not by request handling itself
        if not self.enabled:
            return True
        try:
            return bool(self.redis.ping())
        except RedisError:
            return False


rate_limiter = RateLimiter()
