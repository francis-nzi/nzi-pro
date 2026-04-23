from __future__ import annotations

import threading
import time
from typing import Any

from core.database import get_conn
from services.tenancy import get_default_org_id

SUPERADMIN_ROLE = "SuperAdmin"
ADMIN_ACCESS_PERMISSION = "admin.access"
DEFAULT_INTERNAL_ACCESS_SCOPE = "all"
DEFAULT_PORTAL_ACCESS_SCOPE = "linked_clients"
ACCESS_SCOPES = {DEFAULT_INTERNAL_ACCESS_SCOPE, DEFAULT_PORTAL_ACCESS_SCOPE}

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
    "clients.sites.manage": "Manage client sites.",
    "clients.contacts.manage": "Manage client contacts.",
    "jobs.view": "View jobs.",
    "jobs.create": "Create jobs.",
    "jobs.edit": "Edit jobs.",
    "jobs.data.edit": "Edit job data.",
    "jobs.data.import": "Import job data from templates and files.",
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
        "clients.sites.manage",
        "clients.contacts.manage",
        "jobs.view",
        "jobs.create",
        "jobs.edit",
        "jobs.data.edit",
        "jobs.data.import",
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
        "clients.contacts.manage",
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
    "ClientAdmin": {
        "clients.view",
        "clients.edit",
        "clients.sites.manage",
        "clients.contacts.manage",
        "jobs.view",
        "jobs.data.edit",
        "jobs.data.import",
        "jobs.reporting.view",
    },
    "ClientContributor": {
        "clients.view",
        "clients.contacts.manage",
        "jobs.view",
        "jobs.data.edit",
        "jobs.data.import",
        "jobs.reporting.view",
    },
    "ClientViewer": {
        "clients.view",
        "jobs.view",
        "jobs.reporting.view",
    },
    "ClientReporting": {
        "clients.view",
        "jobs.view",
        "jobs.reporting.view",
        "insights.view",
    },
}

SEEDED_SUPERADMINS = (
    "francis@netzero.international",
    "david@netzero.international",
    "jennie@netzero.international",
)

_PERMISSION_CACHE_TTL_SECONDS = 60.0
_permission_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_permission_cache_lock = threading.Lock()
_permission_schema_ready = False
_permission_schema_lock = threading.Lock()


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
    try:
        con.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS access_scope VARCHAR DEFAULT '{DEFAULT_INTERNAL_ACCESS_SCOPE}'")
    except Exception:
        pass
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS client_users (
            user_id VARCHAR NOT NULL,
            client_db_id INTEGER NOT NULL,
            role_name VARCHAR,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by VARCHAR,
            PRIMARY KEY (user_id, client_db_id)
        )
        """
    )

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
    con.execute(
        f"""
        UPDATE users
        SET access_scope = CASE
            WHEN LOWER(COALESCE(user_type, 'internal')) = 'client_portal' THEN '{DEFAULT_PORTAL_ACCESS_SCOPE}'
            ELSE '{DEFAULT_INTERNAL_ACCESS_SCOPE}'
        END
        WHERE access_scope IS NULL OR TRIM(access_scope) = ''
        """
    )

    for email in SEEDED_SUPERADMINS:
        con.execute(
            """
            UPDATE users
            SET role = ?, user_type = 'internal', access_scope = ?
            WHERE LOWER(COALESCE(email, '')) = LOWER(?)
            """,
            [SUPERADMIN_ROLE, DEFAULT_INTERNAL_ACCESS_SCOPE, email],
        )


def _normalize_user_type(value: str | None) -> str:
    normalized = str(value or "internal").strip().lower()
    return "client_portal" if normalized == "client_portal" else "internal"


def _normalize_access_scope(user_type: str | None, value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in ACCESS_SCOPES:
        return normalized
    if _normalize_user_type(user_type) == "client_portal":
        return DEFAULT_PORTAL_ACCESS_SCOPE
    return DEFAULT_INTERNAL_ACCESS_SCOPE


def _load_user_identity(con, user_id: str) -> tuple[str, str, str] | None:
    row = con.execute(
        """
        SELECT COALESCE(role, 'ReadOnly') AS role,
               COALESCE(user_type, 'internal') AS user_type,
               COALESCE(access_scope, 'all') AS access_scope
        FROM users
        WHERE LOWER(COALESCE(user_id, '')) = LOWER(?)
        LIMIT 1
        """,
        [str(user_id or "").strip()],
    ).fetchone()
    if not row:
        return None
    user_type = _normalize_user_type(str(row[1] or "internal"))
    access_scope = _normalize_access_scope(user_type, str(row[2] or DEFAULT_INTERNAL_ACCESS_SCOPE))
    return str(row[0] or "ReadOnly"), user_type, access_scope


def _load_linked_clients(con, user_id: str) -> list[dict[str, Any]]:
    rows = con.execute(
        """
        SELECT cu.client_db_id, COALESCE(cu.role_name, ''), COALESCE(c.client_name, '')
        FROM client_users cu
        LEFT JOIN clients c ON c.db_id = cu.client_db_id
        WHERE LOWER(COALESCE(cu.user_id, '')) = LOWER(?)
          AND COALESCE(cu.is_active, TRUE) = TRUE
        ORDER BY c.client_name ASC, cu.client_db_id ASC
        """,
        [str(user_id or "").strip()],
    ).fetchall()
    linked: list[dict[str, Any]] = []
    for row in rows or []:
        client_id = int(row[0]) if row and row[0] is not None else None
        if client_id is None:
            continue
        linked.append(
            {
                "client_db_id": client_id,
                "role_name": str(row[1] or "").strip() or None,
                "client_name": str(row[2] or "").strip() or None,
            }
        )
    return linked


def _copy_resolved_permissions(payload: dict[str, Any]) -> dict[str, Any]:
    copied = dict(payload)
    copied["effective_permissions"] = list(payload.get("effective_permissions") or [])
    copied["denied_permissions"] = list(payload.get("denied_permissions") or [])
    copied["linked_client_ids"] = list(payload.get("linked_client_ids") or [])
    copied["linked_clients"] = [dict(item) for item in (payload.get("linked_clients") or [])]
    return copied


def _ensure_permission_schema_if_needed() -> None:
    global _permission_schema_ready
    if _permission_schema_ready:
        return
    with _permission_schema_lock:
        if _permission_schema_ready:
            return
        with get_conn() as con:
            ensure_permission_schema(con)
        _permission_schema_ready = True


def invalidate_permission_cache(user_id: str | None = None) -> None:
    user_key = str(user_id or "").strip().lower()
    with _permission_cache_lock:
        if user_key:
            _permission_cache.pop(user_key, None)
            return
        _permission_cache.clear()


def get_effective_permissions_for_user(user_id: str, role_hint: str | None = None) -> dict[str, Any]:
    user_id_norm = str(user_id or "").strip()
    if not user_id_norm:
        return {
            "role": str(role_hint or "ReadOnly"),
            "user_type": "internal",
            "access_scope": DEFAULT_INTERNAL_ACCESS_SCOPE,
            "is_super_admin": False,
            "effective_permissions": [],
            "denied_permissions": [],
            "linked_client_ids": [],
            "linked_clients": [],
        }

    cache_key = user_id_norm.lower()
    now = time.monotonic()
    with _permission_cache_lock:
        cached = _permission_cache.get(cache_key)
        if cached and (now - cached[0]) < _PERMISSION_CACHE_TTL_SECONDS:
            return _copy_resolved_permissions(cached[1])

    _ensure_permission_schema_if_needed()
    with get_conn() as con:
        identity = _load_user_identity(con, user_id_norm)
        role_name = str(role_hint or (identity[0] if identity else "ReadOnly") or "ReadOnly")
        user_type = str(identity[1] if identity else "internal")
        access_scope = str(identity[2] if identity else _normalize_access_scope(user_type, None))
        linked_clients = _load_linked_clients(con, user_id_norm)
        linked_client_ids = sorted({int(item["client_db_id"]) for item in linked_clients if item.get("client_db_id") is not None})
        is_super_admin = role_name.strip().lower() == SUPERADMIN_ROLE.lower()

        if is_super_admin:
            resolved = {
                "role": role_name,
                "user_type": user_type,
                "access_scope": DEFAULT_INTERNAL_ACCESS_SCOPE,
                "is_super_admin": True,
                "effective_permissions": sorted(PERMISSIONS.keys()),
                "denied_permissions": [],
                "linked_client_ids": linked_client_ids,
                "linked_clients": linked_clients,
            }
            with _permission_cache_lock:
                _permission_cache[cache_key] = (time.monotonic(), _copy_resolved_permissions(resolved))
            return _copy_resolved_permissions(resolved)

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

        resolved = {
            "role": role_name,
            "user_type": user_type,
            "access_scope": access_scope,
            "is_super_admin": False,
            "effective_permissions": sorted(granted),
            "denied_permissions": sorted(denied),
            "linked_client_ids": linked_client_ids,
            "linked_clients": linked_clients,
        }
        with _permission_cache_lock:
            _permission_cache[cache_key] = (time.monotonic(), _copy_resolved_permissions(resolved))
        return _copy_resolved_permissions(resolved)


def enrich_user_permissions(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return user
    user_id = str(user.get("user_id") or "").strip()
    role_hint = str(user.get("role") or "").strip() or None
    resolved = get_effective_permissions_for_user(user_id, role_hint=role_hint)
    enriched = dict(user)
    enriched["role"] = resolved["role"]
    enriched["user_type"] = resolved["user_type"]
    enriched["access_scope"] = resolved["access_scope"]
    enriched["is_super_admin"] = bool(resolved["is_super_admin"])
    enriched["effective_permissions"] = list(resolved["effective_permissions"])
    enriched["denied_permissions"] = list(resolved["denied_permissions"])
    enriched["linked_client_ids"] = list(resolved.get("linked_client_ids") or [])
    enriched["linked_clients"] = list(resolved.get("linked_clients") or [])
    return enriched


def user_has_permission(user: dict[str, Any] | None, permission_key: str) -> bool:
    if not user:
        return False
    if bool(user.get("is_super_admin")):
        return True
    effective_permissions = user.get("effective_permissions") or []
    return str(permission_key or "").strip() in {str(p or "").strip() for p in effective_permissions}


def user_can_access_client(user: dict[str, Any] | None, client_db_id: int) -> bool:
    if not user:
        return False
    if bool(user.get("is_super_admin")):
        return True
    client_id = int(client_db_id)
    user_org_id = str(user.get("org_id") or "").strip()
    if user_org_id:
        try:
            with get_conn() as con:
                row = con.execute(
                    "SELECT org_id FROM clients WHERE db_id = ? LIMIT 1",
                    [client_id],
                ).fetchone()
            if not row:
                return False
            client_org_id = str(row[0] or "").strip()
            if not client_org_id:
                default_org_id = str(get_default_org_id() or "").strip()
                return bool(default_org_id) and user_org_id == default_org_id
            return client_org_id == user_org_id
        except Exception:
            return False
    return False


def user_can_access_job(user: dict[str, Any] | None, job_id: int) -> bool:
    if not user:
        return False
    if bool(user.get("is_super_admin")):
        return True
    user_org_id = str(user.get("org_id") or "").strip()
    if user_org_id:
        try:
            with get_conn() as con:
                row = con.execute(
                    """
                    SELECT j.client_db_id, c.org_id
                    FROM jobs j
                    JOIN clients c ON c.db_id = j.client_db_id
                    WHERE j.job_id = ?
                    LIMIT 1
                    """,
                    [int(job_id)],
                ).fetchone()
            if row:
                client_db_id = int(row[0]) if row[0] is not None else None
                job_org_id = str(row[1] or "").strip()
                if not job_org_id:
                    default_org_id = str(get_default_org_id() or "").strip()
                    return bool(default_org_id) and user_org_id == default_org_id
                return job_org_id == user_org_id
        except Exception:
            return False
    return False
