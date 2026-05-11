"""
Shared admin-user helper functions used by the user management routes.
"""

from datetime import datetime, timezone

import pandas as pd

from core.auth import set_user_password
from core.database import get_conn
from services.messaging_templates import build_email_content
from services.outbound_email import send_tracked_email
from services.permissions import (
    ACCESS_SCOPES,
    DEFAULT_INTERNAL_ACCESS_SCOPE,
    DEFAULT_PORTAL_ACCESS_SCOPE,
    ensure_permission_schema,
)

def _normalize_user_type(value: object | None) -> str:
    normalized = str(value or "internal").strip().lower()
    return "client_portal" if normalized == "client_portal" else "internal"


def _normalize_access_scope(user_type: str, value: object | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in ACCESS_SCOPES:
        return normalized
    if user_type == "client_portal":
        return DEFAULT_PORTAL_ACCESS_SCOPE
    return DEFAULT_INTERNAL_ACCESS_SCOPE


def _fetch_linked_clients(con, email: str) -> list[dict[str, object]]:
    rows = con.execute(
        """
        SELECT cu.client_db_id, COALESCE(cu.role_name, ''), COALESCE(c.client_name, '')
        FROM client_users cu
        LEFT JOIN clients c ON c.db_id = cu.client_db_id
        WHERE LOWER(COALESCE(cu.user_id, '')) = LOWER(?)
          AND COALESCE(cu.is_active, TRUE) = TRUE
        ORDER BY c.client_name ASC, cu.client_db_id ASC
        """,
        [str(email or "").strip().lower()],
    ).fetchall()
    items: list[dict[str, object]] = []
    for row in rows or []:
        if not row or row[0] is None:
            continue
        items.append(
            {
                "client_db_id": int(row[0]),
                "role_name": str(row[1] or "").strip() or None,
                "client_name": str(row[2] or "").strip() or None,
            }
        )
    return items


def _replace_linked_clients(
    con,
    *,
    email: str,
    actor: str,
    linked_clients: list[dict[str, object]] | list[int],
) -> list[dict[str, object]]:
    email_norm = str(email or "").strip().lower()
    con.execute(
        "DELETE FROM client_users WHERE LOWER(COALESCE(user_id, '')) = LOWER(?)",
        [email_norm],
    )
    seen: set[int] = set()
    for item in linked_clients or []:
        if isinstance(item, dict):
            client_id = item.get("client_db_id")
            role_name = str(item.get("role_name") or "").strip() or None
        else:
            client_id = item
            role_name = None
        try:
            client_id_int = int(client_id)  # type: ignore[arg-type]
        except Exception:
            continue
        if client_id_int in seen:
            continue
        seen.add(client_id_int)
        con.execute(
            """
            INSERT INTO client_users (user_id, client_db_id, role_name, is_active, created_by, updated_at)
            VALUES (?, ?, ?, TRUE, ?, NOW())
            """,
            [email_norm, client_id_int, role_name, actor],
        )
    return _fetch_linked_clients(con, email_norm)


def _ensure_users_position_column(con) -> None:
    """Ensure users.position exists for consultant position metadata."""
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR")
    except Exception:
        # Keep admin routes resilient if schema changes lag behind.
        pass


def _ensure_users_password_column(con) -> None:
    """Ensure users.password_hash exists for credential-based login."""
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE")
    except Exception:
        pass


def _ensure_users_invite_columns(con) -> None:
    """Ensure users invite lifecycle columns exist."""
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by VARCHAR")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP")
    except Exception:
        pass


def _ensure_users_cost_sell_mobile_columns(con) -> None:
    """Ensure user commercial and mobile fields exist."""
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS cost_per_hour NUMERIC(12,2)")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS sell_per_hour NUMERIC(12,2)")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_phone VARCHAR")
    except Exception:
        pass


def _ensure_positions_lookup_table(con) -> None:
    """Ensure positions lookup table exists before admin lookup operations."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS positions_lookup (
              position_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        default_positions = [
            "Chief Commercial Officer",
            "Chief Executive Officer",
            "Chief Information Officer",
            "Customer Relationship Manager",
        ]
        for position_name in default_positions:
            con.execute(
                """
                INSERT INTO positions_lookup (name, is_active)
                SELECT %s, TRUE
                WHERE NOT EXISTS (
                  SELECT 1 FROM positions_lookup WHERE lower(name) = lower(%s)
                )
                """,
                [position_name, position_name],
            )
    except Exception:
        # Keep admin routes resilient during schema transitions.
        pass

def _ensure_admin_user_schema_once(con) -> None:
    global _ADMIN_USER_BOOTSTRAPPED
    with _ADMIN_USER_BOOTSTRAP_LOCK:
        if _ADMIN_USER_BOOTSTRAPPED:
            return
        ensure_permission_schema(con)
        _ensure_users_position_column(con)
        _ensure_users_password_column(con)
        _ensure_users_invite_columns(con)
        _ensure_users_cost_sell_mobile_columns(con)
        _ADMIN_USER_BOOTSTRAPPED = True


def _ensure_supplier_tables(con) -> None:
    """Ensure supplier master and supplier service item tables exist."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS suppliers (
              supplier_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              supplier_name VARCHAR NOT NULL,
              address TEXT,
              contact_name VARCHAR,
              contact_email VARCHAR,
              website VARCHAR,
              phone VARCHAR,
              notes TEXT,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
        con.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_name_ci ON suppliers (lower(supplier_name))")
    except Exception:
        pass

    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS supplier_service_items (
              supplier_item_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              supplier_id INTEGER NOT NULL,
              cost_type VARCHAR,
              item_name VARCHAR NOT NULL,
              description TEXT,
              uom VARCHAR,
              agreed_rate DOUBLE PRECISION DEFAULT 0,
              is_vatable BOOLEAN DEFAULT FALSE,
              vat_rate_pct DOUBLE PRECISION DEFAULT 0,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS ix_supplier_service_items_supplier_id ON supplier_service_items (supplier_id)"
        )
    except Exception:
        pass

def _send_team_access_email(
    *,
    to_email: str,
    full_name: str,
    role: str,
    temporary_password: str,
    invite_expires_at: datetime | None,
    template_key: str,
    sender_identifier: str,
) -> dict:
    if not str(to_email or "").strip():
        return {"status": "skipped", "error": "Recipient email is blank"}

    sender_name = sender_identifier
    context = {
        "full_name": str(full_name or "").strip() or str(to_email or "").strip(),
        "email": str(to_email or "").strip(),
        "role": str(role or "").strip(),
        "temporary_password": str(temporary_password or "").strip(),
        "invite_expires_at": invite_expires_at.isoformat() if invite_expires_at else "",
        "sender_name": sender_name,
    }

    fallback_subject = "Your NZI Pro account details"
    fallback_body = (
        f"<p>Hi {context['full_name']},</p>"
        "<p>Your NZI Pro access details are below:</p>"
        f"<p>Username: <strong>{context['email']}</strong><br/>"
        f"Temporary password: <strong>{context['temporary_password']}</strong><br/>"
        f"Expires: <strong>{context['invite_expires_at']}</strong></p>"
        "<p>Please sign in and change your password immediately.</p>"
        f"<p>Kind regards,<br/>{sender_name}</p>"
    )

    with get_conn() as con:
        rendered = build_email_content(
            con=con,
            template_key=template_key,
            context=context,
            fallback_subject=fallback_subject,
            fallback_body=fallback_body,
            sender_identifier=sender_identifier,
        )
        result = send_tracked_email(
            con,
            to_email=context["email"],
            subject=rendered["subject"],
            body_text=rendered["body_text"],
            body_html=rendered["body_html"],
            created_by=sender_identifier,
            template_key=template_key,
            entity_type="team_member",
            metadata={"flow": template_key},
            raise_on_error=False,
        )
    return result


def _is_invite_lapsed(expires_at, has_password: bool, must_change_password: bool) -> bool:
    if not expires_at:
        return False

    expiry_dt = expires_at
    if isinstance(expires_at, str):
        try:
            expiry_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except Exception:
            return False

    try:
        if getattr(expiry_dt, "tzinfo", None) is None:
            now = datetime.utcnow()
        else:
            now = datetime.now(timezone.utc)
        return bool(now > expiry_dt and ((not has_password) or must_change_password))
    except Exception:
        return False
