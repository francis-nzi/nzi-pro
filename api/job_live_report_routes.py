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
          AND reporting_year IS NOT NULL
        ORDER BY reporting_year ASC, job_id ASC
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


@router.get("/jobs/{job_id}/live-report-data")
def get_job_live_report_data(job_id: int, _user: dict[str, str] = Depends(_current_user)) -> dict[str, Any]:
    """Return the live report payload for the browser report page."""
    job_data = get_job_data(int(job_id))
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    scope_totals = get_scope_totals(int(job_id))
    categories = get_emissions_by_category(int(job_id))
    benchmark_totals = get_benchmark_emissions(int(job_id), job_data.get("benchmark_year"))
    activity_groups, activity_totals, activity_details = _build_activity_grouping(categories)
    intensity_metrics = _load_job_intensity_metrics(int(job_id))
    job_actions = get_job_report_actions_payload(int(job_id))
    target_data = get_job_target_data(int(job_id))
    report_metadata = _get_job_report_metadata(int(job_id))
    with get_conn() as con:
        yearly_emissions = _build_yearly_emissions(con, int(job_data.get("client_db_id") or 0))
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
            template_variables = {}

    # Phase 1 additions — data required by the Advanced Reports renderer
    site_breakdowns: dict[str, Any] = {}
    try:
        site_breakdowns = get_site_emissions_breakdowns(int(job_id))
    except Exception:
        pass

    glossary_cards: list[dict[str, Any]] = []
    try:
        glossary_cards = _ensure_glossary_cards_and_fetch(
            int(job_id),
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
    report_url = (
        f"{frontend_base}/jobs/{int(job_id)}/advanced-reports"
        f"?print=1&pdf_token={urllib.parse.quote(bearer)}"
        if bearer
        else f"{frontend_base}/jobs/{int(job_id)}/advanced-reports?print=1"
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
            viewport={"width": 1440, "height": 2200},
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
            page = context.new_page()
            page.goto(report_url, wait_until="networkidle", timeout=90000)
            page.locator(".live-report-section").first.wait_for(state="visible", timeout=60000)
            page.wait_for_timeout(1500)
            page.emulate_media(media="print")
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
        raise HTTPException(status_code=500, detail=f"Failed to list react report versions: {exc}") from exc
