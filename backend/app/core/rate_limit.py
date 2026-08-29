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


LIMITS = {
    "profile_start": Limit(10, 60),
    "profile_bootstrap": Limit(30, 60),
    "profile_restore": Limit(5, 15 * 60),
    "recovery_rotate": Limit(5, 60 * 60),
    "installation_revoke": Limit(20, 60 * 60),
    "upload_presign": Limit(30, 60),
    "report_create": Limit(30, 60),
    "sightings_read": Limit(120, 60),
}


def client_address(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class RateLimiter:
    def __init__(self) -> None:
        settings = get_settings()
        self.enabled = settings.rate_limit_enabled
        self.fail_closed = settings.app_env == "production"
        self.redis = Redis.from_url(settings.redis_url, decode_responses=True)

    @staticmethod
    def _safe_key(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def check(self, scope: str, identity: str) -> None:
        if not self.enabled:
            return
        limit = LIMITS[scope]
        key = f"invatrace:limit:{scope}:{self._safe_key(identity)}"
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

    def ping(self) -> bool:
        if not self.enabled:
            return True
        try:
            return bool(self.redis.ping())
        except RedisError:
            return False


rate_limiter = RateLimiter()
