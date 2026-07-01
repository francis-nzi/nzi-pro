"""
Live report data routes for job dashboards.

This router composes the existing report helpers into a single payload that the
browser report page can render directly, including print-friendly charts.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
import time
import urllib.parse
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from api.auth import _current_user
from core.database import get_conn
from api.job_intensity_routes import _load_job_intensity_metrics
from api.job_report_routes import (
    ACTIVITY_GROUP_COLORS,
    ACTIVITY_GROUP_ORDER,
    _build_activity_grouping,
    _ensure_glossary_cards_and_fetch,
    _get_job_assigned_template_selection,
    _normalize_report_version_status,
    _safe_int,
    _serialize_report_version_row,
    _store_report_version_artifact,
    _resolve_benchmark_reference_job,
    get_benchmark_emissions,
    get_emissions_by_category,
    get_job_data,
    get_job_target_data,
    get_site_emissions_breakdowns,
    _get_template_variable_values_for_render,
    get_scope_totals,
)
from api.report_template_routes import (
    _get_job_report_metadata,
    _build_report_render_values,
)
from api.job_data_output_routes import (
    _load_data_output_rows,
    _build_scope_summary,
    _clean_label,
    _dataset_category_label,
)
from services.emissions_reporting import combined_row_metrics, load_combined_emissions_summary_rows
from services.monthly_emissions import JobMonthlyEmissionsResolver
from services.playwright_browser import ensure_playwright_browser
from services.report_actions import get_job_report_actions_payload

router = APIRouter()


def _safe_nzi_logo_src() -> str:
    """Return NZI logo data-URI without ever raising."""
    try:
        from api.job_report_routes import _get_nzi_logo_src
        return _get_nzi_logo_src()
    except Exception:
        return ""


def _coerce_float(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def _summarize_category(categories: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not categories:
        return None
    top = max(categories, key=lambda item: _coerce_float(item.get("emissions")))
    return {
        "category": str(top.get("category") or "Uncategorized"),
        "scope": str(top.get("scope") or ""),
        "emissions": _coerce_float(top.get("emissions")),
        "report_label": str(top.get("report_label") or ""),
        "data_source": str(top.get("data_source") or ""),
        "reference_label": str(top.get("reference_label") or ""),
    }


# ---------------------------------------------------------------------------
# Async PDF task store — avoids HTTP request timeouts on long renders.
# Tasks are held in memory (single-instance deployment). Cleaned up after 20 min.
# ---------------------------------------------------------------------------
_pdf_tasks: dict[str, dict] = {}
_pdf_tasks_lock = threading.Lock()

# Semaphore: only one Playwright/Chromium instance at a time.
# Chromium is memory-hungry; running two concurrently crashes Render's container.
_pdf_semaphore = threading.Semaphore(1)


def _cleanup_pdf_tasks() -> None:
    cutoff = time.time() - 1200  # 20 minutes
    with _pdf_tasks_lock:
        stale = [k for k, v in _pdf_tasks.items() if v.get("created_at", 0) < cutoff]
        for k in stale:
            del _pdf_tasks[k]


def _frontend_base_url(request: Request) -> str:
    explicit = str(os.getenv("FRONTEND_BASE_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    # Fall back to the API's own base URL only in local development.
    # In production (Render) the API and frontend are separate services, so
    # FRONTEND_BASE_URL *must* be set or the Playwright PDF will try to load
    # the API server instead of the Next.js app and produce a blank page.
    base = str(request.base_url).rstrip("/")
    if "render.com" in base or "onrender.com" in base:
        raise RuntimeError(
            "FRONTEND_BASE_URL environment variable is not set. "
            "Configure it to the Next.js app URL (e.g. https://your-app.onrender.com) "
            "so the live-report PDF can load the correct page."
        )
    return base


def _playwright_headers(request: Request) -> dict[str, str]:
    headers: dict[str, str] = {}
    cookie = str(request.headers.get("cookie") or "").strip()
    if cookie:
        headers["cookie"] = cookie
    authorization = str(request.headers.get("authorization") or "").strip()
    if authorization:
        headers["authorization"] = authorization
    x_user = str(request.headers.get("x-user") or "").strip()
    if x_user:
        headers["x-user"] = x_user
    x_user_email = str(request.headers.get("x-user-email") or "").strip()
    if x_user_email:
        headers["x-user-email"] = x_user_email
    return headers


def _coerce_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        return int(float(value))
    except Exception:
        return None


def _build_yearly_emissions(con, client_db_id: int) -> list[dict[str, Any]]:
    jobs_df = con.execute(
        """
        SELECT job_id,
               COALESCE(
                   EXTRACT(YEAR FROM reporting_period_end),
                   reporting_year
               ) AS dashboard_year,
               intensity_metrics
        FROM jobs
        WHERE client_db_id = %s
          AND (reporting_year IS NOT NULL OR reporting_period_end IS NOT NULL)
        ORDER BY COALESCE(reporting_year, EXTRACT(YEAR FROM reporting_period_end)) ASC, job_id ASC
        """,
        [int(client_db_id)],
    ).df()
    if jobs_df is None or getattr(jobs_df, "empty", True):
        return []

    # Deduplicate to one job per year (most recent by job_id) so multiple
    # jobs for the same dashboard_year don't double-count emissions.
    year_to_job_id: dict[int, int] = {}
    year_to_metrics: dict[int, Any] = {}
    for _, row in jobs_df.iterrows():
        yr = _coerce_int(row.get("dashboard_year"))
        if yr is None:
            continue
        jid = _coerce_int(row.get("job_id"))
        if jid is None:
            continue
        if yr not in year_to_job_id or jid > year_to_job_id[yr]:
            year_to_job_id[yr] = jid
            raw = row.get("intensity_metrics")
            year_to_metrics[yr] = raw

    job_ids = list(year_to_job_id.values())
    if not job_ids:
        return []

    # Build year → intensity_metrics from the already-deduplicated year_to_metrics map.
    year_metrics_map: dict[int, dict[str, Any]] = {}
    for yr, raw in year_to_metrics.items():
        if raw is None:
            continue
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                continue
        if isinstance(raw, dict) and raw:
            year_metrics_map[yr] = raw

    # Build per-year scope totals using the same path as the /scope-totals endpoint
    # (_load_data_output_rows + _build_scope_summary with combined_row_metrics) so all
    # charts show figures consistent with the Outputs / Data Entry view.
    yearly_emissions: list[dict[str, Any]] = []
    for yr, job_id in sorted(year_to_job_id.items()):
        try:
            resolver = JobMonthlyEmissionsResolver(con, int(job_id))
            data_df = _load_data_output_rows(con, int(job_id))
            if data_df is None or getattr(data_df, "empty", True):
                continue
            _, totals = _build_scope_summary(data_df, resolver)
        except Exception:
            continue
        s1 = round(float(totals.get("Scope 1") or 0.0), 2)
        s2 = round(float(totals.get("Scope 2") or 0.0), 2)
        s3 = round(float(totals.get("Scope 3") or 0.0), 2)
        total = s1 + s2 + s3
        entry: dict[str, Any] = {
            "year": int(yr),
            "scope1": s1,
            "scope2": s2,
            "scope3": s3,
            "total": total,
        }
        # Attach per-metric intensities using each year's own job basis.
        job_metrics = year_metrics_map.get(yr, {})
        intensity_by_metric: dict[str, float] = {}
        for key, metric in job_metrics.items():
            if not isinstance(metric, dict):
                continue
            basis = float(metric.get("value") or 0)
            divider = float(metric.get("divider") or 1)
            if basis > 0:
                intensity_by_metric[key] = round((total * divider) / basis, 3)
        if intensity_by_metric:
            entry["intensity_by_metric"] = intensity_by_metric
        yearly_emissions.append(entry)
    return yearly_emissions


@router.get("/jobs/{job_id}/yearly-emissions")
def get_job_yearly_emissions(job_id: int, _user: dict[str, str] = Depends(_current_user)) -> list[dict[str, Any]]:
    """Return yearly emissions history for all jobs belonging to this job's client."""
    job_data = get_job_data(int(job_id))
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")
    client_db_id = job_data.get("client_db_id")
    if not client_db_id:
        return []
    with get_conn() as con:
        return _build_yearly_emissions(con, int(client_db_id))


@router.get("/jobs/{job_id}/live-report-data")
def get_job_live_report_data(job_id: int, _user: dict[str, str] = Depends(_current_user)) -> dict[str, Any]:
    """Return the live report payload for the browser report page."""
    import traceback

    try:
        job_data = get_job_data(int(job_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"get_job_data failed: {exc}") from exc
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    # ── Parallel fetch of all independent data sources ────────────────────────
    _jid = int(job_id)
    _client_db_id = int(job_data.get("client_db_id") or 0)
    _benchmark_year = job_data.get("benchmark_year")
    # Derive effective benchmark year early (before parallel tasks) so
    # get_benchmark_emissions uses it. Falls back to benchmark_period_end year.
    _early_benchmark_year = _benchmark_year
    if _early_benchmark_year is None:
        _bm_pe_early = job_data.get("benchmark_period_end")
        if _bm_pe_early:
            try:
                _early_benchmark_year = int(str(_bm_pe_early)[:4])
            except Exception:
                pass

    scope_totals: dict[str, Any] = {}
    categories: list[dict[str, Any]] = []
    benchmark_totals: dict[str, Any] = {"Scope 1": 0, "Scope 2": 0, "Scope 3": 0, "Total": 0}
    intensity_metrics: dict[str, Any] = {}
    job_actions: dict[str, Any] = {}
    target_data: dict[str, Any] = {}
    report_metadata: dict[str, Any] = {}
    yearly_emissions: list[dict[str, Any]] = []
    template_selection: dict[str, Any] | None = None
    site_breakdowns: dict[str, Any] = {}

    def _fetch_scope_totals():
        return "scope_totals", get_scope_totals(_jid)

    def _fetch_categories():
        return "categories", get_emissions_by_category(_jid)

    def _fetch_benchmark_totals():
        return "benchmark_totals", get_benchmark_emissions(_jid, _early_benchmark_year)

    def _fetch_intensity_metrics():
        return "intensity_metrics", _load_job_intensity_metrics(_jid)

    def _fetch_job_actions():
        return "job_actions", get_job_report_actions_payload(_jid)

    def _fetch_target_data():
        return "target_data", get_job_target_data(_jid)

    def _fetch_report_metadata():
        return "report_metadata", _get_job_report_metadata(_jid)

    def _fetch_yearly_emissions():
        with get_conn() as con:
            return "yearly_emissions", _build_yearly_emissions(con, _client_db_id)

    def _fetch_template_selection():
        return "template_selection", _get_job_assigned_template_selection(_jid)

    def _fetch_site_breakdowns():
        return "site_breakdowns", get_site_emissions_breakdowns(_jid)

    _parallel_tasks = [
        _fetch_scope_totals,
        _fetch_categories,
        _fetch_benchmark_totals,
        _fetch_intensity_metrics,
        _fetch_job_actions,
        _fetch_target_data,
        _fetch_report_metadata,
        _fetch_yearly_emissions,
        _fetch_template_selection,
        _fetch_site_breakdowns,
    ]

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(fn): fn.__name__ for fn in _parallel_tasks}
        for future in as_completed(futures):
            try:
                key, value = future.result()
                if key == "scope_totals":
                    scope_totals = value
                elif key == "categories":
                    categories = value
                elif key == "benchmark_totals":
                    benchmark_totals = value
                elif key == "intensity_metrics":
                    intensity_metrics = value
                elif key == "job_actions":
                    job_actions = value
                elif key == "target_data":
                    target_data = value
                elif key == "report_metadata":
                    report_metadata = value
                elif key == "yearly_emissions":
                    yearly_emissions = value
                elif key == "template_selection":
                    template_selection = value
                elif key == "site_breakdowns":
                    site_breakdowns = value
            except Exception:
                pass  # each fetch has a safe default above

    if not scope_totals:
        try:
            scope_totals = get_scope_totals(_jid)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"get_scope_totals failed: {exc}") from exc
    if not categories:
        try:
            categories = get_emissions_by_category(_jid)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"get_emissions_by_category failed: {exc}") from exc
    if not report_metadata:
        try:
            report_metadata = _get_job_report_metadata(_jid)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"get_job_report_metadata failed: {exc}") from exc

    # ── Sequential: depends on results above ──────────────────────────────────

    # Resolve effective benchmark year: prefer explicit baseline_year, fall back
    # to the year of benchmark_period_end (which is always populated for CRP jobs).
    _effective_benchmark_year = _benchmark_year
    if _effective_benchmark_year is None:
        _bm_pe = job_data.get("benchmark_period_end")
        if _bm_pe:
            try:
                _effective_benchmark_year = int(str(_bm_pe)[:4])
            except Exception:
                pass

    benchmark_categories: list[dict[str, Any]] = []
    try:
        bm_job_id: int | None = None
        if _effective_benchmark_year is not None:
            # Find a job for the same client whose reporting period falls in the benchmark year.
            with get_conn() as _bm_con:
                _bm_row = _bm_con.execute(
                    """
                    SELECT job_id FROM jobs
                    WHERE client_db_id = %s
                      AND job_id <> %s
                      AND COALESCE(archived, FALSE) = FALSE
                      AND (
                        EXTRACT(YEAR FROM reporting_period_end)::int = %s
                        OR reporting_year = %s
                      )
                    ORDER BY COALESCE(is_benchmark, FALSE) DESC,
                             reporting_period_end DESC NULLS LAST,
                             job_id DESC
                    LIMIT 1
                    """,
                    [_client_db_id, _jid, _effective_benchmark_year, _effective_benchmark_year],
                ).fetchone()
            if _bm_row:
                bm_job_id = int(_bm_row[0])
        if bm_job_id is None:
            bm_job_id = _resolve_benchmark_reference_job(_jid, _effective_benchmark_year)
        if bm_job_id and bm_job_id != _jid:
            benchmark_categories = get_emissions_by_category(int(bm_job_id))
    except Exception:
        benchmark_categories = []

    # Load benchmark year intensity metrics (basis counts may differ from current year)
    benchmark_intensity_metrics: dict[str, Any] = {}
    if bm_job_id and bm_job_id != _jid:
        try:
            benchmark_intensity_metrics = _load_job_intensity_metrics(int(bm_job_id)) or {}
        except Exception:
            pass

    # Previous year (one year before the current reporting year)
    previous_year_categories: list[dict[str, Any]] = []
    previous_year_label: str = ""
    try:
        _re_end = job_data.get("reporting_period_end")
        _curr_year: int | None = None
        if _re_end:
            try:
                from datetime import date as _date_cls
                _curr_year = int(str(_re_end)[:4])
            except Exception:
                pass
        if _curr_year is None:
            _ry = job_data.get("reporting_year")
            _curr_year = int(_ry) if _ry else None
        if _curr_year:
            _prev_year = _curr_year - 1
            previous_year_label = str(_prev_year)
            # Exclude the benchmark job so previous year and benchmark are always different
            _bm_exclude = bm_job_id if bm_job_id else -1
            with get_conn() as _con:
                _prev_row = _con.execute(
                    """
                    SELECT j.job_id,
                           j.reporting_period_start,
                           j.reporting_period_end
                    FROM jobs j
                    WHERE j.client_db_id = %s
                      AND j.job_id NOT IN (%s, %s)
                      AND COALESCE(j.archived, FALSE) = FALSE
                      AND (
                        EXTRACT(YEAR FROM j.reporting_period_end)::int = %s
                        OR j.reporting_year = %s
                      )
                    ORDER BY j.reporting_period_end DESC NULLS LAST, j.job_id DESC
                    LIMIT 1
                    """,
                    [_client_db_id, _jid, _bm_exclude, _prev_year, _prev_year],
                ).fetchone()
            if _prev_row:
                previous_year_categories = get_emissions_by_category(int(_prev_row[0]))
                # Build a compact year label: "2024" or "2023–2024" for cross-year periods
                _ps = _prev_row[1]
                _pe = _prev_row[2]
                if _ps and _pe:
                    _ps_year = int(str(_ps)[:4])
                    _pe_year = int(str(_pe)[:4])
                    previous_year_label = f"{_ps_year}–{_pe_year}" if _ps_year != _pe_year else str(_pe_year)
                elif _pe:
                    previous_year_label = str(int(str(_pe)[:4]))
    except Exception:
        pass

    try:
        activity_groups, activity_totals, activity_details = _build_activity_grouping(categories)
    except Exception:
        activity_groups, activity_totals, activity_details = {}, {}, {}

    template_variables: dict[str, Any] = {}
    if template_selection and template_selection.get("template_id") is not None:
        try:
            template_variables = _get_template_variable_values_for_render(
                _jid,
                int(template_selection["template_id"]),
                int(template_selection["version_id"]) if template_selection.get("version_id") is not None else None,
            )
        except Exception:
            template_variables = {}

    glossary_cards: list[dict[str, Any]] = []
    try:
        glossary_cards = _ensure_glossary_cards_and_fetch(
            _jid,
            job_data,
            target_data.get("glossary_terms") if target_data else None,
        )
    except Exception:
        pass

    render_values: dict[str, Any] = {}
    try:
        render_values = _build_report_render_values(
            job_data=job_data,
            scope_totals=scope_totals,
            report_metadata=report_metadata or {},
            template_variables=template_variables,
        )
    except Exception:
        pass

    current_total = _coerce_float(scope_totals.get("Total"))
    benchmark_total = _coerce_float(benchmark_totals.get("Total"))
    delta_total = current_total - benchmark_total
    delta_pct = None
    if benchmark_total > 0:
        delta_pct = (delta_total / benchmark_total) * 100.0

    return {
        "job_data": job_data,
        "scope_totals": scope_totals,
        "benchmark_totals": benchmark_totals,
        "categories": categories,
        "benchmark_categories": benchmark_categories,
        "previous_year_categories": previous_year_categories,
        "previous_year_label": previous_year_label,
        "activity_groups": activity_groups,
        "activity_totals": activity_totals,
        "activity_details": activity_details,
        "activity_group_order": ACTIVITY_GROUP_ORDER,
        "activity_group_colors": ACTIVITY_GROUP_COLORS,
        "job_actions": job_actions,
        "intensity_metrics": intensity_metrics,
        "benchmark_intensity_metrics": benchmark_intensity_metrics,
        "yearly_emissions": yearly_emissions,
        "target_data": target_data,
        "report_metadata": report_metadata,
        "template_variables": template_variables,
        "site_breakdowns": site_breakdowns,
        "glossary_cards": glossary_cards,
        "render_values": render_values,
        "nzi_logo_src": _safe_nzi_logo_src(),
        "summary": {
            "current_total": current_total,
            "benchmark_total": benchmark_total,
            "delta_total": delta_total,
            "delta_pct": delta_pct,
            "top_category": _summarize_category(categories),
        },
    }


def _extract_bearer_token(request: Request) -> str:
    """Return the raw JWT from the Authorization header, or empty string."""
    auth = str(request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def _wait_for_widget_pngs_ready(page, timeout_ms: int = 30000) -> None:
    """Wait until the report page has fetched stored widget PNGs."""
    page.wait_for_function(
        """() => {
            const root = document.querySelector('[data-report-ready="1"]');
            return Boolean(root && root.getAttribute('data-widget-pngs-ready') === '1');
        }""",
        timeout=timeout_ms,
    )


def _render_live_report_pdf_bytes(
    job_id: int,
    bearer: str,
    frontend_base: str,
    extra_headers: dict[str, str],
) -> bytes:
    from playwright.sync_api import sync_playwright

    # Target the Advanced Reports page. Playwright renders live Recharts charts
    # directly — no stored PNG capture step is required before generating a PDF.
    # Pass the bearer token as a query param so in-page fetch calls are authenticated.
    report_url = (
        f"{frontend_base}/jobs/{int(job_id)}/advanced-reports"
        f"?print=1&pdf_token={urllib.parse.quote(bearer)}"
        if bearer
        else f"{frontend_base}/jobs/{int(job_id)}/advanced-reports?print=1"
    )

    ensure_playwright_browser()
    with sync_playwright() as p:
        browser = p.chromium.launch(args=[
            # --disable-dev-shm-usage is critical in Linux containers: Chromium
            # writes to /dev/shm by default, which is only ~64 MB in most container
            # runtimes.  This redirects shared memory to /tmp (no size limit).
            "--disable-dev-shm-usage",
            # No setuid sandbox in typical container environments.
            "--no-sandbox",
            "--disable-setuid-sandbox",
            # No GPU in headless containers — avoids GPU process memory overhead.
            "--disable-gpu",
            # Run renderer in the browser process (no separate renderer process).
            # Saves ~150-200 MB on constrained container instances; acceptable
            # for a single-page PDF render with no concurrent tabs.
            "--single-process",
            # Reduce idle-process and background overhead.
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-breakpad",
            "--disable-default-apps",
            "--disable-hang-monitor",
            "--disable-sync",
            "--metrics-recording-only",
            "--no-first-run",
            "--safebrowsing-disable-auto-update",
        ])
        context = browser.new_context(
            # 700px wide = A4 content width so Recharts measures correctly.
            # Height 2200px keeps all charts in the rendered layout tree so
            # Recharts SVG label positions are calculated correctly; reducing
            # this causes LabelList and other positioned SVG elements to
            # miscalculate and disappear in the rendered PDF.
            viewport={"width": 700, "height": 2200},
            extra_http_headers=extra_headers,
        )
        # Inject the JWT as the nzi_token cookie so the auth-client.ts global
        # fetch interceptor (which reads this cookie name) includes Authorization
        # headers on all in-page API calls — Playwright's browser has no cookie jar.
        if bearer:
            hostname = urllib.parse.urlparse(frontend_base).hostname or "localhost"
            context.add_cookies([{
                "name": "nzi_token",
                "value": bearer,
                "domain": hostname,
                "path": "/",
            }])
        _PDF_STYLES = (
            # Kill all CSS animations/transitions so charts render to their final
            # state immediately — no waiting for Recharts bar/line transitions.
            "*, *::before, *::after {"
            "  animation-duration: 0.001s !important;"
            "  animation-delay: 0s !important;"
            "  transition-duration: 0.001s !important;"
            "  transition-delay: 0s !important;"
            "}"
            # Strip card borders/shadows from widget cards — not needed in print.
            "[data-widget-key] {"
            "  border: none !important;"
            "  box-shadow: none !important;"
            "  border-radius: 0 !important;"
            "}"
            # Remove horizontal padding and compact vertical padding on all card
            # children (CardHeader & CardContent) inside section/widget cards so
            # charts fill the full PDF page width and whitespace is minimised.
            "[data-section] > div,"
            "[data-widget-key] > div {"
            "  padding-left: 0 !important;"
            "  padding-right: 0 !important;"
            "  padding-top: 8px !important;"
            "  padding-bottom: 8px !important;"
            "}"
            # Compact space-y-* utility margins throughout the report so sections
            # and nested items are tighter in the PDF.
            ".space-y-6 > :not([hidden]) ~ :not([hidden]) {"
            "  margin-top: 12px !important;"
            "}"
            ".space-y-5 > :not([hidden]) ~ :not([hidden]) {"
            "  margin-top: 10px !important;"
            "}"
            ".space-y-4 > :not([hidden]) ~ :not([hidden]) {"
            "  margin-top: 8px !important;"
            "}"
            # Force donut centre number to large size regardless of whatever
            # print-media CSS Chromium applies that silently caps inline font-size.
            "[data-donut-center] > span:first-child {"
            "  font-size: 36px !important;"
            "  font-weight: 700 !important;"
            "  line-height: 1 !important;"
            "}"
            # Keep Declaration and Sign Off on the same page as Standards & Methodology.
            # Tailwind's break-before-avoid alone is overridden by Chromium's layout engine;
            # both legacy and modern properties with !important are needed.
            "[data-section='Declaration and Sign Off'] {"
            "  break-before: avoid !important;"
            "  page-break-before: avoid !important;"
            "}"
        )

        try:
            t0 = time.time()
            page = context.new_page()
            # Cap every Playwright operation at 60s so a frozen Chromium can never
            # hold the semaphore indefinitely and block all subsequent PDF requests.
            page.set_default_timeout(60000)

            # Inject animation-kill + border-removal CSS immediately via
            # an init script so it is active from the very first paint —
            # charts that load data later will never animate.
            page.add_init_script(
                f"document.addEventListener('DOMContentLoaded', () => {{"
                f"  const s = document.createElement('style');"
                f"  s.textContent = {repr(_PDF_STYLES)};"
                f"  document.head.appendChild(s);"
                f"}});"
            )

            page.goto(report_url, wait_until="domcontentloaded", timeout=30000)
            print(f"[PDF] job={job_id} domcontentloaded in {time.time()-t0:.1f}s", file=sys.stderr, flush=True)

            # networkidle: wait until all in-page API fetches (chart data, scope
            # totals, historical emissions, etc.) have completed — no new network
            # requests for 500 ms.  This is the most accurate signal that every
            # chart has its data and can render.  Timeout is generous because
            # Render cold-starts can be slow.
            try:
                page.wait_for_load_state("networkidle", timeout=90000)
                print(f"[PDF] job={job_id} networkidle in {time.time()-t0:.1f}s", file=sys.stderr, flush=True)
            except Exception:
                print(f"[PDF] job={job_id} networkidle timed out at {time.time()-t0:.1f}s — proceeding", file=sys.stderr, flush=True)

            # Re-inject styles via add_style_tag in case init_script missed the window.
            page.add_style_tag(content=_PDF_STYLES)

            # Scroll each section into view quickly to trigger any
            # intersection-observer-gated renders.
            page.evaluate("""
                async () => {
                    const delay = ms => new Promise(r => setTimeout(r, ms));
                    const sections = document.querySelectorAll('.live-report-section');
                    for (const section of sections) {
                        section.scrollIntoView();
                        await delay(50);
                    }
                    window.scrollTo(0, 0);
                }
            """)

            # Short settle so rAF-based repaints complete.
            page.wait_for_timeout(600)
            print(f"[PDF] job={job_id} pre-print ready in {time.time()-t0:.1f}s", file=sys.stderr, flush=True)

            # Apply print media so measurements reflect the actual print layout.
            page.emulate_media(media="print")

            # ROOT CAUSE FIX: overflow-x-hidden silently promotes overflow-y to
            # auto, creating a scroll container that clips Chrome's print output.
            page.evaluate("""
                () => {
                    document.querySelectorAll('.overflow-x-hidden').forEach(el => {
                        el.style.setProperty('overflow', 'visible', 'important');
                    });
                    document.querySelectorAll('.min-h-screen').forEach(el => {
                        el.style.setProperty('min-height', '0', 'important');
                        el.style.setProperty('height', 'auto', 'important');
                    });
                }
            """)

            page.wait_for_timeout(500)
            print(f"[PDF] job={job_id} calling page.pdf()", file=sys.stderr, flush=True)

            # page.pdf() has no internal timeout in Playwright Python —
            # set_default_timeout does not reach the underlying CDP send call, so
            # page.pdf() can hang indefinitely if Chromium stops responding.
            # Force a hard 3-minute limit via threading.Timer: closing the browser
            # from a side thread interrupts the pending CDP call with a
            # "Browser was disconnected" error so the semaphore is always released.
            _pdf_timed_out = threading.Event()

            def _kill_browser():
                _pdf_timed_out.set()
                print(f"[PDF] job={job_id} 3-min PDF timeout — force-closing browser", file=sys.stderr, flush=True)
                try:
                    browser.close()
                except Exception:
                    pass

            _kill_timer = threading.Timer(180, _kill_browser)
            _kill_timer.start()
            try:
                return page.pdf(
                    format="A4",
                    print_background=True,
                    margin={
                        "top": "10mm",
                        "right": "10mm",
                        "bottom": "10mm",
                        "left": "10mm",
                    },
                )
            except Exception as exc:
                if _pdf_timed_out.is_set():
                    raise RuntimeError(
                        "PDF rendering timed out after 3 minutes. Please try again."
                    ) from exc
                raise
            finally:
                _kill_timer.cancel()
        finally:
            print(f"[PDF] job={job_id} total {time.time()-t0:.1f}s", file=sys.stderr, flush=True)
            try:
                context.close()
            except Exception:
                pass
            try:
                browser.close()
            except Exception:
                pass


def _extract_pdf_request_parts(request: Request) -> tuple[str, str, dict[str, str]]:
    """Extract bearer token, frontend base URL, and extra headers from a request."""
    bearer = _extract_bearer_token(request)
    frontend_base = _frontend_base_url(request)
    extra_headers: dict[str, str] = {}
    for name in ("x-user", "x-user-email"):
        val = str(request.headers.get(name) or "").strip()
        if val:
            extra_headers[name] = val
    return bearer, frontend_base, extra_headers


@router.get("/jobs/{job_id}/report-live-pdf")
def get_job_live_report_pdf(
    job_id: int,
    request: Request,
    _user: dict[str, str] = Depends(_current_user),
) -> Response:
    job_data = get_job_data(int(job_id))
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    bearer, frontend_base, extra_headers = _extract_pdf_request_parts(request)
    try:
        pdf_bytes = _render_live_report_pdf_bytes(int(job_id), bearer, frontend_base, extra_headers)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to render live report PDF: {exc}") from exc

    job_number = str(job_data.get("job_number") or f"job-{job_id}").strip() or f"job-{job_id}"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{job_number}-live-report.pdf"',
            "Cache-Control": "no-store",
        },
    )


# ─── Async PDF generation (avoids HTTP request-timeout on long renders) ──────


@router.post("/jobs/{job_id}/report-live-pdf/generate")
def start_pdf_generation(
    job_id: int,
    request: Request,
    _user: dict[str, str] = Depends(_current_user),
) -> dict:
    """Start background PDF generation. Returns a task_id to poll for status."""
    job_data = get_job_data(int(job_id))
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    _cleanup_pdf_tasks()

    # Extract request parts now — Request object must not be used across threads.
    bearer, frontend_base, extra_headers = _extract_pdf_request_parts(request)
    job_number = str(job_data.get("job_number") or f"job-{job_id}").strip() or f"job-{job_id}"
    task_id = str(uuid.uuid4())

    with _pdf_tasks_lock:
        _pdf_tasks[task_id] = {
            "job_id": int(job_id),
            "status": "pending",
            "created_at": time.time(),
            "job_number": job_number,
        }

    def _run():
        # Acquire the global semaphore — only one Playwright/Chromium instance
        # may run at a time.  Other tasks stay "pending" until it is released.
        acquired = _pdf_semaphore.acquire(timeout=600)  # 10-min queue wait max
        if not acquired:
            with _pdf_tasks_lock:
                _pdf_tasks[task_id]["status"] = "error"
                _pdf_tasks[task_id]["error"] = "PDF generation queue timed out. Please try again."
            return
        try:
            pdf_bytes = _render_live_report_pdf_bytes(int(job_id), bearer, frontend_base, extra_headers)
            with _pdf_tasks_lock:
                _pdf_tasks[task_id]["status"] = "complete"
                _pdf_tasks[task_id]["pdf_bytes"] = pdf_bytes
        except Exception as exc:
            print(f"[PDF TASK {task_id}] error: {exc}", file=sys.stderr, flush=True)
            with _pdf_tasks_lock:
                _pdf_tasks[task_id]["status"] = "error"
                _pdf_tasks[task_id]["error"] = str(exc)
        finally:
            _pdf_semaphore.release()

    threading.Thread(target=_run, daemon=True).start()
    return {"task_id": task_id}


@router.get("/jobs/{job_id}/report-live-pdf/status/{task_id}")
def get_pdf_task_status(
    job_id: int,
    task_id: str,
    _user: dict[str, str] = Depends(_current_user),
) -> dict:
    with _pdf_tasks_lock:
        task = dict(_pdf_tasks.get(task_id, {}))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("job_id") != int(job_id):
        raise HTTPException(status_code=403, detail="Task does not belong to this job")
    return {
        "status": task.get("status", "unknown"),
        "error": task.get("error"),
    }


@router.get("/jobs/{job_id}/report-live-pdf/download/{task_id}")
def download_pdf_task(
    job_id: int,
    task_id: str,
    _user: dict[str, str] = Depends(_current_user),
) -> Response:
    with _pdf_tasks_lock:
        task = dict(_pdf_tasks.get(task_id, {}))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("job_id") != int(job_id):
        raise HTTPException(status_code=403, detail="Task does not belong to this job")
    if task.get("status") != "complete":
        raise HTTPException(status_code=409, detail="PDF not yet ready")
    pdf_bytes: bytes = task["pdf_bytes"]
    job_number = task.get("job_number", f"job-{job_id}")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{job_number}-live-report.pdf"',
            "Cache-Control": "no-store",
        },
    )


# ─── Versioned React report generation ───────────────────────────────────────


def _load_latest_final_react_version(con, job_id: int) -> dict[str, Any] | None:
    """Return the latest finalized React-format report version row, or None."""
    row = con.execute(
        """
        SELECT *
        FROM job_report_versions
        WHERE job_id = %s
          AND lower(COALESCE(report_format, '')) = 'react'
          AND lower(COALESCE(status, '')) = 'final'
        ORDER BY COALESCE(finalized_at, generated_at) DESC NULLS LAST,
                 version_number DESC, report_version_id DESC
        LIMIT 1
        """,
        [int(job_id)],
    ).fetchone()
    return dict(row._mapping) if row is not None else None


def _build_react_snapshot(live_payload: dict[str, Any]) -> tuple[str, str]:
    """Serialise a live-report-data payload to deterministic JSON and return (json, sha256)."""
    snapshot_json = json.dumps(live_payload, ensure_ascii=False, sort_keys=True, default=str)
    data_hash = hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()
    return snapshot_json, data_hash


def _load_file_bytes_local(file_path: str | None) -> bytes | None:
    if not file_path:
        return None
    try:
        import pathlib
        p = pathlib.Path(file_path)
        return p.read_bytes() if p.exists() else None
    except Exception:
        return None


@router.post("/jobs/{job_id}/generate-report-react")
def generate_job_report_react(
    job_id: int,
    request: Request,
    save_version: bool = Query(default=True),
    report_version_status: str = Query(default="review"),
    version_label: str | None = Query(default=None),
    notes: str | None = Query(default=None),
    _user: dict[str, str] = Depends(_current_user),
) -> Response:
    """Render the React/Playwright advanced report and optionally save a version."""
    job_data = get_job_data(int(job_id))
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    job_number = str(job_data.get("job_number") or f"job-{job_id}").strip() or f"job-{job_id}"

    # Frozen-final short-circuit — only when not explicitly saving a new version
    if not save_version:
        with get_conn() as con:
            frozen = _load_latest_final_react_version(con, int(job_id))
            if frozen:
                file_path = frozen.get("file_path")
                pdf_bytes = _load_file_bytes_local(file_path)
                if pdf_bytes:
                    vnum = frozen.get("version_number", "")
                    return Response(
                        content=pdf_bytes,
                        media_type="application/pdf",
                        headers={
                            "Content-Disposition": f'attachment; filename="{job_number}-advanced-v{vnum}.pdf"',
                            "Cache-Control": "no-store",
                            "X-Report-Version-Id": str(frozen.get("report_version_id") or ""),
                            "X-Report-Version-Number": str(vnum),
                            "X-Report-Status": str(frozen.get("status") or ""),
                            "X-Report-Frozen": "1",
                        },
                    )
        # Fall through to fresh render if bytes unavailable

    # Render PDF via Playwright
    try:
        bearer, frontend_base, extra_headers = _extract_pdf_request_parts(request)
        pdf_bytes = _render_live_report_pdf_bytes(int(job_id), bearer, frontend_base, extra_headers)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to render advanced report PDF: {exc}") from exc

    if not save_version:
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{job_number}-advanced.pdf"',
                "Cache-Control": "no-store",
            },
        )

    # Build snapshot from live data
    generated_by = str(_user.get("email") or _user.get("username") or "system")
    status = _normalize_report_version_status(report_version_status)
    generation_date = datetime.now(timezone.utc).date().isoformat()

    scope_totals = get_scope_totals(int(job_id))
    categories = get_emissions_by_category(int(job_id))
    benchmark_totals = get_benchmark_emissions(int(job_id), job_data.get("benchmark_year"))
    template_selection = _get_job_assigned_template_selection(int(job_id))
    template_variables: dict[str, Any] = {}
    if template_selection and template_selection.get("template_id") is not None:
        try:
            template_variables = _get_template_variable_values_for_render(
                int(job_id),
                int(template_selection["template_id"]),
                int(template_selection["version_id"]) if template_selection.get("version_id") is not None else None,
            )
        except Exception:
            pass

    site_breakdowns: dict[str, Any] = {}
    try:
        site_breakdowns = get_site_emissions_breakdowns(int(job_id))
    except Exception:
        pass

    with get_conn() as con:
        report_metadata = _get_job_report_metadata(int(job_id)) or {}

        snapshot_payload: dict[str, Any] = {
            "job_data": job_data,
            "scope_totals": scope_totals,
            "benchmark_totals": benchmark_totals,
            "categories": categories,
            "template_variables": template_variables,
            "report_metadata": report_metadata,
            "site_breakdowns": site_breakdowns,
            "generation_date": generation_date,
            "renderer": "react",
        }
        snapshot_json, data_hash = _build_react_snapshot(snapshot_payload)

        next_v_row = con.execute(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM job_report_versions WHERE job_id = %s",
            [int(job_id)],
        ).fetchone()
        version_number = int(next_v_row[0]) if next_v_row else 1

        artifact = _store_report_version_artifact(
            con=con,
            job_data=job_data,
            version_number=version_number,
            pdf_bytes=pdf_bytes,
            generated_by=generated_by,
            status=status,
            template_id=int(template_selection["template_id"]) if template_selection and template_selection.get("template_id") is not None else None,
            template_version_id=int(template_selection["version_id"]) if template_selection and template_selection.get("version_id") is not None else None,
            data_hash=data_hash,
            snapshot_json=snapshot_json,
            version_label=version_label,
            notes=notes,
            report_format="react",
        )

    vnum = artifact.get("version_number", version_number)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{job_number}-advanced-v{vnum}.pdf"',
            "Cache-Control": "no-store",
            "X-Report-Version-Id": str(artifact.get("report_version_id") or ""),
            "X-Report-Version-Number": str(vnum),
            "X-Report-Data-Hash": data_hash,
            "X-Report-Status": status,
            "X-Report-File-Id": str(artifact.get("file_id") or ""),
        },
    )


@router.get("/jobs/{job_id}/react-report-versions")
def list_react_report_versions(
    job_id: int,
    _user: dict[str, str] = Depends(_current_user),
) -> dict[str, Any]:
    """List all React-format report versions for a job, newest first."""
    import traceback
    try:
        with get_conn() as con:
            rows = con.execute(
                """
                SELECT
                    report_version_id, job_id, client_db_id, version_number,
                    version_label, status, report_format, template_id, version_id,
                    file_id, file_name, file_path, storage_provider,
                    external_item_id, external_web_url, external_path,
                    data_hash, notes, generated_at, generated_by,
                    reviewed_at, reviewed_by, finalized_at, finalized_by,
                    superseded_at, superseded_by
                FROM job_report_versions
                WHERE job_id = %s
                  AND lower(COALESCE(report_format, '')) = 'react'
                ORDER BY version_number DESC, report_version_id DESC
                """,
                [int(job_id)],
            ).df()
        versions: list[dict[str, Any]] = []
        if rows is not None and not rows.empty:
            for _, row in rows.iterrows():
                versions.append(_serialize_report_version_row(dict(row)))
        return {"versions": versions, "total": len(versions)}
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        logger.warning("Failed to list react report versions for job %s: %s", job_id, exc, exc_info=True)
        return {"versions": [], "total": 0, "warning": "Version history is temporarily unavailable."}


def compare_canonical_vs_report(
    canonical_rows: dict[str, dict[str, Any]],
    canonical_cats: dict[str, float],
    canonical_scopes: dict[str, float],
    report_rows: dict[str, dict[str, Any]],
    report_cats: dict[str, float],
    tolerance: float = 0.05,
) -> dict[str, Any]:
    """
    Pure comparison function: given pre-built canonical and report dicts,
    returns a structured diff result.

    Extracted from the route so it can be unit-tested without a real DB connection.
    Both input dicts are built by the route (and by tests using stub data).
    """
    issues: list[dict[str, Any]] = []

    report_scopes: dict[str, float] = {}
    for k, v in report_cats.items():
        s = k.split("||")[0]
        report_scopes[s] = round(report_scopes.get(s, 0.0) + v, 4)

    for scope_key in ["Scope 1", "Scope 2", "Scope 3"]:
        c = round(canonical_scopes.get(scope_key, 0.0), 2)
        r = round(report_scopes.get(scope_key, 0.0), 2)
        if abs(c - r) > tolerance:
            issues.append({"level": "scope", "label": scope_key, "canonical": c, "report": r, "diff": round(abs(c - r), 2)})

    for cat_key in sorted(set(canonical_cats) | set(report_cats)):
        c = round(canonical_cats.get(cat_key, 0.0), 2)
        r = round(report_cats.get(cat_key, 0.0), 2)
        if abs(c - r) > tolerance:
            scope_label, category = cat_key.split("||", 1)
            issues.append({"level": "category", "label": f"{scope_label} — {category}", "canonical": c, "report": r, "diff": round(abs(c - r), 2)})

    for row_id in sorted(set(canonical_rows) | set(report_rows)):
        canon = canonical_rows.get(row_id)
        report = report_rows.get(row_id)
        if canon and report:
            if abs(canon["emission"] - report["emission"]) > tolerance:
                issues.append({
                    "level": "row",
                    "label": f"{canon['scope']} — {canon['category']} — {canon['label']}",
                    "canonical": canon["emission"],
                    "report": report["emission"],
                    "diff": round(abs(canon["emission"] - report["emission"]), 2),
                })
        elif canon and canon["emission"] > tolerance:
            issues.append({
                "level": "row",
                "label": f"MISSING from Report — {canon['scope']} — {canon['label']}",
                "canonical": canon["emission"], "report": 0.0, "diff": canon["emission"],
            })
        elif report and report["emission"] > tolerance:
            issues.append({
                "level": "row",
                "label": f"EXTRA in Report — {report['scope']} — {report['label']}",
                "canonical": 0.0, "report": report["emission"], "diff": report["emission"],
            })

    canonical_total = round(canonical_total_precise, 2)
    report_total = round(sum(report_cats.values()), 2)

    return {
        "status": "pass" if not issues else "fail",
        "canonical_total": canonical_total,
        "report_total": report_total,
        "issue_count": len(issues),
        "scope_issues": sum(1 for i in issues if i["level"] == "scope"),
        "category_issues": sum(1 for i in issues if i["level"] == "category"),
        "row_issues": sum(1 for i in issues if i["level"] == "row"),
        "issues": issues,
    }


@router.get("/jobs/{job_id}/report-data-check")
def check_report_data_integrity(
    job_id: int,
    _user: dict[str, str] = Depends(_current_user),
) -> dict[str, Any]:
    """
    Comprehensive data integrity check: compares every emissions figure that
    appears in Report Printing against the canonical Outputs calculation path
    at scope, category, and individual row level.

    Returns status "pass" when all figures agree within 0.05 tCO2e, or
    "fail" with a structured list of discrepancies.
    """
    # ── Canonical: Outputs path ──────────────────────────────────────────────
    with get_conn() as con:
        resolver = JobMonthlyEmissionsResolver(con, int(job_id))
        data_df = _load_data_output_rows(con, int(job_id))

        if data_df is None or getattr(data_df, "empty", True):
            return {"status": "no_data", "issues": [], "canonical_total": 0.0, "report_total": 0.0}

        canonical_rows: dict[str, dict[str, Any]] = {}
        canonical_cats: dict[str, float] = {}
        canonical_scopes: dict[str, float] = {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0}
        canonical_total_precise: float = 0.0

        for _, row in data_df.iterrows():
            try:
                metrics = combined_row_metrics(row, resolver)
                emission_precise = float(metrics.get("calc_tco2e") or 0.0)
                emission = round(emission_precise, 2)
            except Exception:
                continue
            scope = _clean_label(row.get("scope"), "Unknown")
            category = _dataset_category_label(row)
            row_id = str(row.get("original_id") or "")
            label = str(row.get("report_label") or category)

            canonical_total_precise += emission_precise
            if row_id:
                canonical_rows[row_id] = {"scope": scope, "category": category, "label": label, "emission": emission}
            cat_key = f"{scope}||{category}"
            canonical_cats[cat_key] = round(canonical_cats.get(cat_key, 0.0) + emission, 4)
            if scope in canonical_scopes:
                canonical_scopes[scope] = round(canonical_scopes[scope] + emission, 4)

    # ── Report Printing path ─────────────────────────────────────────────────
    report_cats_list = get_emissions_by_category(int(job_id))
    report_rows: dict[str, dict[str, Any]] = {}
    report_cats: dict[str, float] = {}

    for item in report_cats_list:
        scope = str(item.get("scope") or "Unknown")
        category = str(item.get("category") or "Uncategorized")
        emission = round(float(item.get("emissions") or 0.0), 2)
        row_id = str(item.get("original_id") or "")
        label = str(item.get("report_label") or category)

        if row_id:
            report_rows[row_id] = {"scope": scope, "category": category, "label": label, "emission": emission}
        cat_key = f"{scope}||{category}"
        report_cats[cat_key] = round(report_cats.get(cat_key, 0.0) + emission, 4)

    return compare_canonical_vs_report(
        canonical_rows, canonical_cats, canonical_scopes,
        report_rows, report_cats,
    )
