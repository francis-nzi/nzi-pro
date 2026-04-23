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


class _BillingConn:
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
            return _FakeRow(
                "org-123",
                "growth",
                "active",
                12,
                50,
                "2026-05-01",
                "cus-123",
                "sub-123",
                "active",
                "2026-04-01",
                "2026-05-01",
                True,
                "2026-04-23",
                "2026-04-23",
            )
        if "FROM organisations" in sql and "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "growth", "active", 12, 50, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT org_id FROM organisations WHERE org_id = %s LIMIT 1" in sql:
            return _FakeRow("org-123")
        if "FROM organisation_billing_invoices" in sql and "WHERE billing_invoice_id = %s AND org_id = %s" in sql:
            return _FakeRow(
                "bill-1",
                "org-123",
                "INV-2026-001",
                "issued",
                12550,
                "GBP",
                "Monthly subscription",
                "2026-04-01",
                "2026-04-30",
                None,
                "2026-04-01",
                "2026-04-30",
                "PAY-1",
                "in_123",
                "pi_123",
                "u1",
                "2026-04-23",
                "2026-04-23",
            )
        if "FROM organisation_billing_invoices" in sql and "SELECT 1" in sql:
            return None
        if "INSERT INTO organisation_billing_invoices" in sql and "RETURNING billing_invoice_id, org_id, invoice_number" in sql:
            return _FakeRow(
                "bill-1",
                "org-123",
                "INV-2026-001",
                "issued",
                12550,
                "GBP",
                "Monthly subscription",
                "2026-04-01",
                "2026-04-30",
                None,
                "2026-04-01",
                "2026-04-30",
                "PAY-1",
                "in_123",
                "pi_123",
                "u1",
                "2026-04-23",
                "2026-04-23",
            )
        if "UPDATE organisation_billing_invoices" in sql and "RETURNING billing_invoice_id, org_id, invoice_number" in sql:
            return _FakeRow(
                "bill-1",
                "org-123",
                "INV-2026-001",
                "paid",
                12550,
                "GBP",
                "Monthly subscription",
                "2026-04-01",
                "2026-04-30",
                "2026-04-23",
                "2026-04-01",
                "2026-04-30",
                "PAY-1",
                "in_123",
                "pi_123",
                "u1",
                "2026-04-23",
                "2026-04-23",
            )
        if "INSERT INTO organisation_billing_events" in sql and "RETURNING billing_event_id, org_id, billing_invoice_id" in sql:
            params = self.executed[-1][1] or []
            event_type = str(params[2] or "note") if len(params) > 2 else "note"
            return _FakeRow(
                "evt-1",
                "org-123",
                "bill-1",
                event_type,
                "manual",
                "recorded",
                12550,
                "GBP",
                "PAY-1",
                "Annual renewal",
                '{"source":"organisation-admin"}',
                "2026-04-23",
                "u1",
                "2026-04-23",
            )
        return None

    def fetchall(self):
        sql = self._last_sql
        if "FROM organisation_billing_invoices" in sql:
            return [
                _FakeRow(
                    "bill-1",
                    "org-123",
                    "INV-2026-001",
                    "issued",
                    12550,
                    "GBP",
                    "Monthly subscription",
                    "2026-04-01",
                    "2026-04-30",
                    None,
                    "2026-04-01",
                    "2026-04-30",
                    "PAY-1",
                    "in_123",
                    "pi_123",
                    "u1",
                    "2026-04-23",
                    "2026-04-23",
                )
            ]
        if "FROM organisation_billing_events" in sql:
            return [
                _FakeRow(
                    "evt-1",
                    "org-123",
                    "bill-1",
                    "payment_received",
                    "manual",
                    "recorded",
                    12550,
                    "GBP",
                    "PAY-1",
                    "Annual renewal",
                    '{"source":"organisation-admin"}',
                    "2026-04-23",
                    "u1",
                    "2026-04-23",
                )
            ]
        return []


def test_list_organisation_billing_returns_history(monkeypatch):
    fake = _BillingConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_billing_schema", lambda con: None)

    result = admin_routes.list_organisation_billing("org-123", _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"})

    assert result["organisation"]["name"] == "Acme Org"
    assert result["entitlement"]["stripe_subscription_id"] == "sub-123"
    assert result["billing"]["invoices"][0]["invoice_number"] == "INV-2026-001"
    assert result["billing"]["events"][0]["event_type"] == "payment_received"


def test_create_update_and_record_billing_entries(monkeypatch):
    fake = _BillingConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_billing_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "record_audit_event", lambda *args, **kwargs: None)

    created = admin_routes.create_organisation_billing_invoice(
        "org-123",
        {
            "invoice_number": "INV-2026-001",
            "status": "issued",
            "amount": "125.50",
            "currency": "GBP",
            "description": "Monthly subscription",
            "invoice_date": "2026-04-01",
            "due_date": "2026-04-30",
            "payment_reference": "PAY-1",
            "stripe_invoice_id": "in_123",
            "stripe_payment_intent_id": "pi_123",
        },
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"},
    )
    assert created["ok"] is True
    assert created["invoice"]["amount_cents"] == 12550
    assert any("INSERT INTO organisation_billing_events" in sql for sql, _ in fake.executed)

    updated = admin_routes.update_organisation_billing_invoice(
        "org-123",
        "bill-1",
        {"status": "paid", "paid_at": "2026-04-23", "notes": "Paid in full"},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"},
    )
    assert updated["ok"] is True
    assert updated["invoice"]["status"] == "paid"
    assert any("UPDATE organisation_billing_invoices" in sql for sql, _ in fake.executed)

    event = admin_routes.create_organisation_billing_event(
        "org-123",
        {
            "event_type": "renewal",
            "source": "manual",
            "status": "recorded",
            "amount": "125.50",
            "currency": "GBP",
            "reference": "PAY-1",
            "notes": "Annual renewal",
            "billing_invoice_id": "bill-1",
            "effective_at": "2026-04-23",
            "payload": {"source": "organisation-admin"},
        },
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"},
    )
    assert event["ok"] is True
    assert event["event"]["event_type"] == "renewal"
    assert event["event"]["amount_cents"] == 12550
