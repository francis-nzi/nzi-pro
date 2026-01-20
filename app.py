import os, sys
APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

import streamlit as st
from dotenv import load_dotenv

from config import APP_TITLE, LOGO_URL
from core.database import run_ddl
from core.migrations import run_migrations
from components.navigation import render_sidebar
from nzi_pages import dashboard, clients, admin, client_folder, jobs
from models import clients as m_clients

load_dotenv()

st.set_page_config(layout="wide", page_title=APP_TITLE, page_icon="🌱")

# Styles
try:
    with open("assets/styles.css") as f:
        st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)
except Exception:
    pass

# State defaults
st.session_state.setdefault("active_page", "Dashboard")
st.session_state.setdefault("selected_client_id", None)
st.session_state.setdefault("edit_mode", False)

# DB init/migrations
run_ddl()
run_migrations()


def _qp_first(name: str):
    """Streamlit query_params can be str or list[str] depending on version."""
    try:
        v = st.query_params.get(name)
    except Exception:
        v = st.experimental_get_query_params().get(name)
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _handle_action_links():
    action = _qp_first("action")
    cid = _qp_first("cid")
    if not action or not cid:
        return

    try:
        cid_i = int(cid)
    except Exception:
        try:
            st.query_params.clear()
        except Exception:
            st.experimental_set_query_params()
        return

    if action in ("open", "edit"):
        st.session_state["selected_client_id"] = cid_i
        st.session_state["edit_mode"] = (action == "edit")
        st.session_state["active_page"] = "Client Folder"

    elif action == "archive":
        m_clients.archive_client(cid_i)
        st.session_state["active_page"] = "Clients"

    # Clear params so refresh doesn't repeat action
    try:
        st.query_params.clear()
    except Exception:
        st.experimental_set_query_params()


# Must run before sidebar is rendered
_handle_action_links()

# Header
c1, c2 = st.columns([1, 6])
with c1:
    st.image(LOGO_URL, width=160)
with c2:
    st.markdown(f"### {APP_TITLE}")
    st.caption("Net Zero International — internal portal")
st.markdown("<div class='hr'></div>", unsafe_allow_html=True)

# Sidebar
page = render_sidebar()

# Router
if page == "Dashboard":
    dashboard.render()
elif page == "Clients":
    clients.render()
elif page == "Client Folder":
    client_folder.render()
elif page == "Jobs":
    jobs.render()
elif page == "Admin":
    admin.render()
else:
    dashboard.render()
