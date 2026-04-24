from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes
import api.business_development_routes as business_development_routes
import api.auth_routes as auth_routes
import api.main as main


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _Stage3Conn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at" in sql and "FROM organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 12, 50, False, None, None, "2026-04-23", "2026-04-23")
        if "FROM organisations" in sql and "SELECT org_id, name, slug, plan, plan_status, archived" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", True)
        if "FROM organisation_memberships" in sql and "SELECT role, is_owner, is_active" in sql:
            return _FakeRow("Administrator", True, True)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s LIMIT 1" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 12, 50, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 12, 50, False, None, None, "2026-04-23", "2026-04-23")
        if "FROM organisation_entitlements" in sql:
            return _FakeRow("org-123", "growth", "active", 12, 50, "2026-05-01", "cus-123", "sub-123", "active", "2026-04-01", "2026-05-01", True, "2026-04-23", "2026-04-23")
        if "FROM organisation_billing_invoices" in sql and "SELECT 1" in sql:
            return None
        if "SELECT org_id FROM organisations WHERE org_id = %s LIMIT 1" in sql:
            return _FakeRow("org-123")
        if "FROM organisation_billing_invoices" in sql and "WHERE org_id = %s" in sql:
            return _FakeRow("bill-1", "org-123", "INV-2026-001", "issued", 12550, "GBP", "Monthly subscription", "2026-04-01", "2026-04-30", None, "2026-04-01", "2026-04-30", "PAY-1", "in_123", "pi_123", "u1", "2026-04-23", "2026-04-23")
        if "FROM organisation_billing_events" in sql and "WHERE org_id = %s" in sql:
            return _FakeRow("evt-1", "org-123", "bill-1", "payment_received", "manual", "recorded", 12550, "GBP", "PAY-1", "Annual renewal", '{"source":"organisation-admin"}', "2026-04-23", "u1", "2026-04-23")
        if "SELECT org_id, user_id, role, is_active, is_owner" in sql:
            return _FakeRow("org-123", "u2", "Consultant", True, False)
        if "SELECT membership_id, org_id, user_id, role, is_active, is_owner" in sql:
            return _FakeRow("mem-1", "org-123", "u2", "Consultant", True, False)
        if "SELECT COUNT(*)" in sql and "FROM organisation_memberships" in sql:
            return _FakeRow(1)
        if "SELECT COUNT(*)" in sql and "FROM organisation_invitations" in sql:
            return _FakeRow(0)
        if "SELECT COUNT(*)" in sql and "FROM clients" in sql:
            return _FakeRow(0)
        return None

    def fetchall(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisation_billing_invoices" in sql:
            return [
                _FakeRow("bill-1", "org-123", "INV-2026-001", "issued", 12550, "GBP", "Monthly subscription", "2026-04-01", "2026-04-30", None, "2026-04-01", "2026-04-30", "PAY-1", "in_123", "pi_123", "u1", "2026-04-23", "2026-04-23")
            ]
        if "FROM organisation_billing_events" in sql:
            return [
                _FakeRow("evt-1", "org-123", "bill-1", "payment_received", "manual", "recorded", 12550, "GBP", "PAY-1", "Annual renewal", '{"source":"organisation-admin"}', "2026-04-23", "u1", "2026-04-23")
            ]
        if "FROM organisations" in sql:
            return [_FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 12, 50, False, None, None, "2026-04-23", "2026-04-23", "growth", "active")]
        if "FROM organisation_memberships m" in sql:
            return [_FakeRow("org-123", "u1", "Owner Name", "owner@example.com", "Owner", True, True, "2026-04-23", "2026-04-23")]
        if "FROM organisation_memberships" in sql:
            return [_FakeRow("org-123", "Owner", True, True)]
        return []


def test_current_org_summary_includes_role_and_archived_flag(monkeypatch):
    fake = _Stage3Conn()
    monkeypatch.setattr(auth_routes, "get_conn", lambda: fake)

    result = auth_routes.me(user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"})

    assert result["current_org"]["org_id"] == "org-123"
    assert result["current_org"]["role"] == "Administrator"
    assert result["current_org"]["archived"] is True
    assert result["current_org"]["is_owner"] is True


def test_switch_active_organisation_updates_user_and_records_audit(monkeypatch):
    fake = _Stage3Conn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_require_org_switch_role", lambda con, user, org_id, **_kwargs: {"role": "Consultant", "capabilities": {"can_switch": True}})
    monkeypatch.setattr(admin_routes, "_require_org_capacity", lambda *args, **kwargs: {})

    result = admin_routes.switch_active_organisation(
        "org-123",
        _user={"user_id": "u2", "email": "user@example.com", "org_id": "org-old", "role": "Consultant"},
    )

    assert result["ok"] is True
    assert result["org_id"] == "org-123"
    assert any("UPDATE users SET org_id" in sql for sql, _ in fake.executed)


def test_billing_ledger_stays_scoped_to_selected_org(monkeypatch):
    fake = _Stage3Conn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_billing_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_require_org_management_role", lambda con, user, org_id, **_kwargs: {"role": "Owner", "capabilities": {"can_manage_billing": True}})
    monkeypatch.setattr(admin_routes, "_organisation_entitlement_info", lambda con, org_id: {"plan": "growth", "plan_status": "active", "max_users": 12, "max_clients": 50, "trial_ends_at": None, "stripe_customer_id": "cus-123", "stripe_subscription_id": "sub-123", "subscription_status": "active", "current_period_start": None, "current_period_end": None, "auto_renew": True})

    result = admin_routes.list_organisation_billing(
        "org-123",
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"},
    )

    assert result["organisation"]["org_id"] == "org-123"
    assert result["billing"]["invoices"][0]["org_id"] == "org-123"
    assert result["billing"]["events"][0]["org_id"] == "org-123"
    assert result["billing"]["role"] == "Owner"


def test_client_org_columns_do_not_backfill_default_org():
    fake = _Stage3Conn()
    main._ensure_client_org_columns(fake)

    assert any("ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id" in sql for sql, _ in fake.executed)
    assert not any("UPDATE clients SET org_id = COALESCE" in sql for sql, _ in fake.executed)
    assert not any("UPDATE client_sites SET org_id = COALESCE" in sql for sql, _ in fake.executed)
    assert not any("UPDATE client_contacts SET org_id = COALESCE" in sql for sql, _ in fake.executed)


def test_business_development_bootstrap_does_not_backfill_default_org():
    fake = _Stage3Conn()
    business_development_routes._ensure_tables(fake)

    assert any("CREATE TABLE IF NOT EXISTS bd_scan_batches" in sql for sql, _ in fake.executed)
    assert not any("UPDATE bd_" in sql and "org_id" in sql for sql, _ in fake.executed)
