from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from api.auth import _current_user
from core.database import get_conn
from services.messaging_templates import ensure_user_settings_columns

router = APIRouter(tags=["user-settings"])


def _user_row(con, user: dict) -> tuple[Any, ...] | None:
    ident = str(user.get("email") or user.get("user_id") or "").strip()
    if not ident:
        return None
    return con.execute(
        """
        SELECT user_id, email, full_name, role, position, mobile_phone,
               COALESCE(timezone, '') AS timezone,
               COALESCE(date_format, '') AS date_format,
               COALESCE(locale, '') AS locale,
               COALESCE(default_currency, '') AS default_currency,
               COALESCE(theme_preference, '') AS theme_preference,
               COALESCE(email_notifications, TRUE) AS email_notifications,
               COALESCE(weekly_digest, FALSE) AS weekly_digest,
               COALESCE(email_signature_html, '') AS email_signature_html
        FROM users
        WHERE lower(email) = lower(%s) OR lower(user_id) = lower(%s)
        LIMIT 1
        """,
        [ident, ident],
    ).fetchone()


@router.get("/auth/account-settings")
def get_account_settings(user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            ensure_user_settings_columns(con)
            row = _user_row(con, user)
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            return {
                "user": {
                    "user_id": str(row[0] or ""),
                    "email": str(row[1] or ""),
                    "full_name": str(row[2] or ""),
                    "role": str(row[3] or ""),
                    "position": str(row[4] or ""),
                    "mobile_phone": str(row[5] or ""),
                },
                "settings": {
                    "timezone": str(row[6] or ""),
                    "date_format": str(row[7] or ""),
                    "locale": str(row[8] or ""),
                    "default_currency": str(row[9] or ""),
                    "theme_preference": str(row[10] or ""),
                    "email_notifications": bool(row[11] if row[11] is not None else True),
                    "weekly_digest": bool(row[12] if row[12] is not None else False),
                    "email_signature_html": str(row[13] or ""),
                },
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load account settings: {e}")


@router.patch("/auth/account-settings")
def update_account_settings(body: dict = Body(...), user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            ensure_user_settings_columns(con)
            current = _user_row(con, user)
            if not current:
                raise HTTPException(status_code=404, detail="User not found")
            user_id = str(current[0] or "").strip()
            if not user_id:
                raise HTTPException(status_code=400, detail="Invalid user id")

            updates: list[str] = []
            params: list[Any] = []
            allowed_text = ("full_name", "position", "mobile_phone", "timezone", "date_format", "locale", "default_currency", "theme_preference", "email_signature_html")
            for key in allowed_text:
                if key in body:
                    updates.append(f"{key} = %s")
                    value = body.get(key)
                    params.append(str(value or "").strip() if value is not None else None)
            for key in ("email_notifications", "weekly_digest"):
                if key in body:
                    updates.append(f"{key} = %s")
                    params.append(bool(body.get(key)))
            if not updates:
                return {"ok": True, "message": "No fields to update"}

            params.append(user_id)
            con.execute(f"UPDATE users SET {', '.join(updates)} WHERE user_id = %s", params)
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update account settings: {e}")
