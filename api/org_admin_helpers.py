"""
Shared organisation-admin helpers used by auth and admin routers.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import io
import json
import logging
import re
import zipfile
from typing import Any

import pandas as pd
from fastapi import HTTPException

from core.database import get_conn
from services.permissions import SUPERADMIN_ROLE

logger = logging.getLogger(__name__)

_ORG_ROLE_RANKS = {
    "owner": 40,
    "admin": 30,
    "billing": 20,
    "member": 10,
    "consultant": 10,
}
_ORG_ROLE_LABELS = {
    "owner": "Owner",
    "admin": "Admin",
    "billing": "Billing",
    "member": "Member",
    "consultant": "Consultant",
}
_ORG_ROLE_CAPABILITIES = {
    "owner": {
        "can_switch": True,
        "can_manage_members": True,
        "can_invite": True,
        "can_manage_organisation": True,
        "can_transfer_ownership": True,
        "can_manage_billing": True,
    },
    "admin": {
        "can_switch": True,
        "can_manage_members": True,
        "can_invite": True,
        "can_manage_organisation": True,
        "can_transfer_ownership": False,
        "can_manage_billing": False,
    },
    "billing": {
        "can_switch": True,
        "can_manage_members": False,
        "can_invite": False,
        "can_manage_organisation": False,
        "can_transfer_ownership": False,
        "can_manage_billing": True,
    },
    "member": {
        "can_switch": True,
        "can_manage_members": False,
        "can_invite": False,
        "can_manage_organisation": False,
        "can_transfer_ownership": False,
        "can_manage_billing": False,
    },
    "consultant": {
        "can_switch": True,
        "can_manage_members": False,
        "can_invite": False,
        "can_manage_organisation": False,
        "can_transfer_ownership": False,
        "can_manage_billing": False,
    },
}
_ORG_MANAGEMENT_ROLES = {"owner", "admin"}
_ORG_SWITCH_ROLES = {"owner", "admin", "billing", "member", "consultant"}
_ORG_BILLING_INVOICE_STATUSES = {"draft", "issued", "paid", "overdue", "void", "refunded"}
_ORG_BILLING_EVENT_TYPES = {
    "invoice_created",
    "invoice_issued",
    "payment_received",
    "payment_failed",
    "subscription_created",
    "subscription_updated",
    "subscription_canceled",
    "renewal",
    "reminder_sent",
    "note",
}

def _ensure_org_lifecycle_schema(con) -> None:
    """Keep org lifecycle tables and columns available on older databases."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS organisations (
              org_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
              name VARCHAR NOT NULL,
              slug VARCHAR UNIQUE,
              plan VARCHAR DEFAULT 'trial',
              plan_status VARCHAR DEFAULT 'active',
              trial_ends_at TIMESTAMP,
              stripe_customer_id VARCHAR,
              stripe_subscription_id VARCHAR,
              max_users INTEGER DEFAULT 3,
              max_clients INTEGER DEFAULT 10,
              archived BOOLEAN DEFAULT FALSE,
              archived_at TIMESTAMP,
              archived_by VARCHAR,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE")
        con.execute("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP")
        con.execute("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS archived_by VARCHAR")
    except Exception:
        pass

    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS organisation_invitations (
              invitation_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
              org_id UUID REFERENCES organisations(org_id),
              email VARCHAR NOT NULL,
              role VARCHAR DEFAULT 'Consultant',
              invited_by VARCHAR,
              token VARCHAR UNIQUE NOT NULL,
              accepted_at TIMESTAMP,
              expires_at TIMESTAMP NOT NULL,
              created_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID")
    except Exception:
        pass
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS organisation_memberships (
              membership_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
              org_id UUID REFERENCES organisations(org_id) NOT NULL,
              user_id VARCHAR NOT NULL,
              role VARCHAR DEFAULT 'Consultant',
              is_active BOOLEAN DEFAULT TRUE,
              is_owner BOOLEAN DEFAULT FALSE,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
    except Exception:
        pass
    try:
        con.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_organisation_memberships_org_user
            ON organisation_memberships (org_id, user_id)
            """
        )
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE organisation_invitations ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP")
        con.execute("ALTER TABLE organisation_invitations ADD COLUMN IF NOT EXISTS invited_by VARCHAR")
        con.execute("ALTER TABLE organisation_invitations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP")
    except Exception:
        pass
    try:
        con.execute(
            """
            INSERT INTO organisations (name, slug, plan, plan_status, max_users, max_clients)
            SELECT 'NZI Internal', 'nzi-internal', 'trial', 'active', 999, 999
            WHERE NOT EXISTS (
              SELECT 1 FROM organisations WHERE slug = 'nzi-internal'
            )
            """
        )
    except Exception:
        pass
    try:
        con.execute(
            """
            INSERT INTO organisation_memberships (org_id, user_id, role, is_active, is_owner)
            SELECT org_id, user_id, COALESCE(role, 'Consultant'), TRUE,
                   CASE
                     WHEN lower(COALESCE(role, '')) IN ('owner', 'admin', 'superadmin') THEN TRUE
                     ELSE FALSE
                   END
            FROM users
            WHERE org_id IS NOT NULL
            ON CONFLICT (org_id, user_id) DO UPDATE SET
              role = EXCLUDED.role,
              is_active = TRUE,
              updated_at = NOW()
            """
        )
    except Exception:
        pass


def _ensure_org_entitlement_schema(con) -> None:
    """Keep org entitlement data available and mirrored from organisation rows."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS organisation_entitlements (
              org_id UUID PRIMARY KEY REFERENCES organisations(org_id),
              plan VARCHAR DEFAULT 'trial',
              plan_status VARCHAR DEFAULT 'active',
              max_users INTEGER DEFAULT 3,
              max_clients INTEGER DEFAULT 10,
              trial_ends_at TIMESTAMP,
              stripe_customer_id VARCHAR,
              stripe_subscription_id VARCHAR,
              subscription_status VARCHAR DEFAULT 'active',
              current_period_start TIMESTAMP,
              current_period_end TIMESTAMP,
              auto_renew BOOLEAN DEFAULT TRUE,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
    except Exception:
        pass
    for ddl in (
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS plan VARCHAR DEFAULT 'trial'",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS plan_status VARCHAR DEFAULT 'active'",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 3",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS max_clients INTEGER DEFAULT 10",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS subscription_status VARCHAR DEFAULT 'active'",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMP",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT TRUE",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()",
        "ALTER TABLE organisation_entitlements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()",
    ):
        try:
            con.execute(ddl)
        except Exception:
            pass
    try:
        con.execute(
            """
            INSERT INTO organisation_entitlements (
              org_id, plan, plan_status, max_users, max_clients, trial_ends_at,
              stripe_customer_id, stripe_subscription_id, subscription_status,
              current_period_start, current_period_end, auto_renew
            )
            SELECT
              org_id, COALESCE(plan, 'trial'), COALESCE(plan_status, 'active'),
              COALESCE(max_users, 3), COALESCE(max_clients, 10), trial_ends_at,
              stripe_customer_id, stripe_subscription_id, COALESCE(plan_status, 'active'),
              NULL, NULL, TRUE
            FROM organisations
            ON CONFLICT (org_id) DO UPDATE SET
              plan = EXCLUDED.plan,
              plan_status = EXCLUDED.plan_status,
              max_users = EXCLUDED.max_users,
              max_clients = EXCLUDED.max_clients,
              trial_ends_at = COALESCE(EXCLUDED.trial_ends_at, organisation_entitlements.trial_ends_at),
              stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, organisation_entitlements.stripe_customer_id),
              stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, organisation_entitlements.stripe_subscription_id),
              subscription_status = EXCLUDED.subscription_status,
              updated_at = NOW()
            """
        )
    except Exception:
        pass
    try:
        con.execute(
            """
            UPDATE users
            SET org_id = (
              SELECT org_id FROM organisations WHERE slug = 'nzi-internal' LIMIT 1
            )
            WHERE org_id IS NULL
            """
        )
    except Exception:
        pass


def _ensure_org_billing_schema(con) -> None:
    """Keep org billing ledger tables available on older databases."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS organisation_billing_invoices (
              billing_invoice_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
              org_id UUID REFERENCES organisations(org_id) NOT NULL,
              invoice_number VARCHAR NOT NULL,
              status VARCHAR DEFAULT 'draft',
              amount_cents INTEGER DEFAULT 0,
              currency VARCHAR DEFAULT 'GBP',
              description TEXT,
              invoice_date TIMESTAMP,
              due_date TIMESTAMP,
              paid_at TIMESTAMP,
              period_start TIMESTAMP,
              period_end TIMESTAMP,
              payment_reference VARCHAR,
              stripe_invoice_id VARCHAR,
              stripe_payment_intent_id VARCHAR,
              created_by VARCHAR,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
    except Exception:
        pass
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS organisation_billing_events (
              billing_event_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
              org_id UUID REFERENCES organisations(org_id) NOT NULL,
              billing_invoice_id UUID REFERENCES organisation_billing_invoices(billing_invoice_id),
              event_type VARCHAR NOT NULL,
              source VARCHAR DEFAULT 'manual',
              status VARCHAR DEFAULT 'recorded',
              amount_cents INTEGER DEFAULT 0,
              currency VARCHAR DEFAULT 'GBP',
              reference VARCHAR,
              notes TEXT,
              payload_json TEXT,
              effective_at TIMESTAMP,
              created_by VARCHAR,
              created_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
    except Exception:
        pass
    for ddl in (
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'draft'",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS amount_cents INTEGER DEFAULT 0",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS currency VARCHAR DEFAULT 'GBP'",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS invoice_date TIMESTAMP",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS due_date TIMESTAMP",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS period_start TIMESTAMP",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS period_end TIMESTAMP",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS payment_reference VARCHAR",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS stripe_invoice_id VARCHAR",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS created_by VARCHAR",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()",
        "ALTER TABLE organisation_billing_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS billing_invoice_id UUID REFERENCES organisation_billing_invoices(billing_invoice_id)",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual'",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'recorded'",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS amount_cents INTEGER DEFAULT 0",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS currency VARCHAR DEFAULT 'GBP'",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS reference VARCHAR",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS notes TEXT",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS payload_json TEXT",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS effective_at TIMESTAMP",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS created_by VARCHAR",
        "ALTER TABLE organisation_billing_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()",
    ):
        try:
            con.execute(ddl)
        except Exception:
            pass
    try:
        con.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_org_billing_invoices_org_number
            ON organisation_billing_invoices (org_id, lower(invoice_number))
            """
        )
    except Exception:
        pass
    try:
        con.execute(
            """
            CREATE INDEX IF NOT EXISTS ix_org_billing_invoices_org_created
            ON organisation_billing_invoices (org_id, created_at DESC)
            """
        )
    except Exception:
        pass
    try:
        con.execute(
            """
            CREATE INDEX IF NOT EXISTS ix_org_billing_events_org_created
            ON organisation_billing_events (org_id, created_at DESC)
            """
        )
    except Exception:
        pass


def _normalize_org_role(value: object | None, *, default: str = "Member") -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        raw = str(default or "Member").strip().lower()
    if raw in {"superadmin", "administrator"}:
        raw = "owner"
    if raw in {"crm", "qa", "support", "readonly", "read-only", "team member"}:
        raw = "member"
    if raw not in _ORG_ROLE_RANKS:
        raw = str(default or "Member").strip().lower() or "member"
        if raw not in _ORG_ROLE_RANKS:
            raw = "member"
    return _ORG_ROLE_LABELS.get(raw, "Member")


def _org_role_rank(value: object | None) -> int:
    normalized = _normalize_org_role(value)
    return _ORG_ROLE_RANKS.get(normalized.strip().lower(), 10)


def _org_role_capabilities(value: object | None) -> dict[str, bool]:
    normalized = _normalize_org_role(value).strip().lower()
    caps = dict(_ORG_ROLE_CAPABILITIES.get(normalized, _ORG_ROLE_CAPABILITIES["member"]))
    caps["is_owner_role"] = normalized == "owner"
    caps["is_admin_role"] = normalized == "admin"
    caps["role"] = _ORG_ROLE_LABELS.get(normalized, "Member")
    return caps


def _entitlement_row_to_dict(row) -> dict[str, object]:
    def _value(idx: int):
        try:
            return row[idx]
        except Exception:
            return None

    return {
        "org_id": str(_value(0)) if _value(0) is not None else None,
        "plan": str(_value(1) or "trial"),
        "plan_status": str(_value(2) or "active"),
        "max_users": int(_value(3) or 0),
        "max_clients": int(_value(4) or 0),
        "trial_ends_at": str(_value(5)) if _value(5) else None,
        "stripe_customer_id": str(_value(6) or "") or None,
        "stripe_subscription_id": str(_value(7) or "") or None,
        "subscription_status": str(_value(8) or "active"),
        "current_period_start": str(_value(9)) if _value(9) else None,
        "current_period_end": str(_value(10)) if _value(10) else None,
        "auto_renew": bool(_value(11)) if _value(11) is not None else True,
        "created_at": str(_value(12)) if _value(12) else None,
        "updated_at": str(_value(13)) if _value(13) else None,
    }


def _organisation_entitlement_info(con, org_id: str) -> dict[str, object]:
    row = con.execute(
        """
        SELECT org_id, plan, plan_status, max_users, max_clients, trial_ends_at,
               stripe_customer_id, stripe_subscription_id, subscription_status,
               current_period_start, current_period_end, auto_renew, created_at, updated_at
        FROM organisation_entitlements
        WHERE org_id = %s
        LIMIT 1
        """,
        [str(org_id).strip()],
    ).fetchone()
    if row:
        return _entitlement_row_to_dict(row)

    org_row = con.execute(
        """
        SELECT org_id, plan, plan_status, max_users, max_clients, trial_ends_at,
               stripe_customer_id, stripe_subscription_id, plan_status,
               NULL, NULL, TRUE, created_at, updated_at
        FROM organisations
        WHERE org_id = %s
        LIMIT 1
        """,
        [str(org_id).strip()],
    ).fetchone()
    if not org_row:
        raise HTTPException(status_code=404, detail="Organisation not found")
    return _entitlement_row_to_dict(org_row)


def _billing_invoice_row_to_dict(row) -> dict[str, object]:
    def _value(idx: int):
        try:
            return row[idx]
        except Exception:
            return None

    return {
        "billing_invoice_id": str(_value(0)) if _value(0) is not None else None,
        "org_id": str(_value(1)) if _value(1) is not None else None,
        "invoice_number": str(_value(2) or ""),
        "status": str(_value(3) or "draft"),
        "amount_cents": int(_value(4) or 0),
        "currency": str(_value(5) or "GBP"),
        "description": str(_value(6) or "") or None,
        "invoice_date": str(_value(7)) if _value(7) else None,
        "due_date": str(_value(8)) if _value(8) else None,
        "paid_at": str(_value(9)) if _value(9) else None,
        "period_start": str(_value(10)) if _value(10) else None,
        "period_end": str(_value(11)) if _value(11) else None,
        "payment_reference": str(_value(12) or "") or None,
        "stripe_invoice_id": str(_value(13) or "") or None,
        "stripe_payment_intent_id": str(_value(14) or "") or None,
        "created_by": str(_value(15) or "") or None,
        "created_at": str(_value(16)) if _value(16) else None,
        "updated_at": str(_value(17)) if _value(17) else None,
    }


def _billing_event_row_to_dict(row) -> dict[str, object]:
    def _value(idx: int):
        try:
            return row[idx]
        except Exception:
            return None

    payload = _value(10)
    payload_text = str(payload) if payload else None
    return {
        "billing_event_id": str(_value(0)) if _value(0) is not None else None,
        "org_id": str(_value(1)) if _value(1) is not None else None,
        "billing_invoice_id": str(_value(2)) if _value(2) is not None else None,
        "event_type": str(_value(3) or "note"),
        "source": str(_value(4) or "manual"),
        "status": str(_value(5) or "recorded"),
        "amount_cents": int(_value(6) or 0),
        "currency": str(_value(7) or "GBP"),
        "reference": str(_value(8) or "") or None,
        "notes": str(_value(9) or "") or None,
        "payload_json": payload_text,
        "effective_at": str(_value(11)) if _value(11) else None,
        "created_by": str(_value(12) or "") or None,
        "created_at": str(_value(13)) if _value(13) else None,
    }


def _parse_amount_cents(value: object | None) -> int:
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        return 0
    try:
        decimal_value = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(status_code=400, detail="amount must be a valid number")
    return int((decimal_value * 100).quantize(Decimal("1")))


def _optional_int_param(value: object | None) -> int | None:
    try:
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return int(value)
    except Exception:
        return None


def _membership_for_user(con, user_id: str, org_id: str) -> dict[str, object] | None:
    try:
        row = con.execute(
            """
            SELECT org_id, user_id, role, is_active, is_owner
            FROM organisation_memberships
            WHERE lower(user_id) = lower(%s)
              AND org_id = %s
            LIMIT 1
            """,
            [str(user_id).strip(), str(org_id).strip()],
        ).fetchone()
    except Exception:
        return None
    if not row:
        return None
    return {
        "org_id": str(row[0]) if row[0] is not None else None,
        "user_id": str(row[1]) if row[1] is not None else None,
        "role": _normalize_org_role(row[2]),
        "is_active": bool(row[3]) if row[3] is not None else True,
        "is_owner": bool(row[4]) if row[4] is not None else False,
    }


def _org_role_info(con, user: dict, org_id: str) -> dict[str, object]:
    user_id = str(user.get("user_id") or "").strip()
    membership = _membership_for_user(con, user_id, org_id)
    if membership:
        return membership

    role = _normalize_org_role(user.get("role"), default="Member")
    return {
        "org_id": str(org_id).strip(),
        "user_id": user_id or None,
        "role": role,
        "is_active": True,
        "is_owner": role == "Owner",
        "capabilities": _org_role_capabilities(role),
    }


def _require_org_owner_role(con, user: dict, org_id: str, *, allow_superadmin: bool = True) -> dict[str, object]:
    role_info = _org_role_info(con, user, org_id)
    user_role = str(role_info.get("role") or "Member").strip().lower()
    if allow_superadmin and str(user.get("role") or "").strip().lower() in (SUPERADMIN_ROLE, "superadmin"):
        return role_info
    if user_role != "owner":
        raise HTTPException(status_code=403, detail="Organisation owner role required")
    return role_info


def _require_org_management_role(con, user: dict, org_id: str, *, allow_superadmin: bool = True) -> dict[str, object]:
    role_info = _org_role_info(con, user, org_id)
    user_role = str(role_info.get("role") or "Member").strip().lower()
    if allow_superadmin and str(user.get("role") or "").strip().lower() in (SUPERADMIN_ROLE, "superadmin"):
        return role_info
    if user_role not in _ORG_MANAGEMENT_ROLES:
        raise HTTPException(status_code=403, detail="Organisation admin role required")
    return role_info


def _require_org_switch_role(con, user: dict, org_id: str, *, allow_superadmin: bool = True) -> dict[str, object]:
    role_info = _org_role_info(con, user, org_id)
    user_role = str(role_info.get("role") or "Member").strip().lower()
    if allow_superadmin and str(user.get("role") or "").strip().lower() in (SUPERADMIN_ROLE, "superadmin"):
        return role_info
    if user_role not in _ORG_SWITCH_ROLES:
        raise HTTPException(status_code=403, detail="Organisation membership required")
    return role_info


def _require_org_active(con, org_id: str) -> None:
    row = con.execute(
        "SELECT COALESCE(archived, FALSE) FROM organisations WHERE org_id = %s LIMIT 1",
        [org_id],
    ).fetchone()
    if row and bool(row[0]):
        raise HTTPException(status_code=403, detail="Organisation is archived")


def _organisation_usage_info(con, org_id: str) -> dict[str, int | bool | str]:
    entitlement = _organisation_entitlement_info(con, org_id)
    org_row = con.execute(
        """
        SELECT COALESCE(archived, FALSE)
        FROM organisations
        WHERE org_id = %s
        LIMIT 1
        """,
        [org_id],
    ).fetchone()

    active_members = con.execute(
        """
        SELECT COUNT(*)
        FROM organisation_memberships
        WHERE org_id = %s
          AND COALESCE(is_active, TRUE) = TRUE
        """,
        [org_id],
    ).fetchone()
    pending_invites = con.execute(
        """
        SELECT COUNT(*)
        FROM organisation_invitations
        WHERE org_id = %s
          AND accepted_at IS NULL
          AND expires_at > NOW()
        """,
        [org_id],
    ).fetchone()
    active_clients = con.execute(
        """
        SELECT COUNT(*)
        FROM clients
        WHERE org_id = %s
          AND COALESCE(archived, FALSE) = FALSE
        """,
        [org_id],
    ).fetchone()

    return {
        "max_users": int(entitlement.get("max_users") or 0),
        "max_clients": int(entitlement.get("max_clients") or 0),
        "archived": bool(org_row[0]) if org_row is not None and org_row[0] is not None else False,
        "plan_status": str(entitlement.get("plan_status") or "active"),
        "plan": str(entitlement.get("plan") or "trial"),
        "trial_ends_at": entitlement.get("trial_ends_at"),
        "stripe_customer_id": entitlement.get("stripe_customer_id"),
        "stripe_subscription_id": entitlement.get("stripe_subscription_id"),
        "subscription_status": str(entitlement.get("subscription_status") or "active"),
        "current_period_start": entitlement.get("current_period_start"),
        "current_period_end": entitlement.get("current_period_end"),
        "auto_renew": bool(entitlement.get("auto_renew")) if entitlement.get("auto_renew") is not None else True,
        "active_members": int(active_members[0] or 0) if active_members else 0,
        "pending_invites": int(pending_invites[0] or 0) if pending_invites else 0,
        "active_clients": int(active_clients[0] or 0) if active_clients else 0,
    }


def _table_exists(con, table_name: str) -> bool:
    try:
        row = con.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = %s
            LIMIT 1
            """,
            [str(table_name).strip()],
        ).fetchone()
        return bool(row)
    except Exception:
        return False


def _column_exists(con, table_name: str, column_name: str) -> bool:
    try:
        row = con.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = %s
              AND column_name = %s
            LIMIT 1
            """,
            [str(table_name).strip(), str(column_name).strip()],
        ).fetchone()
        return bool(row)
    except Exception:
        return False


def _rows_to_csv_bytes(df: pd.DataFrame) -> bytes:
    output = io.StringIO()
    if df is None or df.empty:
        output.write("")
    else:
        safe_df = df.copy()
        for col in safe_df.columns:
            safe_df[col] = safe_df[col].apply(lambda value: value.isoformat() if hasattr(value, "isoformat") else value)
        safe_df.to_csv(output, index=False)
    return output.getvalue().encode("utf-8")


def _org_export_frames(con, org_id: str) -> list[tuple[str, pd.DataFrame]]:
    org = str(org_id).strip()
    frames: list[tuple[str, pd.DataFrame]] = []
    has_memberships = _table_exists(con, "organisation_memberships")

    export_queries: list[tuple[str, str, list[object]]] = [
        ("organisations.csv", "SELECT * FROM organisations WHERE org_id = %s", [org]),
        ("organisation_entitlements.csv", "SELECT * FROM organisation_entitlements WHERE org_id = %s", [org]),
        ("organisation_memberships.csv", "SELECT * FROM organisation_memberships WHERE org_id = %s", [org]),
        ("organisation_invitations.csv", "SELECT * FROM organisation_invitations WHERE org_id = %s", [org]),
        (
            "users.csv",
            """
            SELECT *
            FROM users
            WHERE org_id = %s
            {membership_clause}
            ORDER BY user_id
            """,
            [org],
        ),
        ("clients.csv", "SELECT * FROM clients WHERE org_id = %s ORDER BY db_id", [org]),
        ("client_sites.csv", "SELECT * FROM client_sites WHERE org_id = %s ORDER BY client_db_id, site_id", [org]),
        ("client_contacts.csv", "SELECT * FROM client_contacts WHERE org_id = %s ORDER BY client_db_id, contact_id", [org]),
        ("client_notes.csv", "SELECT * FROM client_notes WHERE org_id = %s ORDER BY client_db_id, note_id", [org]),
        ("jobs.csv", "SELECT * FROM jobs WHERE org_id = %s ORDER BY job_id", [org]),
        ("job_scope_config.csv", "SELECT * FROM job_scope_config WHERE org_id = %s ORDER BY job_id, scope", [org]),
        ("job_scope_rows.csv", "SELECT * FROM job_scope_rows WHERE org_id = %s ORDER BY job_id, source_type, row_id", [org]),
        (
            "job_additional_datasets.csv",
            "SELECT * FROM job_additional_datasets WHERE org_id = %s ORDER BY job_id, dataset_id",
            [org],
        ),
        (
            "job_custom_field_values.csv",
            "SELECT * FROM job_custom_field_values WHERE org_id = %s ORDER BY job_id, custom_field_id",
            [org],
        ),
        (
            "client_custom_field_values.csv",
            "SELECT * FROM client_custom_field_values WHERE org_id = %s ORDER BY client_db_id, custom_field_id",
            [org],
        ),
        ("job_milestones.csv", "SELECT * FROM job_milestones WHERE org_id = %s ORDER BY job_id, milestone_id", [org]),
        (
            "time_logs.csv",
            """
            SELECT *
            FROM time_logs
            WHERE org_id = %s
               OR job_id IN (SELECT job_id FROM jobs WHERE org_id = %s)
            ORDER BY work_date DESC, created_at DESC
            """,
            [org, org],
        ),
        (
            "quotes.csv",
            """
            SELECT *
            FROM quotes
            WHERE org_id = %s
               OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)
            ORDER BY quote_id
            """,
            [org, org],
        ),
        (
            "invoices.csv",
            """
            SELECT *
            FROM invoices
            WHERE org_id = %s
               OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)
            ORDER BY invoice_id
            """,
            [org, org],
        ),
        (
            "invoice_items.csv",
            """
            SELECT *
            FROM invoice_items
            WHERE org_id = %s
               OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)
            ORDER BY invoice_id, line_id
            """,
            [org, org],
        ),
        (
            "organisation_billing_invoices.csv",
            "SELECT * FROM organisation_billing_invoices WHERE org_id = %s ORDER BY created_at DESC, billing_invoice_id",
            [org],
        ),
        (
            "organisation_billing_events.csv",
            "SELECT * FROM organisation_billing_events WHERE org_id = %s ORDER BY created_at DESC, billing_event_id",
            [org],
        ),
        (
            "outbound_email_log.csv",
            """
            SELECT *
            FROM outbound_email_log
            WHERE client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)
               OR job_id IN (SELECT job_id FROM jobs WHERE org_id = %s)
            ORDER BY created_at DESC, email_id DESC
            """,
            [org, org],
        ),
        ("feedback_items.csv", "SELECT * FROM feedback_items WHERE org_id = %s ORDER BY created_at DESC, feedback_id", [org]),
    ]

    if has_memberships:
        export_queries[4] = (
            "users.csv",
            """
            SELECT *
            FROM users
            WHERE org_id = %s
               OR user_id IN (
                    SELECT user_id
                    FROM organisation_memberships
                    WHERE org_id = %s
               )
            ORDER BY user_id
            """,
            [org, org],
        )
    else:
        export_queries[4] = (
            "users.csv",
            """
            SELECT *
            FROM users
            WHERE org_id = %s
            ORDER BY user_id
            """,
            [org],
        )

    for filename, sql, params in export_queries:
        try:
            table_name = filename.replace(".csv", "")
            if not _table_exists(con, table_name):
                continue
            df = con.execute(sql, params).df()
            frames.append((filename, df if df is not None else pd.DataFrame()))
        except Exception as exc:
            logger.warning("Org export table skipped org_id=%s file=%s error=%s", org, filename, exc)
    return frames


def _build_org_export_zip(con, org_id: str, *, actor: str | None = None) -> tuple[io.BytesIO, str, dict[str, object]]:
    org = str(org_id).strip()
    org_row = con.execute(
        """
        SELECT org_id, name, slug, plan, plan_status, trial_ends_at, stripe_customer_id, stripe_subscription_id,
               max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at
        FROM organisations
        WHERE org_id = %s
        LIMIT 1
        """,
        [org],
    ).fetchone()
    if not org_row:
        raise HTTPException(status_code=404, detail="Organisation not found")

    membership_rows = con.execute(
        """
        SELECT role, is_active, is_owner
        FROM organisation_memberships
        WHERE org_id = %s
        ORDER BY created_at ASC
        """,
        [org],
    ).fetchall()
    entitlement = _organisation_entitlement_info(con, org)

    manifest: dict[str, object] = {
        "exported_at_utc": datetime.now(timezone.utc).isoformat(),
        "exported_by": actor,
        "org_id": str(org_row[0] or org),
        "org_name": str(org_row[1] or ""),
        "org_slug": str(org_row[2] or ""),
        "plan": str(org_row[3] or "trial"),
        "plan_status": str(org_row[4] or "active"),
        "trial_ends_at": str(org_row[5]) if org_row[5] else None,
        "membership_count": len(membership_rows or []),
        "entitlement": entitlement,
        "files": [],
    }

    payload = io.BytesIO()
    safe_slug = _slugify_org_name(str(org_row[1] or org))
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive_name = f"gdpr_export_{safe_slug}_{timestamp}.zip"

    with zipfile.ZipFile(payload, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for filename, df in _org_export_frames(con, org):
            csv_bytes = _rows_to_csv_bytes(df)
            zf.writestr(filename, csv_bytes)
            manifest["files"].append({"name": filename, "rows": int(len(df.index) if df is not None else 0)})
        zf.writestr("manifest.json", json.dumps(manifest, default=str, indent=2))
    payload.seek(0)
    return payload, archive_name, manifest


def _delete_org_data(con, org_id: str) -> dict[str, object]:
    org = str(org_id).strip()
    counts: list[dict[str, object]] = []

    job_rows = con.execute("SELECT job_id FROM jobs WHERE org_id = %s", [org]).fetchall() if _table_exists(con, "jobs") else []
    client_rows = con.execute("SELECT db_id FROM clients WHERE org_id = %s", [org]).fetchall() if _table_exists(con, "clients") else []
    member_user_ids = [
        str(row[0]).strip()
        for row in (con.execute("SELECT user_id FROM organisation_memberships WHERE org_id = %s", [org]).fetchall() if _table_exists(con, "organisation_memberships") else [])
        if row and row[0] is not None and str(row[0]).strip()
    ]

    delete_specs: list[tuple[str, str, list[object]]] = [
        ("registration_verification_tokens", "DELETE FROM registration_verification_tokens WHERE org_id = %s", [org]),
        ("outbound_email_log", "DELETE FROM outbound_email_log WHERE client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s) OR job_id IN (SELECT job_id FROM jobs WHERE org_id = %s)", [org, org]),
        ("invoice_items", "DELETE FROM invoice_items WHERE org_id = %s OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)", [org, org]),
        ("invoices", "DELETE FROM invoices WHERE org_id = %s OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)", [org, org]),
        ("quotes", "DELETE FROM quotes WHERE org_id = %s OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)", [org, org]),
        ("time_logs", "DELETE FROM time_logs WHERE org_id = %s OR job_id IN (SELECT job_id FROM jobs WHERE org_id = %s)", [org, org]),
        ("job_scope_rows", "DELETE FROM job_scope_rows WHERE org_id = %s OR job_id IN (SELECT job_id FROM jobs WHERE org_id = %s)", [org, org]),
        ("job_scope_config", "DELETE FROM job_scope_config WHERE org_id = %s OR job_id IN (SELECT job_id FROM jobs WHERE org_id = %s)", [org, org]),
        ("job_additional_datasets", "DELETE FROM job_additional_datasets WHERE org_id = %s OR job_id IN (SELECT job_id FROM jobs WHERE org_id = %s)", [org, org]),
        ("job_custom_field_values", "DELETE FROM job_custom_field_values WHERE org_id = %s OR job_id IN (SELECT job_id FROM jobs WHERE org_id = %s)", [org, org]),
        ("job_milestones", "DELETE FROM job_milestones WHERE org_id = %s OR job_id IN (SELECT job_id FROM jobs WHERE org_id = %s)", [org, org]),
        ("client_custom_field_values", "DELETE FROM client_custom_field_values WHERE org_id = %s OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)", [org, org]),
        ("client_notes", "DELETE FROM client_notes WHERE org_id = %s OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)", [org, org]),
        ("client_contacts", "DELETE FROM client_contacts WHERE org_id = %s OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)", [org, org]),
        ("client_sites", "DELETE FROM client_sites WHERE org_id = %s OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)", [org, org]),
        ("jobs", "DELETE FROM jobs WHERE org_id = %s OR client_db_id IN (SELECT db_id FROM clients WHERE org_id = %s)", [org, org]),
        ("clients", "DELETE FROM clients WHERE org_id = %s", [org]),
        ("organisation_billing_events", "DELETE FROM organisation_billing_events WHERE org_id = %s", [org]),
        ("organisation_billing_invoices", "DELETE FROM organisation_billing_invoices WHERE org_id = %s", [org]),
        ("organisation_invitations", "DELETE FROM organisation_invitations WHERE org_id = %s", [org]),
        ("organisation_memberships", "DELETE FROM organisation_memberships WHERE org_id = %s", [org]),
        ("organisation_entitlements", "DELETE FROM organisation_entitlements WHERE org_id = %s", [org]),
        ("users", "DELETE FROM users WHERE org_id = %s", [org]),
        ("organisations", "DELETE FROM organisations WHERE org_id = %s", [org]),
    ]

    for table_name, sql, params in delete_specs:
        if not _table_exists(con, table_name):
            continue
        try:
            if table_name == "users":
                user_ids = tuple(member_user_ids)
                if user_ids:
                    placeholders = ", ".join(["%s"] * len(user_ids))
                    sql = f"DELETE FROM users WHERE org_id = %s OR user_id IN ({placeholders})"
                    params = [org, *user_ids]
                else:
                    sql = "DELETE FROM users WHERE org_id = %s"
                    params = [org]
            deleted_rows = con.execute(f"{sql} RETURNING 1", params).fetchall()
            counts.append({"table": table_name, "deleted": len(deleted_rows or [])})
        except Exception as exc:
            logger.warning("Org delete table skipped org_id=%s table=%s error=%s", org, table_name, exc)
            counts.append({"table": table_name, "deleted": 0, "skipped": True, "error": str(exc)})

    return {
        "org_id": org,
        "jobs_scanned": len(job_rows or []),
        "clients_scanned": len(client_rows or []),
        "tables": counts,
    }


def _require_org_capacity(
    con,
    org_id: str,
    *,
    additional_users: int = 0,
    additional_clients: int = 0,
    count_pending_invites: bool = False,
) -> dict[str, int | bool | str]:
    usage = _organisation_usage_info(con, org_id)
    def _raise_capacity_error(
        *,
        reason: str,
        message: str,
        limit_type: str | None = None,
        limit_value: int | None = None,
        current_value: int | None = None,
        additional_value: int | None = None,
    ) -> None:
        detail: dict[str, object] = {
            "message": message,
            "reason": reason,
            "org_id": org_id,
            "plan": usage.get("plan"),
            "plan_status": usage.get("plan_status"),
            "max_users": usage.get("max_users"),
            "max_clients": usage.get("max_clients"),
            "active_members": usage.get("active_members"),
            "active_clients": usage.get("active_clients"),
            "pending_invites": usage.get("pending_invites"),
        }
        if limit_type is not None:
            detail["limit_type"] = limit_type
        if limit_value is not None:
            detail["limit_value"] = limit_value
        if current_value is not None:
            detail["current_value"] = current_value
        if additional_value is not None:
            detail["additional_value"] = additional_value
        raise HTTPException(status_code=403, detail=detail)

    if bool(usage.get("archived")):
        logger.warning(
            "Organisation capacity denied org_id=%s reason=archived plan_status=%s max_users=%s max_clients=%s active_members=%s active_clients=%s pending_invites=%s",
            org_id,
            usage.get("plan_status"),
            usage.get("max_users"),
            usage.get("max_clients"),
            usage.get("active_members"),
            usage.get("active_clients"),
            usage.get("pending_invites"),
        )
        _raise_capacity_error(reason="archived", message="Organisation is archived")

    plan_status = str(usage.get("plan_status") or "active").strip().lower()
    if plan_status not in {"active", "trial"}:
        logger.warning(
            "Organisation capacity denied org_id=%s reason=inactive_plan plan_status=%s max_users=%s max_clients=%s active_members=%s active_clients=%s pending_invites=%s",
            org_id,
            usage.get("plan_status"),
            usage.get("max_users"),
            usage.get("max_clients"),
            usage.get("active_members"),
            usage.get("active_clients"),
            usage.get("pending_invites"),
        )
        _raise_capacity_error(reason="inactive_plan", message="Organisation plan is not active")

    max_users = int(usage.get("max_users") or 0)
    max_clients = int(usage.get("max_clients") or 0)
    active_members = int(usage.get("active_members") or 0)
    pending_invites = int(usage.get("pending_invites") or 0)
    active_clients = int(usage.get("active_clients") or 0)

    users_in_use = active_members + (pending_invites if count_pending_invites else 0)
    if max_users > 0 and users_in_use + additional_users > max_users:
        logger.warning(
            "Organisation capacity denied org_id=%s reason=user_limit users_in_use=%s max_users=%s additional_users=%s active_clients=%s",
            org_id,
            users_in_use,
            max_users,
            additional_users,
            active_clients,
        )
        _raise_capacity_error(
            reason="user_limit",
            message=f"Organisation user limit reached ({users_in_use}/{max_users})",
            limit_type="users",
            limit_value=max_users,
            current_value=users_in_use,
            additional_value=additional_users,
        )
    if max_clients > 0 and active_clients + additional_clients > max_clients:
        logger.warning(
            "Organisation capacity denied org_id=%s reason=client_limit active_clients=%s max_clients=%s additional_clients=%s active_members=%s pending_invites=%s",
            org_id,
            active_clients,
            max_clients,
            additional_clients,
            active_members,
            pending_invites,
        )
        _raise_capacity_error(
            reason="client_limit",
            message=f"Organisation client limit reached ({active_clients}/{max_clients})",
            limit_type="clients",
            limit_value=max_clients,
            current_value=active_clients,
            additional_value=additional_clients,
        )
    return usage


def _require_org_plan_active(con, org_id: str) -> dict[str, int | bool | str]:
    usage = _organisation_usage_info(con, org_id)
    if bool(usage.get("archived")):
        logger.warning(
            "Organisation action denied org_id=%s reason=archived plan_status=%s max_users=%s max_clients=%s active_members=%s active_clients=%s pending_invites=%s",
            org_id,
            usage.get("plan_status"),
            usage.get("max_users"),
            usage.get("max_clients"),
            usage.get("active_members"),
            usage.get("active_clients"),
            usage.get("pending_invites"),
        )
        raise HTTPException(
            status_code=403,
            detail={
                "message": "Organisation is archived",
                "reason": "archived",
                "org_id": org_id,
                "plan": usage.get("plan"),
                "plan_status": usage.get("plan_status"),
                "max_users": usage.get("max_users"),
                "max_clients": usage.get("max_clients"),
                "active_members": usage.get("active_members"),
                "active_clients": usage.get("active_clients"),
                "pending_invites": usage.get("pending_invites"),
            },
        )

    plan_status = str(usage.get("plan_status") or "active").strip().lower()
    if plan_status not in {"active", "trial"}:
        logger.warning(
            "Organisation action denied org_id=%s reason=inactive_plan plan_status=%s max_users=%s max_clients=%s active_members=%s active_clients=%s pending_invites=%s",
            org_id,
            usage.get("plan_status"),
            usage.get("max_users"),
            usage.get("max_clients"),
            usage.get("active_members"),
            usage.get("active_clients"),
            usage.get("pending_invites"),
        )
        raise HTTPException(
            status_code=403,
            detail={
                "message": "Organisation plan is not active",
                "reason": "inactive_plan",
                "org_id": org_id,
                "plan": usage.get("plan"),
                "plan_status": usage.get("plan_status"),
                "max_users": usage.get("max_users"),
                "max_clients": usage.get("max_clients"),
                "active_members": usage.get("active_members"),
                "active_clients": usage.get("active_clients"),
                "pending_invites": usage.get("pending_invites"),
            },
        )
    return usage


def _slugify_org_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")
    return slug or "organisation"


def _actor_identifier(user: dict) -> str:
    return str(
        user.get("email")
        or user.get("user_id")
        or user.get("full_name")
        or "system"
    ).strip()


def _invite_expiry(days: int = 7) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


def _organisation_row_to_dict(row) -> dict[str, object]:
    def _value(idx: int):
        try:
            return row[idx]
        except Exception:
            return None

    return {
        "org_id": str(_value(0)) if _value(0) is not None else None,
        "name": str(_value(1) or ""),
        "slug": str(_value(2) or ""),
        "plan": str(_value(3) or "trial"),
        "plan_status": str(_value(4) or "active"),
        "max_users": int(_value(5) or 0),
        "max_clients": int(_value(6) or 0),
        "archived": bool(_value(7)) if _value(7) is not None else False,
        "archived_at": str(_value(8)) if _value(8) else None,
        "archived_by": str(_value(9)) if _value(9) else None,
        "created_at": str(_value(10)) if _value(10) else None,
        "updated_at": str(_value(11)) if _value(11) else None,
    }
