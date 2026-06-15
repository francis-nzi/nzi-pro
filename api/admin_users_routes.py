"""
Admin API routes for team users, access control, and password management.
"""

import secrets
import string
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Body, Depends, HTTPException

from api.auth import _current_user
from api.org_admin_helpers import _actor_identifier, _invite_expiry
from api.admin_user_helpers import (
    _ensure_admin_user_schema_once,
    _ensure_users_cost_sell_mobile_columns,
    _ensure_users_invite_columns,
    _ensure_users_password_column,
    _ensure_users_position_column,
    _fetch_linked_clients,
    _is_invite_lapsed,
    _normalize_access_scope,
    _normalize_user_type,
    _replace_linked_clients,
    _send_team_access_email,
)
from core.auth import set_user_password
from core.database import get_conn
from services.permissions import (
    ACCESS_SCOPES,
    ADMIN_ACCESS_PERMISSION,
    DEFAULT_INTERNAL_ACCESS_SCOPE,
    DEFAULT_PORTAL_ACCESS_SCOPE,
    PERMISSIONS,
    SUPERADMIN_ROLE,
    ensure_permission_schema,
    get_effective_permissions_for_user,
    invalidate_permission_cache,
)
from api.permissions import require_permission

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)

# =========================
# TEAM MANAGEMENT
# =========================

@router.get("/users")
def list_users(_user: dict = Depends(_current_user)):
    """List all users."""
    try:
        with get_conn() as con:
            _ensure_admin_user_schema_once(con)
            df = con.execute(
                """
                SELECT user_id, full_name, email, role, position, status, password_hash,
                       invited_at, invited_by, invite_expires_at, COALESCE(must_change_password, FALSE) AS must_change_password,
                       cost_per_hour, sell_per_hour, mobile_phone,
                       COALESCE(user_type, 'internal') AS user_type,
                       COALESCE(access_scope, 'all') AS access_scope
                FROM users
                ORDER BY status DESC, role, full_name
                """
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "user_id": str(r.get("user_id") or ""),
                    "full_name": str(r.get("full_name") or ""),
                    "email": str(r.get("email") or ""),
                    "role": str(r.get("role") or "ReadOnly"),
                    "position": str(r.get("position") or ""),
                    "status": str(r.get("status") or "Active"),
                    "has_password": bool(r.get("password_hash")),
                    "invited_at": str(r.get("invited_at")) if r.get("invited_at") else None,
                    "invited_by": str(r.get("invited_by") or "") or None,
                    "invite_expires_at": str(r.get("invite_expires_at")) if r.get("invite_expires_at") else None,
                    "invite_lapsed": _is_invite_lapsed(
                        r.get("invite_expires_at"),
                        bool(r.get("password_hash")),
                        bool(r.get("must_change_password")),
                    ),
                    "cost_per_hour": (float(r.get("cost_per_hour")) if r.get("cost_per_hour") is not None else None),
                    "sell_per_hour": (float(r.get("sell_per_hour")) if r.get("sell_per_hour") is not None else None),
                    "mobile_phone": str(r.get("mobile_phone") or "") or None,
                    "user_type": _normalize_user_type(r.get("user_type")),
                    "access_scope": _normalize_access_scope(
                        _normalize_user_type(r.get("user_type")),
                        r.get("access_scope"),
                    ),
                })
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list users: {e}")


@router.get("/roles")
def list_roles(_user: dict = Depends(_current_user)):
    """List all roles."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT role_name, is_active
                FROM roles_lookup
                ORDER BY role_name
                """
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "role_name": str(r.get("role_name") or ""),
                    "is_active": bool(r.get("is_active", True)),
                })
        else:
            # Default roles if table is empty
            items = [
                {"role_name": SUPERADMIN_ROLE, "is_active": True},
                {"role_name": "Admin", "is_active": True},
                {"role_name": "Consultant", "is_active": True},
                {"role_name": "ReadOnly", "is_active": True},
                {"role_name": "CRM", "is_active": True},
                {"role_name": "QA", "is_active": True},
                {"role_name": "Support", "is_active": True},
            ]
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list roles: {e}")


@router.get("/permissions")
def list_permissions(_user: dict = Depends(_current_user)):
    try:
        return {
            "items": [
                {"permission_key": key, "description": description}
                for key, description in sorted(PERMISSIONS.items(), key=lambda item: item[0])
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list permissions: {e}")


@router.get("/access/options")
def get_access_options(_user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            ensure_permission_schema(con)
            roles_df = con.execute(
                """
                SELECT role_name, is_active
                FROM roles_lookup
                WHERE COALESCE(is_active, TRUE) = TRUE
                ORDER BY role_name
                """
            ).df()
            clients_df = con.execute(
                """
                SELECT db_id AS client_db_id, client_name
                FROM clients
                WHERE status IS NULL OR LOWER(COALESCE(status, '')) <> 'archived'
                ORDER BY client_name ASC, db_id ASC
                """
            ).df()
        roles = []
        if roles_df is not None and not roles_df.empty:
            for _, row in roles_df.iterrows():
                roles.append(
                    {
                        "role_name": str(row.get("role_name") or ""),
                        "is_active": bool(row.get("is_active", True)),
                    }
                )
        clients = []
        if clients_df is not None and not clients_df.empty:
            for _, row in clients_df.iterrows():
                if row.get("client_db_id") is None:
                    continue
                clients.append(
                    {
                        "client_db_id": int(row.get("client_db_id")),
                        "client_name": str(row.get("client_name") or ""),
                    }
                )
        return {
            "roles": roles,
            "permissions": [
                {"permission_key": key, "description": description}
                for key, description in sorted(PERMISSIONS.items(), key=lambda item: item[0])
            ],
            "access_scopes": sorted(ACCESS_SCOPES),
            "user_types": ["internal", "client_portal"],
            "clients": clients,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch access options: {e}")


@router.get("/users/{email}/access")
def get_user_access(email: str, _user: dict = Depends(_current_user)):
    try:
        email_norm = str(email or "").strip().lower()
        with get_conn() as con:
            ensure_permission_schema(con)
            row = con.execute(
                """
                SELECT email, COALESCE(role, 'ReadOnly'), COALESCE(user_type, 'internal'), COALESCE(access_scope, 'all')
                FROM users
                WHERE LOWER(COALESCE(email, '')) = LOWER(?)
                LIMIT 1
                """,
                [email_norm],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            override_rows = con.execute(
                """
                SELECT permission_key, LOWER(COALESCE(effect, 'deny')) AS effect, reason
                FROM user_permission_overrides
                WHERE LOWER(COALESCE(user_id, '')) = LOWER(?)
                ORDER BY permission_key
                """,
                [email_norm],
            ).fetchall()
            linked_clients = _fetch_linked_clients(con, email_norm)

        effective = get_effective_permissions_for_user(email_norm, role_hint=str(row[1] or "ReadOnly"))
        return {
            "email": str(row[0] or email_norm),
            "role": str(row[1] or "ReadOnly"),
            "user_type": _normalize_user_type(row[2]),
            "access_scope": _normalize_access_scope(row[2], row[3]),
            "linked_clients": linked_clients,
            "overrides": [
                {
                    "permission_key": str(item[0] or ""),
                    "effect": str(item[1] or "deny"),
                    "reason": str(item[2] or "").strip() or None,
                }
                for item in (override_rows or [])
                if item and item[0]
            ],
            "effective_permissions": list(effective.get("effective_permissions") or []),
            "denied_permissions": list(effective.get("denied_permissions") or []),
            "is_super_admin": bool(effective.get("is_super_admin")),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch user access: {e}")


@router.put("/users/{email}/access")
def update_user_access(email: str, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        email_norm = str(email or "").strip().lower()
        actor = _actor_identifier(_user)
        role_name = str(body.get("role") or "ReadOnly").strip() or "ReadOnly"
        user_type = _normalize_user_type(body.get("user_type"))
        access_scope = _normalize_access_scope(user_type, body.get("access_scope"))
        linked_clients_body = body.get("linked_clients") or []
        overrides_body = body.get("overrides") or []

        with get_conn() as con:
            ensure_permission_schema(con)
            exists = con.execute(
                "SELECT 1 FROM users WHERE LOWER(COALESCE(email, '')) = LOWER(?) LIMIT 1",
                [email_norm],
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="User not found")

            con.execute(
                """
                UPDATE users
                SET role = ?, user_type = ?, access_scope = ?, user_id = COALESCE(NULLIF(user_id, ''), ?)
                WHERE LOWER(COALESCE(email, '')) = LOWER(?)
                """,
                [role_name, user_type, access_scope, email_norm, email_norm],
            )

            con.execute(
                "DELETE FROM user_permission_overrides WHERE LOWER(COALESCE(user_id, '')) = LOWER(?)",
                [email_norm],
            )
            for item in overrides_body:
                if not isinstance(item, dict):
                    continue
                permission_key = str(item.get("permission_key") or "").strip()
                effect = str(item.get("effect") or "").strip().lower()
                reason = str(item.get("reason") or "").strip() or None
                if permission_key not in PERMISSIONS or effect not in {"allow", "deny"}:
                    continue
                con.execute(
                    """
                    INSERT INTO user_permission_overrides (user_id, permission_key, effect, reason, updated_at)
                    VALUES (?, ?, ?, ?, NOW())
                    """,
                    [email_norm, permission_key, effect, reason],
                )

            linked_clients = _replace_linked_clients(
                con,
                email=email_norm,
                actor=actor,
                linked_clients=linked_clients_body,
            )

        invalidate_permission_cache(email_norm)
        effective = get_effective_permissions_for_user(email_norm, role_hint=role_name)
        return {
            "ok": True,
            "email": email_norm,
            "role": role_name,
            "user_type": user_type,
            "access_scope": access_scope,
            "linked_clients": linked_clients,
            "effective_permissions": list(effective.get("effective_permissions") or []),
            "denied_permissions": list(effective.get("denied_permissions") or []),
            "is_super_admin": bool(effective.get("is_super_admin")),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update user access: {e}")


@router.patch("/users/{user_id}/archive")
def archive_user(
    user_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Archive or unarchive a team member."""
    try:
        with get_conn() as con:
            # Check user exists
            exists = con.execute(
                "SELECT 1 FROM users WHERE user_id = ?",
                [int(user_id)]
            ).fetchone()
            
            if not exists:
                raise HTTPException(status_code=404, detail="User not found")
            
            archived = body.get("archived", True)
            user_name = _user.get("name", "system")
            
            if archived:
                con.execute(
                    """
                    UPDATE users 
                    SET archived = ?, archived_at = CURRENT_TIMESTAMP, archived_by = ?
                    WHERE user_id = ?
                    """,
                    [True, user_name, int(user_id)]
                )
            else:
                con.execute(
                    """
                    UPDATE users 
                    SET archived = ?, archived_at = NULL, archived_by = NULL
                    WHERE user_id = ?
                    """,
                    [False, int(user_id)]
                )
            affected_email = con.execute(
                "SELECT LOWER(COALESCE(email, '')) FROM users WHERE user_id = ? LIMIT 1",
                [int(user_id)],
            ).fetchone()
            if affected_email and affected_email[0]:
                invalidate_permission_cache(str(affected_email[0]))
            
            return {"ok": True, "message": "User archived successfully" if archived else "User restored successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Archive failed: {e}")


@router.post("/users")
def create_or_update_user(body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Create or update a user (upsert by email)."""
    try:
        email = body.get("email", "").strip().lower()
        full_name = body.get("full_name", "").strip()
        role = body.get("role", "ReadOnly")
        position = body.get("position", None)
        position = str(position).strip() if position is not None else None
        if position == "":
            position = None
        mobile_phone = body.get("mobile_phone", None)
        mobile_phone = str(mobile_phone).strip() if mobile_phone is not None else None
        if mobile_phone == "":
            mobile_phone = None
        cost_per_hour_raw = body.get("cost_per_hour", None)
        sell_per_hour_raw = body.get("sell_per_hour", None)
        cost_per_hour = float(cost_per_hour_raw) if cost_per_hour_raw not in (None, "") else None
        sell_per_hour = float(sell_per_hour_raw) if sell_per_hour_raw not in (None, "") else None
        status = body.get("status", "Active")
        user_type = _normalize_user_type(body.get("user_type"))
        access_scope = _normalize_access_scope(user_type, body.get("access_scope"))
        password = str(body.get("password") or "")
        manual_password_provided = bool(password)
        actor = _actor_identifier(_user)
        is_new_user = False
        generated_temp_password = ""
        invite_expires_at: datetime | None = None
        
        if not email or not full_name:
            raise HTTPException(status_code=400, detail="Email and full name are required")
        
        with get_conn() as con:
            ensure_permission_schema(con)
            _ensure_users_position_column(con)
            _ensure_users_password_column(con)
            _ensure_users_invite_columns(con)
            _ensure_users_cost_sell_mobile_columns(con)
            existing = con.execute(
                """
                SELECT password_hash
                FROM users
                WHERE lower(email) = lower(%s)
                LIMIT 1
                """,
                [email],
            ).fetchone()

            if existing:
                existing_org_id = str(_user.get("org_id") or "").strip() or None
                con.execute(
                    """
                    UPDATE users
                    SET full_name = %s,
                        role = %s,
                        position = %s,
                        mobile_phone = %s,
                        cost_per_hour = %s,
                        sell_per_hour = %s,
                        status = %s,
                        user_type = %s,
                        access_scope = %s,
                        user_id = %s,
                        org_id = COALESCE(org_id, %s)
                    WHERE lower(email) = lower(%s)
                    """,
                    [full_name, role, position, mobile_phone, cost_per_hour, sell_per_hour, status, user_type, access_scope, email, existing_org_id, email],
                )
            else:
                is_new_user = True
                if not password:
                    generated_temp_password = "".join(
                        secrets.choice(string.ascii_letters + string.digits + "!@#$%^&*")
                        for _ in range(14)
                    )
                    password = generated_temp_password
                invite_mode = not manual_password_provided
                invited_at = datetime.now(timezone.utc) if invite_mode else None
                invite_expires_at = _invite_expiry(7) if invite_mode else None
                invited_by = actor if invite_mode else None
                new_user_org_id = str(_user.get("org_id") or "").strip() or None
                con.execute(
                    """
                    INSERT INTO users (user_id, full_name, role, position, mobile_phone, cost_per_hour, sell_per_hour, email, status, invited_at, invited_by, invite_expires_at, user_type, access_scope, org_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        email,
                        full_name,
                        role,
                        position,
                        mobile_phone,
                        cost_per_hour,
                        sell_per_hour,
                        email,
                        status,
                        invited_at,
                        invited_by,
                        invite_expires_at,
                        user_type,
                        access_scope,
                        new_user_org_id,
                    ],
                )

        if password:
            if len(password) < 8:
                raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
            set_user_password(email, password, force_change=True)
            with get_conn() as con:
                _ensure_users_invite_columns(con)
                con.execute(
                    """
                    UPDATE users
                    SET invite_expires_at = %s
                    WHERE lower(email) = lower(%s)
                    """,
                    [invite_expires_at if is_new_user else None, email],
                )

        email_result = None
        if is_new_user and generated_temp_password:
            email_result = _send_team_access_email(
                to_email=email,
                full_name=full_name,
                role=role,
                temporary_password=generated_temp_password,
                invite_expires_at=invite_expires_at,
                template_key="team_member_invite",
                sender_identifier=actor,
            )

        invalidate_permission_cache(email)
        response = {"ok": True, "message": "User saved successfully"}
        if generated_temp_password:
            response["temporary_password"] = generated_temp_password
            response["invite_expires_at"] = invite_expires_at.isoformat() if invite_expires_at else None
        if email_result:
            response["email_status"] = str(email_result.get("status") or "")
            if email_result.get("error"):
                response["email_error"] = str(email_result.get("error") or "")
        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save user: {e}")


@router.patch("/users/{email}")
def update_user(email: str, body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Update a user's details."""
    try:
        with get_conn() as con:
            ensure_permission_schema(con)
            _ensure_users_position_column(con)
            _ensure_users_password_column(con)
            _ensure_users_cost_sell_mobile_columns(con)
            updates = []
            params = []
            
            if "full_name" in body:
                updates.append("full_name = %s")
                params.append(body["full_name"])
            if "role" in body:
                updates.append("role = %s")
                params.append(body["role"])
            if "position" in body:
                updates.append("position = %s")
                params.append(body["position"])
            if "status" in body:
                updates.append("status = %s")
                params.append(body["status"])
            if "user_type" in body:
                user_type = _normalize_user_type(body.get("user_type"))
                updates.append("user_type = %s")
                params.append(user_type)
                if "access_scope" not in body:
                    updates.append("access_scope = %s")
                    params.append(_normalize_access_scope(user_type, None))
            if "access_scope" in body:
                scope_user_type = body.get("user_type")
                if scope_user_type is None:
                    current_row = con.execute(
                        "SELECT COALESCE(user_type, 'internal') FROM users WHERE LOWER(COALESCE(email, '')) = LOWER(%s) LIMIT 1",
                        [email.lower()],
                    ).fetchone()
                    scope_user_type = current_row[0] if current_row else "internal"
                updates.append("access_scope = %s")
                params.append(_normalize_access_scope(_normalize_user_type(scope_user_type), body.get("access_scope")))
            if "mobile_phone" in body:
                updates.append("mobile_phone = %s")
                mobile_phone = body.get("mobile_phone")
                if mobile_phone is None:
                    params.append(None)
                else:
                    mobile_phone = str(mobile_phone).strip()
                    params.append(mobile_phone or None)
            if "cost_per_hour" in body:
                updates.append("cost_per_hour = %s")
                v = body.get("cost_per_hour")
                params.append((float(v) if v not in (None, "") else None))
            if "sell_per_hour" in body:
                updates.append("sell_per_hour = %s")
                v = body.get("sell_per_hour")
                params.append((float(v) if v not in (None, "") else None))
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(email.lower())
            query = f"UPDATE users SET {', '.join(updates)} WHERE email = %s"
            
            con.execute(query, params)

        password = str(body.get("password") or "")
        if password:
            if len(password) < 8:
                raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
            set_user_password(email, password, force_change=True)

        invalidate_permission_cache(email)
        
        return {"ok": True, "message": "User updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update user: {e}")


@router.patch("/users/{email}/password")
def admin_set_user_password(
    email: str,
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    """Set a new password for a user by email."""
    try:
        new_password = str(body.get("new_password") or "").strip()
        if len(new_password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

        with get_conn() as con:
            _ensure_users_password_column(con)
            exists = con.execute(
                "SELECT 1 FROM users WHERE lower(email) = lower(?) LIMIT 1",
                [email],
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="User not found")

        ok = set_user_password(email, new_password, force_change=True)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to set password")

        return {"ok": True, "message": "Password updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set password: {e}")


@router.post("/users/{email}/password/reset")
def admin_reset_user_password(
    email: str,
    _user: dict = Depends(_current_user),
):
    """Reset user password and return a temporary password."""
    try:
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
        temp_password = "".join(secrets.choice(alphabet) for _ in range(14))
        now = datetime.now(timezone.utc)
        expiry = _invite_expiry(7)

        full_name = email
        role = "Team Member"
        with get_conn() as con:
            _ensure_users_password_column(con)
            _ensure_users_invite_columns(con)
            row = con.execute(
                "SELECT full_name, role FROM users WHERE lower(email) = lower(?) LIMIT 1",
                [email],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            full_name = str(row[0] or "").strip() or email
            role = str(row[1] or "").strip() or "Team Member"

        ok = set_user_password(email, temp_password, force_change=True)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to reset password")

        with get_conn() as con:
            _ensure_users_invite_columns(con)
            con.execute(
                """
                UPDATE users
                SET invited_at = %s,
                    invited_by = %s,
                    invite_expires_at = %s
                WHERE lower(email) = lower(%s)
                """,
                [now, _actor_identifier(_user), expiry, email],
            )

        email_result = _send_team_access_email(
            to_email=email,
            full_name=full_name,
            role=role,
            temporary_password=temp_password,
            invite_expires_at=expiry,
            template_key="team_member_password_reset",
            sender_identifier=_actor_identifier(_user),
        )

        return {
            "ok": True,
            "message": "Temporary password generated",
            "temporary_password": temp_password,
            "invite_expires_at": expiry.isoformat(),
            "email_status": str(email_result.get("status") or ""),
            "email_error": str(email_result.get("error") or "") if email_result.get("error") else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {e}")


@router.post("/users/{email}/reinvite")
def admin_reinvite_user(
    email: str,
    _user: dict = Depends(_current_user),
):
    """Re-invite a user by generating a fresh temporary password and invite expiry."""
    try:
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
        temp_password = "".join(secrets.choice(alphabet) for _ in range(14))
        expiry = _invite_expiry(7)
        now = datetime.now(timezone.utc)

        full_name = email
        role = "Team Member"
        with get_conn() as con:
            _ensure_users_password_column(con)
            _ensure_users_invite_columns(con)
            row = con.execute(
                "SELECT full_name, role FROM users WHERE lower(email) = lower(?) LIMIT 1",
                [email],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            full_name = str(row[0] or "").strip() or email
            role = str(row[1] or "").strip() or "Team Member"

        ok = set_user_password(email, temp_password, force_change=True)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to re-invite user")

        with get_conn() as con:
            _ensure_users_invite_columns(con)
            con.execute(
                """
                UPDATE users
                SET invited_at = %s,
                    invited_by = %s,
                    invite_expires_at = %s
                WHERE lower(email) = lower(%s)
                """,
                [now, _actor_identifier(_user), expiry, email],
            )

        email_result = _send_team_access_email(
            to_email=email,
            full_name=full_name,
            role=role,
            temporary_password=temp_password,
            invite_expires_at=expiry,
            template_key="team_member_reinvite",
            sender_identifier=_actor_identifier(_user),
        )

        return {
            "ok": True,
            "message": "User re-invited",
            "temporary_password": temp_password,
            "invite_expires_at": expiry.isoformat(),
            "email_status": str(email_result.get("status") or ""),
            "email_error": str(email_result.get("error") or "") if email_result.get("error") else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to re-invite user: {e}")


