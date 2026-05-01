from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock
from time import time
from typing import Any


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    window_seconds: int
    max_requests: int


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    rule_name: str | None = None
    limit: int | None = None
    remaining: int | None = None
    retry_after_seconds: int | None = None


class RateLimitExceeded(Exception):
    def __init__(self, result: RateLimitResult):
        self.result = result
        message = "Rate limit exceeded"
        if result.rule_name:
            message = f"Rate limit exceeded for {result.rule_name}"
        super().__init__(message)


def _env_truthy(name: str, default: str = "true") -> bool:
    from os import getenv

    val = str(getenv(name, default) or "").strip().lower()
    return val in ("1", "true", "yes", "y", "on")


def _env_int(name: str, default: int) -> int:
    from os import getenv

    raw = str(getenv(name, str(default)) or "").strip()
    try:
        return max(1, int(raw))
    except Exception:
        return default


def _normalize_path(path: str) -> str:
    value = str(path or "").strip().lower()
    if not value:
        return "/"
    return value if value.startswith("/") else f"/{value}"


def _client_identifier(request: Any) -> str:
    forwarded = str(getattr(request, "headers", {}).get("x-forwarded-for") or "").strip()
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first

    forwarded_alt = str(getattr(request, "headers", {}).get("x-real-ip") or "").strip()
    if forwarded_alt:
        return forwarded_alt

    client = getattr(request, "client", None)
    host = str(getattr(client, "host", "") or "").strip()
    return host or "unknown"


class InMemoryRateLimiter:
    def __init__(self, *, rules: dict[str, RateLimitRule], enabled: bool = True):
        self._rules = dict(rules)
        self._enabled = enabled
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _rule_for(self, path: str, method: str) -> RateLimitRule | None:
        if not self._enabled:
            return None

        normalized_path = _normalize_path(path)
        normalized_method = str(method or "GET").upper()

        exempt_prefixes = (
            "/health",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/favicon.ico",
            "/_next/",
            "/static/",
            "/uploads/",
        )
        if normalized_path.startswith(exempt_prefixes):
            return None

        auth_public_paths = {
            "/auth/login",
            "/auth/login/mfa/verify",
            "/auth/register",
            "/auth/register/verify",
            "/auth/register/resend-verification",
            "/auth/forgot-password",
        }
        if normalized_path in auth_public_paths:
            return self._rules.get("auth_public")

        if normalized_path.startswith("/auth/"):
            if normalized_method in {"POST", "PUT", "PATCH", "DELETE"}:
                return self._rules.get("auth_mutation")
            return self._rules.get("auth_read")

        if normalized_method in {"POST", "PUT", "PATCH", "DELETE"}:
            return self._rules.get("write")

        if normalized_method in {"GET", "HEAD"}:
            return self._rules.get("read")

        return None

    def check(self, request: Any, *, now: float | None = None) -> RateLimitResult:
        rule = self._rule_for(getattr(getattr(request, "url", None), "path", ""), getattr(request, "method", "GET"))
        if rule is None:
            return RateLimitResult(allowed=True)

        current = time() if now is None else float(now)
        key = f"{rule.name}:{_client_identifier(request)}"
        window_start = current - float(rule.window_seconds)

        with self._lock:
            bucket = self._events[key]
            while bucket and bucket[0] <= window_start:
                bucket.popleft()
            if len(bucket) >= rule.max_requests:
                retry_after = max(1, int(rule.window_seconds - (current - bucket[0]))) if bucket else rule.window_seconds
                return RateLimitResult(
                    allowed=False,
                    rule_name=rule.name,
                    limit=rule.max_requests,
                    remaining=0,
                    retry_after_seconds=retry_after,
                )
            bucket.append(current)
            return RateLimitResult(
                allowed=True,
                rule_name=rule.name,
                limit=rule.max_requests,
                remaining=max(0, rule.max_requests - len(bucket)),
                retry_after_seconds=None,
            )


def build_default_rate_limiter() -> InMemoryRateLimiter:
    enabled = _env_truthy("RATE_LIMIT_ENABLED", "true")
    return InMemoryRateLimiter(
        enabled=enabled,
        rules={
            "auth_public": RateLimitRule(
                "auth_public",
                _env_int("RATE_LIMIT_AUTH_PUBLIC_WINDOW_SECONDS", 60),
                _env_int("RATE_LIMIT_AUTH_PUBLIC_MAX_REQUESTS", 10),
            ),
            "auth_mutation": RateLimitRule(
                "auth_mutation",
                _env_int("RATE_LIMIT_AUTH_MUTATION_WINDOW_SECONDS", 60),
                _env_int("RATE_LIMIT_AUTH_MUTATION_MAX_REQUESTS", 30),
            ),
            "auth_read": RateLimitRule(
                "auth_read",
                _env_int("RATE_LIMIT_AUTH_READ_WINDOW_SECONDS", 60),
                _env_int("RATE_LIMIT_AUTH_READ_MAX_REQUESTS", 60),
            ),
            "write": RateLimitRule(
                "write",
                _env_int("RATE_LIMIT_WRITE_WINDOW_SECONDS", 60),
                _env_int("RATE_LIMIT_WRITE_MAX_REQUESTS", 240),
            ),
            "read": RateLimitRule(
                "read",
                _env_int("RATE_LIMIT_READ_WINDOW_SECONDS", 60),
                _env_int("RATE_LIMIT_READ_MAX_REQUESTS", 1200),
            ),
        },
    )
