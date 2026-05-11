import io
from datetime import datetime, timezone
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
    raise RuntimeError("FATAL: NZI_JWT_SECRET missing in strict auth mode")

import pandas as pd
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
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
from services.emissions_reporting import exact_job_total_emissions
from services.rate_limiter import build_default_rate_limiter
from api.admin_routes import router as admin_router
from api.org_admin_helpers import _require_org_capacity
from api.org_admin_helpers import _require_org_plan_active
from api.admin_users_routes import router as admin_users_router
from api.admin_organisations_routes import router as admin_organisations_router
from api.admin_datasets_routes import router as admin_datasets_router
from api.admin_lookups_routes import router as admin_lookups_router
from api.admin_suppliers_routes import router as admin_suppliers_router
from api.admin_legacy_routes import router as admin_legacy_router
from api.admin_jobs_routes import router as admin_jobs_router
from api.admin_archive_routes import router as admin_archive_router
from api.admin_monitoring_routes import router as admin_monitoring_router
from api.admin_audit_routes import router as admin_audit_router
from api.support_feedback_routes import router as support_feedback_router
from api.stripe_billing_routes import router as stripe_billing_router
from api.stripe_billing_routes import webhook_router as stripe_billing_webhook_router
from api.job_scope_data_routes import router as job_scope_data_router
from api.job_management_routes import router as job_management_router
from api.job_template_routes import router as job_template_router
from api.job_report_version_routes import router as job_report_version_router
from api.job_report_docx_routes import router as job_report_docx_router
from api.job_emission_register_routes import router as job_emission_register_router
from api.job_custom_factors_routes import router as job_custom_factors_router
from api.job_milestone_routes import router as job_milestone_router
from api.custom_factors_routes import router as custom_factors_router
from api.client_index_routes import router as client_index_router
from api.client_dashboard_routes import router as client_dashboard_router
from api.client_notes_routes import router as client_notes_router
from api.client_reporting_routes import router as client_reporting_router
from api.intelligence_routes import router as intelligence_router
from api.job_intensity_routes import router as job_intensity_router
from api.job_live_report_routes import router as job_live_report_router
from api.main_dashboard_routes import router as main_dashboard_router
from api.job_data_output_routes import router as job_data_output_router
from api.job_report_routes import router as job_report_router
from api.job_report_pdf_routes import router as job_report_pdf_router
from api.pdf_generation_routes import router as pdf_generation_router
from api.job_files_routes import router as job_files_router
from api.job_emissions_certificate_routes import router as job_emissions_certificate_router
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
from api.spend_data_routes import router as spend_data_router
from api.employee_commuting_routes import router as employee_commuting_router
from api.quotes_routes import router as quotes_router
from api.xero_routes import router as xero_router
from api.dataset_import_routes import router as dataset_import_router
from api.auth import _current_user
from api.auth_routes import router as auth_router
from api.client_management_routes import router as client_management_router
from api.permissions import assert_client_access, assert_job_access, assert_permission
from services.tenancy import require_org

try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
except Exception:  # pragma: no cover - optional dependency
    sentry_sdk = None
    FastApiIntegration = None
    LoggingIntegration = None


def _init_sentry() -> None:
    if sentry_sdk is None:
        return
    dsn = str(os.getenv("SENTRY_DSN") or "").strip()
    if not dsn:
        return
    try:
        traces_sample_rate = float(str(os.getenv("SENTRY_TRACES_SAMPLE_RATE") or "0.0").strip())
    except Exception:
        traces_sample_rate = 0.0
    traces_sample_rate = max(0.0, min(traces_sample_rate, 1.0))
    environment = str(os.getenv("SENTRY_ENVIRONMENT") or os.getenv("APP_ENV") or "production").strip()
    integrations = []
    if FastApiIntegration is not None:
        integrations.append(FastApiIntegration(transaction_style="endpoint"))
    if LoggingIntegration is not None:
        integrations.append(LoggingIntegration(level=None, event_level=None))
    sentry_sdk.init(
        dsn=dsn,
        environment=environment or "production",
        traces_sample_rate=traces_sample_rate,
        send_default_pii=False,
        integrations=integrations,
    )


_init_sentry()


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
_rate_limiter = build_default_rate_limiter()

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
app.include_router(admin_users_router)
app.include_router(admin_organisations_router)
app.include_router(admin_datasets_router)
app.include_router(admin_lookups_router)
app.include_router(admin_suppliers_router)
app.include_router(admin_legacy_router)
app.include_router(admin_jobs_router)
app.include_router(admin_archive_router)
app.include_router(admin_monitoring_router)
app.include_router(admin_audit_router)
app.include_router(support_feedback_router)
app.include_router(client_index_router)
app.include_router(client_management_router)

# Include Stripe billing routes
app.include_router(stripe_billing_router)
app.include_router(stripe_billing_webhook_router)

# Include job scope data routes
app.include_router(job_scope_data_router)
app.include_router(job_management_router)
app.include_router(job_template_router)

# Include emission register routes
app.include_router(job_emission_register_router)
app.include_router(job_report_version_router)
app.include_router(job_report_docx_router)

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

# Include intelligence routes
app.include_router(intelligence_router)

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

# Include professional PDF report routes
app.include_router(job_report_pdf_router)

# Include PDF generation routes (Phase 1: Async PDF)
app.include_router(pdf_generation_router)

# Include job files routes
app.include_router(job_files_router)

# Include job emissions certificate routes
app.include_router(job_emissions_certificate_router)

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
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id UUID",
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
    """Ensure client/org tenancy columns exist."""
    statements = [
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id UUID",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS org_id UUID",
        "ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS org_id UUID",
    ]
    for statement in statements:
        try:
            con.execute(statement)
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


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    result = _rate_limiter.check(request)
    if not result.allowed:
        headers = {}
        if result.retry_after_seconds is not None:
            headers["Retry-After"] = str(result.retry_after_seconds)
        return JSONResponse(
            status_code=429,
            content={
                "detail": "Too many requests",
                "reason": "rate_limited",
                "rule": result.rule_name,
                "limit": result.limit,
                "retry_after_seconds": result.retry_after_seconds,
            },
            headers=headers,
        )

    return await call_next(request)
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
                        f"""
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
                            (str(level_1).strip() if level_1 is not None else None),  # category = top-level dataset category
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
    _tmp_template_file = None
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

        # If the assigned template has DB content (uploaded via Admin), write to a temp
        # file so the generator uses the correct file instead of a stale disk copy.
        with get_conn() as con:
            tpl_row = con.execute(
                """
                SELECT jt.file_content
                FROM jobs j
                LEFT JOIN job_templates jt ON jt.job_template_id = j.job_template_id
                WHERE j.job_id = ?
                """,
                [int(job_id)],
            ).fetchone()
        if tpl_row and tpl_row[0]:
            import tempfile
            file_content_bytes = bytes(tpl_row[0]) if not isinstance(tpl_row[0], bytes) else tpl_row[0]
            _tmp_template_file = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
            _tmp_template_file.write(file_content_bytes)
            _tmp_template_file.close()
            reference_template_path = _tmp_template_file.name

        if template_format == "single":
            from services.generate_single_sheet_template import generate_single_sheet_template

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
    finally:
        if _tmp_template_file is not None:
            try:
                os.unlink(_tmp_template_file.name)
            except Exception:
                pass

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
        try:
            rows_ready, parse_errors, parse_warnings, parse_details = parse_single_sheet_upload(
                raw, int(job_id), ds_map
            )
        except Exception as parse_exc:
            raise HTTPException(status_code=400, detail=f"Failed to parse workbook: {parse_exc}")
        
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
