from __future__ import annotations

from datetime import datetime, timezone
import os
from urllib.parse import urlparse

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from core.database import db_backend, get_conn
from api.auth import _current_user
from api.auth_routes import _current_org_summary
from api.feedback_routes import (
    create_feedback_item as _create_feedback_item,
    list_feedback_items as _list_feedback_items,
    update_feedback_item as _update_feedback_item,
)

router = APIRouter()


@router.get("/support/database-fingerprint")
def support_database_fingerprint(_user: dict[str, str] = Depends(_current_user)):
    """Return a small fingerprint for the currently connected database."""
    with get_conn() as con:
        row = con.execute(
            """
            SELECT
              current_database() AS db_name,
              current_user AS db_user,
              inet_server_addr()::text AS host_ip,
              inet_server_port() AS host_port,
              version() AS pg_version
            """
        ).fetchone()

    if not row:
        raise HTTPException(status_code=500, detail="Unable to read database fingerprint")

    return {
        "db_name": row[0],
        "db_user": row[1],
        "host_ip": row[2],
        "host_port": row[3],
        "pg_version": row[4],
    }


@router.get("/support/diagnostics")
def support_diagnostics(user: dict[str, str] = Depends(_current_user)):
    """Return a support-friendly snapshot of the active session and database."""
    fingerprint = support_database_fingerprint(user)
    current_org = _current_org_summary(user)
    permissions = sorted(
        {
            str(permission).strip()
            for permission in (user.get("effective_permissions") or [])
            if str(permission).strip()
        }
    )
    role = str(user.get("role") or "").strip()
    can_manage_organisations = bool(
        user.get("is_super_admin")
        or "admin.access" in permissions
        or role.lower() in {"admin", "superadmin"}
    )
    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "database": fingerprint,
        "session": {
            "user_id": str(user.get("user_id") or "").strip() or None,
            "email": str(user.get("email") or "").strip() or None,
            "role": role or None,
            "org_id": str(user.get("org_id") or "").strip() or None,
            "mfa_enabled": bool(user.get("mfa_enabled")) if user.get("mfa_enabled") is not None else None,
            "must_change_password": bool(user.get("must_change_password")) if user.get("must_change_password") is not None else None,
            "is_super_admin": bool(user.get("is_super_admin")) if user.get("is_super_admin") is not None else None,
            "effective_permissions": permissions,
        },
        "current_org": current_org,
        "can_manage_organisations": can_manage_organisations,
    }


@router.get("/health")
def health():
    try:
        with get_conn() as con:
            row = con.execute("SELECT 1").fetchone()
        if not row or row[0] != 1:
            raise HTTPException(status_code=503, detail="Database health check failed")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database health check failed: {exc}")
    return {
        "ok": True,
        "service": "NZI Pro API",
        "database": "ok",
    }


@router.get("/debug/env")
def debug_env(_user: dict[str, str] = Depends(_current_user)):
    url = os.getenv("DATABASE_URL") or ""
    host = ""
    port: int | None = None
    try:
        if url:
            parsed = urlparse(url)
            host = parsed.hostname or ""
            port = parsed.port
    except Exception:
        host = ""
        port = None
    return {
        "db_backend": db_backend(),
        "database_url_is_set": bool(url),
        "database_url_host": host,
        "database_url_port": port,
        "database_url_has_sslmode": ("sslmode=" in url),
    }


@router.get("/feedback/items")
def app_list_feedback_items(
    feedback_type: str = Query(default="all"),
    include_completed: bool = Query(default=True),
    _user: dict = Depends(_current_user),
):
    return _list_feedback_items(
        feedback_type=feedback_type,
        include_completed=include_completed,
        _user=_user,
    )


@router.post("/feedback/items")
def app_create_feedback_item(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    return _create_feedback_item(body=body, _user=_user)


@router.patch("/feedback/items/{feedback_id}")
def app_update_feedback_item(
    feedback_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    return _update_feedback_item(feedback_id=feedback_id, body=body, _user=_user)
