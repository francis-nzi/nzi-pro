import hmac
import os

import streamlit as st


def require_basic_auth() -> None:
    user = str(os.getenv("BASIC_AUTH_USER", "") or "").strip()
    password = str(os.getenv("BASIC_AUTH_PASSWORD", "") or "").strip()

    if not user or not password:
        return

    if st.session_state.get("basic_auth_ok") is True:
        return

    with st.form("basic_auth_form"):
        u = st.text_input("Username")
        p = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Sign in")

    if submitted:
        ok = hmac.compare_digest(str(u or "").strip(), user) and hmac.compare_digest(str(p or "").strip(), password)
        if ok:
            st.session_state["basic_auth_ok"] = True
            st.rerun()
        else:
            st.error("Invalid username or password")

    st.stop()
