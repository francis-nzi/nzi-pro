from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.auth_routes as auth_routes
import api.auth as auth_module
from fastapi import HTTPException
import pytest


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _AuthConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisation_memberships" in sql:
            return _FakeRow("Admin", True, True)
        if "FROM organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", False)
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeUrl:
    def __init__(self, path: str):
        self.path = path


class _FakeRequest:
    def __init__(self, path: str = "/auth/me", method: str = "GET"):
        self.url = _FakeUrl(path)
        self.method = method


def test_current_user_requires_bearer_token_when_jwt_enabled(monkeypatch):
    monkeypatch.setenv("NZI_JWT_SECRET", "test-secret")
    request = _FakeRequest()

    with pytest.raises(HTTPException, match="Missing bearer token"):
        auth_routes._current_user(
            request,
            authorization=None,
            x_user="legacy@example.com",
            x_user_email="legacy@example.com",
        )


def test_current_user_accepts_bearer_token_and_sets_org_context(monkeypatch):
    monkeypatch.setenv("NZI_JWT_SECRET", "test-secret")

    token = auth_routes.jwt.encode({"sub": "u1"}, "test-secret", algorithm="HS256")
    request = _FakeRequest()
    seen_context: list[str | None] = []

    monkeypatch.setattr(
        auth_module,
        "_active_user_from_identifier",
        lambda ident: {"user_id": ident, "email": "owner@example.com", "org_id": "org-123", "must_change_password": False, "mfa_enabled": False},
    )
    monkeypatch.setattr(auth_module, "attach_org_id", lambda user: user)
    monkeypatch.setattr(auth_module, "enrich_user_permissions", lambda user: user)
    monkeypatch.setattr(auth_module, "set_current_org_context", lambda org_id: seen_context.append(org_id))

    result = auth_routes._current_user(request, authorization=f"Bearer {token}")

    assert result["user_id"] == "u1"
    assert result["org_id"] == "org-123"
    assert seen_context == ["org-123"]


def test_me_includes_current_org_summary(monkeypatch):
    fake = _AuthConn()
    monkeypatch.setattr(auth_routes, "get_conn", lambda: fake)

    result = auth_routes.me(user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"})

    assert result["current_org"]["org_id"] == "org-123"
    assert result["current_org"]["name"] == "Acme Org"
    assert result["current_org"]["slug"] == "acme-org"
    assert result["current_org"]["role"] == "Admin"
    assert any("FROM organisations" in sql for sql, _ in fake.executed)


def test_issue_login_result_uses_24_hour_expiry(monkeypatch):
    captured: dict[str, object] = {}

    monkeypatch.setattr(auth_routes, "_jwt_secret", lambda: "secret")
    monkeypatch.setattr(auth_routes, "_must_accept_portal_terms", lambda _user: False)
    monkeypatch.setattr(auth_routes.jwt, "encode", lambda payload, secret, algorithm: captured.update({"payload": payload, "secret": secret, "algorithm": algorithm}) or "token")

    result = auth_routes._issue_login_result({"user_id": "u1", "full_name": "User", "email": "user@example.com"})

    assert result["access_token"] == "token"
    assert captured["secret"] == "secret"
    assert captured["algorithm"] == "HS256"
    assert int(captured["payload"]["exp"]) - int(captured["payload"]["iat"]) == 24 * 60 * 60
