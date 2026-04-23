from __future__ import annotations

from pathlib import Path
import sys
from unittest.mock import ANY

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

import api.admin_routes as admin_routes
import services.tenancy as tenancy


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _AuditConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        if "INSERT INTO organisations" in sql:
            return self
        if "SELECT 1 FROM organisations WHERE lower(slug)" in sql:
            return self
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return self
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, created_at, updated_at FROM organisations ORDER BY" in sql:
            return self
        if "SELECT invitation_id, org_id, email, role, accepted_at, expires_at" in sql:
            return self
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisation_entitlements" in sql:
            return _FakeRow("org-123", "growth", "active", 12, 50, "2026-05-01", "cus-123", "sub-123", "active", "2026-04-01", "2026-05-01", True, "2026-04-23", "2026-04-23")
        if "FROM organisations" in sql and "archived" in sql and "LIMIT 1" in sql:
            return _FakeRow(False)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 12, 50, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT COUNT(*)" in sql and "FROM organisation_memberships" in sql:
            return _FakeRow(1)
        if "SELECT COUNT(*)" in sql and "FROM organisation_invitations" in sql:
            return _FakeRow(0)
        if "SELECT COUNT(*)" in sql and "FROM clients" in sql:
            return _FakeRow(0)
        if "FROM organisation_memberships" in sql and "COUNT(*)" in sql:
            return _FakeRow(1)
        if "FROM organisation_invitations" in sql and "COUNT(*)" in sql:
            return _FakeRow(0)
        if "FROM clients" in sql and "COUNT(*)" in sql:
            return _FakeRow(0)
        if "INSERT INTO organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT org_id, user_id, role, is_active, is_owner" in sql:
            return _FakeRow("org-123", "u1", "Owner", True, True)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23", "growth", "active")
        if "SELECT invitation_id, org_id, email, role, accepted_at, expires_at" in sql:
            return _FakeRow("inv-1", "org-123", "user@example.com", "Consultant", None, "2026-05-01T00:00:00+00:00")
        if "SELECT 1 FROM organisations WHERE lower(slug)" in sql:
            return None
        return None

    def fetchall(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisations" in sql:
            return [_FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23", "growth", "active")]
        return []


def test_require_org_logs_missing_context(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("WARNING")

    with pytest.raises(HTTPException):
        tenancy.require_org({"user_id": "u1"})

    assert any("Organisation context missing" in record.message for record in caplog.records)


def test_org_lifecycle_emits_audit_event(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("INFO")
    fake = _AuditConn()
    captured: list[tuple[str, str, object, dict | None]] = []

    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(
        admin_routes,
        "record_audit_event",
        lambda con, **kwargs: captured.append(
            (
                str(kwargs.get("action") or ""),
                str(kwargs.get("entity_type") or ""),
                kwargs.get("entity_id"),
                kwargs.get("metadata"),
            )
        ),
    )

    result = admin_routes.create_organisation(
        {"name": "Acme Org", "plan": "growth", "max_users": 12, "max_clients": 50},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-old"},
    )

    invite = admin_routes.invite_user_to_organisation(
        "org-123",
        {"email": "user@example.com", "role": "Consultant", "days_valid": 7},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"},
    )

    assert result["ok"] is True
    assert invite["ok"] is True
    assert ("create", "organisation", "org-123", ANY) == captured[0]
    assert ("create", "organisation_invitation", ANY, ANY) == captured[1]


class _DeniedCapacityConn(_AuditConn):
    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisation_entitlements" in sql:
            return _FakeRow("org-123", "growth", "active", 3, 10, None, None, None, "active", None, None, True, None, None)
        if "FROM organisations" in sql and "archived" in sql and "LIMIT 1" in sql:
            return _FakeRow(True)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 3, 10, True, "2026-04-23", "u1", "2026-04-23", "2026-04-23")
        if "FROM organisation_memberships" in sql and "COUNT(*)" in sql:
            return _FakeRow(1)
        if "FROM organisation_invitations" in sql and "COUNT(*)" in sql:
            return _FakeRow(0)
        if "FROM clients" in sql and "COUNT(*)" in sql:
            return _FakeRow(0)
        return super().fetchone()


def test_org_capacity_denial_is_logged(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("WARNING")
    fake = _DeniedCapacityConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    with pytest.raises(HTTPException):
        admin_routes.invite_user_to_organisation(
            "org-123",
            {"email": "user@example.com", "role": "Consultant", "days_valid": 7},
            _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"},
        )

    assert any("Organisation capacity denied org_id=org-123 reason=archived" in record.message for record in caplog.records)
