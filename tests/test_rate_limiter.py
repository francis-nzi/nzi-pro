from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.rate_limiter import InMemoryRateLimiter, RateLimitRule


class _FakeUrl:
    def __init__(self, path: str):
        self.path = path


class _FakeClient:
    def __init__(self, host: str):
        self.host = host


class _FakeRequest:
    def __init__(self, path: str, method: str = "GET", host: str = "127.0.0.1", headers: dict[str, str] | None = None):
        self.url = _FakeUrl(path)
        self.method = method
        self.client = _FakeClient(host)
        self.headers = headers or {}


def test_rate_limiter_blocks_public_auth_after_limit():
    limiter = InMemoryRateLimiter(
        enabled=True,
        rules={
            "auth_public": RateLimitRule("auth_public", 60, 2),
            "auth_mutation": RateLimitRule("auth_mutation", 60, 5),
            "auth_read": RateLimitRule("auth_read", 60, 5),
            "write": RateLimitRule("write", 60, 5),
            "read": RateLimitRule("read", 60, 5),
        },
    )

    req = _FakeRequest("/auth/login", method="POST", host="1.2.3.4")
    first = limiter.check(req, now=100.0)
    second = limiter.check(req, now=101.0)
    third = limiter.check(req, now=102.0)

    assert first.allowed is True
    assert second.allowed is True
    assert third.allowed is False
    assert third.rule_name == "auth_public"
    assert third.retry_after_seconds is not None


def test_rate_limiter_exempts_health_checks():
    limiter = InMemoryRateLimiter(
        enabled=True,
        rules={
            "auth_public": RateLimitRule("auth_public", 60, 1),
            "auth_mutation": RateLimitRule("auth_mutation", 60, 1),
            "auth_read": RateLimitRule("auth_read", 60, 1),
            "write": RateLimitRule("write", 60, 1),
            "read": RateLimitRule("read", 60, 1),
        },
    )

    result = limiter.check(_FakeRequest("/health", method="GET"), now=100.0)

    assert result.allowed is True
    assert result.rule_name is None
