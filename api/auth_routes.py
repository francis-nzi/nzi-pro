from datetime import datetime, timedelta, timezone
import base64
import hashlib
import json
import os
import secrets
import string
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException

from core.auth import authenticate_user, get_user_by_id, set_user_password
from core.database import get_conn
from api.auth import _current_user, _mfa_required_for_all_users
from services.messaging_templates import build_email_content
from services.outbound_email import send_tracked_email
from services.permissions import enrich_user_permissions

try:
    import jwt
except Exception:  # pragma: no cover - optional unless JWT secret configured
    jwt = None
try:
    import pyotp
except Exception:  # pragma: no cover
    pyotp = None
try:
    from cryptography.fernet import Fernet
except Exception:  # pragma: no cover
    Fernet = None

router = APIRouter(prefix="/auth", tags=["auth"])
PORTAL_TERMS_VERSION = "2026-03-16"


def _jwt_secret() -> str:
    return os.getenv("NZI_JWT_SECRET", "")


def _env_truthy(name: str, default: str = "false") -> bool:
    val = str(os.getenv(name, default) or "").strip().lower()
    return val in ("1", "true", "yes", "y", "on")


def _strict_auth_required() -> bool:
    env = str(os.getenv("APP_ENV", "") or "").strip().lower()
    if env in ("prod", "production"):
        return True
    return _env_truthy("ENFORCE_JWT_AUTH", "false")


def _challenge_secret() -> str:
    return str(
        os.getenv("NZI_MFA_CHALLENGE_SECRET")
        or _jwt_secret()
        or "nzi-local-mfa-challenge-secret"
    ).strip()


def _mfa_remember_days() -> int:
    raw = str(os.getenv("MFA_REMEMBER_DAYS") or "30").strip()
    try:
        days = int(raw)
    except Exception:
        days = 30
    return max(1, min(days, 365))


def _ensure_mfa_columns(con) -> None:
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery_codes_hash TEXT")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMP")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_used_at TIMESTAMP")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_setup_secret_encrypted TEXT")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_setup_created_at TIMESTAMP")
    except Exception:
        pass


def _ensure_users_invite_columns(con) -> None:
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


def _ensure_portal_terms_columns(con) -> None:
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_portal_terms_at TIMESTAMP")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_portal_terms_version VARCHAR")
    except Exception:
        pass


def _must_accept_portal_terms(user: Dict) -> bool:
    return str(user.get("accepted_portal_terms_version") or "").strip() != PORTAL_TERMS_VERSION


def _current_org_summary(user: Dict) -> dict | None:
    org_id = str(user.get("org_id") or "").strip()
    if not org_id:
        return None
    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT org_id, name, slug, plan, plan_status, archived
                FROM organisations
                WHERE org_id = ?
                LIMIT 1
                """,
                [org_id],
            ).fetchone()
        if not row:
            return {"org_id": org_id, "name": org_id, "slug": None, "plan": None, "plan_status": None, "archived": None}
        return {
            "org_id": str(row[0] or "").strip() or org_id,
            "name": str(row[1] or "").strip() or org_id,
            "slug": str(row[2] or "").strip() or None,
            "plan": str(row[3] or "").strip() or None,
            "plan_status": str(row[4] or "").strip() or None,
            "archived": bool(row[5]) if row[5] is not None else None,
        }
    except Exception:
        return {"org_id": org_id, "name": org_id, "slug": None, "plan": None, "plan_status": None, "archived": None}


def _temporary_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _send_forgot_password_email(
    *,
    to_email: str,
    full_name: str,
    temporary_password: str,
    invite_expires_at: datetime,
) -> dict:
    sender_identifier = "self-service-forgot-password"
    context = {
        "full_name": str(full_name or "").strip() or str(to_email or "").strip(),
        "email": str(to_email or "").strip(),
        "temporary_password": str(temporary_password or "").strip(),
        "invite_expires_at": invite_expires_at.isoformat(),
        "sender_name": "NZI Pro",
    }
    fallback_subject = "NZI Pro temporary password request"
    fallback_body = (
        f"<p>Hi {context['full_name']},</p>"
        "<p>We received a password reset request for your NZI Pro account.</p>"
        f"<p>Username: <strong>{context['email']}</strong><br/>"
        f"Temporary password: <strong>{context['temporary_password']}</strong><br/>"
        f"Reset expires: <strong>{context['invite_expires_at']}</strong></p>"
        "<p>If you did not request this, contact your administrator.</p>"
    )
    with get_conn() as con:
        rendered = build_email_content(
            con=con,
            template_key="forgot_password",
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
            template_key="forgot_password",
            entity_type="team_member",
            metadata={"flow": "forgot_password"},
            raise_on_error=False,
        )
    return result


def _mfa_fernet() -> "Fernet":
    if Fernet is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: cryptography package missing")
    key = str(os.getenv("MFA_ENCRYPTION_KEY") or "").strip()
    if key:
        try:
            return Fernet(key.encode("utf-8"))
        except Exception:
            raise HTTPException(status_code=500, detail="MFA_ENCRYPTION_KEY is invalid")
    seed = str(_jwt_secret() or "nzi-local-mfa-dev-key").encode("utf-8")
    derived = hashlib.sha256(seed).digest()
    fallback_key = base64.urlsafe_b64encode(derived)
    return Fernet(fallback_key)


def _encrypt_secret(secret: str) -> str:
    return _mfa_fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def _decrypt_secret(value: str) -> str:
    try:
        return _mfa_fernet().decrypt(str(value or "").encode("utf-8")).decode("utf-8")
    except Exception:
        return ""


def _hash_recovery_code(code: str) -> str:
    normalized = str(code or "").strip().upper().replace("-", "")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _new_recovery_codes(count: int = 10) -> tuple[list[str], list[str]]:
    plain: list[str] = []
    hashed: list[str] = []
    for _ in range(count):
        raw = secrets.token_hex(4).upper()
        formatted = f"{raw[:4]}-{raw[4:]}"
        plain.append(formatted)
        hashed.append(_hash_recovery_code(formatted))
    return plain, hashed


def _user_mfa_row(identifier: str) -> tuple | None:
    ident = str(identifier or "").strip()
    if not ident:
        return None
    with get_conn() as con:
        _ensure_mfa_columns(con)
        return con.execute(
            """
            SELECT user_id, email,
                   COALESCE(mfa_enabled, FALSE) AS mfa_enabled,
                   mfa_secret_encrypted,
                   COALESCE(mfa_recovery_codes_hash, '[]') AS mfa_recovery_codes_hash,
                   mfa_setup_secret_encrypted
            FROM users
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            LIMIT 1
            """,
            [ident, ident],
        ).fetchone()


def _issue_login_result(user: Dict, *, setup_required: bool = False) -> Dict:
    secret = _jwt_secret()
    if _strict_auth_required() and not secret:
        raise HTTPException(status_code=500, detail="Server auth misconfigured: NZI_JWT_SECRET missing in strict mode")
    if not secret:
        return {
            "user": user,
            "must_change_password": bool(user.get("must_change_password")),
            "must_accept_portal_terms": _must_accept_portal_terms(user),
            "mfa_setup_required": bool(setup_required),
            "portal_terms_version": PORTAL_TERMS_VERSION,
        }
    if jwt is None:
        raise HTTPException(status_code=500, detail="Server auth misconfigured: PyJWT missing")
    now = datetime.utcnow()
    payload = {
        "sub": user["user_id"],
        "kind": "mfa_setup" if setup_required else "session",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=4)).timestamp()),
    }
    token = jwt.encode(payload, secret, algorithm="HS256")
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user,
        "must_change_password": bool(user.get("must_change_password")),
        "must_accept_portal_terms": _must_accept_portal_terms(user),
        "mfa_setup_required": bool(setup_required),
        "portal_terms_version": PORTAL_TERMS_VERSION,
    }


def _issue_mfa_challenge(user: Dict) -> str:
    if jwt is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: PyJWT missing")
    now = datetime.utcnow()
    payload = {
        "kind": "mfa_challenge",
        "sub": str(user.get("user_id") or ""),
        "email": str(user.get("email") or ""),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
    }
    return jwt.encode(payload, _challenge_secret(), algorithm="HS256")


def _mfa_secret_fingerprint(encrypted_secret: str) -> str:
    return hashlib.sha256(str(encrypted_secret or "").encode("utf-8")).hexdigest()


def _issue_mfa_remember_token(user: Dict, encrypted_secret: str) -> str:
    if jwt is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: PyJWT missing")
    now = datetime.utcnow()
    exp = now + timedelta(days=_mfa_remember_days())
    payload = {
        "kind": "mfa_remember",
        "sub": str(user.get("user_id") or ""),
        "email": str(user.get("email") or ""),
        "ms": _mfa_secret_fingerprint(encrypted_secret),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, _challenge_secret(), algorithm="HS256")


def _verify_mfa_remember_token(token: str, user: Dict, encrypted_secret: str) -> bool:
    if jwt is None:
        return False
    t = str(token or "").strip()
    if not t:
        return False
    try:
        payload = jwt.decode(t, _challenge_secret(), algorithms=["HS256"])
    except Exception:
        return False
    if str(payload.get("kind") or "") != "mfa_remember":
        return False
    if str(payload.get("sub") or "") != str(user.get("user_id") or ""):
        return False
    if str(payload.get("email") or "").lower() != str(user.get("email") or "").lower():
        return False
    if str(payload.get("ms") or "") != _mfa_secret_fingerprint(encrypted_secret):
        return False
    return True


@router.post("/login")
def login(body: Dict):
    identifier = (body.get("identifier") or "").strip()
    password = body.get("password") or ""
    if not identifier or not password:
        raise HTTPException(status_code=400, detail="identifier and password required")

    user = authenticate_user(identifier, password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = enrich_user_permissions(user) or user
    mfa_row = _user_mfa_row(str(user.get("email") or user.get("user_id") or ""))
    mfa_enabled = bool(mfa_row and mfa_row[2])
    remember_token = str(body.get("mfa_remember_token") or "").strip()
    if mfa_enabled:
        secret_encrypted = str(mfa_row[3] or "")
        if secret_encrypted and _verify_mfa_remember_token(remember_token, user, secret_encrypted):
            result = _issue_login_result(user)
            result["mfa_required"] = False
            result["mfa_remember_token"] = remember_token
            result["mfa_remember_days"] = _mfa_remember_days()
            return result
        challenge_token = _issue_mfa_challenge(user)
        return {
            "mfa_required": True,
            "mfa_challenge_token": challenge_token,
            "user": {
                "user_id": user.get("user_id"),
                "email": user.get("email"),
                "full_name": user.get("full_name"),
                "role": user.get("role"),
            },
            "must_change_password": bool(user.get("must_change_password")),
            "must_accept_portal_terms": _must_accept_portal_terms(user),
            "mfa_setup_required": False,
            "portal_terms_version": PORTAL_TERMS_VERSION,
        }
    user = enrich_user_permissions(user) or user
    result = _issue_login_result(user, setup_required=_mfa_required_for_all_users())
    result["mfa_required"] = False
    return result


@router.post("/login/mfa/verify")
def login_mfa_verify(body: Dict):
    if jwt is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: PyJWT missing")
    if pyotp is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: pyotp package missing")

    challenge = str(body.get("mfa_challenge_token") or "").strip()
    otp_code = str(body.get("otp_code") or "").strip()
    recovery_code = str(body.get("recovery_code") or "").strip()
    remember_device = bool(body.get("remember_device", True))
    if not challenge:
        raise HTTPException(status_code=400, detail="mfa_challenge_token is required")
    if not otp_code and not recovery_code:
        raise HTTPException(status_code=400, detail="otp_code or recovery_code is required")

    try:
        payload = jwt.decode(challenge, _challenge_secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="MFA challenge expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid MFA challenge token")

    if str(payload.get("kind") or "") != "mfa_challenge":
        raise HTTPException(status_code=401, detail="Invalid MFA challenge token")

    ident = str(payload.get("email") or payload.get("sub") or "").strip()
    if not ident:
        raise HTTPException(status_code=401, detail="Invalid MFA challenge token")

    user = get_user_by_id(str(payload.get("sub") or ""))
    if not user:
        # fallback by email
        auth_user = _user_mfa_row(ident)
        if auth_user:
            user = get_user_by_id(str(auth_user[0] or ""))
    if not user:
        raise HTTPException(status_code=401, detail="Unknown or inactive user")

    with get_conn() as con:
        _ensure_mfa_columns(con)
        row = con.execute(
            """
            SELECT COALESCE(mfa_enabled, FALSE), mfa_secret_encrypted, COALESCE(mfa_recovery_codes_hash, '[]')
            FROM users
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            LIMIT 1
            """,
            [ident, ident],
        ).fetchone()
        if not row or not bool(row[0]):
            raise HTTPException(status_code=400, detail="MFA is not enabled for this user")
        secret_encrypted = str(row[1] or "")
        secret = _decrypt_secret(secret_encrypted)
        if not secret:
            raise HTTPException(status_code=500, detail="MFA secret is invalid")

        codes_raw = str(row[2] or "[]")
        try:
            recovery_hashes = json.loads(codes_raw) if codes_raw else []
        except Exception:
            recovery_hashes = []
        if not isinstance(recovery_hashes, list):
            recovery_hashes = []

        verified = False
        used_recovery_hash: str | None = None
        if otp_code:
            verified = bool(pyotp.TOTP(secret).verify(otp_code, valid_window=1))
        if not verified and recovery_code:
            candidate = _hash_recovery_code(recovery_code)
            if candidate in recovery_hashes:
                verified = True
                used_recovery_hash = candidate

        if not verified:
            raise HTTPException(status_code=401, detail="Invalid MFA code")

        updated_hashes = [h for h in recovery_hashes if h != used_recovery_hash] if used_recovery_hash else recovery_hashes
        con.execute(
            """
            UPDATE users
            SET mfa_recovery_codes_hash = ?, mfa_last_used_at = ?
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            """,
            [json.dumps(updated_hashes), datetime.now(timezone.utc), ident, ident],
        )

    result = _issue_login_result(user)
    result["mfa_required"] = False
    if remember_device:
        result["mfa_remember_token"] = _issue_mfa_remember_token(user, secret_encrypted)
        result["mfa_remember_days"] = _mfa_remember_days()
    return result


@router.get("/mfa/status")
def mfa_status(user: Dict[str, str] = Depends(_current_user)):
    try:
        ident = str(user.get("email") or user.get("user_id") or "").strip()
        with get_conn() as con:
            _ensure_mfa_columns(con)
            row = con.execute(
                """
                SELECT COALESCE(mfa_enabled, FALSE), mfa_enabled_at, mfa_last_used_at
                FROM users
                WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
                LIMIT 1
                """,
                [ident, ident],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            mfa_enabled = bool(row[0])
            mfa_required = _mfa_required_for_all_users()
            return {
                "mfa_enabled": mfa_enabled,
                "mfa_enabled_at": row[1].isoformat() if row[1] else None,
                "mfa_last_used_at": row[2].isoformat() if row[2] else None,
                "mfa_required_for_all_users": mfa_required,
                "mfa_setup_required": bool(mfa_required and not mfa_enabled),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load MFA status: {e}")


@router.post("/mfa/setup/start")
def mfa_setup_start(body: Dict, user: Dict[str, str] = Depends(_current_user)):
    if pyotp is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: pyotp package missing")
    current_password = str(body.get("current_password") or "")
    if not current_password:
        raise HTTPException(status_code=400, detail="current_password is required")

    ident = str(user.get("email") or user.get("user_id") or "").strip()
    auth_user = authenticate_user(ident, current_password)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    issuer = str(os.getenv("MFA_ISSUER") or "NZI Pro").strip()
    account_name = str(user.get("email") or user.get("user_id") or "").strip()
    secret = pyotp.random_base32()
    provisioning_uri = pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=issuer)

    with get_conn() as con:
        _ensure_mfa_columns(con)
        con.execute(
            """
            UPDATE users
            SET mfa_setup_secret_encrypted = ?, mfa_setup_created_at = ?
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            """,
            [_encrypt_secret(secret), datetime.now(timezone.utc), ident, ident],
        )

    return {
        "ok": True,
        "issuer": issuer,
        "account_name": account_name,
        "secret": secret,
        "provisioning_uri": provisioning_uri,
    }


@router.post("/mfa/setup/verify")
def mfa_setup_verify(body: Dict, user: Dict[str, str] = Depends(_current_user)):
    if pyotp is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: pyotp package missing")
    otp_code = str(body.get("otp_code") or "").strip()
    if not otp_code:
        raise HTTPException(status_code=400, detail="otp_code is required")

    ident = str(user.get("email") or user.get("user_id") or "").strip()
    with get_conn() as con:
        _ensure_mfa_columns(con)
        row = con.execute(
            """
            SELECT mfa_setup_secret_encrypted
            FROM users
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            LIMIT 1
            """,
            [ident, ident],
        ).fetchone()
        setup_enc = str(row[0] or "") if row else ""
        secret = _decrypt_secret(setup_enc)
        if not secret:
            raise HTTPException(status_code=400, detail="No pending MFA setup found")
        if not pyotp.TOTP(secret).verify(otp_code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid OTP code")
        recovery_plain, recovery_hashes = _new_recovery_codes(10)
        con.execute(
            """
            UPDATE users
            SET mfa_enabled = TRUE,
                mfa_secret_encrypted = ?,
                mfa_recovery_codes_hash = ?,
                mfa_enabled_at = ?,
                mfa_last_used_at = ?,
                mfa_setup_secret_encrypted = NULL,
                mfa_setup_created_at = NULL
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            """,
            [
                _encrypt_secret(secret),
                json.dumps(recovery_hashes),
                datetime.now(timezone.utc),
                datetime.now(timezone.utc),
                ident,
                ident,
            ],
        )
    user = enrich_user_permissions(get_user_by_id(ident) or user) or user
    result = _issue_login_result(user)
    result.update({"ok": True, "mfa_enabled": True, "recovery_codes": recovery_plain, "mfa_setup_required": False})
    return result


@router.post("/mfa/disable")
def mfa_disable(body: Dict, user: Dict[str, str] = Depends(_current_user)):
    if pyotp is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: pyotp package missing")
    if _mfa_required_for_all_users():
        raise HTTPException(status_code=403, detail="MFA is required for all users")
    current_password = str(body.get("current_password") or "")
    otp_code = str(body.get("otp_code") or "").strip()
    recovery_code = str(body.get("recovery_code") or "").strip()
    if not current_password:
        raise HTTPException(status_code=400, detail="current_password is required")
    if not otp_code and not recovery_code:
        raise HTTPException(status_code=400, detail="otp_code or recovery_code is required")

    ident = str(user.get("email") or user.get("user_id") or "").strip()
    auth_user = authenticate_user(ident, current_password)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    with get_conn() as con:
        _ensure_mfa_columns(con)
        row = con.execute(
            """
            SELECT mfa_secret_encrypted, COALESCE(mfa_recovery_codes_hash, '[]')
            FROM users
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            LIMIT 1
            """,
            [ident, ident],
        ).fetchone()
        secret = _decrypt_secret(str((row[0] if row else "") or ""))
        if not secret:
            raise HTTPException(status_code=400, detail="MFA is not enabled")
        try:
            hashes = json.loads(str(row[1] or "[]"))
        except Exception:
            hashes = []
        if not isinstance(hashes, list):
            hashes = []
        verified = False
        if otp_code:
            verified = bool(pyotp.TOTP(secret).verify(otp_code, valid_window=1))
        if not verified and recovery_code:
            verified = _hash_recovery_code(recovery_code) in hashes
        if not verified:
            raise HTTPException(status_code=401, detail="Invalid MFA code")
        con.execute(
            """
            UPDATE users
            SET mfa_enabled = FALSE,
                mfa_secret_encrypted = NULL,
                mfa_recovery_codes_hash = '[]',
                mfa_setup_secret_encrypted = NULL,
                mfa_setup_created_at = NULL
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            """,
            [ident, ident],
        )
    return {"ok": True, "mfa_enabled": False}


@router.post("/mfa/recovery-codes/regenerate")
def mfa_regenerate_recovery_codes(body: Dict, user: Dict[str, str] = Depends(_current_user)):
    if pyotp is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: pyotp package missing")
    current_password = str(body.get("current_password") or "")
    otp_code = str(body.get("otp_code") or "").strip()
    if not current_password or not otp_code:
        raise HTTPException(status_code=400, detail="current_password and otp_code are required")

    ident = str(user.get("email") or user.get("user_id") or "").strip()
    auth_user = authenticate_user(ident, current_password)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    with get_conn() as con:
        _ensure_mfa_columns(con)
        row = con.execute(
            """
            SELECT mfa_secret_encrypted
            FROM users
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            LIMIT 1
            """,
            [ident, ident],
        ).fetchone()
        secret = _decrypt_secret(str((row[0] if row else "") or ""))
        if not secret:
            raise HTTPException(status_code=400, detail="MFA is not enabled")
        if not pyotp.TOTP(secret).verify(otp_code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid OTP code")
        plain, hashes = _new_recovery_codes(10)
        con.execute(
            """
            UPDATE users
            SET mfa_recovery_codes_hash = ?, mfa_last_used_at = ?
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            """,
            [json.dumps(hashes), datetime.now(timezone.utc), ident, ident],
        )
    return {"ok": True, "recovery_codes": plain}


@router.post("/register")
def register(body: Dict):
    if _strict_auth_required():
        raise HTTPException(status_code=403, detail="Open registration is disabled in strict auth mode")
    # Lightweight registration endpoint for bootstrapping users.
    # This endpoint is intentionally permissive; you should protect it in production.
    user_id = (body.get("user_id") or "").strip()
    full_name = (body.get("full_name") or "").strip()
    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    role = body.get("role") or "client"

    if not user_id or not email or not password:
        raise HTTPException(status_code=400, detail="user_id, email and password required")

    # Lazy import to avoid circulars
    from core.auth import create_user

    create_user(user_id, full_name or user_id, email, password, role=role)
    return {"ok": True, "user_id": user_id}


@router.get("/me")
def me(user: Dict[str, str] = Depends(_current_user)):
    return {
        "user": user,
        "current_org": _current_org_summary(user),
        "must_accept_portal_terms": _must_accept_portal_terms(user),
        "mfa_required_for_all_users": _mfa_required_for_all_users(),
        "mfa_setup_required": bool(user.get("mfa_setup_required")),
        "portal_terms_version": PORTAL_TERMS_VERSION,
    }


@router.post("/accept-portal-terms")
def accept_portal_terms(user: Dict[str, str] = Depends(_current_user)):
    ident = str(user.get("email") or user.get("user_id") or "").strip()
    if not ident:
        raise HTTPException(status_code=401, detail="Invalid user")

    accepted_at = datetime.now(timezone.utc)
    with get_conn() as con:
        _ensure_portal_terms_columns(con)
        con.execute(
            """
            UPDATE users
            SET accepted_portal_terms_at = ?,
                accepted_portal_terms_version = ?
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            """,
            [accepted_at, PORTAL_TERMS_VERSION, ident, ident],
        )

    return {
        "ok": True,
        "accepted_portal_terms_at": accepted_at.isoformat(),
        "accepted_portal_terms_version": PORTAL_TERMS_VERSION,
    }


@router.post("/forgot-password")
def forgot_password(body: Dict):
    """Self-service password reset for known active users.

    Returns a temporary password and marks must_change_password=True.
    """
    identifier = str(body.get("identifier") or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="identifier required")

    with get_conn() as con:
        row = con.execute(
            """
            SELECT email, status, full_name
            FROM users
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            LIMIT 1
            """,
            [identifier, identifier],
        ).fetchone()

    # Do not reveal account existence details.
    if not row:
        return {"ok": True, "message": "If the account exists, a temporary password has been generated."}

    email = str(row[0] or "").strip()
    status = str(row[1] or "").strip().lower()
    full_name = str(row[2] or "").strip() or email
    if not email or status != "active":
        return {"ok": True, "message": "If the account exists, a temporary password has been generated."}

    temp_password = _temporary_password(14)
    ok = set_user_password(email, temp_password, force_change=True)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to generate temporary password")

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    with get_conn() as con:
        _ensure_users_invite_columns(con)
        con.execute(
            """
            UPDATE users
            SET invited_at = ?,
                invited_by = ?,
                invite_expires_at = ?
            WHERE lower(email) = lower(?) OR lower(user_id) = lower(?)
            """,
            [datetime.now(timezone.utc), "self-service-forgot-password", expires_at, email, email],
        )

    email_result = _send_forgot_password_email(
        to_email=email,
        full_name=full_name,
        temporary_password=temp_password,
        invite_expires_at=expires_at,
    )

    return {
        "ok": True,
        "message": "Temporary password generated. Change it after sign in.",
        "temporary_password": temp_password,
        "invite_expires_at": expires_at.isoformat(),
        "email_status": str(email_result.get("status") or ""),
        "email_error": str(email_result.get("error") or "") if email_result.get("error") else None,
    }


@router.post("/change-password")
def change_password(body: Dict, user: Dict[str, str] = Depends(_current_user)):
    current_password = str(body.get("current_password") or "")
    new_password = str(body.get("new_password") or "")
    confirm_password = str(body.get("confirm_password") or "")

    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="current_password and new_password required")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if confirm_password and new_password != confirm_password:
        raise HTTPException(status_code=400, detail="New password and confirm password do not match")

    ident = str(user.get("email") or user.get("user_id") or "").strip()
    if not ident:
        raise HTTPException(status_code=401, detail="Invalid user")

    auth_user = authenticate_user(ident, current_password)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    ok = set_user_password(ident, new_password, force_change=False)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to update password")

    return {"ok": True, "message": "Password changed successfully"}
