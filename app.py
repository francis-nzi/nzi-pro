import os, sys
APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
import streamlit as st
from config import APP_TITLE, LOGO_URL
from core.database import run_ddl
from core.migrations import run_migrations
from components.navigation import render_sidebar
from nzi_pages import dashboard, clients, admin, client_folder, jobs

from dotenv import load_dotenv
load_dotenv()

st.set_page_config(layout="wide", page_title=APP_TITLE, page_icon="🌱")
try:
    with open("assets/styles.css") as f: st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)
except Exception: pass
run_ddl()
run_migrations()

# --- Action links handler (from Clients table icons) ---
# Why: st.query_params is not a dict in modern Streamlit; treat it as a mapping-like object.
try:
    qp = st.query_params
except Exception:
    qp = st.experimental_get_query_params()

try:
    action = qp.get('action')
    cid = qp.get('cid')
except Exception:
    action = None
    cid = None

# st.experimental_get_query_params returns lists; normalize both styles
if isinstance(action, list): action = action[0] if action else None
if isinstance(cid, list): cid = cid[0] if cid else None

if action and cid:
    try:
        cid_i = int(cid)
    except Exception:
        cid_i = None
    if cid_i is not None:
        if action in ('open', 'edit'):
            st.session_state['selected_client_id'] = cid_i
            st.session_state['edit_mode'] = (action == 'edit')
            st.session_state['active_page'] = 'Client Folder'
        elif action == 'archive':
            from models import clients as m_clients
            m_clients.archive_client(cid_i)
            st.session_state['active_page'] = 'Clients'
    # Clear params so refresh doesn't repeat actions
    try:
        st.query_params.clear()
    except Exception:
        st.experimental_set_query_params()
# --------------------------------------------------------


c1, c2 = st.columns([1,6])
with c1: st.image(LOGO_URL, width=160)
with c2:
    st.markdown(f"### {APP_TITLE}")
    st.caption("Net Zero International — internal portal")
st.markdown("<div class='hr'></div>", unsafe_allow_html=True)

import streamlit as st
from models import clients as m_clients  # wherever archive_client lives

def _qp_first(name: str):
    """Streamlit query_params can be str or list[str] depending on version."""
    v = st.query_params.get(name)
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
        # Bad cid in URL -> ignore safely
        st.query_params.clear()
        return

    # Apply action
    if action in ("open", "edit"):
        st.session_state["selected_client_id"] = cid_i
        st.session_state["active_page"] = "Client Folder"
        st.session_state["edit_mode"] = (action == "edit")

    elif action == "archive":
        m_clients.archive_client(cid_i)
        st.session_state["active_page"] = "Clients"

    # Important: clear params so refresh doesn’t repeat the action
    st.query_params.clear()

# MUST run before sidebar/nav is instantiated
_handle_action_links()

page = render_sidebar()
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