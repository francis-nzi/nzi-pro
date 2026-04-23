import io
import mimetypes
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from dotenv import load_dotenv

# Load local .env defaults without overriding deployment/runtime environment.
load_dotenv(override=False)

# Ensure UTF-8 console output on Windows so startup logs never crash under cp1252.
for _stream in (sys.stdout, sys.stderr):
    try:
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:
        # Keep startup resilient even if stream reconfiguration is unavailable.
        pass


def _safe_startup_log(level: str, message: str) -> None:
    """Best-effort startup logger that never raises on console encoding issues."""
    text = f"[{level}] {message}"
    try:
        print(text)
        return
    except UnicodeEncodeError:
        pass

    fallback = text.encode("ascii", errors="backslashreplace").decode("ascii")
    try:
        print(fallback)
    except Exception:
        # Last resort: avoid raising during import/startup logging.
        return


def _env_truthy(name: str, default: str = "false") -> bool:
    val = str(os.getenv(name, default) or "").strip().lower()
    return val in ("1", "true", "yes", "y", "on")


def _strict_auth_required() -> bool:
    env = str(os.getenv("APP_ENV", "") or "").strip().lower()
    if env in ("prod", "production"):
        return True
    return _env_truthy("ENFORCE_JWT_AUTH", "false")


if _strict_auth_required() and not str(os.getenv("NZI_JWT_SECRET") or "").strip():
    _safe_startup_log("WARN", "Strict auth mode is enabled but NZI_JWT_SECRET is missing.")

import pandas as pd
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from openpyxl import load_workbook

from core.database import db_backend, get_conn
from services.audit_log import fetch_row_dict, record_audit_event
from services.job_folder_excel import build_excel_template_bytes
from services import sites as sites_service
from services.dataset_selector import (
    resolve_dataset_resolution,
)
from services.client_benchmark import ensure_client_benchmark_columns
from services.kaleido_browser import ensure_kaleido_browser
from services.playwright_browser import ensure_playwright_browser
from api.admin_routes import router as admin_router
from api.admin_routes import _require_org_capacity
from api.job_scope_data_routes import router as job_scope_data_router
from api.job_emission_register_routes import router as job_emission_register_router
from api.job_custom_factors_routes import router as job_custom_factors_router
from api.job_milestone_routes import router as job_milestone_router
from api.custom_factors_routes import router as custom_factors_router
from api.client_dashboard_routes import router as client_dashboard_router
from api.client_notes_routes import router as client_notes_router
from api.client_reporting_routes import router as client_reporting_router
from api.job_intensity_routes import router as job_intensity_router
from api.job_live_report_routes import router as job_live_report_router
from api.main_dashboard_routes import router as main_dashboard_router
from api.job_data_output_routes import router as job_data_output_router
from api.job_report_routes import router as job_report_router
from api.pdf_generation_routes import router as pdf_generation_router
from api.job_files_routes import router as job_files_router
from api.job_communications_routes import router as job_communications_router
from api.milestone_template_routes import router as milestone_template_router
from api.theme_routes import router as theme_router
from api.time_routes import router as time_router
from api.report_template_routes import router as report_template_router
from api.report_actions_routes import router as report_actions_router
from api.system_settings_routes import router as system_settings_router
from api.custom_fields_routes import router as custom_fields_router
from api.databank_routes import router as databank_router
from api.methodology_routes import router as methodology_router
from api.feedback_routes import router as feedback_router
from api.messaging_templates_routes import router as messaging_templates_router
from api.user_settings_routes import router as user_settings_router
from api.crm_timeline_routes import router as crm_timeline_router
from api.crm_automation_routes import router as crm_automation_router
from api.business_development_routes import router as business_development_router
from api.lca_routes import router as lca_router
from api.onedrive_routes import router as onedrive_router
from api.feedback_routes import (
    create_feedback_item as _create_feedback_item,
    list_feedback_items as _list_feedback_items,
    update_feedback_item as _update_feedback_item,
)
from api.spend_data_routes import router as spend_data_router
from api.employee_commuting_routes import router as employee_commuting_router
from api.quotes_routes import router as quotes_router
from api.xero_routes import router as xero_router
from api.dataset_import_routes import router as dataset_import_router
from api.auth import _current_user
from api.auth_routes import router as auth_router
from api.permissions import assert_client_access, assert_job_access, assert_permission
from services.tenancy import get_default_org_id, require_org


def _client_audit_snapshot(con, client_db_id: int, org_id: str | None = None) -> dict | None:
    if org_id is not None and str(org_id).strip():
        return fetch_row_dict(
            con,
            "SELECT * FROM clients WHERE db_id = ? AND org_id = ?",
            [int(client_db_id), str(org_id).strip()],
        )
    return fetch_row_dict(
        con,
        "SELECT * FROM clients WHERE db_id = ?",
        [int(client_db_id)],
    )


def _job_audit_snapshot(con, job_id: int) -> dict | None:
    return fetch_row_dict(
        con,
        "SELECT * FROM jobs WHERE job_id = ?",
        [int(job_id)],
    )


def _client_site_audit_snapshot(con, client_db_id: int, site_id: int, org_id: str | None = None) -> dict | None:
    if org_id is not None and str(org_id).strip():
        row = fetch_row_dict(
            con,
            "SELECT * FROM client_sites WHERE client_db_id = ? AND site_id = ? AND org_id = ?",
            [int(client_db_id), int(site_id), str(org_id).strip()],
        )
        if row:
            return row
        return fetch_row_dict(
            con,
            "SELECT * FROM client_sites WHERE client_db_id = ? AND site_id = ? AND org_id IS NULL",
            [int(client_db_id), int(site_id)],
        )
    return fetch_row_dict(
        con,
        "SELECT * FROM client_sites WHERE client_db_id = ? AND site_id = ?",
        [int(client_db_id), int(site_id)],
    )


def _ensure_client_sites_runtime_columns(con) -> None:
    fn = getattr(sites_service, "ensure_client_sites_runtime_columns", None)
    if callable(fn):
        fn(con)


def _ensure_registered_office_site(client_db_id: int, con=None) -> int | None:
    fn = getattr(sites_service, "ensure_registered_office_site", None)
    if callable(fn):
        return fn(client_db_id, con=con)
    return None


def _list_sites(client_db_id: int):
    fn = getattr(sites_service, "list_sites", None)
    if callable(fn):
        return fn(client_db_id)
    return pd.DataFrame(columns=["site_id", "site_name", "location", "is_registered_office"])


def _fetch_client_sites_payload(client_db_id: int, con=None) -> dict[str, object]:
    fn = getattr(sites_service, "fetch_client_sites_payload", None)
    if callable(fn):
        return fn(client_db_id, con=con)

    # Backward-compatible fallback if an older services.sites module is deployed.
    df = _list_sites(client_db_id)
    active_sites: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        for _, r in df.iterrows():
            active_sites.append(
                {
                    "site_id": int(r.get("site_id")) if r.get("site_id") is not None else None,
                    "site_name": r.get("site_name"),
                    "location": r.get("location"),
                    "is_registered_office": bool(r.get("is_registered_office"))
                    if r.get("is_registered_office") is not None
                    else False,
                    "vacated_date": None,
                }
            )
    return {
        "client_db_id": int(client_db_id),
        "active_sites": active_sites,
        "vacated_sites": [],
    }


def _client_contact_audit_snapshot(con, client_db_id: int, contact_id: int, org_id: str | None = None) -> dict | None:
    if org_id is not None and str(org_id).strip():
        return fetch_row_dict(
            con,
            "SELECT * FROM client_contacts WHERE client_db_id = ? AND contact_id = ? AND org_id = ?",
            [int(client_db_id), int(contact_id), str(org_id).strip()],
        )
    return fetch_row_dict(
        con,
        "SELECT * FROM client_contacts WHERE client_db_id = ? AND contact_id = ?",
        [int(client_db_id), int(contact_id)],
    )


def _job_template_assignment_audit_snapshot(con, job_id: int) -> dict | None:
    row = fetch_row_dict(
        con,
        """
        SELECT
            j.job_id,
            j.job_template_id,
            jt.template_name,
            jt.template_key
        FROM jobs j
        LEFT JOIN job_templates jt ON jt.job_template_id = j.job_template_id
        WHERE j.job_id = ?
        """,
        [int(job_id)],
    )
    return row


def _job_scope_config_audit_snapshot(con, job_id: int) -> dict:
    config_rows = con.execute(
        """
        SELECT scope, include_scope, dataset_id, factor_method
        FROM job_scope_config
        WHERE job_id = ?
        ORDER BY scope
        """,
        [int(job_id)],
    ).fetchall()
    additional_rows = con.execute(
        """
        SELECT dataset_id
        FROM job_additional_datasets
        WHERE job_id = ?
        ORDER BY dataset_id
        """,
        [int(job_id)],
    ).fetchall()
    return {
        "job_id": int(job_id),
        "items": [
            {
                "scope": str(row[0]) if row and row[0] is not None else None,
                "include_scope": bool(row[1]) if row and row[1] is not None else None,
                "dataset_id": int(row[2]) if row and row[2] is not None else None,
                "factor_method": str(row[3]) if row and row[3] is not None else None,
            }
            for row in config_rows
        ],
        "additional_dataset_ids": [
            int(row[0]) for row in additional_rows if row and row[0] is not None
        ],
    }

app = FastAPI(title="NZI Pro API", version="0.1.0")


def _json_null_if_na(value):
    """Convert pandas/NumPy NA-like values to JSON-safe None."""
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    return value


@app.get("/support/database-fingerprint")
def support_database_fingerprint(_user: dict[str, str] = Depends(_current_user)):
    """Return a small fingerprint for the currently connected database."""
    with get_conn() as con:
        row = con.execute(
            """
            SELECT
              current_database() AS db_name,
              current_user AS db_user,
              inet_server_addr()::text AS host_ip,
              inet_server_port() AS host_port,
              version() AS pg_version
            """
        ).fetchone()

    if not row:
        raise HTTPException(status_code=500, detail="Unable to read database fingerprint")

    return {
        "db_name": row[0],
        "db_user": row[1],
        "host_ip": row[2],
        "host_port": row[3],
        "pg_version": row[4],
    }

# Serve frontend-uploaded assets (e.g., /uploads/system/nzi-logo.png)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOADS_DIR = PROJECT_ROOT / "frontend" / "public" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


def _client_logo_scope_dir(client_db_id: int | None) -> str:
    if client_db_id is not None and int(client_db_id) > 0:
        return f"client-{int(client_db_id)}"
    return f"temp-{uuid4().hex}"


def _client_logo_upload_path(client_db_id: int | None, filename: str, content_type: str | None) -> tuple[Path, str]:
    scope_dir = _client_logo_scope_dir(client_db_id)
    upload_dir = UPLOADS_DIR / "clients" / scope_dir
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(filename or "").suffix.lower()
    if ext and ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}:
        ext = ""
    if not ext:
        guessed = mimetypes.guess_extension(str(content_type or "").split(";")[0].strip().lower())
        if guessed == ".jpe":
            guessed = ".jpg"
        ext = guessed if guessed in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"} else ".png"

    target_path = upload_dir / f"logo{ext}"
    return target_path, f"/uploads/clients/{scope_dir}/logo{ext}"


def _resolve_uploaded_logo_path(raw_url: str | None) -> Path | None:
    raw = str(raw_url or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    path = parsed.path if parsed.scheme else raw
    rel = path.lstrip("/")
    if not rel.startswith("uploads/"):
        return None
    return PROJECT_ROOT / "frontend" / "public" / rel


def _resolve_job_template_file_path(raw_path: str | None) -> Path | None:
    path_text = str(raw_path or "").strip()
    if not path_text:
        return None

    candidate_paths: list[Path] = []
    raw_path_obj = Path(path_text)
    if raw_path_obj.is_absolute():
        candidate_paths.append(raw_path_obj)
    else:
        candidate_paths.extend(
            [
                PROJECT_ROOT / raw_path_obj,
                PROJECT_ROOT / "frontend" / raw_path_obj,
                PROJECT_ROOT / "frontend" / "public" / raw_path_obj,
                PROJECT_ROOT / "templates" / raw_path_obj.name,
                PROJECT_ROOT / "uploaded_templates" / raw_path_obj.name,
            ]
        )

    seen: set[str] = set()
    for candidate in candidate_paths:
        try:
            resolved = candidate.resolve()
        except Exception:
            resolved = candidate
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        if resolved.exists() and resolved.is_file():
            return resolved

    return None


def _seeded_job_template_fallbacks(template_key: str | None, template_type: str | None) -> list[Path]:
    """Return known seeded workbook/document paths for legacy templates."""
    key = str(template_key or "").strip().lower()
    typ = str(template_type or "").strip().lower()
    fallbacks: list[Path] = []

    if typ == "dataset":
        if "standard_uk" in key:
            fallbacks.append(PROJECT_ROOT / "templates" / "NZI Data Upload Template - Standard UK.xlsx")
            fallbacks.append(PROJECT_ROOT / "templates" / "NZI Data Upload Template - Standard UK.csv")
            fallbacks.append(PROJECT_ROOT / "templates" / "NZI Data Colection Upload Template - Standard UK.csv")
        if "basic_uk" in key or key == "basic_uk":
            fallbacks.append(PROJECT_ROOT / "templates" / "NZI Data Upload Template - Basic UK.xlsx")
    elif typ in ("report", "crp"):
        if "basic_uk" in key or key == "basic_uk":
            fallbacks.append(PROJECT_ROOT / "templates" / "DEMOCO Carbon Reduction Plan Dec 2025 - Second Year Onwards.docx")
        if "quote" in key:
            fallbacks.append(PROJECT_ROOT / "templates" / "NZI Standard Quote.docx")

    return fallbacks

# Include admin routes
app.include_router(admin_router)

# Include job scope data routes
app.include_router(job_scope_data_router)

# Include emission register routes
app.include_router(job_emission_register_router)

# Include job custom factors routes
app.include_router(job_custom_factors_router)

# Include job milestone completion routes
app.include_router(job_milestone_router)

# Include dataset import routes
app.include_router(dataset_import_router)

# Include custom factors routes
app.include_router(custom_factors_router)

# Include client dashboard routes
app.include_router(client_dashboard_router)

# Include client notes routes
app.include_router(client_notes_router)

# Include client reporting routes
app.include_router(client_reporting_router)

# Include job intensity routes
app.include_router(job_intensity_router)

# Include live report routes
app.include_router(job_live_report_router)

# Include main dashboard routes
app.include_router(main_dashboard_router)

# Include job data output routes
app.include_router(job_data_output_router)

# Include job report routes
app.include_router(job_report_router)

# Include PDF generation routes (Phase 1: Async PDF)
app.include_router(pdf_generation_router)

# Include job files routes
app.include_router(job_files_router)

# Include job communications routes
app.include_router(job_communications_router)

# Include milestone template routes
app.include_router(milestone_template_router)

# Include theme routes
app.include_router(theme_router)

# Include time tracking routes
app.include_router(time_router)

# Include report template routes
app.include_router(report_template_router)

# Include report actions routes
app.include_router(report_actions_router)

# Include system settings routes (NZI logo upload and system configuration)
app.include_router(system_settings_router)
_safe_startup_log("OK", f"System settings router registered with {len(system_settings_router.routes)} routes")

# Include custom fields routes
app.include_router(custom_fields_router)
app.include_router(databank_router)
app.include_router(methodology_router)
app.include_router(feedback_router)
app.include_router(auth_router)
app.include_router(spend_data_router)
app.include_router(employee_commuting_router)
app.include_router(quotes_router)
app.include_router(xero_router)
app.include_router(messaging_templates_router)
app.include_router(user_settings_router)
app.include_router(crm_timeline_router)
app.include_router(crm_automation_router)
app.include_router(business_development_router)
app.include_router(lca_router)
app.include_router(onedrive_router)
app.include_router(dataset_import_router)
_safe_startup_log("OK", f"Custom fields router registered with {len(custom_fields_router.routes)} routes")
_safe_startup_log("OK", f"Feedback router registered with {len(feedback_router.routes)} routes")


# Explicit feedback endpoints to guarantee availability on the main app.
@app.get("/feedback/items")
def app_list_feedback_items(
    feedback_type: str = Query(default="all"),
    include_completed: bool = Query(default=True),
    _user: dict = Depends(_current_user),
):
    return _list_feedback_items(
        feedback_type=feedback_type,
        include_completed=include_completed,
        _user=_user,
    )


@app.post("/feedback/items")
def app_create_feedback_item(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    return _create_feedback_item(body=body, _user=_user)


@app.patch("/feedback/items/{feedback_id}")
def app_update_feedback_item(
    feedback_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    return _update_feedback_item(feedback_id=feedback_id, body=body, _user=_user)


@app.on_event("startup")
async def startup_event():
    """Run migrations on startup and keep optional browser warmups alive."""
    try:
        from core.migrations import run_migrations
        run_migrations()
        _safe_startup_log("OK", "Startup migrations completed successfully")
    except Exception as e:
        _safe_startup_log("WARN", f"Startup migrations failed: {e}")
    try:
        browser_path = ensure_kaleido_browser()
        _safe_startup_log("OK", f"Kaleido browser ready at {browser_path}")
    except Exception as e:
        _safe_startup_log("WARN", f"Kaleido browser setup failed: {e}")
    try:
        browser_root = ensure_playwright_browser()
        _safe_startup_log("OK", f"Playwright Chromium ready in {browser_root}")
    except Exception as e:
        _safe_startup_log("WARN", f"Playwright Chromium setup failed: {e}")


def _job_template_paths(job_id: int) -> dict[str, str | None]:
    """Resolve the job-level template selection.

    Defaults to the legacy in-repo templates if no job_template_id/template row is present.
    """
    default_excel = "templates/NZI Data Upload Template - Basic UK.xlsx"
    default_crp = "templates/DEMOCO Carbon Reduction Plan Dec 2025 - Second Year Onwards.docx"

    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT
                    COALESCE(jt.file_path, jt.excel_template_path) AS excel_template_path,
                    jt.crp_template_path
                FROM jobs j
                LEFT JOIN job_templates jt ON jt.job_template_id = j.job_template_id
                WHERE j.job_id=?
                """,
                [int(job_id)],
            ).fetchone()
    except Exception:
        row = None

    excel_path = None
    crp_path = None
    if row:
        try:
            excel_path = (row[0] or None)
        except Exception:
            excel_path = None
        try:
            crp_path = (row[1] or None)
        except Exception:
            crp_path = None

    return {
        "excel_template_path": excel_path or default_excel,
        "crp_template_path": crp_path or default_crp,
    }


def _load_legacy_scope_dataset_map(job_id: int) -> dict[str, int]:
    ds_map: dict[str, int] = {}
    try:
        with get_conn() as con:
            df_scopes = con.execute(
                """
                SELECT scope, dataset_id
                FROM job_scope_config
                WHERE job_id=?
                """,
                [int(job_id)],
            ).df()
        if df_scopes is not None and (not df_scopes.empty):
            for _, rr in df_scopes.iterrows():
                scope = str(rr.get("scope") or "").strip()
                dsid = rr.get("dataset_id")
                if scope and dsid is not None and str(dsid) != "nan":
                    ds_map[scope] = int(dsid)
    except Exception:
        return {}
    return ds_map


def _ensure_job_additional_datasets_table() -> None:
    try:
        with get_conn() as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS job_additional_datasets (
                    job_id INTEGER NOT NULL,
                    dataset_id INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    PRIMARY KEY (job_id, dataset_id)
                )
                """
            )
    except Exception:
        # Keep existing flows resilient if schema migration is in progress.
        pass


def _ensure_job_original_portfolio_column(con) -> None:
    """Ensure jobs.original_portfolio exists for older deployments."""
    try:
        con.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_portfolio VARCHAR DEFAULT 'NZI'")
    except Exception:
        pass


def _ensure_client_billing_columns(con) -> None:
    """Ensure client billing-address columns exist for older deployments."""
    statements = [
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS create_site_from_address BOOLEAN",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_company VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_same_as_main BOOLEAN DEFAULT TRUE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_line1 VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_line2 VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_city VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_region VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_postcode VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_country VARCHAR",
    ]
    for statement in statements:
        con.execute(statement)


def _ensure_client_org_columns(con) -> None:
    """Ensure client/org tenancy columns exist and backfill rows to the default org."""
    statements = [
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id VARCHAR",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS org_id VARCHAR",
        "ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS org_id VARCHAR",
    ]
    for statement in statements:
        try:
            con.execute(statement)
        except Exception:
            pass
    default_org_id = get_default_org_id()
    if default_org_id:
        try:
            con.execute("UPDATE clients SET org_id = COALESCE(org_id, ?) WHERE org_id IS NULL", [default_org_id])
            con.execute("UPDATE client_sites SET org_id = COALESCE(org_id, ?) WHERE org_id IS NULL", [default_org_id])
            con.execute("UPDATE client_contacts SET org_id = COALESCE(org_id, ?) WHERE org_id IS NULL", [default_org_id])
        except Exception:
            pass


def _resolve_scope_dataset_map(
    job_id: int,
) -> tuple[dict[str, int], dict[str, object] | None, list[str]]:
    """Resolve effective scope->dataset map with automatic mode first, legacy fallback."""
    warnings: list[str] = []
    auto_resolution: dict[str, object] | None = None
    ds_map: dict[str, int] = {}

    try:
        auto_resolution = resolve_dataset_resolution(int(job_id))
        auto_primary = auto_resolution.get("scope_primary_datasets") or {}
        for scope, dsid in auto_primary.items():
            if dsid is None:
                continue
            ds_map[str(scope)] = int(dsid)
    except Exception as e:
        warnings.append(f"Automatic dataset resolution unavailable: {e}")

    if not ds_map:
        ds_map = _load_legacy_scope_dataset_map(int(job_id))
        if ds_map:
            warnings.append("Using legacy job_scope_config dataset mapping fallback.")

    return ds_map, auto_resolution, warnings


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex=r"^https:\/\/.*\.onrender\.com$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


# ... existing code ...
@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "NZI Pro API",
    }
# ... existing code ...


@app.get("/debug/env")
def debug_env(_user: dict[str, str] = Depends(_current_user)):
    url = os.getenv("DATABASE_URL") or ""
    host = ""
    port: int | None = None
    try:
        if url:
            parsed = urlparse(url)
            host = parsed.hostname or ""
            port = parsed.port
    except Exception:
        host = ""
        port = None
    return {
        "db_backend": db_backend(),
        "database_url_is_set": bool(url),
        "database_url_host": host,
        "database_url_port": port,
        "database_url_has_sslmode": ("sslmode=" in url),
    }


@app.post("/jobs")
def create_job(request: Request, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    """Create a new job with automatic period calculation."""
    try:
        from datetime import date, timedelta
        import calendar
        from dateutil.relativedelta import relativedelta
        assert_permission(_user, "jobs.create")

        def _ensure_job_original_portfolio_column(con) -> None:
            try:
                con.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_portfolio VARCHAR DEFAULT 'NZI'")
            except Exception:
                pass

        def _col_exists(con, table_name: str, col_name: str) -> bool:
            try:
                row = con.execute(
                    """
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = ? AND column_name = ?
                    LIMIT 1
                    """,
                    [table_name, col_name],
                ).fetchone()
                return bool(row)
            except Exception:
                return False

        def _month_value(value):
            if value is None:
                return None
            if isinstance(value, int):
                return value
            try:
                numeric = int(str(value).strip())
                if 1 <= numeric <= 12:
                    return numeric
            except Exception:
                pass
            month_map = {
                "january": 1,
                "jan": 1,
                "february": 2,
                "feb": 2,
                "march": 3,
                "mar": 3,
                "april": 4,
                "apr": 4,
                "may": 5,
                "june": 6,
                "jun": 6,
                "july": 7,
                "jul": 7,
                "august": 8,
                "aug": 8,
                "september": 9,
                "sep": 9,
                "sept": 9,
                "october": 10,
                "oct": 10,
                "november": 11,
                "nov": 11,
                "december": 12,
                "dec": 12,
            }
            return month_map.get(str(value).strip().lower())

        def _build_reporting_period_end(reporting_year_value, month_value, day_value):
            try:
                reporting_year_int = int(reporting_year_value)
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot determine reporting year/period. Please provide reporting_year or ensure client has benchmark period set.",
                ) from exc

            month_int = month_value or 12
            if month_int < 1 or month_int > 12:
                raise HTTPException(
                    status_code=400,
                    detail="Client financial year end month is invalid. Please update the client benchmark settings.",
                )

            try:
                day_int = int(day_value) if day_value is not None else 31
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Client financial year end day is invalid. Please update the client benchmark settings.",
                ) from exc

            if day_int < 1:
                raise HTTPException(
                    status_code=400,
                    detail="Client financial year end day is invalid. Please update the client benchmark settings.",
                )

            last_day = calendar.monthrange(reporting_year_int, month_int)[1]
            safe_day = min(day_int, last_day)
            return date(reporting_year_int, month_int, safe_day)

        def _next_job_number(con) -> str:
            rows = con.execute(
                """
                SELECT job_number
                FROM jobs
                WHERE job_number IS NOT NULL
                """
            ).fetchall()
            max_number = 0
            for row in rows:
                job_number_value = str((row[0] if row else "") or "").strip()
                if not job_number_value or job_number_value.upper() == "PENDING":
                    continue
                if not job_number_value.upper().startswith("J"):
                    continue
                numeric_part = "".join(ch for ch in job_number_value[1:] if ch.isdigit())
                if not numeric_part:
                    continue
                try:
                    max_number = max(max_number, int(numeric_part))
                except Exception:
                    continue
            return f"J{max_number + 1:06d}"
        
        client_db_id = body.get("client_db_id")
        job_type_name = body.get("job_type")
        reporting_year = body.get("reporting_year")
        is_benchmark = body.get("is_benchmark", False)
        start_date = body.get("start_date")
        due_date = body.get("due_date")
        
        if not client_db_id or not job_type_name:
            raise HTTPException(status_code=400, detail="client_db_id and job_type are required")
        
        if not start_date or not due_date:
            raise HTTPException(status_code=400, detail="start_date and due_date are required")
        assert_client_access(_user, int(client_db_id))

        with get_conn() as con:
            _ensure_job_original_portfolio_column(con)
            # Lookup job_type_id and is_crp from job_types table
            job_type_row = con.execute(
                "SELECT job_type_id, is_crp FROM job_types WHERE name = ? AND is_active = TRUE",
                [job_type_name]
            ).fetchone()
            
            if not job_type_row:
                raise HTTPException(status_code=400, detail=f"Job type '{job_type_name}' not found or inactive")
            
            job_type_id = job_type_row[0]
            is_crp = job_type_row[1] or False
            
            # Get client's benchmark period and financial year info
            fy_month_expr = "financial_year_end_month" if _col_exists(con, "clients", "financial_year_end_month") else "NULL"
            fy_day_expr = "financial_year_end_day" if _col_exists(con, "clients", "financial_year_end_day") else "NULL"
            year_end_expr = "year_end_month" if _col_exists(con, "clients", "year_end_month") else "NULL"
            client_row = con.execute(
                """
                SELECT benchmark_period_start, benchmark_period_end,
                       {fy_month_expr}, {fy_day_expr},
                       benchmark_year,
                       {year_end_expr}
                FROM clients
                WHERE db_id = ?
                """.format(
                    fy_month_expr=fy_month_expr,
                    fy_day_expr=fy_day_expr,
                    year_end_expr=year_end_expr,
                ),
                [int(client_db_id)]
            ).fetchone()
            
            if not client_row:
                raise HTTPException(status_code=404, detail="Client not found")
            
            benchmark_start, benchmark_end, fy_month, fy_day, benchmark_year, year_end_month = client_row
            fy_month = fy_month or _month_value(year_end_month)
            
            # Calculate reporting period
            reporting_period_start = None
            reporting_period_end = None
            
            if is_benchmark:
                # This is the benchmark job - use client's benchmark period
                if benchmark_start and benchmark_end:
                    reporting_period_start = benchmark_start
                    reporting_period_end = benchmark_end
                    if not reporting_year and benchmark_end:
                        reporting_year = benchmark_end.year
                elif reporting_year:
                    # Calculate from reporting_year and financial year end
                    reporting_period_end = _build_reporting_period_end(reporting_year, fy_month, fy_day)
                    reporting_period_start = reporting_period_end - relativedelta(years=1) + timedelta(days=1)
            elif reporting_year:
                # Subsequent job - calculate period based on reporting_year
                reporting_period_end = _build_reporting_period_end(reporting_year, fy_month, fy_day)
                reporting_period_start = reporting_period_end - relativedelta(years=1) + timedelta(days=1)
            elif benchmark_start and benchmark_end:
                # Auto-calculate next period after benchmark
                # Find the latest job for this client
                latest_job = con.execute(
                    """
                    SELECT reporting_period_end, reporting_year
                    FROM jobs
                    WHERE client_db_id = ?
                    ORDER BY reporting_period_end DESC NULLS LAST, reporting_year DESC NULLS LAST
                    LIMIT 1
                    """,
                    [int(client_db_id)]
                ).fetchone()
                
                if latest_job and latest_job[0]:
                    # Add 1 year to the latest period
                    reporting_period_start = latest_job[0] + timedelta(days=1)
                    reporting_period_end = reporting_period_start + relativedelta(years=1) - timedelta(days=1)
                    reporting_year = reporting_period_end.year
                else:
                    # First job after benchmark - use benchmark + 1 year
                    reporting_period_start = benchmark_end + timedelta(days=1)
                    reporting_period_end = reporting_period_start + relativedelta(years=1) - timedelta(days=1)
                    reporting_year = reporting_period_end.year
            
            if not reporting_year:
                raise HTTPException(status_code=400, detail="Cannot determine reporting year/period. Please provide reporting_year or ensure client has benchmark period set.")
            
            row = con.execute(
                """
                INSERT INTO jobs (
                    client_db_id, job_type_id, job_type, original_portfolio, job_number, title, reporting_year,
                    reporting_period_start, reporting_period_end, is_benchmark, is_crp,
                    status, start_date, due_date, legacy_job_no
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING job_id
                """,
                [
                    int(client_db_id),
                    job_type_id,
                    job_type_name,
                    "NZI",
                    "PENDING",
                    body.get("title", "Untitled").strip() or "Untitled",
                    int(reporting_year),
                    reporting_period_start,
                    reporting_period_end,
                    is_benchmark,
                    is_crp,
                    body.get("status", "Open"),
                    start_date,
                    due_date,
                    body.get("legacy_job_no"),
                ],
            ).fetchone()
            
            job_id = int(row[0])
            job_number = _next_job_number(con)
            
            con.execute(
                "UPDATE jobs SET job_number = ? WHERE job_id = ?",
                [job_number, job_id],
            )
            after = _job_audit_snapshot(con, job_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="job",
                entity_id=job_id,
                client_id=int(client_db_id),
                job_id=job_id,
                after=after,
                metadata={
                    "job_number": job_number,
                    "job_type": job_type_name,
                    "is_benchmark": bool(is_benchmark),
                },
            )
            
            return {
                "ok": True, 
                "job_id": job_id, 
                "job_number": job_number,
                "reporting_period_start": str(reporting_period_start) if reporting_period_start else None,
                "reporting_period_end": str(reporting_period_end) if reporting_period_end else None,
                "is_benchmark": is_benchmark
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create job: {e}")


@app.get("/jobs")
def list_jobs(
    q: str | None = None,
    crm: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.view")
    query = (q or "").strip()
    crm_filter = (crm or "").strip()

    def _col_exists(con, table_name: str, col_name: str) -> bool:
        try:
            row = con.execute(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = ? AND column_name = ?
                LIMIT 1
                """,
                [table_name, col_name],
            ).fetchone()
            return bool(row)
        except Exception:
            return False

    def _table_exists(con, table_name: str) -> bool:
        try:
            row = con.execute(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = ?
                LIMIT 1
                """,
                [table_name],
            ).fetchone()
            return bool(row)
        except Exception:
            return False

    try:
        with get_conn() as con:
            has_reporting_period_start = _col_exists(con, "jobs", "reporting_period_start")
            has_reporting_period_end = _col_exists(con, "jobs", "reporting_period_end")
            has_is_benchmark = _col_exists(con, "jobs", "is_benchmark")
            has_due_date = _col_exists(con, "jobs", "due_date")
            has_client_crm_owner = _col_exists(con, "clients", "crm_owner")
            has_job_crm_name = _col_exists(con, "jobs", "crm_name")
            has_job_plan = _table_exists(con, "job_plan")

            reporting_period_start_expr = "j.reporting_period_start" if has_reporting_period_start else "NULL::date AS reporting_period_start"
            reporting_period_end_expr = "j.reporting_period_end" if has_reporting_period_end else "NULL::date AS reporting_period_end"
            is_benchmark_expr = "j.is_benchmark" if has_is_benchmark else "NULL::boolean AS is_benchmark"
            due_date_expr = "j.due_date" if has_due_date else "NULL::date AS due_date"
            if has_job_crm_name and has_client_crm_owner:
                crm_name_value_expr = "COALESCE(NULLIF(j.crm_name, ''), NULLIF(c.crm_owner, ''))"
            elif has_job_crm_name:
                crm_name_value_expr = "NULLIF(j.crm_name, '')"
            elif has_client_crm_owner:
                crm_name_value_expr = "NULLIF(c.crm_owner, '')"
            else:
                crm_name_value_expr = "NULL::text"
            crm_name_expr = f"{crm_name_value_expr} AS crm_name"

            where_clauses = []
            params: list[object] = []
            if not bool(_user.get("is_super_admin")) and str(_user.get("access_scope") or "").strip().lower() == "linked_clients":
                linked_client_ids = sorted(
                    {
                        int(client_id)
                        for client_id in (_user.get("linked_client_ids") or [])
                        if client_id is not None
                    }
                )
                if not linked_client_ids:
                    return {"items": [], "limit": int(limit), "offset": int(offset), "total": 0}
                where_clauses.append(f"j.client_db_id IN ({','.join(['?'] * len(linked_client_ids))})")
                params.extend(linked_client_ids)

            if query:
                if db_backend() == "postgres":
                    where_clauses.append(
                        "(j.job_number ILIKE ? OR j.title ILIKE ? OR c.client_name ILIKE ?)"
                    )
                    like = f"%{query}%"
                    params.extend([like, like, like])
                else:
                    where_clauses.append(
                        "(lower(coalesce(j.job_number,'')) LIKE ? OR lower(coalesce(j.title,'')) LIKE ? OR lower(coalesce(c.client_name,'')) LIKE ?)"
                    )
                    like = f"%{query.lower()}%"
                    params.extend([like, like, like])

            if crm_filter:
                if db_backend() == "postgres":
                    where_clauses.append(f"{crm_name_value_expr} ILIKE ?")
                    params.append(f"%{crm_filter}%")
                else:
                    where_clauses.append(f"lower(coalesce({crm_name_value_expr},'')) LIKE ?")
                    params.append(f"%{crm_filter.lower()}%")

            where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

            total_row = con.execute(
                f"""
                SELECT COUNT(*)
                FROM jobs j
                JOIN clients c ON c.db_id = j.client_db_id
                {where_sql}
                """,
                params,
            ).fetchone()

            job_plan_join_sql = ""
            job_plan_select_sql = ""
            milestone_sort_expr = "2 AS milestone_sort_rank"
            if has_job_plan:
                job_plan_join_sql = "LEFT JOIN job_plan jp ON jp.job_id = j.job_id"
                job_plan_select_sql = """
                               , jp.data_collection_due, jp.data_collection_completed_at
                               , jp.first_draft_due, jp.first_draft_completed_at
                               , jp.final_report_due, jp.final_report_completed_at
                """
                if db_backend() == "postgres":
                    milestone_sort_expr = """
                        CASE
                            WHEN (
                                (jp.data_collection_due IS NOT NULL AND jp.data_collection_completed_at IS NULL AND jp.data_collection_due < (CURRENT_DATE - INTERVAL '1 day'))
                                OR (jp.first_draft_due IS NOT NULL AND jp.first_draft_completed_at IS NULL AND jp.first_draft_due < (CURRENT_DATE - INTERVAL '1 day'))
                                OR (jp.final_report_due IS NOT NULL AND jp.final_report_completed_at IS NULL AND jp.final_report_due < (CURRENT_DATE - INTERVAL '1 day'))
                            ) THEN 0
                            WHEN (
                                (jp.data_collection_due IS NOT NULL AND jp.data_collection_completed_at IS NULL AND jp.data_collection_due <= (CURRENT_DATE + INTERVAL '7 day'))
                                OR (jp.first_draft_due IS NOT NULL AND jp.first_draft_completed_at IS NULL AND jp.first_draft_due <= (CURRENT_DATE + INTERVAL '7 day'))
                                OR (jp.final_report_due IS NOT NULL AND jp.final_report_completed_at IS NULL AND jp.final_report_due <= (CURRENT_DATE + INTERVAL '7 day'))
                            ) THEN 1
                            ELSE 2
                        END AS milestone_sort_rank
                    """
                else:
                    milestone_sort_expr = """
                        CASE
                            WHEN (
                                (jp.data_collection_due IS NOT NULL AND jp.data_collection_completed_at IS NULL AND DATE(jp.data_collection_due) < DATE('now', '-1 day'))
                                OR (jp.first_draft_due IS NOT NULL AND jp.first_draft_completed_at IS NULL AND DATE(jp.first_draft_due) < DATE('now', '-1 day'))
                                OR (jp.final_report_due IS NOT NULL AND jp.final_report_completed_at IS NULL AND DATE(jp.final_report_due) < DATE('now', '-1 day'))
                            ) THEN 0
                            WHEN (
                                (jp.data_collection_due IS NOT NULL AND jp.data_collection_completed_at IS NULL AND DATE(jp.data_collection_due) <= DATE('now', '+7 day'))
                                OR (jp.first_draft_due IS NOT NULL AND jp.first_draft_completed_at IS NULL AND DATE(jp.first_draft_due) <= DATE('now', '+7 day'))
                                OR (jp.final_report_due IS NOT NULL AND jp.final_report_completed_at IS NULL AND DATE(jp.final_report_due) <= DATE('now', '+7 day'))
                            ) THEN 1
                            ELSE 2
                        END AS milestone_sort_rank
                    """

            rows = (
                con.execute(
                    f"""
                    SELECT j.job_id, j.job_number, j.title, j.reporting_year,
                           {reporting_period_start_expr}, {reporting_period_end_expr}, {is_benchmark_expr},
                           j.status, j.client_db_id, c.client_name, {crm_name_expr}, {due_date_expr},
                           {milestone_sort_expr}
                           {job_plan_select_sql}
                    FROM jobs j
                    JOIN clients c ON c.db_id = j.client_db_id
                    {job_plan_join_sql}
                    {where_sql}
                    ORDER BY milestone_sort_rank ASC, COALESCE(j.job_number, '') DESC, j.job_id DESC
                    LIMIT ? OFFSET ?
                    """,
                    [*params, int(limit), int(offset)],
                )
                .df()
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/jobs failed: {e}")

    # Helper function to calculate milestone status
    def get_milestone_status(due_date, completed_at):
        """Calculate traffic light status: green, amber, red, completed"""
        from datetime import date
        import pandas as pd

        if completed_at is not None and not pd.isna(completed_at):
            return "completed"
        if due_date is None or pd.isna(due_date):
            return "green"

        # Handle pandas/python datetime values safely.
        if hasattr(due_date, "date"):
            due_date = due_date.date()

        today = date.today()
        days_until_due = (due_date - today).days

        if days_until_due < -1:  # Overdue by more than 1 day
            return "red"
        elif days_until_due <= 7:  # Due within 7 days or 1 day overdue
            return "amber"
        else:
            return "green"
    
    def get_overall_status(statuses):
        """Get overall status: red if any red, amber if any amber, else green"""
        if "red" in statuses:
            return "red"
        elif "amber" in statuses:
            return "amber"
        else:
            return "green"

    items: list[dict[str, object]] = []
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            # Calculate individual milestone statuses
            milestone_statuses = []
            if r.get("data_collection_due"):
                milestone_statuses.append(get_milestone_status(r.get("data_collection_due"), r.get("data_collection_completed_at")))
            if r.get("first_draft_due"):
                milestone_statuses.append(get_milestone_status(r.get("first_draft_due"), r.get("first_draft_completed_at")))
            if r.get("final_report_due"):
                milestone_statuses.append(get_milestone_status(r.get("final_report_due"), r.get("final_report_completed_at")))
            
            # Calculate overall status
            overall_milestone_status = get_overall_status(milestone_statuses) if milestone_statuses else None
            
            items.append(
                {
                    "job_id": int(r.get("job_id")),
                    "job_number": _json_null_if_na(r.get("job_number")),
                    "title": _json_null_if_na(r.get("title")),
                    "reporting_year": (
                        int(r.get("reporting_period_end").year)
                        if r.get("reporting_period_end") is not None and hasattr(r.get("reporting_period_end"), "year")
                        else (
                            int(r.get("reporting_year"))
                            if _json_null_if_na(r.get("reporting_year")) is not None
                            else None
                        )
                    ),
                    "reporting_period_start": (
                        str(r.get("reporting_period_start"))
                        if _json_null_if_na(r.get("reporting_period_start")) is not None
                        else None
                    ),
                    "reporting_period_end": (
                        str(r.get("reporting_period_end"))
                        if _json_null_if_na(r.get("reporting_period_end")) is not None
                        else None
                    ),
                    "is_benchmark": (
                        bool(r.get("is_benchmark"))
                        if _json_null_if_na(r.get("is_benchmark")) is not None
                        else None
                    ),
                    "status": _json_null_if_na(r.get("status")),
                    "client_db_id": int(r.get("client_db_id")),
                    "client_name": _json_null_if_na(r.get("client_name")),
                    "crm_name": _json_null_if_na(r.get("crm_name")),
                    "due_date": (
                        str(r.get("due_date"))
                        if _json_null_if_na(r.get("due_date")) is not None
                        else None
                    ),
                    "milestone_status": overall_milestone_status,
                }
            )

    # Sort by milestone status priority: red > amber > green > None/completed
    def status_priority(item):
        status = item.get("milestone_status")
        if status == "red":
            return 0
        elif status == "amber":
            return 1
        elif status == "green":
            return 2
        else:
            return 3
    
    items.sort(key=status_priority)

    total = int(total_row[0] if total_row else 0)
    return {"items": items, "limit": int(limit), "offset": int(offset), "total": total}


@app.get("/jobs/{job_id}")
def get_job(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    try:
        with get_conn() as con:
            _ensure_job_original_portfolio_column(con)
            assert_job_access(_user, int(job_id))

            def _table_exists(table_name: str) -> bool:
                row = con.execute(
                    """
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = ?
                    LIMIT 1
                    """,
                    [table_name],
                ).fetchone()
                return bool(row)

            def _col_exists(table_name: str, col_name: str) -> bool:
                row = con.execute(
                    """
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
                    LIMIT 1
                    """,
                    [table_name, col_name],
                ).fetchone()
                return bool(row)

            reporting_period_start_expr = "j.reporting_period_start" if _col_exists("jobs", "reporting_period_start") else "NULL::date AS reporting_period_start"
            reporting_period_end_expr = "j.reporting_period_end" if _col_exists("jobs", "reporting_period_end") else "NULL::date AS reporting_period_end"
            is_benchmark_expr = "j.is_benchmark" if _col_exists("jobs", "is_benchmark") else "NULL::boolean AS is_benchmark"
            milestone_template_expr = "j.milestone_template_id" if _col_exists("jobs", "milestone_template_id") else "NULL::integer AS milestone_template_id"
            crm_name_expr = "j.crm_name" if _col_exists("jobs", "crm_name") else "NULL::text AS crm_name"
            crm_owner_expr = "c.crm_owner" if _col_exists("clients", "crm_owner") else "NULL::text AS crm_owner"
            legacy_job_no_expr = "j.legacy_job_no" if _col_exists("jobs", "legacy_job_no") else "NULL::text AS legacy_job_no"
            job_template_expr = "j.job_template_id" if _col_exists("jobs", "job_template_id") else "NULL::integer AS job_template_id"
            has_job_types_table = _table_exists("job_types")
            job_type_name_expr = "jt.name" if has_job_types_table else "NULL::text AS job_type"
            original_portfolio_expr = "COALESCE(j.original_portfolio, 'NZI')" if _col_exists("jobs", "original_portfolio") else "'NZI'::text AS original_portfolio"

            row = con.execute(
                f"""
                SELECT j.job_id, j.job_number, j.title, j.reporting_year,
                       {reporting_period_start_expr}, {reporting_period_end_expr}, {is_benchmark_expr},
                       j.status, {job_template_expr}, {milestone_template_expr},
                       j.client_db_id, c.client_name,
                       {crm_name_expr}, j.start_date, j.due_date, {legacy_job_no_expr},
                       {job_type_name_expr},
                       j.job_type_id,
                       {original_portfolio_expr}
                FROM jobs j
                LEFT JOIN clients c ON c.db_id = j.client_db_id
                {"LEFT JOIN job_types jt ON jt.job_type_id = j.job_type_id" if has_job_types_table else ""}
                WHERE j.job_id=?
                """,
                [int(job_id)],
            ).fetchone()
        
            if not row:
                raise HTTPException(status_code=404, detail="Job not found")
        
            # Try to get estimated_hours from job_types if the column exists
            estimated_hours = 0
            if row[16] and _col_exists("job_types", "estimated_hours"):  # job_type_id (17th column, 0-indexed)
                try:
                    jt_row = con.execute(
                        "SELECT estimated_hours FROM job_types WHERE job_type_id=?",
                        [row[16]]
                    ).fetchone()
                    if jt_row and jt_row[0] is not None:
                        estimated_hours = float(jt_row[0])
                except Exception:
                    pass  # Column might not exist yet

            # Fetch milestones with completion status
            milestones = None
            if _table_exists("job_plan"):
                milestone_completion_columns = [
                    "data_collection_completed_at",
                    "data_collection_completed_by",
                    "first_draft_completed_at",
                    "first_draft_completed_by",
                    "final_report_completed_at",
                    "final_report_completed_by",
                ]
                has_completion_columns = all(_col_exists("job_plan", col) for col in milestone_completion_columns)

                if has_completion_columns:
                    milestones = con.execute(
                        """
                        SELECT data_collection_due, first_draft_due, final_report_due,
                               data_collection_completed_at, data_collection_completed_by,
                               first_draft_completed_at, first_draft_completed_by,
                               final_report_completed_at, final_report_completed_by
                        FROM job_plan
                        WHERE job_id=?
                        """,
                        [int(job_id)],
                    ).fetchone()
                else:
                    milestones = con.execute(
                        """
                        SELECT data_collection_due, first_draft_due, final_report_due,
                               NULL AS data_collection_completed_at, NULL AS data_collection_completed_by,
                               NULL AS first_draft_completed_at, NULL AS first_draft_completed_by,
                               NULL AS final_report_completed_at, NULL AS final_report_completed_by
                        FROM job_plan
                        WHERE job_id=?
                        """,
                        [int(job_id)],
                    ).fetchone()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load job detail: {e}")

    (
        jid,
        job_number,
        title,
        reporting_year,
        reporting_period_start,
        reporting_period_end,
        is_benchmark,
        status,
        job_template_id,
        milestone_template_id,
        client_db_id,
        client_name,
        crm_name,
        start_date,
        due_date,
        legacy_job_no,
        job_type,
        job_type_id,
        original_portfolio,
    ) = row

    # Calculate traffic light status for each milestone
    def get_milestone_status(due_date, completed_at):
        """Calculate traffic light status: green, amber, red"""
        if completed_at:
            return "completed"
        if not due_date:
            return "green"
        
        from datetime import date, timedelta
        today = date.today()
        days_until_due = (due_date - today).days
        
        if days_until_due < -1:  # Overdue by more than 1 day
            return "red"
        elif days_until_due <= 7:  # Due within 7 days or 1 day overdue
            return "amber"
        else:
            return "green"
    
    milestone_data = {}
    if milestones:
        milestone_data = {
            "data_collection_due": str(milestones[0]) if milestones[0] else None,
            "data_collection_completed_at": str(milestones[3]) if milestones[3] else None,
            "data_collection_completed_by": milestones[4] if milestones[4] else None,
            "data_collection_status": get_milestone_status(milestones[0], milestones[3]),
            "first_draft_due": str(milestones[1]) if milestones[1] else None,
            "first_draft_completed_at": str(milestones[5]) if milestones[5] else None,
            "first_draft_completed_by": milestones[6] if milestones[6] else None,
            "first_draft_status": get_milestone_status(milestones[1], milestones[5]),
            "final_report_due": str(milestones[2]) if milestones[2] else None,
            "final_report_completed_at": str(milestones[7]) if milestones[7] else None,
            "final_report_completed_by": milestones[8] if milestones[8] else None,
            "final_report_status": get_milestone_status(milestones[2], milestones[7]),
        }

    return {
        "job_id": int(jid),
        "job_number": job_number,
        "title": title,
        "reporting_year": (int(reporting_year) if reporting_year is not None else None),
        "reporting_period_start": (str(reporting_period_start) if reporting_period_start else None),
        "reporting_period_end": (str(reporting_period_end) if reporting_period_end else None),
        "is_benchmark": bool(is_benchmark) if is_benchmark is not None else False,
        "status": status,
        "job_template_id": (int(job_template_id) if job_template_id is not None else None),
        "milestone_template_id": (int(milestone_template_id) if milestone_template_id is not None else None),
        "client_db_id": (int(client_db_id) if client_db_id is not None else None),
        "client_name": client_name,
        "crm_name": crm_name,
        "start_date": (str(start_date) if start_date else None),
        "due_date": (str(due_date) if due_date else None),
        "legacy_job_no": legacy_job_no,
        "job_type": job_type,
        "job_type_id": (int(job_type_id) if job_type_id is not None else None),
        "original_portfolio": str(original_portfolio or "NZI").strip() or "NZI",
        "estimated_hours": estimated_hours,
        **milestone_data,
    }


@app.patch("/jobs/{job_id}")
def update_job(
    request: Request,
    job_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update job fields including reporting period."""
    try:
        assert_permission(_user, "jobs.edit")
        assert_job_access(_user, int(job_id))
        with get_conn() as con:
            _ensure_job_original_portfolio_column(con)
            before = _job_audit_snapshot(con, int(job_id))
            # Check job exists
            exists = con.execute("SELECT 1 FROM jobs WHERE job_id = ?", [int(job_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Job not found")
            
            # Build update query dynamically based on provided fields
            updates = []
            params = []
            
            if "reporting_period_start" in body:
                updates.append("reporting_period_start = ?")
                params.append(body["reporting_period_start"])
            
            if "reporting_period_end" in body:
                updates.append("reporting_period_end = ?")
                params.append(body["reporting_period_end"])
            
            if "title" in body:
                updates.append("title = ?")
                params.append(body["title"])
            
            if "status" in body:
                updates.append("status = ?")
                params.append(body["status"])
            
            if "crm_name" in body:
                updates.append("crm_name = ?")
                params.append(body["crm_name"])
            
            if "start_date" in body:
                updates.append("start_date = ?")
                params.append(body["start_date"])
            
            if "due_date" in body:
                updates.append("due_date = ?")
                params.append(body["due_date"])
            
            if "legacy_job_no" in body:
                updates.append("legacy_job_no = ?")
                params.append(body["legacy_job_no"])

            if "original_portfolio" in body:
                original_portfolio = str(body.get("original_portfolio") or "NZI").strip() or "NZI"
                updates.append("original_portfolio = ?")
                params.append(original_portfolio)

            if "job_type" in body:
                job_type_name = str(body.get("job_type") or "").strip()
                if not job_type_name:
                    raise HTTPException(status_code=400, detail="job_type is required")
                job_type_row = con.execute(
                    "SELECT job_type_id, is_crp FROM job_types WHERE name = ? AND is_active = TRUE",
                    [job_type_name],
                ).fetchone()
                if not job_type_row:
                    raise HTTPException(status_code=400, detail=f"Job type '{job_type_name}' not found or inactive")
                updates.append("job_type_id = ?")
                params.append(int(job_type_row[0]))
                updates.append("job_type = ?")
                params.append(job_type_name)
                updates.append("is_crp = ?")
                params.append(bool(job_type_row[1]) if job_type_row[1] is not None else False)

            if "milestone_template_id" in body:
                updates.append("milestone_template_id = ?")
                params.append(body["milestone_template_id"])
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(int(job_id))
            query = f"UPDATE jobs SET {', '.join(updates)} WHERE job_id = ?"
            
            con.execute(query, params)
            after = _job_audit_snapshot(con, int(job_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="job",
                entity_id=int(job_id),
                client_id=int(after.get("client_db_id")) if after and after.get("client_db_id") is not None else None,
                job_id=int(job_id),
                before=before,
                after=after,
                metadata={"updated_fields": list(body.keys())},
            )
            
            # Auto-create/update milestones if anchor-driving fields changed:
            # - start_date
            # - reporting_period_start
            # - milestone template
            if ("start_date" in body) or ("reporting_period_start" in body) or ("milestone_template_id" in body):
                from datetime import datetime, timedelta

                def _to_date(value):
                    if value is None:
                        return None
                    if hasattr(value, "date"):
                        try:
                            return value.date()
                        except Exception:
                            pass
                    if hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
                        return value
                    try:
                        return datetime.strptime(str(value), "%Y-%m-%d").date()
                    except Exception:
                        return None

                # Get both start_date and reporting_period_start from body (if provided) or DB.
                if "start_date" in body:
                    start_date = _to_date(body.get("start_date"))
                else:
                    start_date = None

                if "reporting_period_start" in body:
                    reporting_period_start = _to_date(body.get("reporting_period_start"))
                else:
                    reporting_period_start = None

                if start_date is None or reporting_period_start is None:
                    job_data = con.execute(
                        "SELECT start_date, reporting_period_start FROM jobs WHERE job_id = ?",
                        [int(job_id)]
                    ).fetchone()
                    if job_data:
                        if start_date is None:
                            start_date = _to_date(job_data[0])
                        if reporting_period_start is None:
                            reporting_period_start = _to_date(job_data[1])

                # Anchor logic:
                # - Use Job Start Date by default
                # - If Reporting Period Start is later, use that instead
                # - If one is missing, use the available date
                anchor_date = None
                if start_date and reporting_period_start:
                    anchor_date = reporting_period_start if reporting_period_start > start_date else start_date
                else:
                    anchor_date = start_date or reporting_period_start

                if anchor_date is None:
                    return {"ok": True, "message": "Job updated successfully"}
                
                # Get the milestone template for this job (or use default)
                job_template = con.execute(
                    "SELECT milestone_template_id FROM jobs WHERE job_id = ?",
                    [int(job_id)]
                ).fetchone()
                
                template_id = job_template[0] if job_template and job_template[0] else None
                
                # If no template assigned, get the default template
                if not template_id:
                    default_template = con.execute(
                        "SELECT template_id FROM milestone_templates WHERE is_default = TRUE LIMIT 1"
                    ).fetchone()
                    template_id = default_template[0] if default_template else None
                
                if template_id:
                    # Get milestone items from template
                    milestone_items_df = con.execute(
                        """
                        SELECT milestone_name, days_offset, sort_order
                        FROM milestone_template_items
                        WHERE template_id = %s
                        ORDER BY sort_order
                        """,
                        [template_id]
                    ).df()
                    
                    if not milestone_items_df.empty:
                        # For backward compatibility, map to job_plan table
                        # Assuming first 3 items map to data_collection, first_draft, final_report
                        milestones = {}
                        for idx, row in enumerate(milestone_items_df.head(3).iterrows()):
                            item = row[1]  # row is (index, data)
                            milestone_date = anchor_date + timedelta(days=int(item['days_offset']))
                            if idx == 0:
                                milestones['data_collection_due'] = milestone_date
                            elif idx == 1:
                                milestones['first_draft_due'] = milestone_date
                            elif idx == 2:
                                milestones['final_report_due'] = milestone_date
                        
                        # Check if job_plan exists
                        plan_exists = con.execute(
                            "SELECT 1 FROM job_plan WHERE job_id = ?",
                            [int(job_id)]
                        ).fetchone()
                        
                        if plan_exists:
                            # Update only if override_dates is False
                            con.execute(
                                """
                                UPDATE job_plan
                                SET data_collection_due = %s,
                                    first_draft_due = %s,
                                    final_report_due = %s,
                                    updated_at = CURRENT_TIMESTAMP
                                WHERE job_id = %s AND (override_dates = FALSE OR override_dates IS NULL)
                                """,
                                [
                                    milestones.get('data_collection_due'),
                                    milestones.get('first_draft_due'),
                                    milestones.get('final_report_due'),
                                    int(job_id)
                                ]
                            )
                        else:
                            # Create new job_plan entry
                            con.execute(
                                """
                                INSERT INTO job_plan (job_id, data_collection_due, first_draft_due, final_report_due, override_dates, updated_at)
                                VALUES (%s, %s, %s, %s, FALSE, CURRENT_TIMESTAMP)
                                """,
                                [
                                    int(job_id),
                                    milestones.get('data_collection_due'),
                                    milestones.get('first_draft_due'),
                                    milestones.get('final_report_due')
                                ]
                            )
            
            return {"ok": True, "message": "Job updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


@app.post("/jobs/{job_id}/milestones/{milestone_type}/complete")
def complete_milestone(
    job_id: int,
    milestone_type: str,
    body: dict = Body(...),
    user: dict[str, str] = Depends(_current_user)
):
    """Mark a milestone as complete or incomplete"""
    try:
        # Validate milestone type
        valid_types = ["data_collection", "first_draft", "final_report"]
        if milestone_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"Invalid milestone type. Must be one of: {valid_types}")
        
        completed = body.get("completed", True)
        
        with get_conn() as con:
            # Check if job_plan exists
            plan_exists = con.execute(
                "SELECT 1 FROM job_plan WHERE job_id = %s",
                [int(job_id)]
            ).fetchone()
            
            if not plan_exists:
                raise HTTPException(status_code=404, detail="Job plan not found")
            
            # Update completion status
            if completed:
                # Mark as complete with timestamp and user
                from datetime import datetime
                query = f"""
                    UPDATE job_plan
                    SET {milestone_type}_completed_at = %s,
                        {milestone_type}_completed_by = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE job_id = %s
                """
                con.execute(query, [datetime.now(), user.get("email", "unknown"), int(job_id)])
            else:
                # Mark as incomplete (clear timestamp and user)
                query = f"""
                    UPDATE job_plan
                    SET {milestone_type}_completed_at = NULL,
                        {milestone_type}_completed_by = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE job_id = %s
                """
                con.execute(query, [int(job_id)])
            
            return {"ok": True, "message": f"Milestone {milestone_type} marked as {'complete' if completed else 'incomplete'}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update milestone: {e}")


@app.get("/job-templates")
def list_job_templates(_user: dict[str, str] = Depends(_current_user)):
    try:
        with get_conn() as con:
            df = (
                con.execute(
                    """
                    SELECT job_template_id, template_key, template_name,
                           template_type, file_path, excel_template_path, crp_template_path, is_active
                    FROM job_templates
                    ORDER BY template_type, template_key
                    """
                ).df()
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/job-templates failed: {e}")

    items: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        import numpy as np
        df = df.replace({np.nan: None})
        for _, row in df.iterrows():
            items.append(
                {
                    "job_template_id": int(row["job_template_id"]),
                    "template_key": row["template_key"],
                    "template_name": row["template_name"],
                    "template_type": row["template_type"] or "dataset",
                    "file_path": row["file_path"],
                    "excel_template_path": row["excel_template_path"],
                    "crp_template_path": row["crp_template_path"],
                    "is_active": bool(row["is_active"]),
                }
            )

    return {"items": items}


@app.get("/job-templates/{template_id}/download")
def download_job_template(template_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Download the template file for a job template."""
    from pathlib import Path

    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT
                    template_key,
                    template_name,
                    template_type,
                    file_path,
                    excel_template_path,
                    crp_template_path
                FROM job_templates
                WHERE job_template_id = %s
                """,
                [int(template_id)],
            ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Template not found")

        template_key = str(row[0] or f"template_{template_id}")
        template_name = str(row[1] or "").strip()
        template_type = str(row[2] or "").strip().lower()
        candidate_paths = [row[3], row[4], row[5], *[str(p) for p in _seeded_job_template_fallbacks(template_key, template_type)]]
        file_path = None
        for candidate in candidate_paths:
            file_path = _resolve_job_template_file_path(candidate)
            if file_path is not None:
                break
        if file_path is None:
            raise HTTPException(status_code=404, detail="Template file not found on disk")

        suffix = file_path.suffix
        if not suffix:
            suffix = ".xlsx" if template_type == "dataset" else ".docx"

        preferred_name = template_name or template_key
        safe_name = "".join(ch if ch.isalnum() or ch in ("-", "_", " ") else "_" for ch in preferred_name).strip()
        download_name = f"{safe_name or template_key}{suffix}"

        return FileResponse(
            path=str(file_path),
            filename=download_name,
            media_type="application/octet-stream",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Template download failed: {e}")


@app.post("/job-templates")
async def create_job_template(
    template_key: str = Form(...),
    template_name: str = Form(""),
    template_type: str = Form("dataset"),
    is_active: str = Form("true"),
    file: UploadFile = File(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Create a new job template with file upload."""
    import os
    from pathlib import Path
    
    try:
        if not template_key:
            raise HTTPException(status_code=400, detail="template_key is required")
        
        # Create templates directory if it doesn't exist
        templates_dir = Path("uploaded_templates")
        templates_dir.mkdir(exist_ok=True)
        
        # Generate unique filename
        file_ext = Path(file.filename or "template").suffix
        safe_key = template_key.replace(" ", "_").replace("/", "_")
        file_name = f"{safe_key}_{template_type}{file_ext}"
        file_path = templates_dir / file_name
        
        # Save uploaded file
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)
        
        with get_conn() as con:
            # Check if template_key already exists
            exists = con.execute(
                "SELECT 1 FROM job_templates WHERE template_key = %s",
                [template_key]
            ).fetchone()
            
            if exists:
                raise HTTPException(status_code=400, detail="Template key already exists")
            
            row = con.execute(
                """
                INSERT INTO job_templates 
                (template_key, template_name, template_type, file_path, is_active)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING job_template_id
                """,
                [
                    template_key,
                    template_name or None,
                    template_type,
                    str(file_path),
                    is_active.lower() == "true"
                ]
            ).fetchone()
            
            return {"ok": True, "job_template_id": int(row[0]), "file_path": str(file_path)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Create failed: {e}")


@app.patch("/job-templates/{template_id}")
async def update_job_template(
    template_id: int,
    template_key: str = Form(None),
    template_name: str = Form(None),
    template_type: str = Form(None),
    is_active: str = Form(None),
    file: UploadFile = File(None),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update a job template with optional file upload."""
    from pathlib import Path
    
    try:
        with get_conn() as con:
            # Check template exists
            template_row = con.execute(
                """
                SELECT
                    template_key,
                    template_type,
                    file_path,
                    excel_template_path,
                    crp_template_path
                FROM job_templates
                WHERE job_template_id = %s
                """,
                [int(template_id)]
            ).fetchone()
            
            if not template_row:
                raise HTTPException(status_code=404, detail="Template not found")

            current_template_key = str(template_row[0] or "").strip()
            current_template_type = str(template_row[1] or "").strip().lower()
            current_file_path = template_row[2]
            current_excel_path = template_row[3]
            current_crp_path = template_row[4]
            
            # Build update query
            updates = []
            params = []
            
            if template_key is not None:
                updates.append("template_key = %s")
                params.append(template_key)
            
            if template_name is not None:
                updates.append("template_name = %s")
                params.append(template_name or None)
            
            if template_type is not None:
                updates.append("template_type = %s")
                params.append(template_type)
            
            if is_active is not None:
                updates.append("is_active = %s")
                params.append(is_active.lower() == "true")
            
            # Handle file upload if provided
            if file and file.filename:
                templates_dir = Path("uploaded_templates")
                templates_dir.mkdir(exist_ok=True)
                
                file_ext = Path(file.filename).suffix
                safe_key = (template_key or f"template_{template_id}").replace(" ", "_").replace("/", "_")
                file_name = f"{safe_key}_{template_type or 'dataset'}{file_ext}"
                file_path = templates_dir / file_name
                
                contents = await file.read()
                with open(file_path, "wb") as f:
                    f.write(contents)
                
                updates.append("file_path = %s")
                params.append(str(file_path))
            else:
                current_file_resolved = _resolve_job_template_file_path(current_file_path)
                current_resolved_path = current_file_resolved
                if current_resolved_path is None:
                    fallback_candidates = [
                        current_excel_path,
                        current_crp_path,
                        *[str(p) for p in _seeded_job_template_fallbacks(current_template_key or template_key, current_template_type or template_type)],
                    ]
                    for candidate in fallback_candidates:
                        current_resolved_path = _resolve_job_template_file_path(candidate)
                        if current_resolved_path is not None:
                            break
                if current_resolved_path is not None and current_file_resolved is None:
                    # Backfill a working file reference so Edit and Download resolve the same workbook.
                    updates.append("file_path = %s")
                    params.append(str(current_resolved_path))
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(int(template_id))
            query = f"UPDATE job_templates SET {', '.join(updates)} WHERE job_template_id = %s"
            
            con.execute(query, params)
            
            return {"ok": True, "message": "Template updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


@app.patch("/job-templates/{template_id}/archive")
def archive_job_template(
    template_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Archive or unarchive a job template."""
    try:
        with get_conn() as con:
            # Check template exists
            exists = con.execute(
                "SELECT 1 FROM job_templates WHERE job_template_id = %s",
                [int(template_id)]
            ).fetchone()
            
            if not exists:
                raise HTTPException(status_code=404, detail="Template not found")
            
            archived = body.get("archived", True)
            user_name = _user.get("name", "system")
            
            if archived:
                con.execute(
                    """
                    UPDATE job_templates 
                    SET archived = %s, archived_at = NOW(), archived_by = %s
                    WHERE job_template_id = %s
                    """,
                    [True, user_name, int(template_id)]
                )
            else:
                con.execute(
                    """
                    UPDATE job_templates 
                    SET archived = %s, archived_at = NULL, archived_by = NULL
                    WHERE job_template_id = %s
                    """,
                    [False, int(template_id)]
                )
            
            return {"ok": True, "message": "Template archived successfully" if archived else "Template restored successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Archive failed: {e}")


@app.put("/jobs/{job_id}/job-template")
def update_job_template(
    request: Request,
    job_id: int,
    payload: dict[str, object] = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    raw_id = payload.get("job_template_id")
    if raw_id is None:
        raise HTTPException(status_code=400, detail="job_template_id is required")
    try:
        jt_id = int(raw_id)
    except Exception:
        raise HTTPException(status_code=400, detail="job_template_id must be an integer")

    try:
        with get_conn() as con:
            before = _job_template_assignment_audit_snapshot(con, int(job_id))
            exists_job = con.execute("SELECT 1 FROM jobs WHERE job_id=?", [int(job_id)]).fetchone()
            if not exists_job:
                raise HTTPException(status_code=404, detail="Job not found")

            tpl = con.execute(
                "SELECT job_template_id, template_name, template_key FROM job_templates WHERE job_template_id=? AND is_active=TRUE",
                [int(jt_id)],
            ).fetchone()
            if not tpl:
                raise HTTPException(status_code=400, detail="Invalid job_template_id")

            con.execute(
                "UPDATE jobs SET job_template_id=? WHERE job_id=?",
                [int(jt_id), int(job_id)],
            )
            after = _job_template_assignment_audit_snapshot(con, int(job_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="job_template_assignment",
                entity_id=int(job_id),
                job_id=int(job_id),
                before=before,
                after=after,
                metadata={
                    "job_template_id": int(jt_id),
                    "template_name": str(tpl[1]) if tpl[1] is not None else None,
                    "template_key": str(tpl[2]) if tpl[2] is not None else None,
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update job template: {e}")

    return {"ok": True, "job_id": int(job_id), "job_template_id": int(jt_id)}


@app.get("/jobs/{job_id}/sites")
def job_sites(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    with get_conn() as con:
        row = con.execute(
            "SELECT client_db_id FROM jobs WHERE job_id=?",
            [int(job_id)],
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    client_db_id = int(row[0])
    df = _list_sites(client_db_id)

    sites: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        for _, r in df.iterrows():
            sites.append(
                {
                    "site_id": int(r.get("site_id")) if r.get("site_id") is not None else None,
                    "site_name": r.get("site_name"),
                    "location": r.get("location"),
                    "is_registered_office": bool(r.get("is_registered_office")) if r.get("is_registered_office") is not None else False,
                }
            )

    return {"job_id": int(job_id), "client_db_id": client_db_id, "sites": sites}


@app.get("/datasets")
def list_datasets(_user: dict[str, str] = Depends(_current_user)):
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT dataset_id, name, source, analysis_type, country, region,
                       currency, year, version, archived, archived_at, archived_by
                FROM datasets
                ORDER BY dataset_id DESC
                """
            ).df()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/datasets failed: {e}")

    items: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        for _, r in df.iterrows():
            items.append(
                {
                    "dataset_id": int(r.get("dataset_id")),
                    "name": r.get("name"),
                    "source": r.get("source"),
                    "analysis_type": r.get("analysis_type"),
                    "country": r.get("country"),
                    "region": r.get("region"),
                    "currency": r.get("currency"),
                    "year": (int(r.get("year")) if r.get("year") is not None else None),
                    "version": r.get("version"),
                    "archived": bool(r.get("archived")) if r.get("archived") is not None else False,
                    "archived_at": r.get("archived_at"),
                    "archived_by": r.get("archived_by"),
                }
            )

    return {"items": items}


@app.get("/jobs/{job_id}/scope-config")
def get_job_scope_config(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    try:
        _ensure_job_additional_datasets_table()
        with get_conn() as con:
            exists_job = con.execute("SELECT 1 FROM jobs WHERE job_id=?", [int(job_id)]).fetchone()
            if not exists_job:
                raise HTTPException(status_code=404, detail="Job not found")

            df = con.execute(
                """
                SELECT scope, include_scope, dataset_id, factor_method
                FROM job_scope_config
                WHERE job_id=?
                ORDER BY scope
                """,
                [int(job_id)],
            ).df()

            add_df = con.execute(
                """
                SELECT dataset_id
                FROM job_additional_datasets
                WHERE job_id=?
                ORDER BY dataset_id
                """,
                [int(job_id)],
            ).df()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load scope config: {e}")

    allowed_scopes = ["Scope 1", "Scope 2", "Scope 3"]
    legacy_by_scope: dict[str, dict[str, object]] = {
        scope: {
            "scope": scope,
            "include_scope": True,
            "dataset_id": None,
            "factor_method": None,
        }
        for scope in allowed_scopes
    }

    if df is not None and (not df.empty):
        for _, r in df.iterrows():
            scope = str(r.get("scope") or "").strip()
            if scope not in legacy_by_scope:
                continue
            dsid_raw = r.get("dataset_id")
            dsid = (
                int(dsid_raw)
                if dsid_raw is not None and str(dsid_raw) != "nan"
                else None
            )
            legacy_by_scope[scope] = {
                "scope": scope,
                "include_scope": bool(r.get("include_scope")) if r.get("include_scope") is not None else True,
                "dataset_id": dsid,
                "factor_method": r.get("factor_method"),
            }

    effective_ds_map, auto_resolution, auto_warnings = _resolve_scope_dataset_map(int(job_id))

    items: list[dict[str, object]] = []
    legacy_items: list[dict[str, object]] = []
    for scope in allowed_scopes:
        legacy_item = dict(legacy_by_scope.get(scope) or {})
        legacy_items.append(legacy_item)

        effective_item = dict(legacy_item)
        if scope in effective_ds_map:
            effective_item["dataset_id"] = int(effective_ds_map[scope])
        items.append(effective_item)

    auto_payload = None
    if auto_resolution:
        auto_payload = {
            "country": auto_resolution.get("country"),
            "reporting_period_start": auto_resolution.get("reporting_period_start"),
            "reporting_period_end": auto_resolution.get("reporting_period_end"),
            "uses_legacy_fallback": bool(auto_resolution.get("uses_legacy_fallback")),
            "scope_summaries": auto_resolution.get("scope_summaries") or [],
            "datasets_for_report": auto_resolution.get("datasets_for_report") or [],
            "unresolved_scopes": auto_resolution.get("unresolved_scopes") or [],
        }

    additional_dataset_ids: list[int] = []
    if add_df is not None and (not add_df.empty):
        for _, row in add_df.iterrows():
            raw = row.get("dataset_id")
            if raw is None or str(raw) == "nan":
                continue
            try:
                additional_dataset_ids.append(int(raw))
            except Exception:
                continue

    return {
        "job_id": int(job_id),
        "mode": "automatic" if auto_resolution else "legacy",
        "items": items,
        "legacy_items": legacy_items,
        "additional_dataset_ids": additional_dataset_ids,
        "warnings": auto_warnings,
        "auto_resolution": auto_payload,
    }


@app.put("/jobs/{job_id}/scope-config")
def update_job_scope_config(
    request: Request,
    job_id: int,
    payload: dict[str, object] = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise HTTPException(status_code=400, detail="items must be a list")
    raw_additional = payload.get("additional_dataset_ids")
    if raw_additional is None:
        raw_additional = []
    if not isinstance(raw_additional, list):
        raise HTTPException(status_code=400, detail="additional_dataset_ids must be a list")

    allowed_scopes = {"Scope 1", "Scope 2", "Scope 3"}
    updates: list[tuple[str, int | None, bool | None, str | None]] = []
    for it in raw_items:
        if not isinstance(it, dict):
            continue
        scope = str(it.get("scope") or "").strip()
        if scope not in allowed_scopes:
            continue

        ds_raw = it.get("dataset_id")
        dsid: int | None
        if ds_raw is None or str(ds_raw).strip() == "" or str(ds_raw).strip().lower() in ("none", "null"):
            dsid = None
        else:
            try:
                dsid = int(ds_raw)
            except Exception:
                raise HTTPException(status_code=400, detail=f"Invalid dataset_id for {scope}")

        inc_raw = it.get("include_scope")
        include_scope: bool | None
        if inc_raw is None:
            include_scope = None
        else:
            include_scope = bool(inc_raw)

        fm_raw = it.get("factor_method")
        factor_method: str | None = str(fm_raw).strip() if fm_raw is not None and str(fm_raw).strip() else None
        updates.append((scope, dsid, include_scope, factor_method))

    if not updates:
        raise HTTPException(status_code=400, detail="No valid scope config items")

    additional_dataset_ids: list[int] = []
    for raw in raw_additional:
        if raw is None or str(raw).strip() in ("", "none", "null"):
            continue
        try:
            additional_dataset_ids.append(int(raw))
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid additional dataset_id: {raw}")
    additional_dataset_ids = sorted(set(additional_dataset_ids))

    try:
        _ensure_job_additional_datasets_table()
        with get_conn() as con:
            before = _job_scope_config_audit_snapshot(con, int(job_id))
            exists_job = con.execute("SELECT 1 FROM jobs WHERE job_id=?", [int(job_id)]).fetchone()
            if not exists_job:
                raise HTTPException(status_code=404, detail="Job not found")

            # Ensure rows exist
            for scope in allowed_scopes:
                con.execute(
                    """
                    INSERT INTO job_scope_config (job_id, scope, include_scope, dataset_id, factor_method)
                    VALUES (?, ?, TRUE, NULL, NULL)
                    ON CONFLICT (job_id, scope) DO NOTHING
                    """,
                    [int(job_id), scope],
                )

            for scope, dsid, include_scope, factor_method in updates:
                if include_scope is None and factor_method is None:
                    con.execute(
                        "UPDATE job_scope_config SET dataset_id=? WHERE job_id=? AND scope=?",
                        [dsid, int(job_id), scope],
                    )
                else:
                    con.execute(
                        """
                        UPDATE job_scope_config
                        SET dataset_id=?,
                            include_scope=COALESCE(?, include_scope),
                            factor_method=COALESCE(?, factor_method)
                        WHERE job_id=? AND scope=?
                        """,
                        [dsid, include_scope, factor_method, int(job_id), scope],
                    )

            con.execute("DELETE FROM job_additional_datasets WHERE job_id=?", [int(job_id)])
            for dsid in additional_dataset_ids:
                con.execute(
                    """
                    INSERT INTO job_additional_datasets (job_id, dataset_id)
                    VALUES (?, ?)
                    ON CONFLICT (job_id, dataset_id) DO NOTHING
                    """,
                    [int(job_id), int(dsid)],
                )
            after = _job_scope_config_audit_snapshot(con, int(job_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="job_scope_config",
                entity_id=int(job_id),
                job_id=int(job_id),
                before=before,
                after=after,
                metadata={
                    "updated_scopes": sorted([scope for scope, _, _, _ in updates]),
                    "additional_dataset_ids": additional_dataset_ids,
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update scope config: {e}")

    return {"ok": True, "job_id": int(job_id)}


@app.post("/jobs/{job_id}/excel-import-preflight")
def job_excel_import_preflight(
    job_id: int,
    payload: dict[str, object] = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    """
    Returns rows that would overwrite an existing scope row that already has
    a non-zero qty. The frontend uses this to warn the user before importing.
    """
    site_id_raw = payload.get("site_id")
    rows_ready = payload.get("rows_ready")
    if site_id_raw is None or not isinstance(rows_ready, list):
        raise HTTPException(status_code=400, detail="site_id and rows_ready are required")
    try:
        site_id = int(site_id_raw)
    except Exception:
        raise HTTPException(status_code=400, detail="site_id must be an integer")

    conflicts = []
    try:
        with get_conn() as con:
            for r in rows_ready:
                if not isinstance(r, dict):
                    continue
                scope = str(r.get("scope") or "").strip()
                original_id = str(r.get("original_id") or "").strip()
                if not scope or not original_id:
                    continue
                existing = con.execute(
                    """
                    SELECT row_id, qty, report_label
                    FROM job_scope_rows
                    WHERE job_id=%s AND site_id=%s AND scope=%s AND original_id=%s
                      AND COALESCE(enabled, TRUE) = TRUE
                    LIMIT 1
                    """,
                    [int(job_id), site_id, scope, original_id],
                ).fetchone()
                if existing and existing[1] is not None and float(existing[1]) != 0:
                    conflicts.append({
                        "scope": scope,
                        "original_id": original_id,
                        "report_label": r.get("report_label") or (str(existing[2]) if existing[2] else original_id),
                        "existing_qty": float(existing[1]),
                        "upload_qty": float(r["qty"]) if r.get("qty") is not None else None,
                    })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preflight check failed: {e}")

    return {"conflicts": conflicts}


@app.post("/jobs/{job_id}/excel-import")
def job_excel_import(
    job_id: int,
    payload: dict[str, object] = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    site_id_raw = payload.get("site_id")
    rows_ready = payload.get("rows_ready")

    if site_id_raw is None:
        raise HTTPException(status_code=400, detail="site_id is required")
    try:
        site_id = int(site_id_raw)
    except Exception:
        raise HTTPException(status_code=400, detail="site_id must be an integer")

    if not isinstance(rows_ready, list):
        raise HTTPException(status_code=400, detail="rows_ready must be a list")
    if not rows_ready:
        raise HTTPException(status_code=400, detail="rows_ready is empty")

    inserted = 0
    updated = 0
    month_fields = [f"month_{idx}" for idx in range(1, 13)]
    month_placeholders = ", ".join(["?"] * len(month_fields))

    try:
        with get_conn() as con:
            job_row = con.execute("SELECT client_db_id FROM jobs WHERE job_id=?", [int(job_id)]).fetchone()
            if not job_row:
                raise HTTPException(status_code=404, detail="Job not found")
            client_db_id = int(job_row[0])

            site_ok = con.execute(
                "SELECT 1 FROM client_sites WHERE site_id=? AND client_db_id=?",
                [int(site_id), int(client_db_id)],
            ).fetchone()
            if not site_ok:
                raise HTTPException(status_code=400, detail="site_id does not belong to this job's client")

            for r in rows_ready:
                if not isinstance(r, dict):
                    continue

                scope = str(r.get("scope") or "").strip()
                original_id = str(r.get("original_id") or "").strip()
                if not scope or not original_id:
                    continue

                dataset_id = r.get("dataset_id")
                factor_db_id = r.get("db_id")
                if dataset_id is None or factor_db_id is None:
                    continue

                qty = r.get("qty")
                uom = r.get("uom")
                factor = r.get("factor")
                ghg_unit = r.get("ghg_unit")
                calc_tco2e = r.get("calc_tco2e")
                notes = r.get("notes")
                data_source = r.get("data_source")
                data_confidence = r.get("data_confidence")
                apply_pct = r.get("apply_pct")
                report_label = r.get("report_label")

                level_1 = r.get("level_1")
                level_2 = r.get("level_2")
                level_3 = r.get("level_3")
                level_4 = r.get("level_4")
                column_text = r.get("column_text")
                month_values = [r.get(field) for field in month_fields]

                exists = con.execute(
                    """
                    SELECT row_id
                    FROM job_scope_rows
                    WHERE job_id=? AND site_id=? AND scope=? AND original_id=?
                    LIMIT 1
                    """,
                    [int(job_id), int(site_id), str(scope), str(original_id)],
                ).fetchone()

                if exists:
                    con.execute(
                        """
                        UPDATE job_scope_rows
                        SET enabled=TRUE,
                            dataset_id=?,
                            factor_db_id=?,
                            qty=?,
                            uom=?,
                            factor=?,
                            ghg_unit=?,
                            calc_tco2e=?,
                            apply_pct=?,
                            data_source=?,
                            data_confidence=?,
                            notes=?,
                            month_1=?,
                            month_2=?,
                            month_3=?,
                            month_4=?,
                            month_5=?,
                            month_6=?,
                            month_7=?,
                            month_8=?,
                            month_9=?,
                            month_10=?,
                            month_11=?,
                            month_12=?,
                            level_1=?,
                            level_2=?,
                            level_3=?,
                            level_4=?,
                            report_label=?,
                            column_text=?,
                            updated_at=NOW()
                        WHERE row_id=?
                        """,
                        [
                            int(dataset_id),
                            int(factor_db_id),
                            float(qty) if qty is not None else None,
                            (str(uom).strip() if uom is not None else None),
                            float(factor) if factor is not None else None,
                            (str(ghg_unit).strip() if ghg_unit is not None else None),
                            float(calc_tco2e) if calc_tco2e is not None else None,
                            float(apply_pct) if apply_pct is not None else None,
                            (str(data_source).strip() if data_source is not None else None),
                            (str(data_confidence).strip() if data_confidence is not None else None),
                            (str(notes).strip() if notes is not None else None),
                            float(month_values[0]) if month_values[0] is not None else None,
                            float(month_values[1]) if month_values[1] is not None else None,
                            float(month_values[2]) if month_values[2] is not None else None,
                            float(month_values[3]) if month_values[3] is not None else None,
                            float(month_values[4]) if month_values[4] is not None else None,
                            float(month_values[5]) if month_values[5] is not None else None,
                            float(month_values[6]) if month_values[6] is not None else None,
                            float(month_values[7]) if month_values[7] is not None else None,
                            float(month_values[8]) if month_values[8] is not None else None,
                            float(month_values[9]) if month_values[9] is not None else None,
                            float(month_values[10]) if month_values[10] is not None else None,
                            float(month_values[11]) if month_values[11] is not None else None,
                            (str(level_1).strip() if level_1 is not None else None),
                            (str(level_2).strip() if level_2 is not None else None),
                            (str(level_3).strip() if level_3 is not None else None),
                            (str(level_4).strip() if level_4 is not None else None),
                            (str(report_label).strip() if report_label is not None else None),
                            (str(column_text).strip() if column_text is not None else None),
                            int(exists[0]),
                        ],
                    )
                    updated += 1
                else:
                    con.execute(
                        """
                        INSERT INTO job_scope_rows
                          (job_id, site_id, scope, category, dataset_id, factor_db_id, original_id,
                           level_1, level_2, level_3, level_4, column_text,
                           report_label, notes, enabled,
                           qty, uom, factor, ghg_unit, apply_pct, data_source, data_confidence,
                           month_1, month_2, month_3, month_4, month_5, month_6,
                           month_7, month_8, month_9, month_10, month_11, month_12,
                           calc_tco2e, override_tco2e, override_reason,
                           created_at, updated_at)
                        VALUES
                          (?, ?, ?, ?, ?, ?, ?,
                           ?, ?, ?, ?, ?,
                           ?, ?, TRUE,
                           ?, ?, ?, ?, ?, ?, ?,
                           {month_placeholders},
                           ?, NULL, NULL,
                           NOW(), NOW())
                        """,
                        [
                            int(job_id),
                            int(site_id),
                            str(scope),
                            (str(level_2).strip() if level_2 is not None else None),  # category = level_2
                            int(dataset_id),
                            int(factor_db_id),
                            str(original_id),
                            (str(level_1).strip() if level_1 is not None else None),
                            (str(level_2).strip() if level_2 is not None else None),
                            (str(level_3).strip() if level_3 is not None else None),
                            (str(level_4).strip() if level_4 is not None else None),
                            (str(column_text).strip() if column_text is not None else None),
                            (str(report_label).strip() if report_label is not None else None),
                            (str(notes).strip() if notes is not None else None),
                            float(qty) if qty is not None else None,
                            (str(uom).strip() if uom is not None else None),
                            float(factor) if factor is not None else None,
                            (str(ghg_unit).strip() if ghg_unit is not None else None),
                            float(apply_pct) if apply_pct is not None else None,
                            (str(data_source).strip() if data_source is not None else None),
                            (str(data_confidence).strip() if data_confidence is not None else None),
                            float(month_values[0]) if month_values[0] is not None else None,
                            float(month_values[1]) if month_values[1] is not None else None,
                            float(month_values[2]) if month_values[2] is not None else None,
                            float(month_values[3]) if month_values[3] is not None else None,
                            float(month_values[4]) if month_values[4] is not None else None,
                            float(month_values[5]) if month_values[5] is not None else None,
                            float(month_values[6]) if month_values[6] is not None else None,
                            float(month_values[7]) if month_values[7] is not None else None,
                            float(month_values[8]) if month_values[8] is not None else None,
                            float(month_values[9]) if month_values[9] is not None else None,
                            float(month_values[10]) if month_values[10] is not None else None,
                            float(month_values[11]) if month_values[11] is not None else None,
                            float(calc_tco2e) if calc_tco2e is not None else None,
                        ],
                    )
                    inserted += 1
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import rows: {e}")

    return {"ok": True, "job_id": int(job_id), "site_id": int(site_id), "inserted": int(inserted), "updated": int(updated)}


@app.get("/jobs/{job_id}/excel-template")
def job_excel_template(
    job_id: int,
    site: str = Query(..., min_length=1),
    include_prev_year: bool = Query(True),
    template_format: str = Query("single", regex="^(single|multi)$"),
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        # Get job/client metadata for filename convention.
        with get_conn() as con:
            job_row = con.execute(
                """
                SELECT j.job_number, j.reporting_year, j.reporting_period_start, j.reporting_period_end, c.client_name
                FROM jobs j
                LEFT JOIN clients c ON c.db_id = j.client_db_id
                WHERE j.job_id = ?
                """,
                [job_id],
            ).fetchone()
        job_number = str(job_row[0] or f"Job-{job_id}") if job_row else f"Job-{job_id}"
        reporting_year = job_row[1] if job_row and len(job_row) > 1 else ""
        reporting_period_start = job_row[2] if job_row and len(job_row) > 2 else None
        reporting_period_end = job_row[3] if job_row and len(job_row) > 3 else None
        client_name = str(job_row[4] or "Client") if job_row and len(job_row) > 4 else "Client"

        def _fmt_period_part(val):
            if not val:
                return ""
            if hasattr(val, "strftime"):
                return val.strftime("%d-%b-%Y")
            txt = str(val).strip()
            try:
                return datetime.fromisoformat(txt[:10]).strftime("%d-%b-%Y")
            except Exception:
                return txt

        def _safe_name_part(value: str) -> str:
            s = str(value or "").strip()
            s = re.sub(r'[<>:"/\\|?*]+', "", s)
            s = re.sub(r"\s+", "-", s)
            return s.strip("-") or "Unknown"

        period_part = f"{_fmt_period_part(reporting_period_start)}-to-{_fmt_period_part(reporting_period_end)}"
        if period_part == "-to-":
            period_part = str(reporting_year or datetime.now().year)

        paths = _job_template_paths(int(job_id))
        reference_template_path = paths.get("excel_template_path")

        if template_format == "single":
            from services.generate_single_sheet_template import generate_single_sheet_template

            print(f"DEBUG: job_number={job_number}, client_name={client_name}, site={site}, reporting_year={reporting_year}")

            data, filename = generate_single_sheet_template(
                job_id=int(job_id),
                client_name=client_name,
                site_name=site,
                job_number=job_number,
                reporting_year=str(reporting_year) if reporting_year else "",
                report_from="",
                report_to="",
                include_custom_factors=True,
                include_prev_year=bool(include_prev_year),
                reference_template_path=str(reference_template_path) if reference_template_path else None,
            )
            
            print(f"DEBUG: Generated filename={filename}")
        else:
            # Legacy multi-sheet template
            os.environ["NZI_EXCEL_TEMPLATE_PATH"] = str(paths.get("excel_template_path") or "")
            data, filename = build_excel_template_bytes(
                job_id=int(job_id),
                selected_site=str(site),
                include_prev_year=bool(include_prev_year),
            )
        filename = "_".join(
            [
                _safe_name_part(job_number),
                _safe_name_part(client_name),
                _safe_name_part(str(site)),
                _safe_name_part(period_part),
                "data_upload",
            ]
        ) + ".xlsx"
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build template: {e}")

    # Simple Content-Disposition header with quoted filename
    safe_filename = filename.replace('"', '\\"')
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_filename}"'
    }
    print(f"DEBUG: Content-Disposition header: {headers['Content-Disposition']}")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@app.post("/jobs/{job_id}/excel-upload")
async def job_excel_upload(
    job_id: int,
    file: UploadFile = File(...),
    _user: dict[str, str] = Depends(_current_user),
):
    from api.parse_single_sheet_upload import is_single_sheet_format, parse_single_sheet_upload
    
    paths = _job_template_paths(int(job_id))
    filename = (file.filename or "").strip()
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    errors: list[str] = []
    warnings: list[str] = []
    details: dict[str, object] = {
        "filename": filename,
        "size_bytes": int(len(raw)),
        "job_id": int(job_id),
        "job_excel_template_path": paths.get("excel_template_path"),
    }

    try:
        wb = load_workbook(io.BytesIO(raw), data_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid xlsx file: {e}")

    details["sheets"] = list(wb.sheetnames)

    # Year-mismatch check: compare filename year against job's reporting period.
    # The standard template filename contains the period dates, e.g.:
    #   J000002_ClientName_SiteName_2021-01-01-to-2021-12-31_data_upload.xlsx
    # Extract the end-year from the filename and compare to the job.
    try:
        import re as _re
        with get_conn() as _con:
            _job_period = _con.execute(
                "SELECT reporting_period_start, reporting_period_end, reporting_year FROM jobs WHERE job_id=%s",
                [int(job_id)],
            ).fetchone()
        if _job_period:
            _job_end = _job_period[1]
            _job_year = int(_job_period[2]) if _job_period[2] else (int(str(_job_end)[:4]) if _job_end else None)
            # Look for a 4-digit year in the filename (prefer the end-date year if two found)
            _years_in_name = [int(y) for y in _re.findall(r'\b(20\d{2})\b', filename)]
            if _years_in_name and _job_year:
                # Use the last year found (likely the period end year in the filename)
                _file_year = _years_in_name[-1]
                if _file_year != _job_year:
                    errors.append(
                        f"Year mismatch: this file appears to be for {_file_year} "
                        f"but the job covers {_job_year}. "
                        f"Please upload the correct file for the {_job_year} reporting period."
                    )
    except Exception:
        pass  # Don't block upload if year check itself fails

    ds_map, auto_resolution, auto_ds_warnings = _resolve_scope_dataset_map(int(job_id))
    warnings.extend(auto_ds_warnings)
    details["datasets_by_scope"] = ds_map
    details["dataset_resolution_mode"] = "automatic" if auto_resolution else "legacy"
    if auto_resolution:
        details["dataset_resolution"] = {
            "country": auto_resolution.get("country"),
            "reporting_period_start": auto_resolution.get("reporting_period_start"),
            "reporting_period_end": auto_resolution.get("reporting_period_end"),
            "uses_legacy_fallback": bool(auto_resolution.get("uses_legacy_fallback")),
            "scope_summaries": auto_resolution.get("scope_summaries") or [],
            "datasets_for_report": auto_resolution.get("datasets_for_report") or [],
        }
    
    # Detect format and route to appropriate parser
    if is_single_sheet_format(wb):
        details["template_format"] = "single-sheet"
        
        # Parse single-sheet format
        rows_ready, parse_errors, parse_warnings, parse_details = parse_single_sheet_upload(
            raw, int(job_id), ds_map
        )
        
        errors.extend(parse_errors)
        warnings.extend(parse_warnings)
        details.update(parse_details)
        
        details["rows_ready_count"] = len(rows_ready)
        
        if rows_ready:
            details["rows_ready"] = rows_ready[:10]  # Preview first 10
        
        return {
            "ok": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "details": details,
            "rows_ready": rows_ready if len(errors) == 0 else []
        }
    
    # Otherwise, use legacy multi-sheet parser
    details["template_format"] = "multi-sheet"

    def _norm_scope(sheet_name: str) -> str | None:
        s = (sheet_name or "").strip().lower()
        if "scope 1" in s:
            return "Scope 1"
        if "scope 2" in s:
            return "Scope 2"
        if "scope 3" in s:
            return "Scope 3"
        return None

    scopes_present: set[str] = set()
    for name in wb.sheetnames:
        sn = _norm_scope(name)
        if sn:
            scopes_present.add(sn)

    for s in ["Scope 1", "Scope 2", "Scope 3"]:
        if s not in scopes_present:
            errors.append(f"Missing required scope sheets for: {s}")

    # Basic marker validation against any scope sheet
    for sheet_name in wb.sheetnames:
        scope_name = _norm_scope(sheet_name)
        if scope_name is None:
            continue
        ws = wb[sheet_name]
        a1 = (ws["A1"].value or "")
        a2 = (ws["A2"].value or "")
        if "Site Name" not in str(a1):
            warnings.append(f"{sheet_name}: A1 is not 'Site Name:' marker")
        if "Data Files" not in str(a2):
            warnings.append(f"{sheet_name}: A2 is not 'Data Files:' marker")

    # Optional: core sheet if present
    if "Core Data" not in wb.sheetnames:
        warnings.append("Core Data sheet not found (template may be older)")

    def _find_table_header_row(ws):
        for r in range(1, 60):
            values = [ws.cell(row=r, column=c).value for c in range(1, 80)]
            norm = [str(x).strip().lower() if x is not None else "" for x in values]
            if "id" in norm and "qty" in norm:
                idx = {}
                for name in ("id", "qty", "apply"):
                    if name in norm:
                        idx[name] = norm.index(name) + 1
                return r, idx
        return None, None

    def _to_tco2e(qty: float, factor: float, ghg_unit: str | None) -> float:
        ghg = (str(ghg_unit or "kgCO2e").replace(" ", "").lower())
        emissions = float(qty) * float(factor)
        if ghg.startswith("kg"):
            return emissions / 1000.0
        return emissions

    def _factor_lookup_by_original_ids(dataset_id: int, scope_name: str, original_ids: list[str]) -> pd.DataFrame:
        original_ids = [str(x).strip() for x in (original_ids or []) if x is not None and str(x).strip()]
        if not original_ids:
            return pd.DataFrame()

        with get_conn() as con:
            if db_backend() == "postgres":
                sql = """
                    SELECT db_id, original_id, level_1, level_2, level_3, level_4,
                           column_text, uom, ghg_unit, factor
                    FROM factor_lookup
                    WHERE dataset_id=%s AND scope=%s AND original_id = ANY(%s)
                """
                return con.execute(sql, [int(dataset_id), str(scope_name), original_ids]).df()

            ph = ",".join(["?"] * len(original_ids))
            sql = f"""
                SELECT db_id, original_id, level_1, level_2, level_3, level_4,
                       column_text, uom, ghg_unit, factor
                FROM factor_lookup
                WHERE dataset_id=? AND scope=? AND original_id IN ({ph})
            """
            return con.execute(sql, [int(dataset_id), str(scope_name)] + original_ids).df()

    parsed_rows: list[dict[str, object]] = []
    for ws in wb.worksheets:
        scope_name = _norm_scope(ws.title)
        if scope_name is None:
            continue

        header_row, idx = _find_table_header_row(ws)
        if header_row is None or idx is None:
            continue

        id_col = idx.get("id")
        qty_col = idx.get("qty")
        apply_col = idx.get("apply")
        if not id_col or not qty_col:
            continue

        for r in range(header_row + 1, ws.max_row + 1):
            oid = ws.cell(row=r, column=id_col).value
            if oid is None or str(oid).strip() == "":
                continue

            qv = ws.cell(row=r, column=qty_col).value
            av = ws.cell(row=r, column=apply_col).value if apply_col else None

            if apply_col and av is not None:
                try:
                    if float(av) != 1.0:
                        continue
                except Exception:
                    if str(av).strip() not in ("1", "true", "True", "YES", "Yes"):
                        continue

            try:
                qty_val = float(qv) if qv is not None and str(qv).strip() != "" else None
            except Exception:
                qty_val = None

            if qty_val is None:
                continue

            parsed_rows.append({"scope": scope_name, "original_id": str(oid).strip(), "qty": qty_val})

    details["parsed_row_count"] = int(len(parsed_rows))
    if not parsed_rows:
        errors.append("No rows found to import. Ensure you have filled 'Qty' and set 'Apply' to 1 where applicable.")

    rows_ready: list[dict[str, object]] = []
    missing_ids: dict[str, list[str]] = {}

    for scope_name in ["Scope 1", "Scope 2", "Scope 3"]:
        scope_rows = [r for r in parsed_rows if r.get("scope") == scope_name]
        if not scope_rows:
            continue

        dsid = ds_map.get(scope_name)
        if dsid is None:
            errors.append(f"{scope_name}: no dataset selected in Job Folder -> Data Collection.")
            continue

        ids = [str(r.get("original_id") or "").strip() for r in scope_rows]
        fdf = _factor_lookup_by_original_ids(int(dsid), scope_name, ids)
        if fdf is None or fdf.empty:
            errors.append(f"{scope_name}: none of the uploaded IDs matched factor_lookup for dataset {int(dsid)}.")
            continue

        factor_by_id: dict[str, dict[str, object]] = {}
        for _, fr in fdf.iterrows():
            oid = str(fr.get("original_id") or "").strip()
            if not oid:
                continue
            factor_by_id[oid] = {
                "db_id": int(fr.get("db_id")) if fr.get("db_id") is not None and str(fr.get("db_id")) != "nan" else None,
                "original_id": oid,
                "level_1": fr.get("level_1"),
                "level_2": fr.get("level_2"),
                "level_3": fr.get("level_3"),
                "level_4": fr.get("level_4"),
                "column_text": fr.get("column_text"),
                "uom": fr.get("uom"),
                "ghg_unit": fr.get("ghg_unit"),
                "factor": float(fr.get("factor")) if fr.get("factor") is not None and str(fr.get("factor")) != "nan" else None,
            }

        missing = [oid for oid in ids if oid not in factor_by_id]
        if missing:
            missing_ids[scope_name] = missing[:200]
            errors.append(f"{scope_name}: {len(missing)} IDs were not found in the selected dataset.")

        for r in scope_rows:
            oid = str(r.get("original_id") or "").strip()
            qty_val = r.get("qty")
            if oid not in factor_by_id:
                continue
            f = factor_by_id[oid]
            if f.get("factor") is None:
                errors.append(f"{scope_name}: factor missing for ID {oid}.")
                continue

            calc = _to_tco2e(float(qty_val), float(f.get("factor")), f.get("ghg_unit"))
            rows_ready.append(
                {
                    "scope": scope_name,
                    "dataset_id": int(dsid),
                    "db_id": f.get("db_id"),
                    "original_id": oid,
                    "qty": float(qty_val),
                    "uom": f.get("uom"),
                    "ghg_unit": f.get("ghg_unit"),
                    "factor": f.get("factor"),
                    "calc_tco2e": float(calc),
                    "level_1": f.get("level_1"),
                    "level_2": f.get("level_2"),
                    "level_3": f.get("level_3"),
                    "level_4": f.get("level_4"),
                    "column_text": f.get("column_text"),
                }
            )

    details["rows_ready_count"] = int(len(rows_ready))

    ok = len(errors) == 0
    return {
        "ok": ok,
        "errors": errors,
        "warnings": warnings,
        "details": details,
        "missing_ids": missing_ids,
        "rows_ready": rows_ready,
    }


@app.post("/clients")
def create_client(
    request: Request,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    """Create a new client."""
    try:
        assert_permission(_user, "clients.create")
        org_id = require_org(_user)
        client_name = body.get("client_name", "").strip()
        if not client_name:
            raise HTTPException(status_code=400, detail="client_name is required")

        billing_same_as_main = bool(body.get("billing_same_as_main", True))
        billing_company = str(body.get("billing_company") or client_name).strip() or client_name
        main_addr_line1 = body.get("addr_line1")
        main_addr_line2 = body.get("addr_line2")
        main_addr_city = body.get("addr_city")
        main_addr_region = body.get("addr_region")
        main_addr_postcode = body.get("addr_postcode")
        main_addr_country = body.get("addr_country")

        billing_addr_line1 = main_addr_line1 if billing_same_as_main else body.get("billing_addr_line1")
        billing_addr_line2 = main_addr_line2 if billing_same_as_main else body.get("billing_addr_line2")
        billing_addr_city = main_addr_city if billing_same_as_main else body.get("billing_addr_city")
        billing_addr_region = main_addr_region if billing_same_as_main else body.get("billing_addr_region")
        billing_addr_postcode = main_addr_postcode if billing_same_as_main else body.get("billing_addr_postcode")
        billing_addr_country = main_addr_country if billing_same_as_main else body.get("billing_addr_country")
        
        with get_conn() as con:
            _ensure_client_billing_columns(con)
            _ensure_client_org_columns(con)
            ensure_client_benchmark_columns(con)
            _require_org_capacity(con, org_id, additional_clients=1)
            existing = con.execute(
                """
                SELECT db_id
                FROM clients
                WHERE org_id = ? AND lower(trim(client_name)) = lower(trim(?))
                ORDER BY db_id DESC
                LIMIT 1
                """,
                [org_id, client_name],
            ).fetchone()
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=f"Client '{client_name}' already exists (ID: {int(existing[0])})",
                )

            row = con.execute(
                """
                INSERT INTO clients (
                    org_id, client_name, billing_company, industry, description_long, website, year_end_month,
                    company_reg, sic_code, headquarters, addr_line1, addr_line2, addr_city,
                    addr_region, addr_postcode, addr_country, logo_url, portfolio,
                    crm_owner, currency, status, net_zero_year, benchmark_year,
                    benchmark_scope_1_tco2e, benchmark_scope_2_tco2e,
                    benchmark_scope_3_tco2e, benchmark_total_tco2e,
                    target_s1_year, target_s1_pct, target_s2_year, target_s2_pct,
                    target_s3_year, target_s3_pct, billing_same_as_main,
                    billing_addr_line1, billing_addr_line2, billing_addr_city,
                    billing_addr_region, billing_addr_postcode, billing_addr_country,
                    create_site_from_address
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING db_id
                """,
                [
                    org_id,
                    client_name,
                    billing_company,
                    body.get("industry"),
                    body.get("description_long"),
                    body.get("website"),
                    body.get("year_end_month"),
                    body.get("company_reg"),
                    body.get("sic_code"),
                    body.get("headquarters"),
                    main_addr_line1,
                    main_addr_line2,
                    main_addr_city,
                    main_addr_region,
                    main_addr_postcode,
                    main_addr_country,
                    body.get("logo_url"),
                    body.get("portfolio"),
                    body.get("crm_owner"),
                    str(body.get("currency") or "GBP").upper(),
                    body.get("status", "Active"),
                    body.get("net_zero_year"),
                    body.get("benchmark_year"),
                    body.get("benchmark_scope_1_tco2e"),
                    body.get("benchmark_scope_2_tco2e"),
                    body.get("benchmark_scope_3_tco2e"),
                    body.get("benchmark_total_tco2e"),
                    body.get("target_s1_year"),
                    body.get("target_s1_pct"),
                    body.get("target_s2_year"),
                    body.get("target_s2_pct"),
                    body.get("target_s3_year"),
                    body.get("target_s3_pct"),
                    billing_same_as_main,
                    billing_addr_line1,
                    billing_addr_line2,
                    billing_addr_city,
                    billing_addr_region,
                    billing_addr_postcode,
                    billing_addr_country,
                    body.get("create_site_from_address", False),
                ],
            ).fetchone()
            
            client_db_id = int(row[0])
            
            # Create site from address if requested
            if body.get("create_site_from_address", False):
                addr_parts = []
                if body.get("addr_line1"):
                    addr_parts.append(body.get("addr_line1"))
                if body.get("addr_line2"):
                    addr_parts.append(body.get("addr_line2"))
                if body.get("addr_city"):
                    addr_parts.append(body.get("addr_city"))
                if body.get("addr_region"):
                    addr_parts.append(body.get("addr_region"))
                if body.get("addr_postcode"):
                    addr_parts.append(body.get("addr_postcode"))
                if body.get("addr_country"):
                    addr_parts.append(body.get("addr_country"))
                
                location = ", ".join(addr_parts) if addr_parts else "Registered Office"
                
                con.execute(
                    """
                    INSERT INTO client_sites (org_id, client_db_id, site_name, location, is_registered_office)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    [org_id, client_db_id, "Registered Office", location, True]
                )
            
            after = _client_audit_snapshot(con, client_db_id, org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="client",
                entity_id=int(client_db_id),
                client_id=int(client_db_id),
                after=after,
                metadata={
                    "create_site_from_address": bool(body.get("create_site_from_address", False)),
                },
            )

            return {"ok": True, "client_db_id": client_db_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create client: {e}")


@app.post("/clients/logo-upload")
async def upload_client_logo(
    request: Request,
    file: UploadFile = File(...),
    client_db_id: int | None = Form(None),
    _user: dict[str, str] = Depends(_current_user),
):
    """Upload a client logo and optionally persist it against the client record."""
    if not file.content_type or not str(file.content_type).startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(raw) > (5 * 1024 * 1024):
        raise HTTPException(status_code=400, detail="Logo exceeds 5MB limit")

    target_path, logo_url = _client_logo_upload_path(client_db_id, file.filename or "logo.png", file.content_type)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    if client_db_id is not None and int(client_db_id) > 0:
        assert_permission(_user, "clients.edit")
        assert_client_access(_user, int(client_db_id))
    else:
        assert_permission(_user, "clients.create")

    try:
        if client_db_id is not None and int(client_db_id) > 0 and target_path.parent.exists():
            for existing in target_path.parent.glob("logo.*"):
                try:
                    if existing.is_file():
                        existing.unlink()
                except Exception:
                    pass

        with target_path.open("wb") as buffer:
            buffer.write(raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save client logo: {exc}")

    actor = _user.get("email", "unknown")
    if client_db_id is not None and int(client_db_id) > 0:
        client_db_id = int(client_db_id)
        org_id = require_org(_user)
        with get_conn() as con:
            before = _client_audit_snapshot(con, client_db_id, org_id)
            if not before:
                raise HTTPException(status_code=404, detail="Client not found")
            existing_logo = str(before.get("logo_url") or "").strip()
            con.execute(
                "UPDATE clients SET logo_url = ? WHERE db_id = ? AND org_id = ?",
                [logo_url, client_db_id, org_id],
            )
            after = _client_audit_snapshot(con, client_db_id, org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="client",
                entity_id=client_db_id,
                client_id=client_db_id,
                before=before,
                after=after,
                metadata={
                    "field": "logo_url",
                    "uploaded_filename": target_path.name,
                },
            )
            old_path = _resolve_uploaded_logo_path(existing_logo)
            if old_path and old_path.exists() and old_path != target_path:
                try:
                    old_path.unlink()
                except Exception:
                    pass

    return {
        "ok": True,
        "message": "Client logo uploaded successfully",
        "logo_url": logo_url,
        "filename": target_path.name,
    }


@app.get("/clients")
def list_clients(
    q: str | None = None,
    industry: str | None = None,
    status: str | None = None,
    crm_owner: str | None = None,
    risk: str | None = None,
    include_archived: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("client"),
    sort_dir: str = Query("asc"),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "clients.view")
    org_id = require_org(_user)
    query = (q or "").strip()
    org_placeholder = "%s" if db_backend() == "postgres" else "?"

    def _col_exists(con, table_name: str, col_name: str) -> bool:
        try:
            row = con.execute(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = ? AND column_name = ?
                LIMIT 1
                """,
                [table_name, col_name],
            ).fetchone()
            return bool(row)
        except Exception:
            return False

    def _normalize_filter_value(value: object, fallback: str) -> str:
        text = str(value or "").strip()
        return text if text else fallback

    def _normalize_lookup_value(value: object) -> str:
        return str(value or "").strip().lower()

    def _client_visibility_clause() -> tuple[str, list[object]]:
        if not org_id:
            return "", []

        params: list[object] = [org_id, org_id]
        clause = (
            f"(CAST(c.org_id AS TEXT) = {org_placeholder} "
            f"OR EXISTS (SELECT 1 FROM jobs j WHERE j.client_db_id = c.db_id AND TRIM(COALESCE(CAST(j.org_id AS TEXT), '')) = {org_placeholder})"
        )
        clause += ")"
        return clause, params

    try:
        with get_conn() as con:
            _ensure_client_org_columns(con)
            has_industry = _col_exists(con, "clients", "industry")
            has_status = _col_exists(con, "clients", "status")
            has_crm_owner = _col_exists(con, "clients", "crm_owner")

            where_clauses: list[str] = []
            params: list[object] = []
            visibility_clause, visibility_params = _client_visibility_clause()
            if visibility_clause:
                where_clauses.append(visibility_clause)
                params.extend(visibility_params)
            if not bool(_user.get("is_super_admin")) and str(_user.get("access_scope") or "").strip().lower() == "linked_clients":
                linked_client_ids = sorted(
                    {
                        int(client_id)
                        for client_id in (_user.get("linked_client_ids") or [])
                        if client_id is not None
                    }
                )
                if not linked_client_ids:
                    return {"items": [], "limit": int(limit), "offset": int(offset), "total": 0}
                where_clauses.append(f"c.db_id IN ({','.join(['%s'] * len(linked_client_ids))})")
                params.extend(linked_client_ids)
            if not include_archived and has_status:
                where_clauses.append("(c.status IS NULL OR lower(c.status) <> 'archived')")

            if query:
                if db_backend() == "postgres":
                    if has_industry:
                        where_clauses.append("(c.client_name ILIKE %s OR c.industry ILIKE %s)")
                        like = f"%{query}%"
                        params.extend([like, like])
                    else:
                        where_clauses.append("c.client_name ILIKE %s")
                        params.append(f"%{query}%")
                else:
                    if has_industry:
                        where_clauses.append("(lower(coalesce(c.client_name,'')) LIKE %s OR lower(coalesce(c.industry,'')) LIKE %s)")
                        like = f"%{query.lower()}%"
                        params.extend([like, like])
                    else:
                        where_clauses.append("lower(coalesce(c.client_name,'')) LIKE %s")
                        params.append(f"%{query.lower()}%")
            where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

            total_row = con.execute(
                f"""
                SELECT COUNT(*)
                FROM clients c
                {where_sql}
                """,
                params,
            ).fetchone()

            industry_col = "c.industry" if has_industry else "NULL::text as industry"
            status_col = "c.status" if has_status else "NULL::text as status"
            crm_col = "c.crm_owner" if has_crm_owner else "NULL::text as crm_owner"

            rows = (
                con.execute(
                    f"""
                    SELECT c.db_id as client_db_id,
                           c.client_name,
                           {industry_col},
                           {status_col},
                           {crm_col}
                    FROM clients c
                    {where_sql}
                    ORDER BY LOWER(COALESCE(c.client_name, '')) ASC, c.db_id ASC
                    """,
                    params,
                )
                .df()
            )

            milestone_data = None
            if rows is not None and not rows.empty:
                client_ids = [int(r["client_db_id"]) for _, r in rows.iterrows()]
                try:
                    milestone_data = con.execute(
                        f"""
                        SELECT 
                            j.client_db_id,
                            jp.data_collection_due, jp.data_collection_completed_at,
                            jp.first_draft_due, jp.first_draft_completed_at,
                            jp.final_report_due, jp.final_report_completed_at
                        FROM jobs j
                        LEFT JOIN job_plan jp ON jp.job_id = j.job_id
                        WHERE j.client_db_id IN ({','.join(['%s'] * len(client_ids))})
                        """,
                        client_ids,
                    ).df()
                except Exception:
                    milestone_data = None
    except Exception as e:
        # Final defensive fallback for schema drift: return a minimal list instead of 500.
        try:
            with get_conn() as con:
                where_clauses = []
                params: list[object] = []
                visibility_clause, visibility_params = _client_visibility_clause()
                if visibility_clause:
                    where_clauses.append(visibility_clause)
                    params.extend(visibility_params)
                if query:
                    where_clauses.append("c.client_name ILIKE %s")
                    params.append(f"%{query}%")
                where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

                total_row = con.execute(
                    f"SELECT COUNT(*) FROM clients c {where_sql}",
                    params,
                ).fetchone()
                rows = (
                    con.execute(
                        f"""
                        SELECT c.db_id as client_db_id,
                               c.client_name,
                               NULL::text as industry,
                               NULL::text as status,
                               NULL::text as crm_owner
                        FROM clients c
                        {where_sql}
                        ORDER BY LOWER(COALESCE(c.client_name, '')) ASC, c.db_id ASC
                        """,
                        params,
                    )
                    .df()
                )
                milestone_data = None
        except Exception:
            raise HTTPException(status_code=500, detail=f"/clients failed: {e}")

    # Helper function to calculate milestone status
    def get_milestone_status(due_date, completed_at):
        """Calculate traffic light status: green, amber, red, completed"""
        from datetime import date
        import pandas as pd

        if completed_at is not None and not pd.isna(completed_at):
            return "completed"
        if due_date is None or pd.isna(due_date):
            return "green"

        # Handle pandas/python datetime values safely.
        if hasattr(due_date, "date"):
            due_date = due_date.date()

        today = date.today()
        days_until_due = (due_date - today).days

        if days_until_due < -1:  # Overdue by more than 1 day
            return "red"
        elif days_until_due <= 7:  # Due within 7 days or 1 day overdue
            return "amber"
        else:
            return "green"
    
    def get_overall_status(statuses):
        """Get overall status: red if any red, amber if any amber, else green"""
        if "red" in statuses:
            return "red"
        elif "amber" in statuses:
            return "amber"
        else:
            return "green"
    
    # Calculate milestone status for each client
    client_milestone_status = {}
    if rows is not None and not rows.empty and 'milestone_data' in locals() and milestone_data is not None and not milestone_data.empty:
        for client_id in client_ids:
            client_jobs = milestone_data[milestone_data['client_db_id'] == client_id]
            all_statuses = []
            
            for _, job in client_jobs.iterrows():
                job_statuses = []
                if job.get("data_collection_due"):
                    job_statuses.append(get_milestone_status(job.get("data_collection_due"), job.get("data_collection_completed_at")))
                if job.get("first_draft_due"):
                    job_statuses.append(get_milestone_status(job.get("first_draft_due"), job.get("first_draft_completed_at")))
                if job.get("final_report_due"):
                    job_statuses.append(get_milestone_status(job.get("final_report_due"), job.get("final_report_completed_at")))
                
                if job_statuses:
                    all_statuses.extend(job_statuses)
            
            if all_statuses:
                client_milestone_status[client_id] = get_overall_status(all_statuses)
            else:
                client_milestone_status[client_id] = None

    items: list[dict[str, object]] = []
    facet_industries: dict[str, int] = {}
    facet_statuses: dict[str, int] = {}
    facet_owners: dict[str, int] = {}
    facet_risks: dict[str, int] = {}
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            client_id = int(r.get("client_db_id"))
            industry_value = _normalize_filter_value(_json_null_if_na(r.get("industry")), "Unspecified")
            status_value = _normalize_filter_value(_json_null_if_na(r.get("status")), "Unspecified")
            owner_value = _normalize_filter_value(_json_null_if_na(r.get("crm_owner")), "Unassigned")
            risk_value = _normalize_filter_value(client_milestone_status.get(client_id) or "green", "green")
            risk_label = "Overdue" if risk_value == "red" else "Due" if risk_value == "amber" else "Healthy"

            facet_industries[industry_value] = facet_industries.get(industry_value, 0) + 1
            facet_statuses[status_value] = facet_statuses.get(status_value, 0) + 1
            facet_owners[owner_value] = facet_owners.get(owner_value, 0) + 1
            facet_risks[risk_label] = facet_risks.get(risk_label, 0) + 1

            items.append(
                {
                    "client_db_id": client_id,
                    "client_name": _json_null_if_na(r.get("client_name")),
                    "industry": industry_value,
                    "status": status_value,
                    "crm_owner": owner_value,
                    "milestone_status": _json_null_if_na(client_milestone_status.get(client_id)),
                }
            )

        def matches_filters(item: dict[str, object]) -> bool:
            if industry and _normalize_lookup_value(item.get("industry")) != _normalize_lookup_value(industry):
                return False
            if status and _normalize_lookup_value(item.get("status")) != _normalize_lookup_value(status):
                return False
            if crm_owner and _normalize_lookup_value(item.get("crm_owner")) != _normalize_lookup_value(crm_owner):
                return False
            if risk:
                item_risk = item.get("milestone_status")
                risk_label = "Overdue" if item_risk == "red" else "Due" if item_risk == "amber" else "Healthy"
                if _normalize_lookup_value(risk_label) != _normalize_lookup_value(risk):
                    return False
            return True

        items = [item for item in items if matches_filters(item)]

    def sort_value(item: dict[str, object]):
        key = (sort_by or "client").strip().lower()
        if key == "industry":
            return _normalize_lookup_value(item.get("industry"))
        if key == "status":
            return _normalize_lookup_value(item.get("status"))
        if key == "owner":
            return _normalize_lookup_value(item.get("crm_owner"))
        if key == "risk":
            status = item.get("milestone_status")
            return 0 if status == "red" else 1 if status == "amber" else 2
        return _normalize_lookup_value(item.get("client_name"))

    reverse = str(sort_dir or "asc").strip().lower() == "desc"
    items.sort(key=sort_value, reverse=reverse)

    total = len(items)
    start = int(offset)
    end = start + int(limit)
    page_items = items[start:end]

    facet_payload = {
        "industries": [{"value": key, "count": count} for key, count in sorted(facet_industries.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
        "statuses": [{"value": key, "count": count} for key, count in sorted(facet_statuses.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
        "owners": [{"value": key, "count": count} for key, count in sorted(facet_owners.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
        "risks": [{"value": key, "count": count} for key, count in sorted(facet_risks.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
    }

    return {
        "items": page_items,
        "limit": int(limit),
        "offset": int(offset),
        "total": total,
        "facets": facet_payload,
    }


@app.get("/clients/{client_db_id}")
def get_client(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "clients.view")
    require_org(_user)
    with get_conn() as con:
        _ensure_client_org_columns(con)
        _ensure_client_billing_columns(con)
        ensure_client_benchmark_columns(con)
        assert_client_access(_user, int(client_db_id))
        row = con.execute(
            """
            SELECT c.db_id, c.client_name, c.industry, c.description_long, c.status,
                   c.website, c.year_end_month, c.company_reg, c.sic_code, c.headquarters,
                   c.addr_line1, c.addr_line2, c.addr_city, c.addr_region,
            c.addr_postcode, c.addr_country, c.logo_url, c.crm_owner,
            c.net_zero_year, c.interim_year, c.interim_s1_pct, c.interim_s2_pct,
            c.interim_s3_pct, c.portfolio, c.benchmark_year,
            c.benchmark_period_start, c.benchmark_period_end, c.currency,
            COALESCE(c.billing_same_as_main, TRUE), c.billing_addr_line1,
                   c.billing_addr_line2, c.billing_addr_city, c.billing_addr_region,
                   c.billing_addr_postcode, c.billing_addr_country,
            c.create_site_from_address,
            c.benchmark_scope_1_tco2e, c.benchmark_scope_2_tco2e,
            c.benchmark_scope_3_tco2e, c.benchmark_total_tco2e,
            COALESCE(c.billing_company, c.client_name)
            FROM clients c
            WHERE c.db_id=?
            LIMIT 1
            """,
            [int(client_db_id)],
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Client not found")

    return {
        "client_db_id": int(row[0]),
        "client_name": row[1],
        "industry": row[2],
        "description_long": row[3],
        "status": row[4],
        "website": row[5],
        "year_end_month": row[6],
        "company_reg": row[7],
        "sic_code": row[8],
        "headquarters": row[9],
        "addr_line1": row[10],
        "addr_line2": row[11],
        "addr_city": row[12],
        "addr_region": row[13],
        "addr_postcode": row[14],
        "addr_country": row[15],
        "logo_url": row[16],
        "crm_owner": row[17],
        "net_zero_year": (int(row[18]) if row[18] is not None else None),
        "interim_year": (int(row[19]) if row[19] is not None else None),
        "interim_s1_pct": (int(row[20]) if row[20] is not None else None),
        "interim_s2_pct": (int(row[21]) if row[21] is not None else None),
        "interim_s3_pct": (int(row[22]) if row[22] is not None else None),
        "portfolio": row[23],
        "benchmark_year": (int(row[24]) if row[24] is not None else None),
        "benchmark_period_start": str(row[25]) if row[25] is not None else None,
        "benchmark_period_end": str(row[26]) if row[26] is not None else None,
        "currency": row[27] if row[27] is not None else "GBP",
        "billing_same_as_main": bool(row[28]) if row[28] is not None else True,
        "billing_addr_line1": row[29],
        "billing_addr_line2": row[30],
        "billing_addr_city": row[31],
        "billing_addr_region": row[32],
        "billing_addr_postcode": row[33],
        "billing_addr_country": row[34],
        "create_site_from_address": bool(row[35]) if row[35] is not None else bool(
            row[10] or row[11] or row[12] or row[13] or row[14] or row[15]
        ),
        "benchmark_scope_1_tco2e": float(row[36]) if row[36] is not None else None,
        "benchmark_scope_2_tco2e": float(row[37]) if row[37] is not None else None,
        "benchmark_scope_3_tco2e": float(row[38]) if row[38] is not None else None,
        "benchmark_total_tco2e": float(row[39]) if row[39] is not None else None,
        "billing_company": row[40] if len(row) > 40 else row[1],
    }


@app.patch("/clients/{client_db_id}")
def update_client(
    request: Request,
    client_db_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update client information."""
    try:
        assert_permission(_user, "clients.edit")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_billing_columns(con)
            ensure_client_benchmark_columns(con)
            before = _client_audit_snapshot(con, int(client_db_id), org_id)
            existing_client = con.execute(
                """
                SELECT
                    org_id,
                    addr_line1, addr_line2, addr_city, addr_region, addr_postcode, addr_country,
                    billing_same_as_main, billing_addr_line1, billing_addr_line2, billing_addr_city,
                    billing_addr_region, billing_addr_postcode, billing_addr_country
                FROM clients
                WHERE db_id = ? AND org_id = ?
                LIMIT 1
                """,
                [int(client_db_id), org_id],
            ).fetchone()
            if not existing_client:
                raise HTTPException(status_code=404, detail="Client not found")

            existing_client_org_id = existing_client[0]
            
            # Build update query dynamically based on provided fields
            updates = []
            params = []
            normalized_body = dict(body)
            billing_related_fields = {
                "billing_same_as_main",
                "billing_addr_line1",
                "billing_addr_line2",
                "billing_addr_city",
                "billing_addr_region",
                "billing_addr_postcode",
                "billing_addr_country",
                "addr_line1",
                "addr_line2",
                "addr_city",
                "addr_region",
                "addr_postcode",
                "addr_country",
            }
            if any(field in normalized_body for field in billing_related_fields):
                current_main_addr = {
                    "addr_line1": existing_client[1] if existing_client else None,
                    "addr_line2": existing_client[2] if existing_client else None,
                    "addr_city": existing_client[3] if existing_client else None,
                    "addr_region": existing_client[4] if existing_client else None,
                    "addr_postcode": existing_client[5] if existing_client else None,
                    "addr_country": existing_client[6] if existing_client else None,
                }
                billing_same_default = bool(existing_client[7]) if existing_client and existing_client[7] is not None else True
                billing_same_as_main = bool(normalized_body.get("billing_same_as_main", billing_same_default))
                normalized_body["billing_same_as_main"] = billing_same_as_main
                if billing_same_as_main:
                    normalized_body["billing_addr_line1"] = normalized_body.get("addr_line1", current_main_addr["addr_line1"])
                    normalized_body["billing_addr_line2"] = normalized_body.get("addr_line2", current_main_addr["addr_line2"])
                    normalized_body["billing_addr_city"] = normalized_body.get("addr_city", current_main_addr["addr_city"])
                    normalized_body["billing_addr_region"] = normalized_body.get("addr_region", current_main_addr["addr_region"])
                    normalized_body["billing_addr_postcode"] = normalized_body.get("addr_postcode", current_main_addr["addr_postcode"])
                    normalized_body["billing_addr_country"] = normalized_body.get("addr_country", current_main_addr["addr_country"])
            
            field_mapping = {
                "client_name": "client_name",
                "industry": "industry",
                "description_long": "description_long",
                "website": "website",
                "year_end_month": "year_end_month",
                "company_reg": "company_reg",
                "sic_code": "sic_code",
                "headquarters": "headquarters",
                "addr_line1": "addr_line1",
                "addr_line2": "addr_line2",
                "addr_city": "addr_city",
                "addr_region": "addr_region",
                "addr_postcode": "addr_postcode",
                "addr_country": "addr_country",
                "logo_url": "logo_url",
                "crm_owner": "crm_owner",
                "status": "status",
                "net_zero_year": "net_zero_year",
                "interim_year": "interim_year",
                "interim_s1_pct": "interim_s1_pct",
                "interim_s2_pct": "interim_s2_pct",
                "interim_s3_pct": "interim_s3_pct",
                "portfolio": "portfolio",
                "benchmark_year": "benchmark_year",
                "benchmark_scope_1_tco2e": "benchmark_scope_1_tco2e",
                "benchmark_scope_2_tco2e": "benchmark_scope_2_tco2e",
                "benchmark_scope_3_tco2e": "benchmark_scope_3_tco2e",
                "benchmark_total_tco2e": "benchmark_total_tco2e",
                "benchmark_period_start": "benchmark_period_start",
                "benchmark_period_end": "benchmark_period_end",
                "currency": "currency",
                "target_s1_year": "target_s1_year",
                "target_s1_pct": "target_s1_pct",
                "target_s2_year": "target_s2_year",
                "target_s2_pct": "target_s2_pct",
                "target_s3_year": "target_s3_year",
                "target_s3_pct": "target_s3_pct",
                "billing_company": "billing_company",
                "billing_same_as_main": "billing_same_as_main",
                "billing_addr_line1": "billing_addr_line1",
                "billing_addr_line2": "billing_addr_line2",
                "billing_addr_city": "billing_addr_city",
                "billing_addr_region": "billing_addr_region",
                "billing_addr_postcode": "billing_addr_postcode",
                "billing_addr_country": "billing_addr_country",
                "create_site_from_address": "create_site_from_address",
            }
            
            for field_name, col_name in field_mapping.items():
                if field_name in normalized_body:
                    updates.append(f"{col_name} = ?")
                    params.append(normalized_body[field_name])
            
            if updates:
                params.append(int(client_db_id))
                query = f"UPDATE clients SET {', '.join(updates)} WHERE db_id = ? AND org_id = ?"
                con.execute(query, [*params, org_id])
            
            # Handle site creation/update if requested
            if body.get("create_site_from_address", False):
                # Check if registered office site already exists
                existing_site = con.execute(
                    "SELECT site_id FROM client_sites WHERE client_db_id = ? AND is_registered_office = ?",
                    [int(client_db_id), True]
                ).fetchone()
                
                addr_parts = []
                if body.get("addr_line1"):
                    addr_parts.append(body.get("addr_line1"))
                if body.get("addr_line2"):
                    addr_parts.append(body.get("addr_line2"))
                if body.get("addr_city"):
                    addr_parts.append(body.get("addr_city"))
                if body.get("addr_region"):
                    addr_parts.append(body.get("addr_region"))
                if body.get("addr_postcode"):
                    addr_parts.append(body.get("addr_postcode"))
                if body.get("addr_country"):
                    addr_parts.append(body.get("addr_country"))
                
                location = ", ".join(addr_parts) if addr_parts else "Registered Office"
                
                if existing_site:
                    # Update existing site
                    con.execute(
                        "UPDATE client_sites SET location = ? WHERE site_id = ?",
                        [location, int(existing_site[0])]
                    )
                else:
                    # Create new site
                    con.execute(
                        """
                        INSERT INTO client_sites (client_db_id, site_name, location, is_registered_office)
                        VALUES (?, ?, ?, ?)
                        """,
                        [int(client_db_id), "Registered Office", location, True]
                    )
            
            after = _client_audit_snapshot(con, int(client_db_id), org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="client",
                entity_id=int(client_db_id),
                client_id=int(client_db_id),
                before=before,
                after=after,
                metadata={"updated_fields": list(normalized_body.keys())},
            )

            return {"ok": True, "message": "Client updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


@app.get("/clients/{client_db_id}/sites")
def client_sites(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    # Return both active and vacated sites
    try:
        assert_permission(_user, "clients.view")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_billing_columns(con)
            payload = _fetch_client_sites_payload(int(client_db_id), con=con)
            payload["org_id"] = org_id
            return payload
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch sites: {e}")


@app.post("/clients/{client_db_id}/sites")
def create_client_site(
    request: Request,
    client_db_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Create a new site for a client."""
    try:
        assert_permission(_user, "clients.sites.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_sites_runtime_columns(con)
            # If this site is marked as registered office, unset other registered offices
            if body.get("is_registered_office", False):
                con.execute(
                    "UPDATE client_sites SET is_registered_office = FALSE WHERE client_db_id = %s AND org_id = %s",
                    [int(client_db_id), org_id]
                )
            
            row = con.execute(
                """
                INSERT INTO client_sites (org_id, client_db_id, site_name, location, is_registered_office)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING site_id
                """,
                [
                    org_id,
                    int(client_db_id),
                    body.get("site_name"),
                    body.get("location"),
                    body.get("is_registered_office", False),
                ]
            ).fetchone()
            
            site_id_value = int(row[0])
            after = _client_site_audit_snapshot(con, int(client_db_id), site_id_value, org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="client_site",
                entity_id=site_id_value,
                client_id=int(client_db_id),
                after=after,
                metadata={"is_registered_office": bool(body.get("is_registered_office", False))},
            )

            return {"ok": True, "site_id": site_id_value}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create site: {e}")


@app.patch("/clients/{client_db_id}/sites/{site_id}")
def update_client_site(
    request: Request,
    client_db_id: int,
    site_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update a client site."""
    try:
        assert_permission(_user, "clients.sites.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_sites_runtime_columns(con)
            before = _client_site_audit_snapshot(con, int(client_db_id), int(site_id), org_id)
            # Check site exists
            exists = con.execute(
                """
                SELECT site_id, org_id
                FROM client_sites
                WHERE site_id = %s
                  AND client_db_id = %s
                  AND org_id = %s
                LIMIT 1
                """,
                [int(site_id), int(client_db_id), org_id]
            ).fetchone()
            
            if not exists:
                raise HTTPException(status_code=404, detail="Site not found")

            # If this site is being marked as registered office, unset other registered offices
            if body.get("is_registered_office", False):
                con.execute(
                    """
                    UPDATE client_sites
                    SET is_registered_office = FALSE
                    WHERE client_db_id = %s
                      AND site_id != %s
                      AND org_id = %s
                    """,
                    [int(client_db_id), int(site_id), org_id]
                )
            
            # Build update query
            updates = []
            params = []
            
            field_mapping = {
                "site_name": "site_name",
                "location": "location",
                "is_registered_office": "is_registered_office",
            }
            
            for field_name, col_name in field_mapping.items():
                if field_name in body:
                    updates.append(f"{col_name} = %s")
                    params.append(body[field_name])
            
            if updates:
                params.extend([int(site_id), int(client_db_id), org_id])
                query = f"""
                    UPDATE client_sites
                    SET {', '.join(updates)}
                    WHERE site_id = %s
                      AND client_db_id = %s
                      AND org_id = %s
                """
                con.execute(query, params)
            
            after = _client_site_audit_snapshot(con, int(client_db_id), int(site_id), org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="client_site",
                entity_id=int(site_id),
                client_id=int(client_db_id),
                before=before,
                after=after,
                metadata={"updated_fields": list(body.keys())},
            )

            return {"ok": True, "message": "Site updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update site: {e}")


@app.patch("/clients/{client_db_id}/sites/{site_id}/vacate")
def vacate_client_site(
    request: Request,
    client_db_id: int,
    site_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Mark a site as vacated with a date (preserves historical emissions data)."""
    try:
        assert_permission(_user, "clients.sites.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_sites_runtime_columns(con)
            before = _client_site_audit_snapshot(con, int(client_db_id), int(site_id), org_id)
            # Check site exists
            exists = con.execute(
                """
                SELECT site_id, org_id
                FROM client_sites
                WHERE site_id = %s
                  AND client_db_id = %s
                  AND org_id = %s
                LIMIT 1
                """,
                [int(site_id), int(client_db_id), org_id]
            ).fetchone()
            
            if not exists:
                raise HTTPException(status_code=404, detail="Site not found")

            vacated_date = body.get("vacated_date")
            if not vacated_date:
                raise HTTPException(status_code=400, detail="vacated_date is required")
            
            # Mark site as vacated with date
            # This preserves historical emissions data linked to this site
            con.execute(
                """
                UPDATE client_sites 
                SET vacated_date = %s,
                    archived = TRUE,
                    archived_by = %s,
                    archived_at = CURRENT_TIMESTAMP
                WHERE site_id = %s AND client_db_id = %s AND org_id = %s
                """,
                [vacated_date, _user.get("email", "unknown"), int(site_id), int(client_db_id), org_id]
            )
            
            after = _client_site_audit_snapshot(con, int(client_db_id), int(site_id), org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="vacate",
                entity_type="client_site",
                entity_id=int(site_id),
                client_id=int(client_db_id),
                before=before,
                after=after,
                metadata={"vacated_date": vacated_date},
            )

            return {"ok": True, "message": "Site vacated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to vacate site: {e}")


@app.get("/clients/{client_db_id}/contacts")
def get_client_contacts(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Get all contacts for a client."""
    try:
        assert_permission(_user, "clients.view")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            try:
                if org_id:
                    df = con.execute(
                        """
                        SELECT contact_id, client_db_id, full_name, job_title, email, phone, is_primary
                        FROM client_contacts
                        WHERE client_db_id = ? AND org_id = ?
                        ORDER BY is_primary DESC, full_name ASC
                        """,
                        [int(client_db_id), org_id]
                    ).df()
                else:
                    df = con.execute(
                        """
                        SELECT contact_id, client_db_id, full_name, job_title, email, phone, is_primary
                        FROM client_contacts
                        WHERE client_db_id = ?
                        ORDER BY is_primary DESC, full_name ASC
                        """,
                        [int(client_db_id)]
                    ).df()
            except Exception:
                df = con.execute(
                    """
                    SELECT contact_id, client_db_id, full_name, job_title, email, phone, is_primary
                    FROM client_contacts
                    WHERE client_db_id = ?
                    ORDER BY is_primary DESC, full_name ASC
                    """,
                    [int(client_db_id)]
                ).df()

            def _contact_is_missing(value) -> bool:
                try:
                    return pd.isna(value)
                except Exception:
                    return value is None

            def _contact_int_or_none(value):
                if _contact_is_missing(value):
                    return None
                try:
                    return int(value)
                except Exception:
                    return None

            def _contact_bool_or_false(value) -> bool:
                if _contact_is_missing(value):
                    return False
                try:
                    return bool(value)
                except Exception:
                    return False

            contacts = []
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    contact_id_value = _contact_int_or_none(row.get("contact_id"))
                    client_db_id_value = _contact_int_or_none(row.get("client_db_id"))
                    if contact_id_value is None or client_db_id_value is None:
                        continue
                    contacts.append({
                        "contact_id": contact_id_value,
                        "client_db_id": client_db_id_value,
                        "full_name": None if _contact_is_missing(row.get("full_name")) else row.get("full_name"),
                        "job_title": None if _contact_is_missing(row.get("job_title")) else row.get("job_title"),
                        "email": None if _contact_is_missing(row.get("email")) else row.get("email"),
                        "phone": None if _contact_is_missing(row.get("phone")) else row.get("phone"),
                        "is_primary": _contact_bool_or_false(row.get("is_primary")),
                    })

            return {"client_db_id": int(client_db_id), "contacts": contacts}
    except Exception:
        # Keep the page usable while the tenant schema rollout is still in flight.
        return {"client_db_id": int(client_db_id), "contacts": []}


@app.post("/clients/{client_db_id}/contacts")
def create_client_contact(
    request: Request,
    client_db_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Create a new contact for a client."""
    try:
        assert_permission(_user, "clients.contacts.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            # If this contact is marked as primary, unset other primary contacts
            if body.get("is_primary", False):
                con.execute(
                    "UPDATE client_contacts SET is_primary = FALSE WHERE client_db_id = ? AND org_id = ?",
                    [int(client_db_id), org_id]
                )
            
            row = con.execute(
                """
                INSERT INTO client_contacts (org_id, client_db_id, full_name, job_title, email, phone, is_primary)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING contact_id
                """,
                [
                    org_id,
                    int(client_db_id),
                    body.get("full_name"),
                    body.get("job_title"),
                    body.get("email"),
                    body.get("phone"),
                    body.get("is_primary", False),
                ]
            ).fetchone()
            
            contact_id_value = int(row[0])
            after = _client_contact_audit_snapshot(con, int(client_db_id), contact_id_value)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="client_contact",
                entity_id=contact_id_value,
                client_id=int(client_db_id),
                after=after,
                metadata={"is_primary": bool(body.get("is_primary", False))},
            )

            return {"ok": True, "contact_id": contact_id_value}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create contact: {e}")


@app.patch("/clients/{client_db_id}/contacts/{contact_id}")
def update_client_contact(
    request: Request,
    client_db_id: int,
    contact_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update a client contact."""
    try:
        assert_permission(_user, "clients.contacts.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            before = _client_contact_audit_snapshot(con, int(client_db_id), int(contact_id), org_id)
            # Check contact exists
            exists = con.execute(
                "SELECT 1 FROM client_contacts WHERE contact_id = ? AND client_db_id = ? AND org_id = ?",
                [int(contact_id), int(client_db_id), org_id]
            ).fetchone()
            
            if not exists:
                raise HTTPException(status_code=404, detail="Contact not found")
            
            # If this contact is being marked as primary, unset other primary contacts
            if body.get("is_primary", False):
                con.execute(
                    "UPDATE client_contacts SET is_primary = FALSE WHERE client_db_id = ? AND contact_id != ? AND org_id = ?",
                    [int(client_db_id), int(contact_id), org_id]
                )
            
            # Build update query
            updates = []
            params = []
            
            field_mapping = {
                "full_name": "full_name",
                "job_title": "job_title",
                "email": "email",
                "phone": "phone",
                "is_primary": "is_primary",
            }
            
            for field_name, col_name in field_mapping.items():
                if field_name in body:
                    updates.append(f"{col_name} = ?")
                    params.append(body[field_name])
            
            if updates:
                params.extend([int(contact_id), int(client_db_id), org_id])
                query = f"UPDATE client_contacts SET {', '.join(updates)} WHERE contact_id = ? AND client_db_id = ? AND org_id = ?"
                con.execute(query, params)
            
            after = _client_contact_audit_snapshot(con, int(client_db_id), int(contact_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="client_contact",
                entity_id=int(contact_id),
                client_id=int(client_db_id),
                before=before,
                after=after,
                metadata={"updated_fields": list(body.keys())},
            )

            return {"ok": True, "message": "Contact updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update contact: {e}")


@app.delete("/clients/{client_db_id}/contacts/{contact_id}")
def delete_client_contact(
    request: Request,
    client_db_id: int,
    contact_id: int,
    _user: dict[str, str] = Depends(_current_user)
):
    """Delete a client contact."""
    try:
        assert_permission(_user, "clients.contacts.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            before = _client_contact_audit_snapshot(con, int(client_db_id), int(contact_id), org_id)
            result = con.execute(
                "DELETE FROM client_contacts WHERE contact_id = ? AND client_db_id = ? AND org_id = ?",
                [int(contact_id), int(client_db_id), org_id]
            )

            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="delete",
                entity_type="client_contact",
                entity_id=int(contact_id),
                client_id=int(client_db_id),
                before=before,
                metadata={"deleted": bool(result is not None)},
            )

            return {"ok": True, "message": "Contact deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete contact: {e}")


@app.get("/clients/{client_db_id}/jobs")
def client_jobs(
    client_db_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        assert_permission(_user, "jobs.view")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        org_text = str(org_id or "").strip()
        with get_conn() as con:
            try:
                if org_id:
                    total_row = con.execute(
                        """
                        SELECT COUNT(*)
                        FROM jobs j
                        WHERE j.client_db_id = ?
                          AND TRIM(COALESCE(CAST(j.org_id AS TEXT), '')) = ?
                        """,
                        [int(client_db_id), org_text],
                    ).fetchone()

                    rows = con.execute(
                        """
                        SELECT j.job_id, j.job_number, j.title, j.reporting_year, j.status,
                               j.job_type, j.is_crp, j.reporting_period_end,
                               jp.data_collection_due, jp.data_collection_completed_at,
                               jp.first_draft_due, jp.first_draft_completed_at,
                               jp.final_report_due, jp.final_report_completed_at,
                               COALESCE(SUM(
                                   CASE
                                       WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%'
                                       THEN (COALESCE(jsr.qty,
                                               COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) +
                                               COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) +
                                               COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) +
                                               COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) +
                                               COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) +
                                               COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                           ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0) / 1000.0
                                       ELSE (COALESCE(jsr.qty,
                                               COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) +
                                               COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) +
                                               COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) +
                                               COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) +
                                               COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) +
                                               COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                           ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0)
                                   END
                               ), 0) as total_emissions
                        FROM jobs j
                        LEFT JOIN job_plan jp ON jp.job_id = j.job_id
                        LEFT JOIN job_scope_rows jsr ON jsr.job_id = j.job_id AND jsr.enabled = TRUE
                        WHERE j.client_db_id = ?
                          AND TRIM(COALESCE(CAST(j.org_id AS TEXT), '')) = ?
                        GROUP BY j.job_id, j.job_number, j.title, j.reporting_year, j.status,
                                 j.job_type, j.is_crp, j.reporting_period_end,
                                 jp.data_collection_due, jp.data_collection_completed_at,
                                 jp.first_draft_due, jp.first_draft_completed_at,
                                 jp.final_report_due, jp.final_report_completed_at
                        ORDER BY j.job_type, j.reporting_year DESC, j.job_id DESC
                        LIMIT ? OFFSET ?
                        """,
                        [int(client_db_id), org_text, int(limit), int(offset)],
                    ).df()
                else:
                    total_row = con.execute(
                        """
                        SELECT COUNT(*)
                        FROM jobs j
                        WHERE j.client_db_id = ?
                        """,
                        [int(client_db_id)],
                    ).fetchone()
                    rows = (
                        con.execute(
                            """
                            SELECT j.job_id, j.job_number, j.title, j.reporting_year, j.status,
                                   j.job_type, j.is_crp, j.reporting_period_end,
                                   jp.data_collection_due, jp.data_collection_completed_at,
                                   jp.first_draft_due, jp.first_draft_completed_at,
                                   jp.final_report_due, jp.final_report_completed_at,
                                   COALESCE(SUM(
                                       CASE
                                           WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%'
                                           THEN (COALESCE(jsr.qty,
                                                   COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) +
                                                   COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) +
                                                   COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) +
                                                   COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) +
                                                   COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) +
                                                   COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                               ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0) / 1000.0
                                           ELSE (COALESCE(jsr.qty,
                                                   COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) +
                                                   COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) +
                                                   COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) +
                                                   COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) +
                                                   COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) +
                                                   COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                               ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0)
                                       END
                                   ), 0) as total_emissions
                            FROM jobs j
                            LEFT JOIN job_plan jp ON jp.job_id = j.job_id
                            LEFT JOIN job_scope_rows jsr ON jsr.job_id = j.job_id AND jsr.enabled = TRUE
                            WHERE j.client_db_id=?
                            GROUP BY j.job_id, j.job_number, j.title, j.reporting_year, j.status,
                                     j.job_type, j.is_crp, j.reporting_period_end,
                                     jp.data_collection_due, jp.data_collection_completed_at,
                                     jp.first_draft_due, jp.first_draft_completed_at,
                                     jp.final_report_due, jp.final_report_completed_at
                            ORDER BY j.job_type, j.reporting_year DESC, j.job_id DESC
                            LIMIT ? OFFSET ?
                            """,
                            [int(client_db_id), int(limit), int(offset)],
                        )
                        .df()
                    )
            except Exception:
                total_row = (0,)
                rows = pd.DataFrame()
    except Exception:
        total_row = (0,)
        rows = pd.DataFrame()

    # Helper function to calculate milestone status
    def get_milestone_status(due_date, completed_at):
        """Calculate traffic light status: green, amber, red, completed"""
        if completed_at:
            return "completed"
        if not due_date:
            return "green"
        
        from datetime import date
        import pandas as pd
        
        # Handle pandas Timestamp
        if isinstance(due_date, pd.Timestamp):
            due_date = due_date.date()
        
        today = date.today()
        days_until_due = (due_date - today).days
        
        if days_until_due < -1:  # Overdue by more than 1 day
            return "red"
        elif days_until_due <= 7:  # Due within 7 days or 1 day overdue
            return "amber"
        else:
            return "green"
    
    def get_overall_status(statuses):
        """Get overall status: red if any red, amber if any amber, else green"""
        if "red" in statuses:
            return "red"
        elif "amber" in statuses:
            return "amber"
        else:
            return "green"

    def _is_missing(value) -> bool:
        try:
            return pd.isna(value)
        except Exception:
            return value is None

    def _int_or_none(value):
        if _is_missing(value):
            return None
        try:
            return int(value)
        except Exception:
            return None

    def _float_or_zero(value) -> float:
        if _is_missing(value):
            return 0.0
        try:
            out = float(value)
            return 0.0 if pd.isna(out) else out
        except Exception:
            return 0.0

    def _bool_or_false(value) -> bool:
        if _is_missing(value):
            return False
        try:
            return bool(value)
        except Exception:
            return False

    def _reporting_year_from_row(row) -> int | None:
        reporting_period_end = row.get("reporting_period_end")
        if not _is_missing(reporting_period_end):
            try:
                if hasattr(reporting_period_end, "year"):
                    return int(reporting_period_end.year)
            except Exception:
                pass
        return _int_or_none(row.get("reporting_year"))

    items: list[dict[str, object]] = []
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            job_id = _int_or_none(r.get("job_id"))
            if job_id is None:
                continue

            # Calculate individual milestone statuses
            milestone_statuses = []
            if not _is_missing(r.get("data_collection_due")):
                milestone_statuses.append(get_milestone_status(r.get("data_collection_due"), r.get("data_collection_completed_at")))
            if not _is_missing(r.get("first_draft_due")):
                milestone_statuses.append(get_milestone_status(r.get("first_draft_due"), r.get("first_draft_completed_at")))
            if not _is_missing(r.get("final_report_due")):
                milestone_statuses.append(get_milestone_status(r.get("final_report_due"), r.get("final_report_completed_at")))

            # Calculate overall status
            overall_milestone_status = get_overall_status(milestone_statuses) if milestone_statuses else None

            items.append(
                {
                    "job_id": job_id,
                    "job_number": None if _is_missing(r.get("job_number")) else r.get("job_number"),
                    "title": None if _is_missing(r.get("title")) else r.get("title"),
                    "reporting_year": _reporting_year_from_row(r),
                    "status": None if _is_missing(r.get("status")) else r.get("status"),
                    "job_type": None if _is_missing(r.get("job_type")) else r.get("job_type"),
                    "is_crp": _bool_or_false(r.get("is_crp")),
                    "milestone_status": overall_milestone_status,
                    "total_emissions": _float_or_zero(r.get("total_emissions", 0)),
                }
            )

    total = int(total_row[0] if total_row else 0)
    return {"client_db_id": int(client_db_id), "items": items, "limit": int(limit), "offset": int(offset), "total": total}
