import streamlit as st
from config import LOGO_URL, DEFAULT_YEAR


def render_sidebar():
    with st.sidebar:
        st.image(LOGO_URL, use_container_width=True)
        st.markdown("---")

        pages = ["Dashboard", "Clients", "Jobs", "Admin"]
        hidden_pages = {"Client Folder"}  # routable, not shown in nav

        # Ensure active_page exists and is valid (allow hidden pages)
        ap = st.session_state.get("active_page", "Dashboard")
        if ap not in pages and ap not in hidden_pages:
            ap = "Dashboard"
            st.session_state["active_page"] = ap

        # Choose which page is selected in the radio.
        # If active page is hidden, keep the radio on Clients (or last known nav_page).
        if ap in pages:
            default_nav = ap
        else:
            default_nav = st.session_state.get("nav_page", "Clients")
            if default_nav not in pages:
                default_nav = "Clients"

        # Render radio with a deterministic index
        idx = pages.index(default_nav)
        nav_choice = st.radio(
            "Navigate",
            pages,
            index=idx,
            key="nav_page",
            label_visibility="collapsed",
        )

        # Critical: Always sync active_page to nav_choice
        # BUT do not clobber hidden pages unless user actually chose something different.
        if ap in pages:
            st.session_state["active_page"] = nav_choice
        else:
            # We're currently on a hidden page; only switch away if user clicks a different choice
            # (radio always has a value, so compare to default_nav)
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
