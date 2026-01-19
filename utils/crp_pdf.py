# app.py
import sys
import importlib
from pathlib import Path
import streamlit as st

# --- CONFIG / BOOT ---
from config import APP_TITLE, LOGO_URL
from core.database import run_ddl
from core.migrations import run_migrations
from components.navigation import render_sidebar

PROJECT_ROOT = Path(__file__).parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

st.set_page_config(layout="wide", page_title=APP_TITLE, page_icon="🌱")

# Keep our custom sidebar; hide Streamlit’s built-in multipage nav
st.markdown("""
<style>
div[data-testid="stSidebarNav"]{display:none!important;}
div[data-testid="stSidebarNav"]+div{padding-top:0!important;}
</style>
""", unsafe_allow_html=True)

# Optional stylesheet
try:
    with open(PROJECT_ROOT / "assets" / "styles.css", "r", encoding="utf-8") as f:
        st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)
except Exception:
    pass

# Schema + migrations (safe to run on every rerun)
run_ddl()
run_migrations()

# --- Dynamic page loader (supports either `pages/` or `nzi_pages/`) ---
def discover_pages_pkg() -> str | None:
    # NZI Pro baseline: pages live in `nzi_pages/` (not `pages/`)
    if (PROJECT_ROOT / "nzi_pages").exists():
        return "nzi_pages"
    return None

PAGES_PKG = discover_pages_pkg()

def load_page_module(name: str):
    """Return (module or None, error or None)."""
    if not PAGES_PKG:
        return None, f"No pages folder found. Expected `pages/` or `nzi_pages/` under {PROJECT_ROOT}."
    try:
        mod = importlib.import_module(f"{PAGES_PKG}.{name}")
        if not hasattr(mod, "render"):
            return None, f"Module `{PAGES_PKG}.{name}` has no render()"
        return mod, None
    except ModuleNotFoundError as e:
        return None, f"{e}"
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"

# Try to import each page module
dashboard, err_dashboard = load_page_module("dashboard")
clients, err_clients = load_page_module("clients")
client_folder, err_client_folder = load_page_module("client_folder")
jobs, err_jobs = load_page_module("jobs")
reports, err_reports = load_page_module("reports")   # optional
admin, err_admin = load_page_module("admin")

# --- Header ---
c1, c2 = st.columns([1, 6])
with c1:
    st.image(LOGO_URL, width=160)
with c2:
    st.markdown(f"### {APP_TITLE}")
    st.caption("Net Zero International — internal portal")
st.markdown("<div class='hr'></div>", unsafe_allow_html=True)

# (Optional) quick diagnostics expander
with st.expander("🔧 Diagnostics", expanded=False):
    st.write({
        "pages_pkg": PAGES_PKG or "—",
        "dashboard": "OK" if dashboard else err_dashboard,
        "clients": "OK" if clients else err_clients,
        "client_folder": "OK" if client_folder else err_client_folder,
        "jobs": "OK" if jobs else err_jobs,
        "reports": "OK" if reports else (err_reports or "missing (optional)"),
        "admin": "OK" if admin else err_admin,
    })

# --- Custom sidebar navigation + routing ---
page = render_sidebar()  # must return one of: "Dashboard", "Clients", "Client Folder", "Jobs", "Reports", "Admin"

def render_or_warn(mod, name: str):
    if mod:
        mod.render()
    else:
        st.warning(f"Missing page: **{name}**. Ensure `{PAGES_PKG}/{name}.py` exists and defines a render() function.")

if page == "Dashboard":
    render_or_warn(dashboard, "dashboard")
elif page == "Clients":
    render_or_warn(clients, "clients")
elif page == "Client Folder":
    render_or_warn(client_folder, "client_folder")
elif page == "Jobs":
    render_or_warn(jobs, "jobs")
elif page == "Reports":
    render_or_warn(reports, "reports")
elif page == "Admin":
    render_or_warn(admin, "admin")
else:
    st.info("Select a page from the sidebar.")
