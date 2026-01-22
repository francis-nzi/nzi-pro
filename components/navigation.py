import streamlit as st
from config import LOGO_URL, DEFAULT_YEAR


def _nav_changed():
    st.session_state["active_page"] = st.session_state.get("nav_page", "Dashboard")


def render_sidebar():
    with st.sidebar:
        st.image(LOGO_URL, use_container_width=True)
        st.markdown("---")

        pages = ["Dashboard", "Clients", "Jobs", "Admin"]
        hidden_pages = {"Client Folder", "Job Folder"}  # routable, but not shown in nav

        ap = st.session_state.get("active_page")
        if ap is None:
            st.session_state["active_page"] = "Dashboard"
            ap = "Dashboard"
        if ap not in pages and ap not in hidden_pages:
            st.session_state["active_page"] = "Dashboard"
            ap = "Dashboard"

        if "nav_page" not in st.session_state or st.session_state["nav_page"] not in pages:
            st.session_state["nav_page"] = ap if ap in pages else "Clients"

        st.radio(
            "Navigate",
            pages,
            key="nav_page",
            label_visibility="collapsed",
            on_change=_nav_changed,
        )

        st.markdown("---")
        st.session_state["working_year"] = st.selectbox(
            "Working Year",
            [2024, 2025, 2026],
            index=[2024, 2025, 2026].index(DEFAULT_YEAR),
        )
        st.caption("NZI • v12.1 Multi-Dataset")

    return st.session_state["active_page"]
