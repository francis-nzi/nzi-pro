"""Authentication helpers for NZI Pro backend API."""
from __future__ import annotations

import binascii
import hashlib
import hmac
import os
from typing import Dict, Optional

from core.database import get_conn


def _ensure_auth_columns(con) -> None:
    """Ensure auth-related columns exist on users table."""
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_portal_terms_at TIMESTAMP")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_portal_terms_version VARCHAR")
    except Exception:
        pass


def _hash_password(password: str, iterations: int = 100_000) -> str:
    """Return stored password format: iterations$salt_hex$hash_hex."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{iterations}${binascii.hexlify(salt).decode()}${binascii.hexlify(dk).decode()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if len(parts) != 3:
            return False
        iterations = int(parts[0])
        salt = binascii.unhexlify(parts[1])
        expected = binascii.unhexlify(parts[2])
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def create_user(user_id: str, full_name: str, email: str, password: str, role: str = "client") -> Dict[str, str]:
    """Create or update a user row with hashed password. Returns user dict."""
    ph = _hash_password(password)
    with get_conn() as con:
        _ensure_auth_columns(con)
        try:
            con.execute(
                "INSERT INTO users (user_id, full_name, role, email, password_hash, must_change_password, status) VALUES (?, ?, ?, ?, ?, ?, 'Active')",
                [user_id, full_name, role, email, ph, True],
            )
        except Exception:
            # Idempotent fallback for existing users.
            con.execute(
                "UPDATE users SET full_name=?, role=?, email=?, password_hash=?, must_change_password=?, status='Active' WHERE user_id=?",
                [full_name, role, email, ph, True, user_id],
            )
    return {"user_id": user_id, "full_name": full_name, "email": email, "role": role}


def set_user_password(identifier: str, password: str, force_change: bool = False) -> bool:
    """Set password for an existing user by email or user_id. Returns True if updated."""
    ident = (identifier or "").strip()
    if not ident or not password:
        return False

    ph = _hash_password(password)
    with get_conn() as con:
        _ensure_auth_columns(con)
        con.execute(
            """
            UPDATE users
            SET password_hash = ?,
                must_change_password = ?
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            """,
            [ph, bool(force_change), ident, ident],
        )

        row = con.execute(
            "SELECT 1 FROM users WHERE lower(email) = lower(?) OR lower(user_id) = lower(?) LIMIT 1",
            [ident, ident],
        ).fetchone()
        return bool(row)


def authenticate_user(identifier: str, password: str) -> Optional[Dict[str, str]]:
    """Authenticate by email or user_id. Returns user dict or None."""
    id_val = (identifier or "").strip()
    if not id_val:
        return None

    try:
        with get_conn() as con:
            _ensure_auth_columns(con)
            row = con.execute(
                """
                SELECT user_id, full_name, role, email, password_hash, status,
                       COALESCE(must_change_password, FALSE),
                       accepted_portal_terms_at,
                       accepted_portal_terms_version
                FROM users
                WHERE lower(email)=lower(?) OR lower(user_id)=lower(?)
                LIMIT 1
                """,
                [id_val, id_val],
            ).fetchone()
    except Exception:
        return None

    if not row:
        return None

    user_id, full_name, role, email, password_hash, status, must_change_password, accepted_portal_terms_at, accepted_portal_terms_version = row
    if not password_hash or str(status or "").lower() != "active":
        return None
    if not _verify_password(password, password_hash):
        return None

    return {
        "user_id": user_id,
        "full_name": full_name,
        "role": role,
        "email": email,
        "must_change_password": bool(must_change_password),
        "accepted_portal_terms_at": accepted_portal_terms_at.isoformat() if accepted_portal_terms_at else None,
        "accepted_portal_terms_version": accepted_portal_terms_version,
    }


def get_user_by_id(user_id: str) -> Optional[Dict[str, str]]:
    try:
        with get_conn() as con:
            _ensure_auth_columns(con)
            row = con.execute(
                """
                SELECT user_id, full_name, role, email, status,
                       COALESCE(must_change_password, FALSE),
                       accepted_portal_terms_at,
                       accepted_portal_terms_version
                FROM users
                WHERE user_id=?
                LIMIT 1
                """,
                [user_id],
            ).fetchone()
    except Exception:
        return None

    if not row:
        return None

    return {
        "user_id": row[0],
        "full_name": row[1],
        "role": row[2],
        "email": row[3],
        "status": row[4],
        "must_change_password": bool(row[5]),
        "accepted_portal_terms_at": row[6].isoformat() if row[6] else None,
        "accepted_portal_terms_version": row[7],
    }


def user_has_client_access(user_id: str, client_db_id: int) -> bool:
    """Return True if user has an active client_users link or an admin-like role."""
    try:
        user = get_user_by_id(user_id)
        if not user:
            return False
        if (user.get("role") or "").lower() in ("admin", "nzi", "staff"):
            return True
        with get_conn() as con:
            row = con.execute(
                "SELECT 1 FROM client_users WHERE lower(user_id)=lower(?) AND client_db_id=? AND is_active=TRUE LIMIT 1",
                [user_id, int(client_db_id)],
            ).fetchone()
            return bool(row)
    except Exception:
        return False
