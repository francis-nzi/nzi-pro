from __future__ import annotations

from typing import Any

from core.database import get_conn

SUPERADMIN_ROLE = "SuperAdmin"
ADMIN_ACCESS_PERMISSION = "admin.access"

PERMISSIONS: dict[str, str] = {
    "admin.access": "Access the admin area.",
    "admin.audit.view": "View the audit log.",
    "admin.team.manage": "Manage team members and roles.",
    "admin.reference.manage": "Manage lookups, job items, suppliers, and reference data.",
    "admin.datasets.manage": "Manage datasets and conversion factors.",
    "admin.reporting.manage": "Manage templates, milestones, automations, and delivery settings.",
    "admin.system.manage": "Manage system settings, theme, import/export, and archive tools.",
    "clients.view": "View clients.",
    "clients.create": "Create clients.",
    "clients.edit": "Edit clients.",
    "jobs.view": "View jobs.",
    "jobs.create": "Create jobs.",
    "jobs.edit": "Edit jobs.",
    "jobs.data.edit": "Edit job data.",
    "jobs.reporting.view": "View job reporting outputs.",
    "insights.view": "View insights.",
    "sales.view": "View sales data.",
    "financial.view": "View financial data.",
    "financial.manage": "Manage quotes, invoices, and financial data.",
    "time.view": "View time data.",
}

ROLE_PERMISSION_GRANTS: dict[str, set[str]] = {
    SUPERADMIN_ROLE: set(PERMISSIONS.keys()),
    "Admin": set(PERMISSIONS.keys()),
    "Consultant": {
        "clients.view",
        "clients.create",
        "clients.edit",
        "jobs.view",
        "jobs.create",
        "jobs.edit",
        "jobs.data.edit",
        "jobs.reporting.view",
        "insights.view",
        "sales.view",
        "time.view",
    },
    "ReadOnly": {
        "clients.view",
        "jobs.view",
        "jobs.reporting.view",
        "insights.view",
        "sales.view",
        "financial.view",
        "time.view",
    },
    "CRM": {
        "clients.view",
        "clients.create",
        "clients.edit",
        "jobs.view",
        "jobs.create",
        "jobs.edit",
        "insights.view",
        "sales.view",
    },
    "QA": {
        "clients.view",
        "jobs.view",
        "jobs.data.edit",
        "jobs.reporting.view",
        "insights.view",
    },
    "Support": {
        "clients.view",
        "jobs.view",
        "jobs.data.edit",
        "jobs.reporting.view",
        "insights.view",
    },
}

SEEDED_SUPERADMINS = (
    "francis@netzero.international",
    "david@netzero.international",
    "jennie@netzero.international",
)


def ensure_permission_schema(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS permissions_lookup (
            permission_key VARCHAR PRIMARY KEY,
            description TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS role_permissions (
            role_name VARCHAR NOT NULL,
            permission_key VARCHAR NOT NULL,
            allow BOOLEAN NOT NULL DEFAULT TRUE,
            PRIMARY KEY (role_name, permission_key)
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS user_permission_overrides (
            user_id VARCHAR NOT NULL,
            permission_key VARCHAR NOT NULL,
            effect VARCHAR NOT NULL,
            reason TEXT,
            updated_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (user_id, permission_key)
        )
        """
    )
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR DEFAULT 'internal'")
    except Exception:
        pass

    for role_name in ROLE_PERMISSION_GRANTS.keys():
        con.execute(
            """
            INSERT INTO roles_lookup (role_name, is_active)
            VALUES (?, TRUE)
            ON CONFLICT (role_name) DO NOTHING
            """,
            [role_name],
        )

    for permission_key, description in PERMISSIONS.items():
        con.execute(
            """
            INSERT INTO permissions_lookup (permission_key, description, is_active)
            VALUES (?, ?, TRUE)
            ON CONFLICT (permission_key) DO UPDATE SET
                description = EXCLUDED.description,
                is_active = TRUE
            """,
            [permission_key, description],
        )

    for role_name, grants in ROLE_PERMISSION_GRANTS.items():
        for permission_key in grants:
            con.execute(
                """
                INSERT INTO role_permissions (role_name, permission_key, allow)
                VALUES (?, ?, TRUE)
                ON CONFLICT (role_name, permission_key) DO UPDATE SET allow = EXCLUDED.allow
                """,
                [role_name, permission_key],
            )

    con.execute(
        """
        UPDATE users
        SET user_type = 'internal'
        WHERE user_type IS NULL OR TRIM(user_type) = ''
        """
    )

    for email in SEEDED_SUPERADMINS:
        con.execute(
            """
            UPDATE users
            SET role = ?, user_type = 'internal'
            WHERE LOWER(COALESCE(email, '')) = LOWER(?)
            """,
            [SUPERADMIN_ROLE, email],
        )


def _load_user_identity(con, user_id: str) -> tuple[str, str] | None:
    row = con.execute(
        """
        SELECT COALESCE(role, 'ReadOnly') AS role,
               COALESCE(user_type, 'internal') AS user_type
        FROM users
        WHERE LOWER(COALESCE(user_id, '')) = LOWER(?)
        LIMIT 1
        """,
        [str(user_id or "").strip()],
    ).fetchone()
    if not row:
        return None
    return str(row[0] or "ReadOnly"), str(row[1] or "internal")


def get_effective_permissions_for_user(user_id: str, role_hint: str | None = None) -> dict[str, Any]:
    user_id_norm = str(user_id or "").strip()
    if not user_id_norm:
        return {
            "role": str(role_hint or "ReadOnly"),
            "user_type": "internal",
            "is_super_admin": False,
            "effective_permissions": [],
            "denied_permissions": [],
        }

    with get_conn() as con:
        ensure_permission_schema(con)
        identity = _load_user_identity(con, user_id_norm)
        role_name = str(role_hint or (identity[0] if identity else "ReadOnly") or "ReadOnly")
        user_type = str(identity[1] if identity else "internal")
        is_super_admin = role_name.strip().lower() == SUPERADMIN_ROLE.lower()

        if is_super_admin:
            return {
                "role": role_name,
                "user_type": user_type,
                "is_super_admin": True,
                "effective_permissions": sorted(PERMISSIONS.keys()),
                "denied_permissions": [],
            }

        role_rows = con.execute(
            """
            SELECT permission_key
            FROM role_permissions
            WHERE LOWER(role_name) = LOWER(?)
              AND allow = TRUE
            """,
            [role_name],
        ).fetchall()
        granted = {str(row[0]) for row in (role_rows or []) if row and row[0]}

        override_rows = con.execute(
            """
            SELECT permission_key, LOWER(COALESCE(effect, 'deny')) AS effect
            FROM user_permission_overrides
            WHERE LOWER(user_id) = LOWER(?)
            """,
            [user_id_norm],
        ).fetchall()
        denied: set[str] = set()
        for row in override_rows or []:
            permission_key = str(row[0] or "").strip()
            effect = str(row[1] or "deny").strip().lower()
            if not permission_key:
                continue
            if effect == "allow":
                granted.add(permission_key)
                denied.discard(permission_key)
            else:
                denied.add(permission_key)
                granted.discard(permission_key)

        return {
            "role": role_name,
            "user_type": user_type,
            "is_super_admin": False,
            "effective_permissions": sorted(granted),
            "denied_permissions": sorted(denied),
        }


def enrich_user_permissions(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return user
    user_id = str(user.get("user_id") or "").strip()
    role_hint = str(user.get("role") or "").strip() or None
    resolved = get_effective_permissions_for_user(user_id, role_hint=role_hint)
    enriched = dict(user)
    enriched["role"] = resolved["role"]
    enriched["user_type"] = resolved["user_type"]
    enriched["is_super_admin"] = bool(resolved["is_super_admin"])
    enriched["effective_permissions"] = list(resolved["effective_permissions"])
    enriched["denied_permissions"] = list(resolved["denied_permissions"])
    return enriched


def user_has_permission(user: dict[str, Any] | None, permission_key: str) -> bool:
    if not user:
        return False
    if bool(user.get("is_super_admin")):
        return True
    effective_permissions = user.get("effective_permissions") or []
    return str(permission_key or "").strip() in {str(p or "").strip() for p in effective_permissions}
