"""Client portal data routes — protected by portal JWT.

All routes verify the portal JWT via _portal_user dependency and then
enforce client_db_id ownership so a client can only access their own data.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse

logger = logging.getLogger(__name__)
from pydantic import BaseModel, Field

from api.portal_auth_routes import portal_user_dep
from core.database import get_conn
from services.portal import (
    add_comment,
    approve_review,
    get_or_create_review,
    list_comments,
    list_portal_users,
    mark_pdf_generated,
    portal_dashboard_jobs,
    send_review_to_client,
)

router = APIRouter(tags=["portal"])


# ---------------------------------------------------------------------------
# Ownership helpers
# ---------------------------------------------------------------------------

def _assert_job_belongs_to_client(job_id: int, client_db_id: int, con) -> None:
    row = con.execute(
        "SELECT client_db_id FROM jobs WHERE job_id = %s",
        [int(job_id)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    if int(row[0]) != int(client_db_id):
        raise HTTPException(status_code=403, detail="Access denied")


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@router.get("/portal/dashboard")
def portal_dashboard(current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        jobs = portal_dashboard_jobs(client_db_id, con=con)
        # Client name
        client_row = con.execute(
            "SELECT client_name FROM clients WHERE db_id = %s",
            [client_db_id],
        ).fetchone()
    return {
        "ok": True,
        "client_name": str(client_row[0] or "") if client_row else "",
        "jobs": jobs,
    }


# ---------------------------------------------------------------------------
# Job overview (emissions summary)
# ---------------------------------------------------------------------------

@router.get("/portal/jobs/{job_id}")
def portal_job_overview(job_id: int, current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        job_row = con.execute(
            "SELECT job_id, job_number, title, reporting_year, status FROM jobs WHERE job_id = %s",
            [int(job_id)],
        ).fetchone()
        if not job_row:
            raise HTTPException(status_code=404, detail="Job not found")

        review = get_or_create_review(job_id, con=con)
        comments = list_comments(review["review_id"], con=con)

    # Fetch emissions data via existing functions
    try:
        from api.job_report_routes import get_scope_totals, get_emissions_by_category
        scope_totals = get_scope_totals(job_id)
        emissions_by_category = get_emissions_by_category(job_id)
    except Exception:
        scope_totals = {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0, "Total": 0.0}
        emissions_by_category = []

    open_count = sum(1 for c in comments if c["status"] == "open")

    return {
        "ok": True,
        "job": {
            "job_id": int(job_row[0]),
            "job_number": str(job_row[1] or ""),
            "title": str(job_row[2] or ""),
            "reporting_year": int(job_row[3]) if job_row[3] else None,
            "status": str(job_row[4] or ""),
        },
        "review": review,
        "open_comment_count": open_count,
        "scope_totals": scope_totals,
        "emissions_by_category": emissions_by_category,
    }


# ---------------------------------------------------------------------------
# Report HTML — serves saved final-version snapshot (avoids heavyweight render)
# ---------------------------------------------------------------------------

@router.get("/portal/jobs/{job_id}/report-html", response_class=HTMLResponse)
def portal_report_html(job_id: int, current_user: dict = Depends(portal_user_dep)):
    from services.tenancy import org_context
    from api.job_report_routes import _render_report_snapshot_html

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        _org_id = _portal_org_id(con, client_db_id)

    with org_context(_org_id):
        with get_conn() as con:
            import json as _json
            version_row_raw = con.execute(
                """
                SELECT report_version_id, snapshot_json, status, version_label, version_number
                FROM job_report_versions
                WHERE job_id = %s
                  AND lower(COALESCE(status, '')) IN ('final', 'review', 'draft')
                  AND snapshot_json IS NOT NULL
                ORDER BY
                    CASE lower(COALESCE(status, ''))
                        WHEN 'final' THEN 1
                        WHEN 'review' THEN 2
                        WHEN 'draft' THEN 3
                        ELSE 4
                    END,
                    COALESCE(finalized_at, reviewed_at, generated_at) DESC NULLS LAST,
                    version_number DESC NULLS LAST
                LIMIT 1
                """,
                [int(job_id)],
            ).fetchone()

    if not version_row_raw or not version_row_raw[1]:
        raise HTTPException(
            status_code=404,
            detail="No report has been published for review yet. Please ask your NZI consultant to send the report for review.",
        )

    try:
        snapshot_payload = _json.loads(version_row_raw[1])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Report snapshot is corrupted: {exc}") from exc
    try:
        html_content = _render_report_snapshot_html(snapshot_payload)
    except Exception as exc:
        logger.exception("portal_report_html: snapshot render failed for job %s", job_id)
        raise HTTPException(status_code=500, detail=f"Report render failed: {exc}") from exc

    return HTMLResponse(content=html_content, status_code=200)


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

class AddCommentPayload(BaseModel):
    comment_text: str = Field(..., min_length=1)
    section_reference: str | None = None


@router.get("/portal/jobs/{job_id}/comments")
def portal_list_comments(job_id: int, current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        review = get_or_create_review(job_id, con=con)
        comments = list_comments(review["review_id"], con=con)
    return {"ok": True, "review": review, "comments": comments}


@router.post("/portal/jobs/{job_id}/comments")
def portal_add_comment(
    job_id: int,
    payload: AddCommentPayload = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    client_db_id = int(current_user["client_db_id"])
    with get_conn(autocommit=False) as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        review = get_or_create_review(job_id, con=con)

        if review["status"] == "approved":
            raise HTTPException(status_code=400, detail="This report has already been approved and cannot receive new comments")

        comment = add_comment(
            review["review_id"],
            author_type="client",
            author_name=current_user["full_name"],
            author_email=current_user["email"],
            comment_text=payload.comment_text,
            section_reference=payload.section_reference,
            con=con,
        )

    # Notify assigned CRM
    _notify_crm_new_comment(job_id, current_user["full_name"])

    return {"ok": True, "comment": comment}


def _notify_crm_new_comment(job_id: int, client_name: str) -> None:
    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT j.job_number, j.title, u.email AS crm_email, u.full_name AS crm_name
                FROM jobs j
                LEFT JOIN users u ON u.user_id = j.assigned_user_id
                WHERE j.job_id = %s
                """,
                [int(job_id)],
            ).fetchone()
        if not row or not row[2]:
            return
        from services.outbound_email import send_tracked_email
        job_ref = f"{row[0]} — {row[1]}" if row[0] else str(row[1] or f"Job {job_id}")
        send_tracked_email(
            to_email=row[2],
            subject=f"New client comment on {job_ref}",
            body_text=(
                f"Hi {row[3] or 'there'},\n\n"
                f"{client_name} has added a comment to {job_ref} in NZInsights.\n\n"
                f"Log in to the NZI app to review and respond."
            ),
            body_html=(
                f"<p>Hi {row[3] or 'there'},</p>"
                f"<p><strong>{client_name}</strong> has added a comment to <strong>{job_ref}</strong> in NZInsights.</p>"
                f"<p>Log in to the NZI app to review and respond.</p>"
            ),
            template_key="portal_client_commented",
            entity_type="job",
            entity_id=str(job_id),
            job_id=job_id,
            created_by="portal",
        )
    except Exception:
        pass  # Non-fatal


# ---------------------------------------------------------------------------
# Debug — raw data counts for portal client (temporary)
# ---------------------------------------------------------------------------

@router.get("/portal/debug-data")
def portal_debug_data(current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        jobs_df = _portal_load_jobs(con, client_db_id)
        job_ids = [] if (jobs_df is None or jobs_df.empty) else [int(j) for j in jobs_df["job_id"].tolist()]

        result: dict = {
            "client_db_id": client_db_id,
            "job_ids": job_ids,
            "job_details": [],
            "scope_rows_count": 0,
            "emission_sources_count": 0,
            "crp_scope_entries_count": 0,
        }

        for jid in job_ids:
            jr = con.execute(
                "SELECT job_id, title, reporting_year, is_crp FROM jobs WHERE job_id = %s",
                [jid],
            ).fetchone()
            if jr:
                result["job_details"].append({
                    "job_id": jr[0], "title": str(jr[1] or ""), "reporting_year": jr[2],
                    "is_crp": jr[3],
                })

        if job_ids:
            ph = ",".join(["%s"] * len(job_ids))
            r = con.execute(
                f"SELECT COUNT(*) FROM job_scope_rows WHERE job_id IN ({ph}) AND enabled = TRUE",
                job_ids,
            ).fetchone()
            result["scope_rows_count"] = int(r[0] or 0) if r else 0

            r2 = con.execute(
                f"SELECT COUNT(*) FROM job_emission_sources WHERE job_id IN ({ph}) AND COALESCE(enabled, TRUE) = TRUE",
                job_ids,
            ).fetchone()
            result["emission_sources_count"] = int(r2[0] or 0) if r2 else 0

            r3 = con.execute(
                f"SELECT COUNT(*) FROM crp_scope_entries WHERE job_id IN ({ph}) AND is_archived = FALSE",
                job_ids,
            ).fetchone()
            result["crp_scope_entries_count"] = int(r3[0] or 0) if r3 else 0

    return result


# ---------------------------------------------------------------------------
# Metrics (dashboard data) — replicates /clients/{id}/dashboard?lite=1
# ---------------------------------------------------------------------------

def _portal_safe_year(value):
    try:
        if value is None:
            return None
        if str(value).strip().lower() in {"nan", "<na>", "none", "null", ""}:
            return None
        return int(value)
    except Exception:
        return None


def _portal_clean_label(value, fallback: str) -> str:
    txt = str(value or "").strip()
    if not txt or txt.lower() in {"nan", "none", "null"}:
        return fallback
    return txt


def _portal_category_label(row) -> str:
    for value in (
        row.get("dataset_category"),
        row.get("lookup_category"),
        row.get("category"),
        row.get("lookup_level_1"),
        row.get("level_1"),
        row.get("level_2"),
    ):
        txt = str(value or "").strip()
        if txt and txt.lower() not in {"nan", "none", "null", "uncategorized", "uncategorised"}:
            return txt
    return "Uncategorized"


def _portal_load_crp_entries(con, job_ids: list[int]):
    """Return crp_scope_entries rows shaped like load_combined_reporting_rows output."""
    import pandas as pd
    if not job_ids:
        return pd.DataFrame()
    ph = ",".join(["%s"] * len(job_ids))
    return con.execute(
        f"""
        SELECT
            cse.job_id,
            COALESCE(
                EXTRACT(YEAR FROM j.reporting_period_end),
                EXTRACT(YEAR FROM cjd.reporting_period_to),
                j.reporting_year
            ) AS dashboard_year,
            cse.scope,
            COALESCE(NULLIF(TRIM(CAST(cse.category AS VARCHAR)), ''), 'Uncategorized') AS dataset_category,
            COALESCE(NULLIF(TRIM(CAST(cse.category AS VARCHAR)), ''), 'Uncategorized') AS category,
            COALESCE(NULLIF(TRIM(CAST(cse.category AS VARCHAR)), ''), 'Uncategorized') AS lookup_category,
            'source_register'::text AS record_type,
            COALESCE(cse.tco2e, 0) AS calc_tco2e,
            'No Site Assigned'::text AS site_name
        FROM crp_scope_entries cse
        JOIN jobs j ON j.job_id = cse.job_id
        LEFT JOIN crp_job_details cjd ON cjd.job_id = cse.job_id
        WHERE cse.job_id IN ({ph})
          AND cse.is_archived = FALSE
          AND COALESCE(cse.tco2e, 0) != 0
        """,
        job_ids,
    ).df()


def _portal_org_id(con, client_db_id: int) -> str | None:
    """Look up the org_id for this client so we can mirror the CRM's org context."""
    row = con.execute(
        "SELECT org_id FROM clients WHERE db_id = %s", [int(client_db_id)]
    ).fetchone()
    if row and row[0]:
        return str(row[0])
    return None


def _portal_load_jobs(con, client_db_id: int):
    return con.execute(
        """
        SELECT j.job_id, j.reporting_year,
               COALESCE(
                   EXTRACT(YEAR FROM j.reporting_period_end),
                   EXTRACT(YEAR FROM cjd.reporting_period_to),
                   j.reporting_year
               ) AS dashboard_year
        FROM jobs j
        LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
        WHERE j.client_db_id = %s
        ORDER BY dashboard_year ASC NULLS LAST
        """,
        [int(client_db_id)],
    ).df()


@router.get("/portal/metrics")
def portal_metrics(
    year: int | None = Query(default=None),
    current_user: dict = Depends(portal_user_dep),
):
    from services.emissions_reporting import load_combined_reporting_rows, attach_exact_emissions
    from services.client_benchmark import get_client_benchmark_metrics
    from services.tenancy import org_context
    from datetime import date as _date

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        client_row = con.execute(
            "SELECT client_name, net_zero_year, org_id FROM clients WHERE db_id = %s",
            [client_db_id],
        ).fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found")

        _org_id = str(client_row[2]) if client_row[2] else None

    with org_context(_org_id):
        with get_conn() as con:
            jobs_df = _portal_load_jobs(con, client_db_id)
            job_ids = [] if (jobs_df is None or jobs_df.empty) else [int(j) for j in jobs_df["job_id"].tolist()]

            scope_df = None
            if job_ids:
                import pandas as pd
                try:
                    rows_df = load_combined_reporting_rows(con, job_ids)
                    if rows_df is not None and not rows_df.empty:
                        scope_df = attach_exact_emissions(con, rows_df)
                except Exception as exc:
                    logger.exception(
                        "portal_metrics: emissions load failed client_db_id=%s job_ids=%s",
                        client_db_id, job_ids,
                    )
                    scope_df = None

                # Merge CRP scope entries (jobs that store data in crp_scope_entries
                # rather than job_scope_rows / job_emission_sources)
                try:
                    crp_df = _portal_load_crp_entries(con, job_ids)
                    if crp_df is not None and not crp_df.empty:
                        crp_df["emissions"] = crp_df["calc_tco2e"].astype(float)
                        if scope_df is None or scope_df.empty:
                            scope_df = crp_df
                        else:
                            scope_df = pd.concat([scope_df, crp_df], ignore_index=True)
                except Exception as exc:
                    logger.exception(
                        "portal_metrics: crp entries load failed client_db_id=%s", client_db_id,
                    )

            try:
                benchmark_metrics = get_client_benchmark_metrics(con, client_db_id)
            except Exception:
                benchmark_metrics = None

            net_zero_progress = None
            if client_row[1]:
                nz_year = int(client_row[1])
                net_zero_progress = {
                    "net_zero_year": nz_year,
                    "years_to_target": max(0, nz_year - _date.today().year),
                }

            if scope_df is None or scope_df.empty:
                avail: list[int] = []
                if jobs_df is not None and not jobs_df.empty:
                    avail = sorted({_portal_safe_year(r.get("dashboard_year")) for _, r in jobs_df.iterrows() if _portal_safe_year(r.get("dashboard_year"))})
                sel_yr = year if year in avail else (avail[-1] if avail else None)
                return {
                    "client_db_id": client_db_id, "client_name": str(client_row[0] or ""),
                    "selected_year": sel_yr, "available_years": avail,
                    "current_metrics": {"total_emissions": 0, "scope1": 0, "scope2": 0, "scope3": 0, "year": None},
                    "yoy_change": None, "yearly_emissions": [], "yearly_top_categories": [],
                    "yearly_intensity_metrics": [], "top_categories": [], "intensity_metrics": [],
                    "currency": "GBP", "benchmark_metrics": benchmark_metrics, "net_zero_progress": net_zero_progress,
                }

            scope_df = scope_df.copy()
            scope_df["dashboard_year_norm"] = scope_df["dashboard_year"].apply(_portal_safe_year)
            scope_df = scope_df[scope_df["dashboard_year_norm"].notna()].copy()
            scope_df["dataset_category"] = scope_df.apply(lambda r: _portal_category_label(r), axis=1)

            years_set = {int(y) for y in scope_df["dashboard_year_norm"].dropna().unique() if _portal_safe_year(y) is not None}
            job_years_set = {_portal_safe_year(r.get("dashboard_year")) for _, r in jobs_df.iterrows() if _portal_safe_year(r.get("dashboard_year"))} if jobs_df is not None else set()
            available_years = sorted(years_set | job_years_set)

            req_year = _portal_safe_year(year)
            selected_year = req_year if req_year in available_years else (available_years[-1] if available_years else None)

            scope_groups = scope_df.groupby(["dashboard_year_norm", "scope"])["emissions"].sum().reset_index()
            yearly_emissions: list[dict[str, Any]] = []
            for yr in available_years:
                yr_rows = scope_groups[scope_groups["dashboard_year_norm"] == yr]
                yearly_emissions.append({
                    "year": yr,
                    "scope1": float(yr_rows[yr_rows["scope"] == "Scope 1"]["emissions"].sum()),
                    "scope2": float(yr_rows[yr_rows["scope"] == "Scope 2"]["emissions"].sum()),
                    "scope3": float(yr_rows[yr_rows["scope"] == "Scope 3"]["emissions"].sum()),
                    "total": float(yr_rows["emissions"].sum()),
                })

            current_metrics: dict[str, Any] = {"total_emissions": 0, "scope1": 0, "scope2": 0, "scope3": 0, "year": selected_year}
            if selected_year is not None:
                sd = next((y for y in yearly_emissions if y["year"] == selected_year), None)
                if sd:
                    current_metrics = {"total_emissions": sd["total"], "scope1": sd["scope1"], "scope2": sd["scope2"], "scope3": sd["scope3"], "year": selected_year}

            yoy_change = None
            if selected_year is not None and len(yearly_emissions) >= 2:
                idx = next((i for i, y in enumerate(yearly_emissions) if y["year"] == selected_year), None)
                if idx is not None and idx > 0 and yearly_emissions[idx - 1]["total"] > 0:
                    yoy_change = round((yearly_emissions[idx]["total"] - yearly_emissions[idx - 1]["total"]) / yearly_emissions[idx - 1]["total"] * 100, 1)

            yearly_top_categories: list[dict[str, Any]] = []
            for yr in available_years:
                yr_df = scope_df[scope_df["dashboard_year_norm"] == yr]
                yr_total = float(next((y["total"] for y in yearly_emissions if y["year"] == yr), 0))
                cats: list[dict[str, Any]] = []
                if not yr_df.empty:
                    cg = yr_df.groupby("dataset_category")["emissions"].sum().reset_index()
                    cg = cg.sort_values("emissions", ascending=False).head(10)
                    for _, row in cg.iterrows():
                        cat = str(row["dataset_category"]).strip()
                        if not cat or cat.lower() in ["nan", "none", "null"]:
                            continue
                        em = float(row["emissions"])
                        cats.append({"category": cat, "dataset_category": cat, "emissions": em, "percentage": round((em / yr_total * 100) if yr_total > 0 else 0, 1)})
                yearly_top_categories.append({"year": yr, "categories": cats})

            top_categories: list[dict[str, Any]] = []
            if selected_year is not None:
                sel_tc = next((y for y in yearly_top_categories if y["year"] == selected_year), None)
                if sel_tc:
                    top_categories = sel_tc["categories"]

            yearly_intensity_metrics: list[dict[str, Any]] = []
            for yr in available_years:
                yr_metrics: list[dict[str, Any]] = []
                yr_total = float(next((y["total"] for y in yearly_emissions if y["year"] == yr), 0))
                if jobs_df is not None and not jobs_df.empty:
                    yr_jobs = jobs_df[jobs_df["dashboard_year"].apply(_portal_safe_year) == yr]
                    if not yr_jobs.empty:
                        latest_job_id = int(yr_jobs.iloc[-1]["job_id"])
                        try:
                            r = con.execute("SELECT intensity_metrics FROM jobs WHERE job_id = %s", [latest_job_id]).fetchone()
                            if r and r[0]:
                                for key, metric in list(r[0].items())[:3]:
                                    if metric.get("value", 0) > 0:
                                        intensity = (yr_total / metric["value"]) * metric.get("divider", 1)
                                        yr_metrics.append({"key": key, "label": metric.get("label", key), "value": metric.get("value"), "divider": metric.get("divider", 1), "intensity": round(intensity, 2)})
                        except Exception:
                            pass
                yearly_intensity_metrics.append({"year": yr, "metrics": yr_metrics})

            intensity_metrics: list[dict[str, Any]] = []
            if selected_year is not None:
                sel_m = next((y for y in yearly_intensity_metrics if y["year"] == selected_year), None)
                if sel_m:
                    intensity_metrics = sel_m["metrics"]

            return {
                "client_db_id": client_db_id,
                "client_name": str(client_row[0] or ""),
                "selected_year": selected_year,
                "available_years": available_years,
                "current_metrics": current_metrics,
                "yoy_change": yoy_change,
                "yearly_emissions": yearly_emissions,
                "yearly_top_categories": yearly_top_categories,
                "yearly_intensity_metrics": yearly_intensity_metrics,
                "top_categories": top_categories,
                "intensity_metrics": intensity_metrics,
                "currency": "GBP",
                "benchmark_metrics": benchmark_metrics,
                "net_zero_progress": net_zero_progress,
            }


# ---------------------------------------------------------------------------
# Reporting data — replicates /clients/{id}/reporting
# ---------------------------------------------------------------------------

@router.get("/portal/reporting-data")
def portal_reporting_data(current_user: dict = Depends(portal_user_dep)):
    from services.emissions_reporting import load_combined_reporting_rows, combined_row_metrics
    from services.monthly_emissions import JobMonthlyEmissionsResolver
    from services.tenancy import org_context

    client_db_id = int(current_user["client_db_id"])

    # Step 1: look up client + org_id without org context (clients table is not org-scoped in our queries)
    with get_conn() as con:
        client_row = con.execute(
            "SELECT client_name, org_id FROM clients WHERE db_id = %s", [client_db_id]
        ).fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found")
        _org_id = str(client_row[1]) if client_row[1] else None

    empty_resp = {
        "client_db_id": client_db_id,
        "client_name": str(client_row[0] or ""),
        "years": [], "by_scope": [], "by_scope_category": [], "by_activity": [], "by_site": [],
    }

    # Step 2: all emissions queries run with org context so RLS matches the CRM
    with org_context(_org_id):
        with get_conn() as con:
            jobs_df = _portal_load_jobs(con, client_db_id)
            if jobs_df is None or jobs_df.empty:
                return empty_resp

            job_ids = [int(j) for j in jobs_df["job_id"].tolist()]
            try:
                scope_df = load_combined_reporting_rows(con, job_ids)
            except Exception as exc:
                logger.exception(
                    "portal_reporting_data: rows load failed client_db_id=%s job_ids=%s",
                    client_db_id, job_ids,
                )
                raise HTTPException(status_code=500, detail=f"Failed to load emissions data: {exc}") from exc

            # Merge CRP scope entries for jobs that use crp_scope_entries
            try:
                import pandas as pd
                crp_df = _portal_load_crp_entries(con, job_ids)
                if crp_df is not None and not crp_df.empty:
                    if scope_df is None or scope_df.empty:
                        scope_df = crp_df
                    else:
                        scope_df = pd.concat([scope_df, crp_df], ignore_index=True)
            except Exception as exc:
                logger.exception(
                    "portal_reporting_data: crp entries load failed client_db_id=%s", client_db_id,
                )

            if scope_df is None or scope_df.empty:
                avail = sorted({_portal_safe_year(y) for y in jobs_df["dashboard_year"].dropna().unique() if _portal_safe_year(y)})
                return {**empty_resp, "years": avail}

            resolver_cache: dict[int, Any] = {}
            emissions_vals: list[float] = []
            for _, row in scope_df.iterrows():
                row_type = str(row.get("record_type") or "legacy").strip().lower()
                if row_type == "source_register":
                    metrics = combined_row_metrics(row)
                else:
                    row_job_id = int(row.get("job_id"))
                    resolver = resolver_cache.get(row_job_id)
                    if resolver is None:
                        resolver = JobMonthlyEmissionsResolver(con, row_job_id)
                        resolver_cache[row_job_id] = resolver
                    metrics = combined_row_metrics(row, resolver)
                emissions_vals.append(round(float(metrics.get("calc_tco2e") or 0.0), 2))

            scope_df = scope_df.copy()
            scope_df["emissions"] = emissions_vals
            scope_df["scope"] = scope_df["scope"].apply(lambda v: _portal_clean_label(v, "Unknown"))
            scope_df["dataset_category"] = scope_df.apply(lambda r: _portal_category_label(r), axis=1)
            scope_df["category"] = scope_df["dataset_category"]
            scope_df["site_name"] = scope_df["site_name"].apply(lambda v: _portal_clean_label(v, "Unknown"))

            years = sorted({_portal_safe_year(y) for y in scope_df["dashboard_year"].dropna().unique() if _portal_safe_year(y)})

            def _by_key(groups, key_col: str, yr: int) -> dict[str, Any]:
                yr_data: dict[str, Any] = {"year": yr}
                yr_rows = groups[groups["dashboard_year"] == yr]
                for _, r in yr_rows.iterrows():
                    yr_data[_portal_clean_label(r[key_col], "Unknown")] = round(float(r["emissions"]), 2)
                yr_data["total"] = round(float(yr_rows["emissions"].sum()), 2)
                return yr_data

            scope_groups = scope_df.groupby(["dashboard_year", "scope"])["emissions"].sum().reset_index()
            by_scope = [_by_key(scope_groups, "scope", yr) for yr in years]

            scat_groups = scope_df.groupby(["dashboard_year", "scope", "category"])["emissions"].sum().reset_index()
            by_scope_category: list[dict[str, Any]] = []
            for yr in years:
                yr_rows = scat_groups[scat_groups["dashboard_year"] == yr]
                scopes: dict[str, dict[str, float]] = {}
                for _, r in yr_rows.iterrows():
                    s = _portal_clean_label(r["scope"], "Unknown")
                    c = _portal_clean_label(r["category"], "Uncategorized")
                    if s not in scopes:
                        scopes[s] = {}
                    scopes[s][c] = round(float(r["emissions"]), 2)
                by_scope_category.append({"year": yr, "scopes": scopes})

            act_groups = scope_df.groupby(["dashboard_year", "category"])["emissions"].sum().reset_index()
            by_activity = [_by_key(act_groups, "category", yr) for yr in years]

            site_groups = scope_df.groupby(["dashboard_year", "site_name"])["emissions"].sum().reset_index()
            by_site = [_by_key(site_groups, "site_name", yr) for yr in years]

            return {
                "client_db_id": client_db_id,
                "client_name": str(client_row[0] or ""),
                "years": years,
                "by_scope": by_scope,
                "by_scope_category": by_scope_category,
                "by_activity": by_activity,
                "by_site": by_site,
            }


# ---------------------------------------------------------------------------
# Approval
# ---------------------------------------------------------------------------

class ApprovePayload(BaseModel):
    approver_name: str = Field(..., min_length=1)
    confirmed: bool = Field(...)


@router.post("/portal/jobs/{job_id}/approve")
def portal_approve_report(
    job_id: int,
    payload: ApprovePayload = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    if not payload.confirmed:
        raise HTTPException(status_code=400, detail="Approval confirmation is required")

    client_db_id = int(current_user["client_db_id"])
    with get_conn(autocommit=False) as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        review = approve_review(
            job_id,
            approver_name=payload.approver_name,
            approver_email=current_user["email"],
            con=con,
        )

    # Trigger PDF generation asynchronously
    _trigger_pdf_on_approval(job_id)

    # Notify CRM
    _notify_crm_approval(job_id, payload.approver_name, current_user["email"])

    return {"ok": True, "review": review}


def _trigger_pdf_on_approval(job_id: int) -> None:
    """Queue PDF generation after approval. Non-fatal if it fails."""
    try:
        from services.pdf_generation_queue import queue_pdf_generation
        queue_pdf_generation(job_id)
    except Exception:
        try:
            # Fallback to synchronous generation
            from api.job_report_routes import _generate_professional_pdf_impl
            _generate_professional_pdf_impl(
                job_id=job_id,
                save_version=True,
                report_version_status="final",
                report_version_label="Approved",
                report_version_notes="Generated on client approval via NZInsights portal",
                current_user={"email": "portal-approval", "user_id": "portal-approval"},
            )
            mark_pdf_generated(job_id)
        except Exception:
            pass


def _notify_crm_approval(job_id: int, approver_name: str, approver_email: str) -> None:
    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT j.job_number, j.title, u.email AS crm_email, u.full_name AS crm_name
                FROM jobs j
                LEFT JOIN users u ON u.user_id = j.assigned_user_id
                WHERE j.job_id = %s
                """,
                [int(job_id)],
            ).fetchone()
        if not row or not row[2]:
            return
        from services.outbound_email import send_tracked_email
        job_ref = f"{row[0]} — {row[1]}" if row[0] else str(row[1] or f"Job {job_id}")
        send_tracked_email(
            to_email=row[2],
            subject=f"Report approved: {job_ref}",
            body_text=(
                f"Hi {row[3] or 'there'},\n\n"
                f"{approver_name} ({approver_email}) has approved the report for {job_ref}.\n\n"
                f"PDF generation has been triggered and will be uploaded to the client files automatically."
            ),
            body_html=(
                f"<p>Hi {row[3] or 'there'},</p>"
                f"<p><strong>{approver_name}</strong> ({approver_email}) has approved the report for <strong>{job_ref}</strong>.</p>"
                f"<p>PDF generation has been triggered and will be uploaded to the client files automatically.</p>"
            ),
            template_key="portal_report_approved",
            entity_type="job",
            entity_id=str(job_id),
            job_id=job_id,
            created_by="portal",
        )
    except Exception:
        pass
