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
        if "FROM users" in sql and "COALESCE(mfa_enabled, FALSE)" in sql:
            return _FakeRow(True, "encrypted-secret", "[]")
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


def test_login_records_failed_attempt(monkeypatch):
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(auth_routes, "authenticate_user", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth_routes, "record_audit_event", lambda _con, **kwargs: calls.append(kwargs))
    monkeypatch.setattr(auth_routes, "get_conn", lambda: _AuthConn())

    with pytest.raises(HTTPException, match="Invalid credentials"):
        auth_routes.login({"identifier": "owner@example.com", "password": "bad"}, request=_FakeRequest("/auth/login", method="POST"))

    assert calls and calls[0]["action"] == "login_failed"
    assert calls[0]["metadata"]["reason"] == "invalid_credentials"


def test_login_records_success(monkeypatch):
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(auth_routes, "authenticate_user", lambda *_args, **_kwargs: {"user_id": "u1", "email": "owner@example.com", "full_name": "Owner", "role": "admin", "must_change_password": False})
    monkeypatch.setattr(auth_routes, "enrich_user_permissions", lambda user: user)
    monkeypatch.setattr(auth_routes, "_user_mfa_row", lambda _ident: None)
    monkeypatch.setattr(auth_routes, "_issue_login_result", lambda user, **_kwargs: {"user": user, "mfa_required": False})
    monkeypatch.setattr(auth_routes, "record_audit_event", lambda _con, **kwargs: calls.append(kwargs))
    monkeypatch.setattr(auth_routes, "get_conn", lambda: _AuthConn())

    result = auth_routes.login({"identifier": "owner@example.com", "password": "good"}, request=_FakeRequest("/auth/login", method="POST"))

    assert result["mfa_required"] is False
    assert any(call["action"] == "login_success" for call in calls)
    assert any(call["metadata"].get("mfa") is False for call in calls)


def test_login_mfa_verify_records_success_and_failure(monkeypatch):
    calls: list[dict[str, object]] = []

    class _FakeTotp:
        def __init__(self, *_args, **_kwargs):
            pass

        def verify(self, *_args, **_kwargs):
            return True

    monkeypatch.setattr(auth_routes, "jwt", auth_routes.jwt)
    monkeypatch.setattr(auth_routes.jwt, "decode", lambda *_args, **_kwargs: {"kind": "mfa_challenge", "sub": "u1", "email": "owner@example.com"})
    monkeypatch.setattr(auth_routes, "get_user_by_id", lambda _user_id: {"user_id": "u1", "email": "owner@example.com", "full_name": "Owner", "role": "admin", "must_change_password": False})
    monkeypatch.setattr(auth_routes, "_decrypt_secret", lambda _value: "secret")
    monkeypatch.setattr(auth_routes, "_issue_login_result", lambda user, **_kwargs: {"user": user, "mfa_required": False})
    monkeypatch.setattr(auth_routes, "record_audit_event", lambda _con, **kwargs: calls.append(kwargs))
    monkeypatch.setattr(auth_routes, "get_conn", lambda: _AuthConn())
    monkeypatch.setattr(auth_routes, "pyotp", type("_PyOtp", (), {"TOTP": _FakeTotp}))

    result = auth_routes.login_mfa_verify({"mfa_challenge_token": "challenge", "otp_code": "123456"}, request=_FakeRequest("/auth/login/mfa/verify", method="POST"))

    assert result["mfa_required"] is False
    assert any(call["action"] == "mfa_verification_success" for call in calls)
    assert any(call["action"] == "login_success" for call in calls)

    calls.clear()
    monkeypatch.setattr(auth_routes, "pyotp", type("_PyOtpFail", (), {"TOTP": type("_T", (), {"__init__": lambda self, *_a, **_k: None, "verify": lambda self, *_a, **_k: False})}))

    with pytest.raises(HTTPException, match="Invalid MFA code"):
        auth_routes.login_mfa_verify({"mfa_challenge_token": "challenge", "otp_code": "000000"}, request=_FakeRequest("/auth/login/mfa/verify", method="POST"))

    assert any(call["action"] == "mfa_verification_failed" for call in calls)


def test_logout_records_audit_event(monkeypatch):
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(auth_routes, "record_audit_event", lambda _con, **kwargs: calls.append(kwargs))
    monkeypatch.setattr(auth_routes, "get_conn", lambda: _AuthConn())

    result = auth_routes.logout(user={"user_id": "u1", "email": "owner@example.com", "mfa_enabled": True}, request=_FakeRequest("/auth/logout", method="POST"))

    assert result == {"ok": True}
    assert calls and calls[0]["action"] == "logout"
    assert calls[0]["metadata"]["mfa"] is True
