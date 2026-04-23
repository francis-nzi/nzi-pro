from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _EntitlementConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        sql = self._last_sql
        if "FROM organisation_entitlements" in sql:
            return _FakeRow("org-123", "growth", "active", 12, 50, "2026-05-01", "cus-123", "sub-123", "active", "2026-04-01", "2026-05-01", True, "2026-04-23", "2026-04-23")
        if "INSERT INTO organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 12, 50, False, None, None, "2026-04-23", "2026-04-23")
        if "UPDATE organisations" in sql and "RETURNING org_id, name, slug, plan, plan_status, max_users, max_clients, created_at, updated_at" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "enterprise", "active", 20, 80, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT 1 FROM organisations WHERE lower(slug)" in sql:
            return None
        if "SELECT COALESCE(archived, FALSE) FROM organisations WHERE org_id = %s LIMIT 1" in sql:
            return _FakeRow(False)
        if "SELECT COUNT(*)" in sql and "FROM organisation_memberships" in sql:
            return _FakeRow(1)
        if "SELECT COUNT(*)" in sql and "FROM organisation_invitations" in sql:
            return _FakeRow(0)
        if "SELECT COUNT(*)" in sql and "FROM clients" in sql:
            return _FakeRow(1)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 12, 50, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT org_id, user_id, role, is_active, is_owner" in sql:
            return _FakeRow("org-123", "u1", "Owner", True, True)
        return None

    def fetchall(self):
        sql = self._last_sql
        if "FROM organisations" in sql:
            return [_FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 12, 50, False, None, None, "2026-04-23", "2026-04-23")]
        if "FROM organisation_memberships" in sql:
            return [_FakeRow("org-123", "u1", "Owner", True, True)]
        return []


def test_create_organisation_writes_entitlement_source(monkeypatch):
    fake = _EntitlementConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)

    result = admin_routes.create_organisation(
        {
            "name": "Acme Org",
            "plan": "growth",
            "plan_status": "active",
            "max_users": 12,
            "max_clients": 50,
        },
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"},
    )

    assert result["ok"] is True
    assert any("INSERT INTO organisation_entitlements" in sql for sql, _ in fake.executed)
    entitlement_params = next(params for sql, params in fake.executed if "INSERT INTO organisation_entitlements" in sql)
    assert entitlement_params[1] == "growth"
    assert entitlement_params[2] == "active"
    assert entitlement_params[3] == 12
    assert entitlement_params[4] == 50


def test_list_and_update_organisations_use_entitlement_source(monkeypatch):
    fake = _EntitlementConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)

    listed = admin_routes.list_organisations(_user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"})
    assert listed["current_entitlement"]["plan"] == "growth"
    assert listed["items"][0]["entitlement"]["stripe_subscription_id"] == "sub-123"

    updated = admin_routes.update_organisation(
        "org-123",
        {
            "plan": "enterprise",
            "plan_status": "active",
            "max_users": 20,
            "max_clients": 80,
            "stripe_subscription_id": "sub-456",
            "subscription_status": "trialing",
        },
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"},
    )

    assert updated["ok"] is True
    entitlement_update_sql = [sql for sql, _ in fake.executed if "UPDATE organisation_entitlements" in sql]
    assert entitlement_update_sql
    last_update_params = next(params for sql, params in reversed(fake.executed) if "UPDATE organisation_entitlements" in sql)
    assert "enterprise" in last_update_params
    assert "sub-456" in last_update_params
    assert "trialing" in last_update_params
