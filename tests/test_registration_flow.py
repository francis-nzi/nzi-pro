from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
import pytest

import api.auth_routes as auth_routes


class _Result:
    def __init__(self, row=None):
        self._row = row

    def fetchone(self):
        return self._row


class _RegistrationConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []
        self.orgs: dict[str, dict[str, object]] = {}
        self.users: dict[str, dict[str, object]] = {}
        self.memberships: dict[tuple[str, str], dict[str, object]] = {}
        self.entitlements: dict[str, dict[str, object]] = {}
        self.tokens: dict[str, dict[str, object]] = {}
        self._org_counter = 1

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def _new_org_id(self) -> str:
        org_id = f"org-{self._org_counter}"
        self._org_counter += 1
        return org_id

    def _lookup_user(self, identifier: str) -> dict[str, object] | None:
        ident = str(identifier or "").strip().lower()
        if not ident:
            return None
        for user in self.users.values():
            if str(user.get("email") or "").strip().lower() == ident or str(user.get("user_id") or "").strip().lower() == ident:
                return user
        return None

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        sql_norm = " ".join(str(sql).lower().split())
        params = params or []

        if "select 1 from organisations where lower(slug) = lower(?)" in sql_norm:
            slug = str(params[0] or "").strip().lower()
            exists = any(str(org.get("slug") or "").strip().lower() == slug for org in self.orgs.values())
            return _Result((1,) if exists else None)

        if "insert into organisations" in sql_norm:
            if not params:
                if "nzi internal" in sql_norm:
                    org_id = "internal-org"
                    self.orgs[org_id] = {
                        "org_id": org_id,
                        "name": "NZI Internal",
                        "slug": "nzi-internal",
                        "plan": "trial",
                        "plan_status": "active",
                        "trial_ends_at": None,
                    }
                return _Result(None)
            if "returning org_id" not in sql_norm:
                return _Result(None)
            org_id = self._new_org_id()
            name, slug = str(params[0] or ""), str(params[1] or "")
            self.orgs[org_id] = {
                "org_id": org_id,
                "name": name,
                "slug": slug,
                "plan": "trial",
                "plan_status": "trial",
                "trial_ends_at": params[2],
            }
            return _Result((org_id,))

        if "insert into organisation_entitlements" in sql_norm:
            if not params:
                return _Result(None)
            org_id = str(params[0] or "").strip()
            self.entitlements[org_id] = {
                "org_id": org_id,
                "trial_ends_at": params[1],
            }
            return _Result(None)

        if "select user_id, full_name, role, email, status" in sql_norm and "from users" in sql_norm:
            user = self._lookup_user(params[0]) or self._lookup_user(params[1])
            if not user:
                return _Result(None)
            return _Result(
                (
                    user["user_id"],
                    user["full_name"],
                    user["role"],
                    user["email"],
                    user["status"],
                    user.get("must_change_password", False),
                    user.get("org_id"),
                )
            )

        if "insert into users" in sql_norm:
            user_id, full_name, role, email, _ph, must_change_password, status, org_id = params
            self.users[str(user_id).strip().lower()] = {
                "user_id": str(user_id).strip(),
                "full_name": str(full_name or "").strip(),
                "role": str(role or "").strip(),
                "email": str(email or "").strip(),
                "status": str(status or "Active"),
                "must_change_password": bool(must_change_password),
                "org_id": str(org_id or "").strip() or None,
                "email_verified_at": None,
                "email_verification_sent_at": None,
                "registration_status": None,
            }
            return _Result(None)

        if "update users set email_verified_at = null" in sql_norm:
            ts, email, user_id = params
            user = self._lookup_user(email) or self._lookup_user(user_id)
            if user:
                user["email_verified_at"] = None
                user["email_verification_sent_at"] = ts
                user["registration_status"] = "pending"
            return _Result(None)

        if "insert into organisation_memberships" in sql_norm:
            if not params:
                return _Result(None)
            org_id, user_id = str(params[0]).strip(), str(params[1]).strip().lower()
            self.memberships[(org_id, user_id)] = {
                "org_id": org_id,
                "user_id": user_id,
                "role": "Owner",
                "is_active": True,
                "is_owner": True,
            }
            return _Result(None)

        if "insert into registration_verification_tokens" in sql_norm:
            org_id, user_id, email, token_hash, expires_at = params
            self.tokens[str(token_hash).strip()] = {
                "verification_id": f"v-{len(self.tokens) + 1}",
                "org_id": str(org_id).strip(),
                "user_id": str(user_id).strip(),
                "email": str(email).strip(),
                "token_hash": str(token_hash).strip(),
                "expires_at": expires_at,
                "consumed_at": None,
            }
            return _Result(None)

        if "select verification_id, org_id, user_id, email, token_hash, expires_at, consumed_at" in sql_norm:
            token_hash = str(params[0]).strip()
            token = self.tokens.get(token_hash)
            if not token:
                return _Result(None)
            return _Result(
                (
                    token["verification_id"],
                    token["org_id"],
                    token["user_id"],
                    token["email"],
                    token["token_hash"],
                    token["expires_at"],
                    token["consumed_at"],
                )
            )

        if "update registration_verification_tokens" in sql_norm:
            ts, user_id, email = params
            ident = str(user_id or email or "").strip().lower()
            for token in self.tokens.values():
                if (str(token["user_id"]).strip().lower() == ident or str(token["email"]).strip().lower() == ident) and token["consumed_at"] is None:
                    token["consumed_at"] = ts
            return _Result(None)

        if "select name from organisations where org_id = ?" in sql_norm:
            org_id = str(params[0]).strip()
            org = self.orgs.get(org_id)
            return _Result((org["name"],) if org else None)

        if "update users set status = 'active'" in sql_norm:
            ts, org_id, email, user_id = params
            user = self._lookup_user(email) or self._lookup_user(user_id)
            if user:
                user["status"] = "Active"
                user["email_verified_at"] = ts
                user["registration_status"] = "verified"
                user["must_change_password"] = False
                user["org_id"] = str(org_id or user.get("org_id") or "").strip() or None
            return _Result(None)

        if "update organisation_memberships" in sql_norm:
            user_id, org_id = str(params[0]).strip().lower(), str(params[1]).strip()
            membership = self.memberships.get((org_id, user_id))
            if membership:
                membership["is_active"] = True
                membership["is_owner"] = True
            return _Result(None)

        return _Result(None)


def test_register_creates_pending_org_user_and_verification_token(monkeypatch):
    conn = _RegistrationConn()
    sent_payload: dict[str, object] = {}

    monkeypatch.setattr(auth_routes, "get_conn", lambda autocommit=True: conn)
    monkeypatch.setattr(
        auth_routes,
        "_send_registration_verification_email",
        lambda **kwargs: sent_payload.update(kwargs) or {"status": "sent"},
    )

    result = auth_routes.register(
        {
            "full_name": "Jane Smith",
            "org_name": "Acme Carbon",
            "email": "jane@example.com",
            "password": "super-secret-password",
        }
    )

    assert result["ok"] is True
    assert result["verification_required"] is True
    assert result["email_status"] == "sent"
    assert result["trial_ends_at"] is not None
    created_org_id = str(result["org_id"])
    user = conn.users["jane@example.com"]
    assert user["status"] == "Pending"
    assert user["registration_status"] == "pending"
    assert user["org_id"] == created_org_id
    org = conn.orgs[created_org_id]
    assert org["plan"] == "trial"
    assert org["plan_status"] == "trial"
    membership = conn.memberships[(created_org_id, "jane@example.com")]
    assert membership["is_owner"] is True
    assert membership["is_active"] is True
    assert len(conn.tokens) == 1
    token = next(iter(conn.tokens.values()))
    assert token["consumed_at"] is None
    assert "register/verify?token=" in str(sent_payload["verification_url"])


def test_verify_registration_consumes_token_and_activates_user(monkeypatch):
    conn = _RegistrationConn()
    monkeypatch.setattr(auth_routes, "get_conn", lambda autocommit=True: conn)
    monkeypatch.setattr(auth_routes.secrets, "token_urlsafe", lambda _n: "registration-token")
    monkeypatch.setattr(
        auth_routes,
        "_send_registration_verification_email",
        lambda **kwargs: {"status": "sent"},
    )

    auth_routes.register(
        {
            "full_name": "Jane Smith",
            "org_name": "Acme Carbon",
            "email": "jane@example.com",
            "password": "super-secret-password",
        }
    )
    plain_token = "registration-token"

    result = auth_routes.verify_registration({"token": plain_token})

    assert result["ok"] is True
    assert result["verified"] is True
    user = conn.users["jane@example.com"]
    assert user["status"] == "Active"
    assert user["email_verified_at"] is not None
    token_row = next(iter(conn.tokens.values()))
    assert token_row["consumed_at"] is not None

    with pytest.raises(HTTPException, match="already been used"):
        auth_routes.verify_registration({"token": plain_token})
