import streamlit as st
from config import LOGO_URL, DEFAULT_YEAR

def render_sidebar():
    with st.sidebar:
        st.image(LOGO_URL, width="stretch")
        st.markdown("---")

        pages = ["Dashboard", "Clients", "Jobs", "Admin"]
        hidden_pages = {"Client Folder", "Job Folder"}

        ap = st.session_state.get("active_page", "Dashboard")
        if ap not in pages and ap not in hidden_pages:
            ap = "Dashboard"
            st.session_state["active_page"] = ap

        # If we’re on a hidden page, keep the radio on Clients (but don’t overwrite active_page)
        if ap in pages:
            default_nav = ap
        else:
            default_nav = st.session_state.get("nav_page", "Clients")
            if default_nav not in pages:
                default_nav = "Clients"

        nav_choice = st.radio(
            "Navigate",
            pages,
            index=pages.index(default_nav),
            key="nav_page",
            label_visibility="collapsed",
        )

        # Always sync active_page, but don’t clobber a hidden page unless user changed nav
        if ap in pages:
            st.session_state["active_page"] = nav_choice
        else:
            if nav_choice != default_nav:
                st.session_state["active_page"] = nav_choice

        st.markdown("---")
        years = [2024, 2025, 2026]
        st.session_state["working_year"] = st.selectbox(
            "Working Year",
            years,
            index=years.index(DEFAULT_YEAR) if DEFAULT_YEAR in years else len(years) - 1,
        )
        st.caption("NZI • v12.1 Multi-Dataset")

    return st.session_state["active_page"]
