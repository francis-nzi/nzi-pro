"""
Live report data routes for job dashboards.

This router composes the existing report helpers into a single payload that the
browser report page can render directly, including print-friendly charts.
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.parse
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
from services.emissions_reporting import load_combined_emissions_summary_rows
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
        SELECT job_id
        FROM jobs
        WHERE client_db_id = %s
          AND (reporting_year IS NOT NULL OR reporting_period_end IS NOT NULL)
        ORDER BY COALESCE(reporting_year, EXTRACT(YEAR FROM reporting_period_end)) ASC, job_id ASC
        """,
        [int(client_db_id)],
    ).df()
    if jobs_df is None or getattr(jobs_df, "empty", True):
        return []

    job_ids = [int(job_id) for job_id in jobs_df["job_id"].tolist() if _coerce_int(job_id) is not None]
    if not job_ids:
        return []

    emissions_df = load_combined_emissions_summary_rows(con, job_ids)
    if emissions_df is None or getattr(emissions_df, "empty", True):
        return []

    if "dashboard_year" not in emissions_df.columns:
        return []

    emissions_df = emissions_df.copy()
    emissions_df["dashboard_year_norm"] = emissions_df["dashboard_year"].apply(_coerce_int)
    emissions_df = emissions_df[emissions_df["dashboard_year_norm"].notna()]
    if emissions_df.empty:
        return []

    grouped = emissions_df.groupby(["dashboard_year_norm", "scope"])["emissions"].sum().reset_index()
    years = sorted({int(year) for year in emissions_df["dashboard_year_norm"].tolist() if _coerce_int(year) is not None})
    yearly_emissions: list[dict[str, Any]] = []
    for year in years:
        year_rows = grouped[grouped["dashboard_year_norm"] == year]
        yearly_emissions.append(
            {
                "year": int(year),
                "scope1": float(year_rows[year_rows["scope"] == "Scope 1"]["emissions"].sum()),
                "scope2": float(year_rows[year_rows["scope"] == "Scope 2"]["emissions"].sum()),
                "scope3": float(year_rows[year_rows["scope"] == "Scope 3"]["emissions"].sum()),
                "total": float(year_rows["emissions"].sum()),
            }
        )
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
        return "benchmark_totals", get_benchmark_emissions(_jid, _benchmark_year)

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


def _render_live_report_pdf_bytes(job_id: int, request: Request) -> bytes:
    from playwright.sync_api import sync_playwright

    frontend_base = _frontend_base_url(request)
    bearer = _extract_bearer_token(request)
    # Target the Advanced Reports page directly so the PDF matches the UI.
    # Pass the bearer token as a query param so the in-page fetch calls
    # can include it — the /api/backend proxy forwards Authorization to the API.
    _png_param = "&use_widget_pngs=1"
    report_url = (
        f"{frontend_base}/jobs/{int(job_id)}/advanced-reports"
        f"?print=1{_png_param}&pdf_token={urllib.parse.quote(bearer)}"
        if bearer
        else f"{frontend_base}/jobs/{int(job_id)}/advanced-reports?print=1{_png_param}"
    )

    # Non-cookie headers to pass to all requests Playwright makes itself.
    extra_headers: dict[str, str] = {}
    for name in ("x-user", "x-user-email"):
        val = str(request.headers.get(name) or "").strip()
        if val:
            extra_headers[name] = val

    ensure_playwright_browser()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            # Start at the target A4 content width so Recharts measures correctly
            # from the first render — no later viewport resize needed.
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
        try:
            import sys
            page = context.new_page()
            page.goto(report_url, wait_until="domcontentloaded", timeout=30000)
            page.locator('[data-report-ready="1"]').wait_for(state="visible", timeout=90000)
            page.locator('[data-widget-pngs-ready="1"]').wait_for(state="visible", timeout=90000)

            # Scroll each section into view to trigger any observer-based renders.
            page.evaluate("""
                async () => {
                    const delay = ms => new Promise(r => setTimeout(r, ms));
                    const sections = document.querySelectorAll('.live-report-section');
                    for (const section of sections) {
                        section.scrollIntoView();
                        await delay(150);
                    }
                    window.scrollTo(0, 0);
                }
            """)

            # Wait until at least 11 sections are present (cover + 2..10 + 12 + 13).
            try:
                page.wait_for_function(
                    "() => document.querySelectorAll('.live-report-section').length >= 11",
                    timeout=30000,
                )
            except Exception:
                pass
            # Apply print media so measurements reflect the actual print layout.
            page.emulate_media(media="print")

            # --- Diagnostic: container scroll heights (confirm scroll-clip theory) ---
            container_info = page.evaluate("""
                () => {
                    const w = document.querySelector('.overflow-x-hidden');
                    const p = document.querySelector('.advanced-report-preview');
                    return [
                        'wrapper:' + (w ? w.clientHeight+'c/'+w.scrollHeight+'s' : 'none'),
                        'preview:' + (p ? p.clientHeight+'c/'+p.scrollHeight+'s' : 'none'),
                        'body:' + document.body.clientHeight+'c/'+document.body.scrollHeight+'s',
                    ].join(' | ');
                }
            """)
            print(f"[PDF CONTAINERS] job={job_id} {container_info}", file=sys.stderr, flush=True)

            # ROOT CAUSE FIX: The layout wrapper has `overflow-x-hidden` which the
            # CSS spec silently promotes overflow-y to `auto`, creating a scroll
            # container.  Chrome's print engine clips output at the scroll container's
            # scrollHeight — so pages beyond that cutoff never generate.
            # Removing all overflow constraints forces Chrome to print the full document.
            page.evaluate("""
                () => {
                    // Main content wrapper (overflow-x-hidden → scroll container)
                    document.querySelectorAll('.overflow-x-hidden').forEach(el => {
                        el.style.setProperty('overflow', 'visible', 'important');
                    });
                    // Root flex shell (min-h-screen constrains flex children)
                    document.querySelectorAll('.min-h-screen').forEach(el => {
                        el.style.setProperty('min-height', '0', 'important');
                        el.style.setProperty('height', 'auto', 'important');
                    });
                }
            """)

            page.wait_for_timeout(2000)

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
        finally:
            context.close()
            browser.close()


@router.get("/jobs/{job_id}/report-live-pdf")
def get_job_live_report_pdf(
    job_id: int,
    request: Request,
    _user: dict[str, str] = Depends(_current_user),
) -> Response:
    job_data = get_job_data(int(job_id))
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        pdf_bytes = _render_live_report_pdf_bytes(int(job_id), request)
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
        pdf_bytes = _render_live_report_pdf_bytes(int(job_id), request)
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
