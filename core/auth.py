import streamlit as st
from core.database import get_conn

ROLE_ORDER = {"ReadOnly": 1, "Consultant": 2, "Admin": 3}


def _norm_email(x: str | None) -> str | None:
    if not x:
        return None
    x = str(x).strip().lower()
    return x or None


def current_email() -> str | None:
    """
    Read authenticated email from oauth2-proxy forwarded headers.
    """
    headers = dict(st.context.headers or {})

    for key in (
        "X-Auth-Request-Email",
        "X-Forwarded-Email",
        "X-Forwarded-User",
        "X-Auth-Request-User",
    ):
        if key in headers and headers[key]:
            return _norm_email(headers[key])

    # Authorization header fallback intentionally ignored for Phase 1
    return None


def get_current_user() -> dict:
    email = current_email()

    # STRICT: no email means no access
    if not email:
        return {
            "email": None,
            "role": None,
            "status": "MissingIdentity",
        }

    with get_conn() as con:
        df = con.execute(
            """
            SELECT email, full_name, role, status
            FROM users
            WHERE lower(email) = lower(%s)
            LIMIT 1
            """,
            [email],
        ).df()

    # STRICT: authenticated but not provisioned
    if df.empty:
        return {
            "email": email,
            "role": None,
            "status": "Unknown",
        }

    row = df.iloc[0].to_dict()
    return {
        "email": _norm_email(row.get("email")),
        "full_name": row.get("full_name"),
        "role": (row.get("role") or "ReadOnly").strip(),
        "status": (row.get("status") or "Active").strip(),
    }


def require_role(min_role: str = "ReadOnly"):
    user = get_current_user()

    if user["status"] == "MissingIdentity":
        st.error("Authentication error. Please log in again.")
        st.stop()

    if user["status"] == "Unknown":
        st.error("You are not provisioned yet. Please contact an administrator.")
        st.stop()

    if user["status"] != "Active":
        st.error("Your account is disabled. Please contact an administrator.")
        st.stop()

    have = ROLE_ORDER.get(user.get("role"), 0)
    need = ROLE_ORDER.get(min_role, 0)

    if have < need:
        st.error("You don't have permission to access this area.")
        st.stop()


def show_user_badge():
    user = get_current_user()
    email = user.get("email") or "(unknown)"
    role = user.get("role") or "—"
    st.caption(f"Signed in as **{email}** • Role: **{role}**")
