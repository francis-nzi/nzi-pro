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
        if "INSERT INTO organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, "2026-04-23", "2026-04-23")
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, "2026-04-23", "2026-04-23")
        if "SELECT invitation_id, org_id, email, role, accepted_at, expires_at" in sql:
            return _FakeRow("inv-1", "org-123", "user@example.com", "Consultant", None, "2026-05-01T00:00:00+00:00")
        if "SELECT 1 FROM organisations WHERE lower(slug)" in sql:
            return None
        return None

    def fetchall(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisations" in sql:
            return [_FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, "2026-04-23", "2026-04-23")]
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
