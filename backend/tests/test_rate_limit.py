from __future__ import annotations

import pytest
from redis.exceptions import RedisError

from app.core.errors import ApiProblem
from app.core.rate_limit import LIMITS, RateLimiter


class BrokenRedis:
    def pipeline(self, *, transaction: bool):
        assert transaction is True
        raise RedisError("unavailable")


def test_report_limits_cover_burst_and_daily_flooding() -> None:
    assert LIMITS["report_create_burst"].requests == 10
    assert LIMITS["report_create_burst"].window_seconds == 10 * 60
    assert LIMITS["report_create_daily"].requests == 50
    assert LIMITS["report_create_daily"].window_seconds == 24 * 60 * 60


def test_production_rate_limit_dependency_fails_closed() -> None:
    limiter = RateLimiter.__new__(RateLimiter)
    limiter.enabled = True
    limiter.fail_closed = True
    limiter.redis = BrokenRedis()

    with pytest.raises(ApiProblem) as raised:
        limiter.check("report_create_burst", "profile-id")

    assert raised.value.status_code == 503
    assert raised.value.code == "rate_limit_unavailable"
