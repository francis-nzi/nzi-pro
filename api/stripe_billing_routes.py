from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request

from api.auth import _current_user
from api import admin_routes
from api.permissions import require_permission
from core.database import get_conn
from services.permissions import ADMIN_ACCESS_PERMISSION

try:  # pragma: no cover - optional dependency in local/dev until installed
    import stripe  # type: ignore
except Exception:  # pragma: no cover
    stripe = None

router = APIRouter(
    tags=["stripe-billing"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)
webhook_router = APIRouter(tags=["stripe-billing"])


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def _frontend_base_url() -> str:
    return _env("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")


def _stripe_secret_key() -> str:
    return _env("STRIPE_SECRET_KEY")


def _stripe_price_id() -> str:
    return _env("STRIPE_PRICE_ID")


def _stripe_webhook_secret() -> str:
    return _env("STRIPE_WEBHOOK_SECRET")


def _stripe_portal_configuration_id() -> str:
    return _env("STRIPE_PORTAL_CONFIGURATION_ID")


def _stripe_return_url(default_path: str) -> str:
    configured = _env("STRIPE_PORTAL_RETURN_URL") or _env("STRIPE_SUCCESS_URL")
    if configured:
        return configured
    return f"{_frontend_base_url()}{default_path}"


def _stripe_checkout_urls(org_id: str) -> tuple[str, str]:
    success = _env("STRIPE_SUCCESS_URL")
    cancel = _env("STRIPE_CANCEL_URL")
    if not success:
        success = f"{_frontend_base_url()}/admin/billing?stripe=success&org_id={org_id}"
    if not cancel:
        cancel = f"{_frontend_base_url()}/admin/billing?stripe=cancel&org_id={org_id}"
    return success, cancel


def _stripe_client():
    if stripe is None:
        raise HTTPException(status_code=503, detail="Stripe integration is not installed")
    secret = _stripe_secret_key()
    if not secret:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    stripe.api_key = secret
    return stripe


def _get_stripe_value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _extract_metadata(obj: Any) -> dict[str, Any]:
    metadata = _get_stripe_value(obj, "metadata", {}) or {}
    return dict(metadata) if isinstance(metadata, dict) else {}


def _timestamp_to_naive_utc(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def _find_org_for_stripe_reference(con, *, customer_id: str | None = None, subscription_id: str | None = None) -> str | None:
    rows = con.execute(
        """
        SELECT org_id
        FROM organisation_entitlements
        WHERE (%s IS NOT NULL AND stripe_customer_id = %s)
           OR (%s IS NOT NULL AND stripe_subscription_id = %s)
        LIMIT 1
        """,
        [customer_id, customer_id, subscription_id, subscription_id],
    ).fetchone()
    if rows and rows[0]:
        return str(rows[0])
    return None


def _record_stripe_billing_event(
    con,
    *,
    org_id: str,
    event_type: str,
    reference: str | None,
    payload: dict[str, Any],
    effective_at: datetime | None = None,
    notes: str | None = None,
) -> None:
    con.execute(
        """
        INSERT INTO organisation_billing_events (
          org_id, billing_invoice_id, event_type, source, status, amount_cents, currency,
          reference, notes, payload_json, effective_at, created_by
        )
        VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        [
            org_id,
            event_type,
            "stripe",
            "recorded",
            0,
            "GBP",
            reference,
            notes,
            json.dumps(payload, default=str),
            effective_at or datetime.now(timezone.utc).replace(tzinfo=None),
            "stripe-webhook",
        ],
    )


def _sync_org_from_subscription(con, *, org_id: str, subscription: Any, event_type: str) -> None:
    metadata = _extract_metadata(subscription)
    plan = str(metadata.get("plan") or _env("STRIPE_DEFAULT_PLAN", "growth") or "growth").strip() or "growth"
    subscription_status = str(_get_stripe_value(subscription, "status") or "active").strip() or "active"
    plan_status = "active" if subscription_status in {"active", "trialing"} else subscription_status
    customer_id = str(_get_stripe_value(subscription, "customer") or "").strip() or None
    subscription_id = str(_get_stripe_value(subscription, "id") or "").strip() or None
    trial_ends_at = _timestamp_to_naive_utc(_get_stripe_value(subscription, "trial_end"))
    current_period_start = _timestamp_to_naive_utc(_get_stripe_value(subscription, "current_period_start"))
    current_period_end = _timestamp_to_naive_utc(_get_stripe_value(subscription, "current_period_end"))
    auto_renew = not bool(_get_stripe_value(subscription, "cancel_at_period_end", False))

    con.execute(
        """
        UPDATE organisations
        SET plan = %s,
            plan_status = %s,
            trial_ends_at = %s,
            stripe_customer_id = %s,
            stripe_subscription_id = %s,
            updated_at = NOW()
        WHERE org_id = %s
        """,
        [plan, plan_status, trial_ends_at, customer_id, subscription_id, org_id],
    )
    con.execute(
        """
        UPDATE organisation_entitlements
        SET plan = %s,
            plan_status = %s,
            trial_ends_at = %s,
            stripe_customer_id = %s,
            stripe_subscription_id = %s,
            subscription_status = %s,
            current_period_start = %s,
            current_period_end = %s,
            auto_renew = %s,
            updated_at = NOW()
        WHERE org_id = %s
        """,
        [
            plan,
            plan_status,
            trial_ends_at,
            customer_id,
            subscription_id,
            subscription_status,
            current_period_start,
            current_period_end,
            auto_renew,
            org_id,
        ],
    )
    _record_stripe_billing_event(
        con,
        org_id=org_id,
        event_type=event_type,
        reference=subscription_id,
        payload={
            "subscription": subscription,
            "metadata": metadata,
        },
        effective_at=current_period_start,
        notes=f"Stripe subscription {subscription_status}",
    )


@router.post("/admin/organisations/{org_id}/stripe/checkout-session")
def create_stripe_checkout_session(org_id: str, body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    client = _stripe_client()
    price_id = str(body.get("price_id") or _stripe_price_id()).strip()
    if not price_id:
        raise HTTPException(status_code=503, detail="STRIPE_PRICE_ID is not configured")

    plan = str(body.get("plan") or _env("STRIPE_DEFAULT_PLAN", "growth") or "growth").strip() or "growth"
    trial_days_raw = body.get("trial_period_days")
    if trial_days_raw is None:
        trial_days_raw = _env("STRIPE_TRIAL_DAYS", "14")
    try:
        trial_days = int(trial_days_raw)
    except Exception:
        trial_days = 14
    trial_days = max(0, trial_days)

    with get_conn() as con:
        admin_routes._ensure_org_lifecycle_schema(con)
        admin_routes._ensure_org_entitlement_schema(con)
        admin_routes._ensure_org_billing_schema(con)
        admin_routes._require_org_management_role(con, _user, org_id)
        organisation = con.execute(
            """
            SELECT org_id, name, slug, plan, plan_status, stripe_customer_id
            FROM organisations
            WHERE org_id = %s
            LIMIT 1
            """,
            [org_id],
        ).fetchone()
        if not organisation:
            raise HTTPException(status_code=404, detail="Organisation not found")
        customer_id = str(organisation[5] or "").strip() or None
        success_url, cancel_url = _stripe_checkout_urls(org_id)
        user_email = str(_user.get("email") or "").strip() or None

        session_kwargs: dict[str, Any] = {
            "mode": "subscription",
            "line_items": [{"price": price_id, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "client_reference_id": org_id,
            "metadata": {"org_id": org_id, "plan": plan},
            "subscription_data": {
                "metadata": {"org_id": org_id, "plan": plan},
            },
        }
        if trial_days > 0:
            session_kwargs["subscription_data"]["trial_period_days"] = trial_days
        if customer_id:
            session_kwargs["customer"] = customer_id
        elif user_email:
            session_kwargs["customer_email"] = user_email

        session = client.checkout.Session.create(**session_kwargs)
        return {
            "ok": True,
            "session_id": str(_get_stripe_value(session, "id") or ""),
            "url": str(_get_stripe_value(session, "url") or ""),
        }


@router.post("/admin/organisations/{org_id}/stripe/customer-portal")
def create_stripe_customer_portal(org_id: str, _user: dict = Depends(_current_user)):
    client = _stripe_client()
    with get_conn() as con:
        admin_routes._ensure_org_lifecycle_schema(con)
        admin_routes._ensure_org_entitlement_schema(con)
        admin_routes._ensure_org_billing_schema(con)
        admin_routes._require_org_management_role(con, _user, org_id)
        entitlement = admin_routes._organisation_entitlement_info(con, org_id)
        customer_id = str(entitlement.get("stripe_customer_id") or "").strip()
        if not customer_id:
            raise HTTPException(status_code=400, detail="No Stripe customer is linked to this organisation yet")
        session_kwargs: dict[str, Any] = {
            "customer": customer_id,
            "return_url": _stripe_return_url("/admin/billing"),
        }
        config_id = _stripe_portal_configuration_id()
        if config_id:
            session_kwargs["configuration"] = config_id
        session = client.billing_portal.Session.create(**session_kwargs)
        return {
            "ok": True,
            "session_id": str(_get_stripe_value(session, "id") or ""),
            "url": str(_get_stripe_value(session, "url") or ""),
        }


@webhook_router.post("/stripe/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
):
    client = _stripe_client()
    endpoint_secret = _stripe_webhook_secret()
    if not endpoint_secret:
        raise HTTPException(status_code=503, detail="STRIPE_WEBHOOK_SECRET is not configured")
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")

    payload = (await request.body()).decode("utf-8")
    try:
        event = client.Webhook.construct_event(payload, stripe_signature, endpoint_secret)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Stripe webhook payload: {exc}")

    event_type = str(_get_stripe_value(event, "type") or "")
    data = _get_stripe_value(event, "data", {}) or {}
    obj = _get_stripe_value(data, "object", {}) or {}
    metadata = _extract_metadata(obj)
    customer_id = str(_get_stripe_value(obj, "customer") or "").strip() or None
    subscription_id = str(_get_stripe_value(obj, "id") or "").strip() or None
    effective_at = _timestamp_to_naive_utc(_get_stripe_value(obj, "current_period_start"))

    with get_conn() as con:
        admin_routes._ensure_org_lifecycle_schema(con)
        admin_routes._ensure_org_entitlement_schema(con)
        admin_routes._ensure_org_billing_schema(con)

        if event_type in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
            org_id = str(metadata.get("org_id") or _get_stripe_value(obj, "client_reference_id") or "").strip()
            session_subscription_id = str(_get_stripe_value(obj, "subscription") or "").strip() or None
            session_customer_id = str(_get_stripe_value(obj, "customer") or "").strip() or None
            if not org_id:
                org_id = _find_org_for_stripe_reference(
                    con,
                    customer_id=session_customer_id,
                    subscription_id=session_subscription_id,
                ) or ""
            if org_id:
                if session_subscription_id:
                    try:
                        subscription = client.Subscription.retrieve(session_subscription_id)
                    except Exception:
                        subscription = None
                    if subscription:
                        _sync_org_from_subscription(con, org_id=org_id, subscription=subscription, event_type="subscription_created")
                    else:
                        con.execute(
                            """
                            UPDATE organisations
                            SET stripe_customer_id = COALESCE(%s, stripe_customer_id),
                                stripe_subscription_id = COALESCE(%s, stripe_subscription_id),
                                updated_at = NOW()
                            WHERE org_id = %s
                            """,
                            [session_customer_id, session_subscription_id, org_id],
                        )
                        con.execute(
                            """
                            UPDATE organisation_entitlements
                            SET stripe_customer_id = COALESCE(%s, stripe_customer_id),
                                stripe_subscription_id = COALESCE(%s, stripe_subscription_id),
                                updated_at = NOW()
                            WHERE org_id = %s
                            """,
                            [session_customer_id, session_subscription_id, org_id],
                        )
                _record_stripe_billing_event(
                    con,
                    org_id=org_id,
                    event_type="subscription_created",
                    reference=session_subscription_id,
                    payload={"checkout_session": obj, "metadata": metadata},
                    effective_at=effective_at,
                    notes="Checkout completed",
                )

        elif event_type.startswith("customer.subscription."):
            org_id = str(metadata.get("org_id") or "").strip()
            if not org_id:
                org_id = _find_org_for_stripe_reference(
                    con,
                    customer_id=customer_id,
                    subscription_id=subscription_id,
                ) or ""
            if org_id:
                subscription_event_type = {
                    "customer.subscription.created": "subscription_created",
                    "customer.subscription.updated": "subscription_updated",
                    "customer.subscription.deleted": "subscription_canceled",
                }.get(event_type, "subscription_updated")
                _sync_org_from_subscription(con, org_id=org_id, subscription=obj, event_type=subscription_event_type)

        elif event_type in {"invoice.paid", "invoice.payment_failed", "invoice.finalized"}:
            org_id = str(metadata.get("org_id") or "").strip()
            if not org_id:
                org_id = _find_org_for_stripe_reference(con, customer_id=customer_id, subscription_id=subscription_id) or ""
            if org_id:
                billing_event_type = {
                    "invoice.paid": "payment_received",
                    "invoice.payment_failed": "payment_failed",
                    "invoice.finalized": "invoice_issued",
                }[event_type]
                _record_stripe_billing_event(
                    con,
                    org_id=org_id,
                    event_type=billing_event_type,
                    reference=str(_get_stripe_value(obj, "number") or subscription_id or ""),
                    payload={"invoice": obj, "metadata": metadata},
                    effective_at=effective_at,
                    notes=f"Stripe {event_type}",
                )

    return {"received": True}
