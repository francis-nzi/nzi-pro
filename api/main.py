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
from api.job_report_asset_routes import router as job_report_asset_router
from api.job_report_generation_routes import router as job_report_generation_router
from api.job_report_docx_generation_routes import router as job_report_docx_generation_router
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
from api.auth_routes import _current_org_summary
from api.auth_routes import router as auth_router
from api.client_management_routes import router as client_management_router
from api.permissions import assert_client_access, assert_job_access, assert_permission
from services.tenancy import require_org
import api.client_index_routes as client_index_routes
import api.client_management_routes as client_management_routes
import api.job_management_routes as job_management_routes
import api.job_setup_routes as job_setup_routes
import api.support_feedback_routes as support_feedback_routes

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

app = FastAPI(title="NZI Pro API", version="0.1.0")
_rate_limiter = build_default_rate_limiter()

# Serve frontend-uploaded assets (e.g., /uploads/system/nzi-logo.png)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOADS_DIR = PROJECT_ROOT / "frontend" / "public" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

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
app.include_router(job_report_asset_router)
app.include_router(job_report_generation_router)
app.include_router(job_report_docx_generation_router)

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


def _sync_compat_dependencies(module) -> None:
    """Keep legacy test entrypoints working after route extraction."""
    for name in (
        "get_conn",
        "db_backend",
        "assert_permission",
        "assert_client_access",
        "assert_job_access",
        "require_org",
        "record_audit_event",
        "_current_org_summary",
        "exact_job_total_emissions",
    ):
        if hasattr(module, name) and name in globals():
            setattr(module, name, globals()[name])


def list_clients(*args, **kwargs):
    _sync_compat_dependencies(client_index_routes)
    return client_index_routes.list_clients(*args, **kwargs)


def client_jobs(*args, **kwargs):
    _sync_compat_dependencies(client_index_routes)
    return client_index_routes.client_jobs(*args, **kwargs)


def create_client(*args, **kwargs):
    _sync_compat_dependencies(client_management_routes)
    return client_management_routes.create_client(*args, **kwargs)


def get_client(*args, **kwargs):
    _sync_compat_dependencies(client_management_routes)
    return client_management_routes.get_client(*args, **kwargs)


def get_job(*args, **kwargs):
    _sync_compat_dependencies(job_management_routes)
    return job_management_routes.get_job(*args, **kwargs)


def job_excel_import(*args, **kwargs):
    _sync_compat_dependencies(job_setup_routes)
    return job_setup_routes.job_excel_import(*args, **kwargs)


def support_database_fingerprint(*args, **kwargs):
    _sync_compat_dependencies(support_feedback_routes)
    return support_feedback_routes.support_database_fingerprint(*args, **kwargs)


def support_diagnostics(*args, **kwargs):
    _sync_compat_dependencies(support_feedback_routes)
    return support_feedback_routes.support_diagnostics(*args, **kwargs)


def health(*args, **kwargs):
    _sync_compat_dependencies(support_feedback_routes)
    return support_feedback_routes.health(*args, **kwargs)


def debug_env(*args, **kwargs):
    _sync_compat_dependencies(support_feedback_routes)
    return support_feedback_routes.debug_env(*args, **kwargs)


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
