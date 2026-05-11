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
from api.job_setup_routes import router as job_setup_router
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
app.include_router(job_setup_router)

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
