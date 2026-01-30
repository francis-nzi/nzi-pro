import os, sys
APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

import streamlit as st
from config import APP_TITLE, LOGO_URL
from core.basic_auth import require_basic_auth
from core.database import run_ddl
from core.migrations import run_migrations
from components.navigation import render_top_nav
from nzi_pages import dashboard, clients, admin, client_folder, jobs, job_folder
from nzi_pages import scope1, scope2, scope3

from dotenv import load_dotenv
load_dotenv()

st.set_page_config(layout="wide", page_title=APP_TITLE, page_icon="🌱")
try:
    css_path = os.path.join(APP_DIR, "assets", "styles.css")
    with open(css_path, "r", encoding="utf-8") as f:
        st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)
except Exception:
    pass

require_basic_auth()

run_ddl()

def _env_truthy(name: str, default: str = "true") -> bool:
    v = str(os.getenv(name, default) or "").strip().lower()
    return v in ("1", "true", "yes", "y", "on")

if _env_truthy("RUN_STARTUP_MIGRATIONS", "false"):
    run_migrations()

# --- Action links handler (Clients/Jobs links) ---
try:
    qp = st.query_params
except Exception:
    qp = st.experimental_get_query_params()

try:
    action = qp.get('action')
    cid = qp.get('cid')
    jid = qp.get('jid')
except Exception:
    action = None
    cid = None
    jid = None

if isinstance(action, list):
    action = action[0] if action else None
if isinstance(cid, list):
    cid = cid[0] if cid else None
if isinstance(jid, list):
    jid = jid[0] if jid else None

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

    try:
        st.query_params.clear()
    except Exception:
        st.experimental_set_query_params()

if action and jid:
    try:
        jid_i = int(jid)
    except Exception:
        jid_i = None

    if jid_i is not None:
        if action == 'open':
            st.session_state['selected_job_id'] = jid_i
            st.session_state['active_page'] = 'Job Folder'
        elif action == 'edit':
            st.session_state['edit_job_id'] = jid_i
            st.session_state['active_page'] = 'Jobs'
        elif action == 'archive':
            from core.database import get_conn
            with get_conn() as con:
                con.execute("UPDATE jobs SET status='Archived' WHERE job_id=%s", [jid_i])
            st.session_state['active_page'] = 'Jobs'

    try:
        st.query_params.clear()
    except Exception:
        st.experimental_set_query_params()
# --------------------------------------------------------

st.markdown("<div class='topbar'>", unsafe_allow_html=True)
t1, t2 = st.columns([6, 5])
with t1:
    _render_commit = (os.getenv("RENDER_GIT_COMMIT") or os.getenv("GIT_COMMIT") or "").strip()
    _render_commit_short = _render_commit[:7] if _render_commit else ""
    _subtitle = "Net Zero International — internal portal"
    if _render_commit_short:
        _subtitle = f"{_subtitle} · build {_render_commit_short}"
    st.markdown(
        f"""
        <div class='brand'>
          <img src='{LOGO_URL}' style='height:34px; width:auto;' />
          <div>
            <div class='brand-title'>{APP_TITLE}</div>
            <div class='brand-subtitle'>{_subtitle}</div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
with t2:
    page = render_top_nav()
st.markdown("</div>", unsafe_allow_html=True)

if page == "Dashboard":
    dashboard.render()
elif page == "Clients":
    clients.render()
elif page == "Client Folder":
    client_folder.render()
elif page == "Jobs":
    jobs.render()
elif page == "Job Folder":
    job_folder.render()
elif page == "Admin":
    admin.render()
elif page == "Scope 1":
    scope1.render()
elif page == "Scope 2":
    scope2.render()
elif page == "Scope 3":
    scope3.render()
