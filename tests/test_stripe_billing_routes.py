from __future__ import annotations

from pathlib import Path
import asyncio
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import api.admin_routes as admin_routes
import api.stripe_billing_routes as stripe_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _StripeConn:
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
        if "FROM organisations" in sql and "stripe_customer_id" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", "cus_123")
        if "FROM organisations" in sql and "SELECT org_id FROM organisations" in sql:
            return _FakeRow("org-123")
        if "FROM organisation_entitlements" in sql:
            return _FakeRow("org-123", "growth", "active", 12, 50, None, "cus_123", "sub_123", "active", None, None, True, None, None)
        return None

    def fetchall(self):
        return []


class _CheckoutSessionCreate:
    def __init__(self):
        self.calls: list[dict[str, object]] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return type("Session", (), {"id": "cs_123", "url": "https://stripe.test/checkout"})()


class _PortalSessionCreate:
    def __init__(self):
        self.calls: list[dict[str, object]] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return type("Portal", (), {"id": "bps_123", "url": "https://stripe.test/portal"})()


class _FakeStripe:
    def __init__(self):
        self.api_key = ""
        self.checkout = type("Checkout", (), {"Session": _CheckoutSessionCreate()})()
        self.billing_portal = type("BillingPortal", (), {"Session": _PortalSessionCreate()})()
        self.Webhook = type("Webhook", (), {"construct_event": staticmethod(lambda payload, signature, secret: {})})()
        self.Subscription = type("Subscription", (), {"retrieve": staticmethod(lambda sub_id: {})})()


class _WebhookRequest:
    async def body(self):
        return b'{"type":"customer.subscription.updated"}'


def _patch_admin_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_billing_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_require_org_management_role", lambda con, user, org_id: {"role": "Owner", "capabilities": {"can_manage_billing": True}})


def test_create_stripe_checkout_session(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_stripe = _FakeStripe()
    fake_conn = _StripeConn()
    _patch_admin_schema(monkeypatch)
    monkeypatch.setattr(stripe_routes, "stripe", fake_stripe)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setenv("STRIPE_PRICE_ID", "price_123")
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://app.example.com")
    monkeypatch.setattr(stripe_routes, "get_conn", lambda: fake_conn)

    result = stripe_routes.create_stripe_checkout_session(
        "org-123",
        {"plan": "growth"},
        _user={"user_id": "u1", "email": "owner@example.com", "full_name": "Owner", "org_id": "org-123"},
    )

    assert result["ok"] is True
    assert result["url"] == "https://stripe.test/checkout"
    call = fake_stripe.checkout.Session.calls[0]
    assert call["mode"] == "subscription"
    assert call["customer"] == "cus_123"
    assert call["line_items"][0]["price"] == "price_123"
    assert call["subscription_data"]["metadata"]["org_id"] == "org-123"
    assert call["subscription_data"]["trial_period_days"] == 14


def test_create_stripe_customer_portal(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_stripe = _FakeStripe()
    fake_conn = _StripeConn()
    _patch_admin_schema(monkeypatch)
    monkeypatch.setattr(stripe_routes, "stripe", fake_stripe)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://app.example.com")
    monkeypatch.setattr(stripe_routes, "get_conn", lambda: fake_conn)

    result = stripe_routes.create_stripe_customer_portal(
        "org-123",
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"},
    )

    assert result["ok"] is True
    assert result["url"] == "https://stripe.test/portal"
    call = fake_stripe.billing_portal.Session.calls[0]
    assert call["customer"] == "cus_123"
    assert call["return_url"] == "https://app.example.com/admin/billing"


def test_stripe_webhook_updates_subscription_and_records_event(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_stripe = _FakeStripe()
    fake_conn = _StripeConn()
    _patch_admin_schema(monkeypatch)
    monkeypatch.setattr(stripe_routes, "stripe", fake_stripe)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_123")
    monkeypatch.setattr(stripe_routes, "get_conn", lambda: fake_conn)

    def construct_event(payload, signature, secret):
        assert payload == '{"type":"customer.subscription.updated"}'
        assert signature == "sig_123"
        assert secret == "whsec_123"
        return {
            "type": "customer.subscription.updated",
            "data": {
                "object": {
                    "id": "sub_123",
                    "customer": "cus_123",
                    "status": "active",
                    "cancel_at_period_end": False,
                    "current_period_start": 1710000000,
                    "current_period_end": 1712592000,
                    "trial_end": 1710000000,
                    "metadata": {"org_id": "org-123", "plan": "growth"},
                }
            },
        }

    fake_stripe.Webhook = type("Webhook", (), {"construct_event": staticmethod(construct_event)})()

    result = asyncio.run(
        stripe_routes.stripe_webhook(
            _WebhookRequest(),
            stripe_signature="sig_123",
        )
    )

    assert result == {"received": True}
    assert any("UPDATE organisations" in sql for sql, _ in fake_conn.executed)
    assert any("UPDATE organisation_entitlements" in sql for sql, _ in fake_conn.executed)
    assert any("INSERT INTO organisation_billing_events" in sql for sql, _ in fake_conn.executed)
