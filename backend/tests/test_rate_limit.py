"""Tests for app/core/rate_limit.py.

Two things matter here: the configured limits themselves (burst + daily
caps on report creation), and the fail-closed behaviour when Redis is
down. Fail-closed is the important one from a security standpoint - if
Redis is unreachable we'd rather reject requests than let rate limiting
silently stop working.
"""

from __future__ import annotations

import pytest
from redis.exceptions import RedisError

from app.core.errors import ApiProblem
from app.core.rate_limit import LIMITS, RateLimiter


# Redis client stand-in that always blows up, so we can exercise the
# "Redis is unreachable" path without actually taking Redis down.
class BrokenRedis:
    def pipeline(self, *, transaction: bool):
        assert transaction is True
        raise RedisError("unavailable")


def test_report_limits_cover_burst_and_daily_flooding() -> None:
    # pins the actual numbers down so a config change here is a deliberate
    # decision, not an accidental edit that quietly loosens the limits.
    assert LIMITS["report_create_burst"].requests == 10
    assert LIMITS["report_create_burst"].window_seconds == 10 * 60
    assert LIMITS["report_create_daily"].requests == 50
    assert LIMITS["report_create_daily"].window_seconds == 24 * 60 * 60


def test_production_rate_limit_dependency_fails_closed() -> None:
    # if Redis errors out mid-check, we want a 503 telling the client to
    # back off - NOT the request silently sailing through unlimited.
    # Building the limiter with __new__ here so we can hand it a broken
    # Redis client directly, without going through real construction/config.
    limiter = RateLimiter.__new__(RateLimiter)
    limiter.enabled = True
    limiter.fail_closed = True
    limiter.redis = BrokenRedis()

    with pytest.raises(ApiProblem) as raised:
        limiter.check("report_create_burst", "profile-id")

    assert raised.value.status_code == 503
    assert raised.value.code == "rate_limit_unavailable"
