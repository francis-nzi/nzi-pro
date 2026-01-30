import streamlit as st
from config import LOGO_URL, DEFAULT_YEAR


def _nav_changed():
    st.session_state["active_page"] = st.session_state.get("nav_page", "Dashboard")


def _ensure_active_page(pages: list[str], hidden_pages: set[str]) -> str:
    ap = st.session_state.get("active_page")
    if ap is None:
        st.session_state["active_page"] = "Dashboard"
        ap = "Dashboard"
    if ap not in pages and ap not in hidden_pages:
        st.session_state["active_page"] = "Dashboard"
        ap = "Dashboard"
    if "nav_page" not in st.session_state or st.session_state["nav_page"] not in pages:
        st.session_state["nav_page"] = ap if ap in pages else "Clients"
    return str(st.session_state.get("active_page") or "Dashboard")


def render_top_nav():
    pages = ["Dashboard", "Clients", "Jobs", "Admin"]
    hidden_pages = {"Client Folder", "Job Folder", "Scope 1", "Scope 2", "Scope 3"}
    _ensure_active_page(pages, hidden_pages)

    n1, n2 = st.columns([7, 2])
    with n1:
        st.radio(
            "Navigate",
            pages,
            key="nav_page",
            label_visibility="collapsed",
            on_change=_nav_changed,
            horizontal=True,
        )
    with n2:
        st.session_state["working_year"] = st.selectbox(
            "Working Year",
            [2024, 2025, 2026],
            index=[2024, 2025, 2026].index(DEFAULT_YEAR),
            label_visibility="collapsed",
        )
    return st.session_state["active_page"]


def render_sidebar():
    return render_top_nav()
