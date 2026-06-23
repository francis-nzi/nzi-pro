"""
Main Dashboard API Routes
Provides overview metrics for the main dashboard
"""

import csv
import io
import logging
import math
from datetime import date

from fastapi import APIRouter, HTTPException, Depends, Query, Response
from pydantic import BaseModel, Field
from core.database import get_conn
from api.auth import _current_user
from services.tenancy import require_org
from services.monthly_emissions import JobMonthlyEmissionsResolver
from services.emissions_reporting import combined_row_metrics, load_combined_emissions_summary_rows, load_combined_reporting_rows

router = APIRouter()
logger = logging.getLogger(__name__)


SUPPORTED_REPORT_VIEWS = (
    "client_portfolio",
    "job_delivery",
    "invoice_follow_up",
    "quote_pipeline",
    "crm_workload",
    "emissions_portfolio",
)


class SavedInsightsReportPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    view: str = Field(..., min_length=1, max_length=64)
    year: int | None = None
    industry: str | None = None
    crm_owner: str | None = None


def _table_exists(con, table_name: str) -> bool:
    """Best-effort table existence check that works across backends."""
    try:
        row = con.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = ? LIMIT 1",
            [table_name],
        ).fetchone()
        return bool(row)
    except Exception:
        # Fallback for engines/environments where information_schema is unavailable
        logger.debug("Information schema table probe failed for dashboard helper; trying SELECT fallback", exc_info=True)
        try:
            con.execute(f"SELECT 1 FROM {table_name} LIMIT 1").fetchone()
            return True
        except Exception:
            logger.debug("Failed to detect dashboard table existence; returning False", exc_info=True)
            return False


def _column_exists(con, table_name: str, column_name: str) -> bool:
    """Best-effort column existence check that works across backends."""
    try:
        row = con.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ? LIMIT 1",
            [table_name, column_name],
        ).fetchone()
        return bool(row)
    except Exception:
        # Fallback for engines/environments where information_schema is unavailable
        logger.debug("Information schema column probe failed for dashboard helper; trying SELECT fallback", exc_info=True)
        try:
            con.execute(f"SELECT {column_name} FROM {table_name} LIMIT 1").fetchone()
            return True
        except Exception:
            logger.debug("Failed to detect dashboard column existence; returning False", exc_info=True)
            return False


def _apply_client_filters(
    where_parts: list[str],
    params: list[object],
    *,
    client_alias: str,
    industry: str | None,
    crm_owner: str | None,
) -> None:
    if industry:
        where_parts.append(f"{client_alias}.industry = ?")
        params.append(industry)
    if crm_owner:
        crm_value = str(crm_owner).strip()
        if crm_value.lower() == "unassigned":
            where_parts.append(f"({client_alias}.crm_owner IS NULL OR TRIM({client_alias}.crm_owner) = '')")
        else:
            where_parts.append(f"{client_alias}.crm_owner = ?")
            params.append(crm_value)


def _job_family_expression(job_alias: str = "j") -> str:
    return (
        f"LOWER(COALESCE(NULLIF(TRIM({job_alias}.job_group), ''), NULLIF(TRIM({job_alias}.job_family), ''), "
        f"CASE WHEN COALESCE({job_alias}.is_crp, FALSE) THEN 'crp' ELSE NULL END))"
    )


def _apply_job_family_filter(
    where_parts: list[str],
    params: list[object],
    *,
    job_alias: str = "j",
    job_family: str | None,
) -> None:
    family = str(job_family or "").strip().lower()
    if not family:
        return
    where_parts.append(f"{_job_family_expression(job_alias)} = ?")
    params.append(family)


def _load_dashboard_crm_options(con, org_id: str) -> list[dict[str, str]]:
    """Return selectable CRM/team options for the dashboard filters."""
    options: list[dict[str, str]] = []
    seen: set[str] = set()

    def _add_option(value: str, label: str, meta: str) -> None:
        value_norm = str(value or "").strip()
        label_norm = str(label or value_norm).strip()
        if not value_norm or not label_norm:
            return
        key = label_norm.lower()
        if key in seen:
            return
        seen.add(key)
        options.append({
            "value": value_norm,
            "label": label_norm,
            "meta": meta,
        })

    try:
        users_df = con.execute(
            """
            SELECT
                COALESCE(NULLIF(TRIM(full_name), ''), NULLIF(TRIM(email), ''), NULLIF(TRIM(user_id), ''), '') AS display_name,
                COALESCE(NULLIF(TRIM(email), ''), NULLIF(TRIM(user_id), ''), '') AS email,
                COALESCE(NULLIF(TRIM(role), ''), 'Team Member') AS role,
                COALESCE(NULLIF(TRIM(position), ''), '') AS position
            FROM users
            WHERE org_id = ?
              AND LOWER(COALESCE(status, 'active')) = 'active'
            ORDER BY COALESCE(NULLIF(TRIM(full_name), ''), NULLIF(TRIM(email), ''), NULLIF(TRIM(user_id), ''))
            """,
            [str(org_id)],
        ).df()
    except Exception:
        users_df = None

    if users_df is not None and not users_df.empty:
        for _, row in users_df.iterrows():
            label = str(row.get("display_name") or "").strip()
            if not label:
                continue
            meta_bits = [
                str(row.get("role") or "").strip(),
                str(row.get("position") or "").strip(),
                str(row.get("email") or "").strip(),
            ]
            meta = " • ".join(bit for bit in meta_bits if bit)
            _add_option(label, label, meta)

    for table, column in (("clients", "crm_owner"), ("jobs", "crm_name")):
        try:
            legacy_df = con.execute(
                f"""
                SELECT DISTINCT COALESCE(NULLIF(TRIM({column}), ''), '') AS crm_value
                FROM {table}
                WHERE org_id = ?
                ORDER BY crm_value
                """,
                [str(org_id)],
            ).df()
        except Exception:
            legacy_df = None

        if legacy_df is None or legacy_df.empty:
            continue
        for _, row in legacy_df.iterrows():
            value = str(row.get("crm_value") or "").strip()
            if not value:
                continue
            _add_option(value, value, "Legacy CRM owner")

    return options


def _financial_year_filter(
    where_parts: list[str],
    params: list[object],
    *,
    date_expr: str,
    job_year_expr: str,
    year: int | None,
) -> None:
    if year is None:
        return
    where_parts.append(f"COALESCE({job_year_expr}, EXTRACT(YEAR FROM {date_expr})::INTEGER) = ?")
    params.append(int(year))


def _normalize_to_date(value):
    if hasattr(value, "date"):
        try:
            normalized = value.date()
            if _is_missing_value(normalized):
                return None
            return normalized
        except Exception:
            logger.debug("Failed to normalize date-like dashboard value; returning None", exc_info=True)
    if _is_missing_value(value):
        return None
    if isinstance(value, str):
        txt = value.strip()
        if not txt:
            return None
        try:
            return date.fromisoformat(txt[:10])
        except Exception:
            logger.debug("Failed to parse dashboard ISO date string; returning None", exc_info=True)
            return None


def _normalize_int_value(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    try:
        return int(value)
    except Exception:
        try:
            return int(float(value))
        except Exception:
            logger.debug("Failed to normalize integer dashboard value; returning None", exc_info=True)
            return None


def _is_missing_value(value) -> bool:
    if value is None:
        return True
    try:
        import pandas as pd

        if value is pd.NA or value is pd.NaT:
            return True
    except Exception:
        pass
    try:
        compared = value != value
        return compared is True
    except Exception:
        return False


def _normalize_text_value(value, default: str = "") -> str:
    if _is_missing_value(value):
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    if not text or text.lower() == "nan":
        return default
    return text


def _normalize_float_value(value, default: float = 0.0) -> float:
    if _is_missing_value(value):
        return default
    try:
        number = float(value)
    except Exception:
        return default
    if math.isnan(number):
        return default
    return number


def _empty_dashboard_operations_overview() -> dict:
    return {
        "metrics": {
            "active_jobs": 0,
            "healthy_jobs": 0,
            "due_soon_jobs": 0,
            "overdue_jobs": 0,
            "no_milestone_jobs": 0,
            "jobs_over_estimate": 0,
            "time_logged_hours": 0.0,
            "estimated_hours_total": 0.0,
            "utilisation_pct": 0.0,
            "completed_milestones": 0,
            "upcoming_milestones_30d": 0,
        },
        "milestone_breakdown": [],
        "time_by_subject": [],
        "crm_workload": [],
        "jobs_needing_attention": [],
        "current_jobs": [],
    }


def _load_dashboard_emissions_jobs(
    con,
    *,
    year: int | None,
    industry: str | None,
    crm_owner: str | None,
    job_family: str | None = None,
):
    family = str(job_family or "").strip().lower()
    if family and family != "crp":
        return pd.DataFrame(columns=["job_id", "client_id", "client_name", "reporting_year", "dashboard_year"])
    where_parts = ["j.is_crp = TRUE"]
    params: list[object] = []
    _apply_client_filters(
        where_parts,
        params,
        client_alias="c",
        industry=industry,
        crm_owner=crm_owner,
    )
    _apply_job_family_filter(where_parts, params, job_alias="j", job_family=family)
    if year is not None:
        where_parts.append("j.reporting_year = ?")
        params.append(int(year))
    where_sql = "WHERE " + " AND ".join(where_parts)
    return con.execute(
        f"""
        SELECT
            j.job_id,
            c.db_id AS client_id,
            c.client_name,
            j.reporting_year,
            COALESCE(
                EXTRACT(YEAR FROM j.reporting_period_end),
                EXTRACT(YEAR FROM cjd.reporting_period_to),
                j.reporting_year
            ) AS dashboard_year
        FROM jobs j
        LEFT JOIN clients c ON c.db_id = j.client_db_id
        LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
        {where_sql}
        ORDER BY dashboard_year ASC NULLS LAST, j.job_id ASC
        """,
        params,
    ).df()


def _attach_dashboard_emissions(con, scope_df):
    if scope_df is None or scope_df.empty:
        return scope_df

    resolver_by_job: dict[int, JobMonthlyEmissionsResolver] = {}
    emissions_vals: list[float] = []
    for _, row in scope_df.iterrows():
        row_type = str(row.get("record_type") or "legacy").strip().lower()
        if row_type == "source_register":
            metrics = combined_row_metrics(row)
        else:
            row_job_id = _normalize_int_value(row.get("job_id"))
            if row_job_id is None:
                emissions_vals.append(0.0)
                continue
            resolver = resolver_by_job.get(row_job_id)
            if resolver is None:
                resolver = JobMonthlyEmissionsResolver(con, row_job_id)
                resolver_by_job[row_job_id] = resolver
            metrics = combined_row_metrics(row, resolver)
        emissions_vals.append(float(metrics.get("calc_tco2e") or 0.0))

    scope_df = scope_df.copy()
    scope_df["emissions"] = emissions_vals
    scope_df["dashboard_year_norm"] = scope_df["dashboard_year"].apply(_normalize_int_value)
    return scope_df
    if isinstance(value, date):
        return value
    return None


def _milestone_status(due_date, completed_at) -> str:
    if _normalize_to_date(completed_at) is not None:
        return "completed"
    due = _normalize_to_date(due_date)
    if not due:
        return "green"
    days_until_due = (due - date.today()).days
    if days_until_due < -1:
        return "red"
    if days_until_due <= 7:
        return "amber"
    return "green"


def _overall_milestone_status(statuses: list[str]) -> str | None:
    if not statuses:
        return None
    if "red" in statuses:
        return "red"
    if "amber" in statuses:
        return "amber"
    if "green" in statuses:
        return "green"
    if "completed" in statuses:
        return "completed"
    return None


def _crm_expression(*, has_job_crm_name: bool, has_client_crm_owner: bool, job_alias: str = "j", client_alias: str = "c") -> str:
    if has_job_crm_name and has_client_crm_owner:
        return f"COALESCE(NULLIF({job_alias}.crm_name, ''), NULLIF({client_alias}.crm_owner, ''), 'Unassigned')"
    if has_job_crm_name:
        return f"COALESCE(NULLIF({job_alias}.crm_name, ''), 'Unassigned')"
    if has_client_crm_owner:
        return f"COALESCE(NULLIF({client_alias}.crm_owner, ''), 'Unassigned')"
    return "'Unassigned'"


def _saved_report_user_id(user: dict[str, str]) -> str:
    return str(user.get("user_id") or user.get("email") or "").strip()


def _normalize_saved_report_text(value: str | None) -> str | None:
    txt = str(value or "").strip()
    return txt or None


def _validate_report_view(view: str) -> str:
    normalized = str(view or "").strip()
    if normalized not in SUPPORTED_REPORT_VIEWS:
        raise HTTPException(status_code=400, detail=f"Unsupported report view: {normalized or '(blank)'}")
    return normalized


def _saved_reports_available(con) -> bool:
    return _table_exists(con, "saved_insights_reports")


def _require_saved_reports_table(con) -> None:
    if not _saved_reports_available(con):
        raise HTTPException(
            status_code=503,
            detail="Saved report persistence is not available until SQL migrations are applied.",
        )


def _saved_report_name_exists(con, *, user_id: str, name: str, exclude_id: int | None = None) -> bool:
    sql = """
        SELECT 1
        FROM saved_insights_reports
        WHERE user_id = ? AND lower(name) = lower(?)
    """
    params: list[object] = [user_id, name]
    if exclude_id is not None:
        sql += " AND saved_report_id <> ?"
        params.append(int(exclude_id))
    sql += " LIMIT 1"
    return bool(con.execute(sql, params).fetchone())


def _serialize_saved_report_row(row) -> dict[str, object]:
    return {
        "saved_report_id": int(row[0]),
        "name": row[1],
        "view": row[2],
        "year": int(row[3]) if row[3] is not None else None,
        "industry": row[4],
        "crm_owner": row[5],
        "created_at": row[6].isoformat() if hasattr(row[6], "isoformat") else (str(row[6]) if row[6] else None),
        "updated_at": row[7].isoformat() if hasattr(row[7], "isoformat") else (str(row[7]) if row[7] else None),
    }


@router.get("/dashboard/overview")
def get_dashboard_overview(
    year: int = Query(None, description="Reporting year to filter emissions (defaults to current year)"),
    industry: str | None = Query(None, description="Optional industry filter"),
    crm_owner: str | None = Query(None, description="Optional CRM owner filter"),
    job_family: str | None = Query(None, description="Optional job group filter"),
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Get main dashboard overview metrics including:
    - Total number of clients
    - Total CO2 emissions (by year)
    - Job status breakdown
    - Active jobs count
    - Total datasets
    - Year-over-year emissions change
    - Top emitting clients
    """
    try:
        year = int(year) if isinstance(year, int) else None
        industry = industry if isinstance(industry, str) else None
        crm_owner = crm_owner if isinstance(crm_owner, str) else None
        job_family = str(job_family or "").strip().lower() or None
        org_id = require_org(_user)
        with get_conn() as con:
            # build filters for industry / crm owner
            client_filters: list[str] = []
            job_filters: list[str] = []
            client_params: list[object] = []
            job_params: list[object] = []

            if industry:
                client_filters.append("industry = ?")
                client_params.append(industry)
                job_filters.append("c.industry = ?")
                job_params.append(industry)
            if crm_owner:
                crm_value = str(crm_owner).strip()
                # CRM owner is stored on clients; support explicit "Unassigned" filter.
                if crm_value.lower() == "unassigned":
                    job_filters.append("(c.crm_owner IS NULL OR TRIM(c.crm_owner) = '')")
                else:
                    job_filters.append("c.crm_owner = ?")
                    job_params.append(crm_value)
            if job_family:
                client_filters.append(
                    "EXISTS (SELECT 1 FROM jobs jf WHERE jf.client_db_id = c.db_id AND "
                    f"{_job_family_expression('jf')} = ?)"
                )
                client_params.append(job_family)
                _apply_job_family_filter(job_filters, job_params, job_alias="j", job_family=job_family)

            # helper clauses
            client_where = "WHERE " + " AND ".join(client_filters) if client_filters else ""
            # note: job_where will often be embedded in queries that already have WHERE
            job_where = " AND " + " AND ".join(job_filters) if job_filters else ""

            # Get current year if not specified
            if year is None:
                year = date.today().year
            
            # Total number of clients (optionally filtered by industry)
            clients_count_sql = f"SELECT COUNT(*) FROM clients c {client_where}"
            try:
                clients_count = con.execute(clients_count_sql, client_params).fetchone()[0]
            except Exception:
                logger.exception("Failed to load dashboard client count; defaulting to 0")
                clients_count = 0
            
            # Combined emissions rows for all CRP jobs matching the portfolio filters.
            emissions_scope_df = None
            try:
                emissions_jobs_df = _load_dashboard_emissions_jobs(
                    con,
                    year=None,
                    industry=industry,
                    crm_owner=crm_owner,
                    job_family=job_family,
                )
                if emissions_jobs_df is not None and not emissions_jobs_df.empty:
                    emissions_job_ids = [int(job_id) for job_id in emissions_jobs_df["job_id"].tolist() if job_id is not None]
                    emissions_scope_df = load_combined_emissions_summary_rows(con, emissions_job_ids)
                    if emissions_scope_df is not None and not emissions_scope_df.empty:
                        emissions_scope_df = emissions_scope_df.copy()
                        emissions_scope_df["dashboard_year_norm"] = emissions_scope_df["dashboard_year"].apply(_normalize_int_value)
            except Exception:
                logger.exception("Failed to load dashboard emissions overview; continuing with empty emissions data")

            # Total CO2 emissions for selected year.
            total_emissions = 0.0
            prev_year_emissions = 0.0
            year_trend = []
            top_emitting_clients = []
            if emissions_scope_df is not None and not emissions_scope_df.empty:
                selected_year_df = emissions_scope_df[emissions_scope_df["dashboard_year_norm"] == int(year)].copy()
                if not selected_year_df.empty:
                    total_emissions = float(selected_year_df["emissions"].sum())

                    client_groups = (
                        selected_year_df
                        .groupby(["client_id", "client_name"], dropna=False)["emissions"]
                        .sum()
                        .reset_index()
                        .sort_values("emissions", ascending=False)
                        .head(5)
                    )
                    for _, row in client_groups.iterrows():
                        client_id = _normalize_int_value(row.get("client_id"))
                        client_name = _normalize_text_value(row.get("client_name"), "Unspecified")
                        top_emitting_clients.append({
                            "client_name": client_name,
                            "client_id": client_id,
                            "emissions": float(row["emissions"]),
                        })

                prev_year_df = emissions_scope_df[emissions_scope_df["dashboard_year_norm"] == int(year) - 1].copy()
                if not prev_year_df.empty:
                    prev_year_emissions = float(prev_year_df["emissions"].sum())

                trend_groups = (
                    emissions_scope_df.dropna(subset=["dashboard_year_norm"])
                    .groupby("dashboard_year_norm")["emissions"]
                    .sum()
                    .reset_index()
                    .sort_values("dashboard_year_norm")
                )
                for _, row in trend_groups.iterrows():
                    year_trend.append({
                        "year": int(row["dashboard_year_norm"]),
                        "total_emissions": float(row["emissions"]),
                    })
            # Job status breakdown (apply job filters if any)
            job_statuses_query = f"""
                SELECT 
                    COALESCE(j.status, 'Unknown') as status,
                    COUNT(*) as count
                FROM jobs j
                LEFT JOIN clients c ON c.db_id = j.client_db_id
                WHERE 1=1{job_where}
                GROUP BY j.status
                ORDER BY count DESC
                """
            try:
                job_statuses_df = con.execute(job_statuses_query, job_params).df()
            except Exception:
                logger.exception("Failed to load dashboard job statuses; continuing with empty breakdown")
                job_statuses_df = None
            
            status_breakdown = []
            if job_statuses_df is not None and not job_statuses_df.empty:
                for _, row in job_statuses_df.iterrows():
                    status_breakdown.append({
                        "status": _normalize_text_value(row.get("status"), "Unknown"),
                        "count": _normalize_int_value(row.get("count")) or 0,
                    })
            
            # Active jobs (not completed/archived) with filters
            try:
                active_jobs_query = f"""
                    SELECT COUNT(*) FROM jobs j
                    LEFT JOIN clients c ON c.db_id = j.client_db_id
                    WHERE (status NOT IN ('Completed', 'Archived', 'Cancelled') OR status IS NULL){job_where}
                """
                active_jobs = con.execute(active_jobs_query, job_params).fetchone()[0]
            except Exception:
                logger.debug("Failed to load filtered active jobs count; falling back to total jobs count", exc_info=True)
                active_jobs = con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
            
            # Total datasets
            if _table_exists(con, "datasets"):
                try:
                    total_datasets = con.execute(
                        "SELECT COUNT(*) FROM datasets WHERE archived = FALSE OR archived IS NULL"
                    ).fetchone()[0]
                except Exception:
                    logger.debug("Failed to load filtered dataset count; falling back to total datasets count", exc_info=True)
                    total_datasets = con.execute("SELECT COUNT(*) FROM datasets").fetchone()[0]
            else:
                total_datasets = 0
            
            # Available years for year selector
            try:
                available_years_df = con.execute(
                    """
                    SELECT DISTINCT reporting_year 
                    FROM jobs 
                    WHERE reporting_year IS NOT NULL
                    ORDER BY reporting_year DESC
                    """
                ).df()
            except Exception:
                logger.exception("Failed to load dashboard reporting years; defaulting to current year only")
                available_years_df = None
            
            years_list = []
            if available_years_df is not None and not available_years_df.empty:
                years_list = [
                    normalized_year
                    for year_value in available_years_df["reporting_year"].tolist()
                    if (normalized_year := _normalize_int_value(year_value)) is not None
                ]
            current_year = date.today().year
            if current_year not in years_list:
                years_list = [current_year, *years_list]

            # Available industries (for filter dropdown)
            try:
                industries_df = con.execute(
                    "SELECT DISTINCT industry FROM clients WHERE industry IS NOT NULL ORDER BY industry"
                ).df()
            except Exception:
                logger.exception("Failed to load dashboard industries; defaulting to empty list")
                industries_df = None
            available_industries = [
                _normalize_text_value(row.get("industry"), "Unspecified")
                for _, row in industries_df.iterrows()
            ] if industries_df is not None else []

            crm_options = _load_dashboard_crm_options(con, org_id)
            available_crm = [str(option.get("label") or option.get("value") or "").strip() for option in crm_options if str(option.get("label") or option.get("value") or "").strip()]
            available_job_families = ["crp", "training", "consultancy", "lca", "pcf"]
            if _table_exists(con, "job_types") and (_column_exists(con, "job_types", "job_group") or _column_exists(con, "job_types", "job_family")):
                try:
                    families_df = con.execute(
                        """
                        SELECT DISTINCT LOWER(TRIM(COALESCE(NULLIF(TRIM(job_group), ''), NULLIF(TRIM(job_family), ''), 'crp'))) AS job_family
                        FROM job_types
                        WHERE COALESCE(NULLIF(TRIM(job_group), ''), NULLIF(TRIM(job_family), ''), '') <> ''
                        ORDER BY job_family
                        """
                    ).df()
                    families = [
                        _normalize_text_value(row.get("job_family"), "").strip().lower()
                        for _, row in families_df.iterrows()
                        if _normalize_text_value(row.get("job_family"), "").strip()
                    ] if families_df is not None and not families_df.empty else []
                    if families:
                        available_job_families = sorted(set(available_job_families).union(families))
                except Exception:
                    logger.debug("Failed to load dashboard job group list; using defaults", exc_info=True)
            has_job_types_table = _table_exists(con, "job_types")
            has_job_type_id = _column_exists(con, "jobs", "job_type_id")
            has_job_type_text = _column_exists(con, "jobs", "job_type")
            has_job_group_text = _column_exists(con, "job_types", "job_group")
            has_job_family_text = _column_exists(con, "job_types", "job_family")
            has_job_due_date = _column_exists(con, "jobs", "due_date")
            if has_job_types_table and has_job_type_id:
                job_type_join = "LEFT JOIN job_types jt ON jt.job_type_id = j.job_type_id"
                job_family_expr = "COALESCE(NULLIF(TRIM(jt.job_group), ''), NULLIF(TRIM(jt.job_family), ''), 'crp')" if (has_job_group_text or has_job_family_text) else "'crp'"
                if has_job_type_text:
                    job_type_name_expr = "COALESCE(NULLIF(TRIM(jt.name), ''), NULLIF(TRIM(j.job_type), ''), 'Unassigned')"
                else:
                    job_type_name_expr = "COALESCE(NULLIF(TRIM(jt.name), ''), 'Unassigned')"
            elif has_job_type_text:
                job_type_join = ""
                job_type_name_expr = "COALESCE(NULLIF(TRIM(j.job_type), ''), 'Unassigned')"
                job_family_expr = "COALESCE(NULLIF(TRIM(j.job_group), ''), NULLIF(TRIM(j.job_family), ''), 'crp')" if (_column_exists(con, "jobs", "job_group") or _column_exists(con, "jobs", "job_family")) else "'crp'"
            else:
                job_type_join = ""
                job_type_name_expr = "'Unassigned'"
                job_family_expr = "'crp'"

            # Industry breakdown (count of active clients by industry)
            industry_breakdown = []
            client_count_sql = "SELECT COALESCE(industry,'Unspecified') AS industry, COUNT(*) AS client_count FROM clients c"
            if client_filters:
                client_count_sql += f" WHERE {' AND '.join(client_filters)}"
            client_count_sql += " GROUP BY COALESCE(industry,'Unspecified') ORDER BY client_count DESC"
            try:
                ind_df = con.execute(client_count_sql, client_params).df()
            except Exception:
                logger.debug("Failed to load dashboard industry breakdown; returning empty breakdown", exc_info=True)
                ind_df = None
            if ind_df is not None and not ind_df.empty:
                for _, r in ind_df.iterrows():
                    industry_breakdown.append({
                        "industry": r['industry'],
                        "client_count": int(r['client_count'])
                    })

            # Recent jobs (last 5, ordered by most recent changes)
            if _table_exists(con, "job_plan"):
                try:
                    recent_jobs_df = con.execute(
                        f"""
                        SELECT
                            j.job_id,
                            j.title,
                            j.reporting_year,
                            j.status,
                            c.client_name,
                            j.start_date,
                            j.created_at,
                            jp.data_collection_due,
                            jp.data_collection_completed_at,
                            jp.first_draft_due,
                            jp.first_draft_completed_at,
                            jp.final_report_due,
                            jp.final_report_completed_at,
                            {job_type_name_expr} AS job_type_name,
                            {job_family_expr} AS job_family
                        FROM jobs j
                        LEFT JOIN clients c ON j.client_db_id = c.db_id
                        {job_type_join}
                        LEFT JOIN job_plan jp ON j.job_id = jp.job_id
                        WHERE 1=1{job_where}
                        ORDER BY j.created_at DESC NULLS LAST, j.job_id DESC
                        LIMIT 5
                        """,
                        job_params
                    ).df()
                except Exception:
                    logger.debug("Failed to load dashboard recent jobs from job_plan path; trying fallback query", exc_info=True)
                    recent_jobs_df = con.execute(
                        f"""
                        SELECT
                            j.job_id,
                            j.title,
                            j.reporting_year,
                            j.status,
                            c.client_name,
                            j.start_date,
                            j.created_at,
                            NULL as data_collection_due,
                            NULL as data_collection_completed_at,
                            NULL as first_draft_due,
                            NULL as first_draft_completed_at,
                            NULL as final_report_due,
                            NULL as final_report_completed_at,
                            {job_type_name_expr} AS job_type_name,
                            {job_family_expr} AS job_family
                        FROM jobs j
                        LEFT JOIN clients c ON j.client_db_id = c.db_id
                        {job_type_join}
                        WHERE 1=1{job_where}
                        ORDER BY j.created_at DESC NULLS LAST, j.job_id DESC
                        LIMIT 5
                        """,
                        job_params
                    ).df()
            else:
                recent_jobs_df = con.execute(
                    f"""
                    SELECT
                        j.job_id,
                        j.title,
                        j.reporting_year,
                        j.status,
                        c.client_name,
                        j.start_date,
                        j.created_at,
                        NULL as data_collection_due,
                        NULL as data_collection_completed_at,
                        NULL as first_draft_due,
                        NULL as first_draft_completed_at,
                        NULL as final_report_due,
                        NULL as final_report_completed_at,
                        {job_type_name_expr} AS job_type_name,
                        {job_family_expr} AS job_family
                    FROM jobs j
                    LEFT JOIN clients c ON j.client_db_id = c.db_id
                    {job_type_join}
                    WHERE 1=1{job_where}
                    ORDER BY j.created_at DESC NULLS LAST, j.job_id DESC
                    LIMIT 5
                    """,
                    job_params
                ).df()
            
            # Helper function to calculate milestone status
            def get_milestone_status(due_date, completed_at):
                """Calculate traffic light status: green, amber, red, completed"""
                if completed_at:
                    return "completed"
                due = _normalize_to_date(due_date)
                if not due:
                    return "green"

                from datetime import date
                today = date.today()
                days_until_due = (due - today).days

                if days_until_due < -1:  # Overdue by more than 1 day
                    return "red"
                elif days_until_due <= 7:  # Due within 7 days or 1 day overdue
                    return "amber"
                else:
                    return "green"
            
            def get_overall_status(statuses):
                """Get the worst status from a list of statuses"""
                if "red" in statuses:
                    return "red"
                elif "amber" in statuses:
                    return "amber"
                elif "green" in statuses:
                    return "green"
                elif "completed" in statuses:
                    return "completed"
                else:
                    return None
            
            recent_activity = []
            if recent_jobs_df is not None and not recent_jobs_df.empty:
                for _, row in recent_jobs_df.iterrows():
                    # Calculate individual milestone statuses
                    milestone_statuses = []
                    if _normalize_to_date(row.get("data_collection_due")) is not None:
                        milestone_statuses.append(get_milestone_status(row.get("data_collection_due"), row.get("data_collection_completed_at")))
                    if _normalize_to_date(row.get("first_draft_due")) is not None:
                        milestone_statuses.append(get_milestone_status(row.get("first_draft_due"), row.get("first_draft_completed_at")))
                    if _normalize_to_date(row.get("final_report_due")) is not None:
                        milestone_statuses.append(get_milestone_status(row.get("final_report_due"), row.get("final_report_completed_at")))
                    
                    # Calculate overall status
                    overall_milestone_status = get_overall_status(milestone_statuses) if milestone_statuses else None
                    
                    recent_activity.append({
                        "job_id": _normalize_int_value(row.get("job_id")) or 0,
                        "title": _normalize_text_value(row.get("title"), "Unassigned"),
                        "reporting_year": _normalize_int_value(row['reporting_year']),
                        "status": _normalize_text_value(row.get("status"), "Unknown"),
                        "client_name": _normalize_text_value(row.get("client_name"), "Unspecified"),
                        "job_type": _normalize_text_value(row.get("job_type_name"), "Unassigned"),
                        "job_family": _normalize_text_value(row.get("job_family"), "crp"),
                        "start_date": row.get("start_date"),
                        "milestone_status": overall_milestone_status,
                    })

            jobs_by_type = []
            try:
                jobs_by_type_df = con.execute(
                    f"""
                    SELECT
                        {job_family_expr} AS job_type,
                        {job_family_expr} AS job_family,
                        COUNT(*) AS total_jobs,
                        SUM(CASE WHEN LOWER(COALESCE(NULLIF(TRIM(j.status), ''), 'Unknown')) NOT IN ('completed', 'archived', 'cancelled') THEN 1 ELSE 0 END) AS active_jobs,
                        SUM(CASE WHEN LOWER(COALESCE(NULLIF(TRIM(j.status), ''), 'Unknown')) = 'completed' THEN 1 ELSE 0 END) AS completed_jobs
                    FROM jobs j
                    LEFT JOIN clients c ON j.client_db_id = c.db_id
                    {job_type_join}
                    WHERE 1=1{job_where}
                    GROUP BY 1
                    ORDER BY total_jobs DESC, job_family ASC
                    LIMIT 12
                    """,
                    job_params,
                ).df()
            except Exception:
                logger.debug("Failed to load dashboard jobs by type breakdown; returning empty list", exc_info=True)
                jobs_by_type_df = None
            if jobs_by_type_df is not None and not jobs_by_type_df.empty:
                for _, row in jobs_by_type_df.iterrows():
                    jobs_by_type.append({
                        "job_type": _normalize_text_value(row.get("job_type"), "Unassigned"),
                        "job_family": _normalize_text_value(row.get("job_family"), "crp"),
                        "total_jobs": _normalize_int_value(row.get("total_jobs")) or 0,
                        "active_jobs": _normalize_int_value(row.get("active_jobs")) or 0,
                        "completed_jobs": _normalize_int_value(row.get("completed_jobs")) or 0,
                    })

            job_renewals = []
            renewal_summary = {
                "overdue": 0,
                "due_30": 0,
                "due_60": 0,
                "due_90": 0,
            }
            if has_job_due_date:
                try:
                    job_renewals_df = con.execute(
                        f"""
                        SELECT
                            j.job_id,
                            j.job_number,
                            j.title,
                            c.client_name,
                            j.due_date,
                            COALESCE(NULLIF(TRIM(j.status), ''), 'Unknown') AS status,
                            {crm_expr} AS crm_name
                        FROM jobs j
                        LEFT JOIN clients c ON j.client_db_id = c.db_id
                        WHERE 1=1{job_where}
                          AND j.due_date IS NOT NULL
                          AND LOWER(COALESCE(NULLIF(TRIM(j.status), ''), 'Unknown')) NOT IN ('completed', 'archived', 'cancelled')
                        ORDER BY j.due_date ASC NULLS LAST, j.job_id DESC
                        LIMIT 12
                        """,
                        job_params,
                    ).df()
                except Exception:
                    logger.debug("Failed to load dashboard job renewals breakdown; returning empty list", exc_info=True)
                    job_renewals_df = None
                if job_renewals_df is not None and not job_renewals_df.empty:
                    from datetime import date as _date

                    for _, row in job_renewals_df.iterrows():
                        due_date = _normalize_to_date(row.get("due_date"))
                        if due_date is None:
                            continue
                        days_remaining = (due_date - _date.today()).days
                        if days_remaining > 90:
                            continue
                        if days_remaining <= 0:
                            renewal_summary["overdue"] += 1
                        if days_remaining <= 30:
                            renewal_summary["due_30"] += 1
                        if days_remaining <= 60:
                            renewal_summary["due_60"] += 1
                        if days_remaining <= 90:
                            renewal_summary["due_90"] += 1
                        job_renewals.append({
                            "job_id": _normalize_int_value(row.get("job_id")) or 0,
                            "job_number": _normalize_text_value(row.get("job_number"), ""),
                            "title": _normalize_text_value(row.get("title"), "Unassigned"),
                            "client_name": _normalize_text_value(row.get("client_name"), "Unassigned"),
                            "crm_name": _normalize_text_value(row.get("crm_name"), "Unassigned"),
                            "due_date": due_date.isoformat(),
                            "days_remaining": days_remaining,
                            "status": _normalize_text_value(row.get("status"), "Unknown"),
                        })

            # Jobs per CRM by status (using current client CRM owner)
            try:
                crm_status_df = con.execute(
                    f"""
                    SELECT 
                        COALESCE(c.crm_owner, 'Unassigned') as crm_name,
                        COALESCE(j.status, 'Unknown') as status,
                        COUNT(*) as count
                    FROM jobs j
                    LEFT JOIN clients c ON j.client_db_id = c.db_id
                    WHERE 1=1{job_where}
                    GROUP BY c.crm_owner, j.status
                    ORDER BY crm_name, status
                    """,
                    job_params,
                ).df()
            except Exception:
                logger.exception("Failed to load dashboard CRM status breakdown; continuing with empty breakdown")
                crm_status_df = None
            
            # Organize data by CRM with status breakdown
            crm_status_data = {}
            if crm_status_df is not None and not crm_status_df.empty:
                for _, row in crm_status_df.iterrows():
                    crm = _normalize_text_value(row.get("crm_name"), "Unassigned")
                    status = _normalize_text_value(row.get("status"), "Unknown")
                    count = _normalize_int_value(row.get("count")) or 0
                    
                    if crm not in crm_status_data:
                        crm_status_data[crm] = {
                            "crm_name": crm,
                            "total_jobs": 0,
                            "statuses": {}
                        }
                    
                    crm_status_data[crm]["statuses"][status] = count
                    crm_status_data[crm]["total_jobs"] += count
            
            jobs_per_crm = list(crm_status_data.values())

            # Year-over-year emissions change (%), null when prior year has no baseline
            yoy_change = None
            if prev_year_emissions and prev_year_emissions > 0:
                yoy_change = ((total_emissions - prev_year_emissions) / prev_year_emissions) * 100.0
            
            return {
                "selected_year": int(year),
                "available_years": years_list,
                "available_industries": available_industries,
                "available_crm": available_crm,
                "available_job_families": available_job_families,
                "crm_options": crm_options,
                "year_trend": year_trend,
                "industry_breakdown": industry_breakdown,
                "metrics": {
                    "total_clients": int(clients_count),
                    "total_emissions": round(total_emissions, 1),
                    "active_jobs": int(active_jobs),
                    "total_datasets": int(total_datasets),
                    "yoy_change": round(yoy_change, 1) if yoy_change is not None else None
                },
                "job_status_breakdown": status_breakdown,
                "top_emitting_clients": top_emitting_clients,
                "recent_activity": recent_activity,
                "jobs_per_crm": jobs_per_crm,
                "jobs_by_type": jobs_by_type,
                "job_renewals": job_renewals,
                "renewal_summary": renewal_summary,
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to fetch dashboard overview; returning empty fallback")
        current_year = date.today().year
        return {
            "selected_year": int(year) if isinstance(year, int) else current_year,
            "available_years": [current_year],
            "available_industries": [],
            "available_crm": [],
            "available_job_families": ["crp", "training", "consultancy", "lca", "pcf"],
            "crm_options": [],
            "year_trend": [],
            "industry_breakdown": [],
            "metrics": {
                "total_clients": 0,
                "total_emissions": 0.0,
                "active_jobs": 0,
                "total_datasets": 0,
                "yoy_change": None,
            },
            "job_status_breakdown": [],
            "top_emitting_clients": [],
            "recent_activity": [],
            "jobs_per_crm": [],
            "jobs_by_type": [],
            "job_renewals": [],
            "renewal_summary": {
                "overdue": 0,
                "due_30": 0,
                "due_60": 0,
                "due_90": 0,
            },
            "warning": f"dashboard_overview_unavailable: {e}",
        }


@router.get("/dashboard/financial-overview")
def get_dashboard_financial_overview(
    year: int = Query(None, description="Reporting year filter"),
    industry: str | None = Query(None, description="Optional industry filter"),
    crm_owner: str | None = Query(None, description="Optional CRM owner filter"),
    job_family: str | None = Query(None, description="Optional job group filter"),
    _user: dict[str, str] = Depends(_current_user)
):
    """Portfolio-level quote and invoice intelligence for Insights."""
    try:
        family = str(job_family or "").strip().lower() or None
        with get_conn() as con:
            if not _table_exists(con, "quotes") or not _table_exists(con, "quote_lines") or not _table_exists(con, "invoices"):
                return {
                    "metrics": {
                        "quote_count": 0,
                        "quote_value_total": 0.0,
                        "approved_quote_value": 0.0,
                        "invoice_count": 0,
                        "invoice_total": 0.0,
                        "paid_total": 0.0,
                        "outstanding_total": 0.0,
                        "overdue_invoice_count": 0,
                        "cash_realisation_pct": 0.0,
                    },
                    "quote_status_breakdown": [],
                    "invoice_status_breakdown": [],
                    "monthly_quotes": [],
                    "monthly_invoices": [],
                    "top_clients_by_invoiced_total": [],
                    "quote_currencies": [],
                    "invoice_currencies": [],
                }

            has_quote_job_number = _column_exists(con, "quotes", "job_number") and _column_exists(con, "jobs", "job_number")
            has_quote_approved_at = _column_exists(con, "quotes", "approved_at")
            has_quote_currency = _column_exists(con, "quotes", "currency_code")
            has_quote_line_vat = _column_exists(con, "quote_lines", "vat_rate_pct")
            has_invoice_job_id = _column_exists(con, "invoices", "job_id")
            has_invoice_amount_paid = _column_exists(con, "invoices", "amount_paid")
            has_invoice_currency = _column_exists(con, "invoices", "currency_code")

            quote_where_parts: list[str] = []
            quote_params: list[object] = []
            invoice_where_parts: list[str] = []
            invoice_params: list[object] = []

            _apply_client_filters(
                quote_where_parts,
                quote_params,
                client_alias="c",
                industry=industry,
                crm_owner=crm_owner,
            )
            _apply_client_filters(
                invoice_where_parts,
                invoice_params,
                client_alias="c",
                industry=industry,
                crm_owner=crm_owner,
            )
            _apply_job_family_filter(quote_where_parts, quote_params, job_alias="j", job_family=family)
            _apply_job_family_filter(invoice_where_parts, invoice_params, job_alias="j", job_family=family)
            _financial_year_filter(
                quote_where_parts,
                quote_params,
                date_expr="COALESCE(q.quote_date, q.created_at::date)",
                job_year_expr=("j.reporting_year" if has_quote_job_number else "NULL"),
                year=year,
                job_family=job_family,
            )
            _financial_year_filter(
                invoice_where_parts,
                invoice_params,
                date_expr="COALESCE(i.invoice_date, i.created_at::date)",
                job_year_expr=(
                    "COALESCE(j.reporting_year, jq.reporting_year)"
                    if has_invoice_job_id and has_quote_job_number
                    else ("j.reporting_year" if has_invoice_job_id else ("jq.reporting_year" if has_quote_job_number else "NULL"))
                ),
                year=year,
                job_family=job_family,
            )

            quote_where = f"WHERE {' AND '.join(quote_where_parts)}" if quote_where_parts else ""
            invoice_where = f"WHERE {' AND '.join(invoice_where_parts)}" if invoice_where_parts else ""
            quote_job_join = "LEFT JOIN jobs j ON j.job_number = q.job_number" if has_quote_job_number else "LEFT JOIN jobs j ON 1=0"
            invoice_job_join = "LEFT JOIN jobs j ON j.job_id = i.job_id" if has_invoice_job_id else "LEFT JOIN jobs j ON 1=0"
            invoice_quote_join = "LEFT JOIN quotes q ON q.quote_id = i.quote_id"
            invoice_quote_job_join = "LEFT JOIN jobs jq ON jq.job_number = q.job_number" if has_quote_job_number else "LEFT JOIN jobs jq ON 1=0"
            quote_approved_expr = "q.approved_at" if has_quote_approved_at else "NULL"
            quote_currency_expr = "COALESCE(q.currency_code, 'GBP')" if has_quote_currency else "'GBP'"
            invoice_currency_expr = "COALESCE(i.currency_code, 'GBP')" if has_invoice_currency else "'GBP'"
            quote_vat_expr = "COALESCE(ql.vat_rate_pct, 0)" if has_quote_line_vat else "0"
            invoice_amount_paid_expr = "COALESCE(i.amount_paid, 0)" if has_invoice_amount_paid else "0"

            quote_cte = f"""
                WITH quote_totals AS (
                    SELECT
                        q.quote_id,
                        q.client_db_id,
                        c.client_name,
                        COALESCE(NULLIF(TRIM(q.status), ''), 'Unknown') AS status,
                        {quote_approved_expr} AS approved_at,
                        {quote_currency_expr} AS currency_code,
                        DATE_TRUNC('month', COALESCE(q.quote_date, q.created_at::date))::date AS month_start,
                        COALESCE(SUM(
                            CASE
                                WHEN LOWER(COALESCE(ql.line_type, 'main')) = 'option' THEN 0
                                ELSE COALESCE(ql.qty, 0) * COALESCE(ql.unit_price_ex_vat, 0) * (1 + {quote_vat_expr} / 100.0)
                            END
                        ), 0) AS total_value
                    FROM quotes q
                    LEFT JOIN quote_lines ql ON q.quote_id = ql.quote_id
                    LEFT JOIN clients c ON c.db_id = q.client_db_id
                    {quote_job_join}
                    {quote_where}
                    GROUP BY 1, 2, 3, 4, 5, 6, 7
                )
            """

            invoice_cte = f"""
                WITH invoice_totals AS (
                    SELECT
                        i.invoice_id,
                        i.client_db_id,
                        c.client_name,
                        COALESCE(NULLIF(TRIM(i.status), ''), 'Unknown') AS status,
                        {invoice_currency_expr} AS currency_code,
                        DATE_TRUNC('month', COALESCE(i.invoice_date, i.created_at::date))::date AS month_start,
                        COALESCE(i.total, 0) AS total_value,
                        {invoice_amount_paid_expr} AS amount_paid,
                        i.due_date
                    FROM invoices i
                    LEFT JOIN clients c ON c.db_id = i.client_db_id
                    {invoice_job_join}
                    {invoice_quote_join}
                    {invoice_quote_job_join}
                    {invoice_where}
                )
            """

            quote_metrics_row = con.execute(
                f"""
                {quote_cte}
                SELECT
                    COUNT(*) AS quote_count,
                    COALESCE(SUM(total_value), 0) AS quote_value_total,
                    COALESCE(SUM(
                        CASE
                            WHEN approved_at IS NOT NULL OR LOWER(status) = 'approved' THEN total_value
                            ELSE 0
                        END
                    ), 0) AS approved_quote_value
                FROM quote_totals
                """,
                quote_params,
            ).fetchone()

            invoice_metrics_row = con.execute(
                f"""
                {invoice_cte}
                SELECT
                    COUNT(*) AS invoice_count,
                    COALESCE(SUM(total_value), 0) AS invoice_total,
                    COALESCE(SUM(
                        CASE
                            WHEN amount_paid > 0 THEN amount_paid
                            WHEN LOWER(status) = 'paid' THEN total_value
                            ELSE 0
                        END
                    ), 0) AS paid_total,
                    COALESCE(SUM(
                        CASE
                            WHEN LOWER(status) IN ('paid', 'void') THEN 0
                            ELSE GREATEST(total_value - amount_paid, 0)
                        END
                    ), 0) AS outstanding_total,
                    COALESCE(SUM(
                        CASE
                            WHEN LOWER(status) = 'overdue'
                                 OR (LOWER(status) NOT IN ('paid', 'void')
                                     AND due_date IS NOT NULL
                                     AND due_date < CURRENT_DATE
                                     AND GREATEST(total_value - amount_paid, 0) > 0)
                            THEN 1
                            ELSE 0
                        END
                    ), 0) AS overdue_invoice_count
                FROM invoice_totals
                """,
                invoice_params,
            ).fetchone()

            quote_status_df = con.execute(
                f"""
                {quote_cte}
                SELECT status, COUNT(*) AS count, COALESCE(SUM(total_value), 0) AS total_value
                FROM quote_totals
                GROUP BY status
                ORDER BY total_value DESC, count DESC, status
                """,
                quote_params,
            ).df()

            invoice_status_df = con.execute(
                f"""
                {invoice_cte}
                SELECT status, COUNT(*) AS count, COALESCE(SUM(total_value), 0) AS total_value
                FROM invoice_totals
                GROUP BY status
                ORDER BY total_value DESC, count DESC, status
                """,
                invoice_params,
            ).df()

            monthly_quotes_df = con.execute(
                f"""
                {quote_cte}
                SELECT month_start, COUNT(*) AS count, COALESCE(SUM(total_value), 0) AS total_value
                FROM quote_totals
                GROUP BY month_start
                ORDER BY month_start
                """,
                quote_params,
            ).df()

            monthly_invoices_df = con.execute(
                f"""
                {invoice_cte}
                SELECT
                    month_start,
                    COUNT(*) AS count,
                    COALESCE(SUM(total_value), 0) AS total_value,
                    COALESCE(SUM(
                        CASE
                            WHEN amount_paid > 0 THEN amount_paid
                            WHEN LOWER(status) = 'paid' THEN total_value
                            ELSE 0
                        END
                    ), 0) AS paid_total
                FROM invoice_totals
                GROUP BY month_start
                ORDER BY month_start
                """,
                invoice_params,
            ).df()

            top_clients_df = con.execute(
                f"""
                {invoice_cte}
                SELECT
                    client_db_id,
                    COALESCE(client_name, 'Unknown client') AS client_name,
                    COALESCE(SUM(total_value), 0) AS invoice_total,
                    COALESCE(SUM(
                        CASE
                            WHEN amount_paid > 0 THEN amount_paid
                            WHEN LOWER(status) = 'paid' THEN total_value
                            ELSE 0
                        END
                    ), 0) AS paid_total,
                    COALESCE(SUM(
                        CASE
                            WHEN LOWER(status) IN ('paid', 'void') THEN 0
                            ELSE GREATEST(total_value - amount_paid, 0)
                        END
                    ), 0) AS outstanding_total
                FROM invoice_totals
                GROUP BY client_db_id, COALESCE(client_name, 'Unknown client')
                HAVING COALESCE(SUM(total_value), 0) > 0
                ORDER BY invoice_total DESC, client_name
                LIMIT 8
                """,
                invoice_params,
            ).df()

            quote_currency_df = con.execute(
                f"""
                {quote_cte}
                SELECT DISTINCT currency_code
                FROM quote_totals
                WHERE currency_code IS NOT NULL AND TRIM(currency_code) <> ''
                ORDER BY currency_code
                """,
                quote_params,
            ).df()
            invoice_currency_df = con.execute(
                f"""
                {invoice_cte}
                SELECT DISTINCT currency_code
                FROM invoice_totals
                WHERE currency_code IS NOT NULL AND TRIM(currency_code) <> ''
                ORDER BY currency_code
                """,
                invoice_params,
            ).df()

            quote_count = int(quote_metrics_row[0] or 0) if quote_metrics_row else 0
            quote_value_total = float(quote_metrics_row[1] or 0.0) if quote_metrics_row else 0.0
            approved_quote_value = float(quote_metrics_row[2] or 0.0) if quote_metrics_row else 0.0

            invoice_count = int(invoice_metrics_row[0] or 0) if invoice_metrics_row else 0
            invoice_total = float(invoice_metrics_row[1] or 0.0) if invoice_metrics_row else 0.0
            paid_total = float(invoice_metrics_row[2] or 0.0) if invoice_metrics_row else 0.0
            outstanding_total = float(invoice_metrics_row[3] or 0.0) if invoice_metrics_row else 0.0
            overdue_invoice_count = int(invoice_metrics_row[4] or 0) if invoice_metrics_row else 0

            cash_realisation_pct = (paid_total / invoice_total * 100.0) if invoice_total > 0 else 0.0

            def _month_label(value) -> str:
                if value is None:
                    return "Unknown"
                if hasattr(value, "strftime"):
                    return value.strftime("%b %Y")
                return str(value)

            quote_status_breakdown = []
            if quote_status_df is not None and not quote_status_df.empty:
                for _, row in quote_status_df.iterrows():
                    quote_status_breakdown.append({
                        "status": row["status"],
                        "count": int(row["count"]),
                        "total_value": round(float(row["total_value"] or 0.0), 2),
                    })

            invoice_status_breakdown = []
            if invoice_status_df is not None and not invoice_status_df.empty:
                for _, row in invoice_status_df.iterrows():
                    invoice_status_breakdown.append({
                        "status": row["status"],
                        "count": int(row["count"]),
                        "total_value": round(float(row["total_value"] or 0.0), 2),
                    })

            monthly_quotes = []
            if monthly_quotes_df is not None and not monthly_quotes_df.empty:
                for _, row in monthly_quotes_df.iterrows():
                    monthly_quotes.append({
                        "month": _month_label(row["month_start"]),
                        "count": int(row["count"]),
                        "total_value": round(float(row["total_value"] or 0.0), 2),
                    })

            monthly_invoices = []
            if monthly_invoices_df is not None and not monthly_invoices_df.empty:
                for _, row in monthly_invoices_df.iterrows():
                    monthly_invoices.append({
                        "month": _month_label(row["month_start"]),
                        "count": int(row["count"]),
                        "total_value": round(float(row["total_value"] or 0.0), 2),
                        "paid_total": round(float(row["paid_total"] or 0.0), 2),
                    })

            top_clients_by_invoiced_total = []
            if top_clients_df is not None and not top_clients_df.empty:
                for _, row in top_clients_df.iterrows():
                    top_clients_by_invoiced_total.append({
                        "client_id": int(row["client_db_id"]) if row["client_db_id"] is not None else None,
                        "client_name": row["client_name"],
                        "invoice_total": round(float(row["invoice_total"] or 0.0), 2),
                        "paid_total": round(float(row["paid_total"] or 0.0), 2),
                        "outstanding_total": round(float(row["outstanding_total"] or 0.0), 2),
                    })

            quote_currencies = []
            if quote_currency_df is not None and not quote_currency_df.empty:
                quote_currencies = [str(row["currency_code"]) for _, row in quote_currency_df.iterrows() if row["currency_code"]]
            invoice_currencies = []
            if invoice_currency_df is not None and not invoice_currency_df.empty:
                invoice_currencies = [str(row["currency_code"]) for _, row in invoice_currency_df.iterrows() if row["currency_code"]]

            return {
                "metrics": {
                    "quote_count": quote_count,
                    "quote_value_total": round(quote_value_total, 2),
                    "approved_quote_value": round(approved_quote_value, 2),
                    "invoice_count": invoice_count,
                    "invoice_total": round(invoice_total, 2),
                    "paid_total": round(paid_total, 2),
                    "outstanding_total": round(outstanding_total, 2),
                    "overdue_invoice_count": overdue_invoice_count,
                    "cash_realisation_pct": round(cash_realisation_pct, 1),
                },
                "quote_status_breakdown": quote_status_breakdown,
                "invoice_status_breakdown": invoice_status_breakdown,
                "monthly_quotes": monthly_quotes,
                "monthly_invoices": monthly_invoices,
                "top_clients_by_invoiced_total": top_clients_by_invoiced_total,
                "quote_currencies": quote_currencies,
                "invoice_currencies": invoice_currencies,
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch dashboard financial overview: {e}")


@router.get("/dashboard/jobs-by-milestone-status")
def get_jobs_by_milestone_status(
    job_family: str | None = Query(None, description="Optional job group filter"),
    _user: dict[str, str] = Depends(_current_user),
):
    """
    Get count of jobs grouped by their overall milestone status (green, amber, red)
    """
    try:
        from datetime import date
        
        def get_milestone_status(due_date, completed_at):
            """Calculate traffic light status: green, amber, red, completed"""
            if _normalize_to_date(completed_at) is not None:
                return "completed"
            due_date = _normalize_to_date(due_date)
            if not due_date:
                return "green"

            today = date.today()
            days_until_due = (due_date - today).days
            
            if days_until_due < -1:
                return "red"
            elif days_until_due <= 7:
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
        
        with get_conn() as con:
            family = str(job_family or "").strip().lower() or None
            # If milestone table does not exist yet, return safe empty counts
            if not _table_exists(con, "job_plan"):
                total_jobs_query = "SELECT COUNT(*) FROM jobs j"
                total_jobs_params: list[object] = []
                if family:
                    total_jobs_query += f" WHERE {_job_family_expression('j')} = ?"
                    total_jobs_params.append(family)
                total_jobs = con.execute(total_jobs_query, total_jobs_params).fetchone()[0]
                return {
                    "green": 0,
                    "amber": 0,
                    "red": 0,
                    "no_milestones": int(total_jobs),
                    "total": int(total_jobs),
                }

            # Get all jobs with their milestone data
            try:
                where_parts = []
                params: list[object] = []
                _apply_job_family_filter(where_parts, params, job_alias="j", job_family=family)
                where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
                jobs_df = con.execute(
                    """
                    SELECT
                        j.job_id,
                        jp.data_collection_due, jp.data_collection_completed_at,
                        jp.first_draft_due, jp.first_draft_completed_at,
                        jp.final_report_due, jp.final_report_completed_at
                    FROM jobs j
                    LEFT JOIN job_plan jp ON jp.job_id = j.job_id
                    """ + f" {where_sql}"
            ).df()
            except Exception:
                logger.debug("Failed to load dashboard milestone summary; falling back to no-milestones total", exc_info=True)
                total_jobs_query = "SELECT COUNT(*) FROM jobs j"
                total_jobs_params: list[object] = []
                if family:
                    total_jobs_query += f" WHERE {_job_family_expression('j')} = ?"
                    total_jobs_params.append(family)
                total_jobs = con.execute(total_jobs_query, total_jobs_params).fetchone()[0]
                return {
                    "green": 0,
                    "amber": 0,
                    "red": 0,
                    "no_milestones": int(total_jobs),
                    "total": int(total_jobs),
                }
            
            status_counts = {
                "green": 0,
                "amber": 0,
                "red": 0,
                "no_milestones": 0
            }
            
            if jobs_df is not None and not jobs_df.empty:
                for _, row in jobs_df.iterrows():
                    milestone_statuses = []
                    
                    if _normalize_to_date(row.get("data_collection_due")) is not None:
                        milestone_statuses.append(get_milestone_status(
                            row.get("data_collection_due"), 
                            row.get("data_collection_completed_at")
                        ))
                    if _normalize_to_date(row.get("first_draft_due")) is not None:
                        milestone_statuses.append(get_milestone_status(
                            row.get("first_draft_due"), 
                            row.get("first_draft_completed_at")
                        ))
                    if _normalize_to_date(row.get("final_report_due")) is not None:
                        milestone_statuses.append(get_milestone_status(
                            row.get("final_report_due"), 
                            row.get("final_report_completed_at")
                        ))
                    
                    if milestone_statuses:
                        overall_status = get_overall_status(milestone_statuses)
                        status_counts[overall_status] += 1
                    else:
                        status_counts["no_milestones"] += 1
            
            return {
                "green": status_counts["green"],
                "amber": status_counts["amber"],
                "red": status_counts["red"],
                "no_milestones": status_counts["no_milestones"],
                "total": sum(status_counts.values())
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch jobs by milestone status: {e}")


@router.get("/dashboard/tasks")
def get_dashboard_tasks(
    crm_owner: str | None = Query(None, description="Optional CRM owner filter"),
    include_done: bool = Query(default=False, description="Include completed tasks"),
    limit: int = Query(default=300, ge=1, le=500),
    _user: dict[str, str] = Depends(_current_user),
):
    """Portfolio-wide CRM tasks for the dashboard calendar and priority queue."""
    try:
        org_id = require_org(_user)
        with get_conn() as con:
            if not _table_exists(con, "crm_tasks"):
                return {"items": [], "count": 0}

            where_parts = ["c.org_id = ?"]
            params: list[object] = [org_id]
            if not include_done:
                where_parts.append("LOWER(COALESCE(t.status, 'open')) NOT IN ('done', 'closed')")
            if crm_owner:
                crm_value = str(crm_owner).strip()
                if crm_value.lower() == "unassigned":
                    where_parts.append("(COALESCE(NULLIF(TRIM(c.crm_owner), ''), 'Unassigned') = 'Unassigned' OR COALESCE(NULLIF(TRIM(j.crm_name), ''), 'Unassigned') = 'Unassigned')")
                else:
                    where_parts.append("(COALESCE(NULLIF(TRIM(c.crm_owner), ''), 'Unassigned') = ? OR COALESCE(NULLIF(TRIM(j.crm_name), ''), 'Unassigned') = ?)")
                    params.extend([crm_value, crm_value])

            where_sql = " AND ".join(where_parts)

            count_row = con.execute(
                f"""
                SELECT COUNT(*)
                FROM crm_tasks t
                LEFT JOIN clients c ON c.db_id = t.client_db_id
                LEFT JOIN jobs j ON j.job_id = t.job_id
                WHERE {where_sql}
                """,
                params,
            ).fetchone()
            total_count = int(count_row[0]) if count_row and count_row[0] is not None else 0

            df = con.execute(
                f"""
                SELECT
                    t.task_id,
                    t.event_id,
                    t.client_db_id,
                    t.job_id,
                    t.title,
                    t.details,
                    t.assignee_user_id,
                    t.priority,
                    t.sla_due_at,
                    t.due_at,
                    t.status,
                    t.completed_at,
                    t.created_by,
                    t.created_at,
                    t.updated_at,
                    c.client_name,
                    j.job_number,
                    j.title AS job_title,
                    COALESCE(NULLIF(TRIM(j.crm_name), ''), NULLIF(TRIM(c.crm_owner), ''), 'Unassigned') AS crm_name
                FROM crm_tasks t
                LEFT JOIN clients c ON c.db_id = t.client_db_id
                LEFT JOIN jobs j ON j.job_id = t.job_id
                WHERE {where_sql}
                ORDER BY
                    CASE LOWER(COALESCE(t.priority, 'normal'))
                        WHEN 'urgent' THEN 0
                        WHEN 'high' THEN 1
                        WHEN 'normal' THEN 2
                        ELSE 3
                    END,
                    COALESCE(t.due_at, t.sla_due_at, t.created_at) ASC,
                    t.task_id DESC
                LIMIT ?
                """,
                [*params, int(limit)],
            ).df()

            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    items.append({
                        "id": f"task-{int(row['task_id'])}",
                        "task_id": int(row["task_id"]),
                        "event_id": int(row["event_id"]) if row.get("event_id") is not None else None,
                        "client_db_id": int(row["client_db_id"]) if row.get("client_db_id") is not None else None,
                        "job_id": int(row["job_id"]) if row.get("job_id") is not None else None,
                        "title": str(row.get("title") or ""),
                        "details": str(row.get("details") or "") or None,
                        "assignee_user_id": str(row.get("assignee_user_id") or ""),
                        "priority": str(row.get("priority") or "normal"),
                        "sla_due_at": row["sla_due_at"].isoformat() if row.get("sla_due_at") else None,
                        "due_at": row["due_at"].isoformat() if row.get("due_at") else None,
                        "status": str(row.get("status") or "open"),
                        "completed_at": row["completed_at"].isoformat() if row.get("completed_at") else None,
                        "created_by": str(row.get("created_by") or ""),
                        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
                        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
                        "client_name": str(row.get("client_name") or ""),
                        "job_number": str(row.get("job_number") or "") or None,
                        "job_title": str(row.get("job_title") or "") or None,
                        "crm_name": str(row.get("crm_name") or "Unassigned"),
                        "source": "crm",
                    })

            return {"items": items, "count": total_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch dashboard tasks: {e}")


@router.get("/dashboard/operations-overview")
def get_dashboard_operations_overview(
    year: int = Query(None, description="Reporting year filter"),
    industry: str | None = Query(None, description="Optional industry filter"),
    crm_owner: str | None = Query(None, description="Optional CRM owner filter"),
    job_family: str | None = Query(None, description="Optional job group filter"),
    _user: dict[str, str] = Depends(_current_user)
):
    """Portfolio-level delivery and workload intelligence for Insights."""
    try:
        year = int(year) if isinstance(year, int) else None
        industry = industry if isinstance(industry, str) else None
        crm_owner = crm_owner if isinstance(crm_owner, str) else None
        family = str(job_family or "").strip().lower() or None
        org_id = require_org(_user)
        with get_conn() as con:
            if not _table_exists(con, "jobs"):
                return _empty_dashboard_operations_overview()

            has_job_plan = _table_exists(con, "job_plan")
            has_time_logs = _table_exists(con, "time_logs")
            has_job_type_id = _column_exists(con, "jobs", "job_type_id")
            has_job_type_estimated = _column_exists(con, "job_types", "estimated_hours")
            has_job_due_date = _column_exists(con, "jobs", "due_date")
            has_job_crm_name = _column_exists(con, "jobs", "crm_name")
            has_client_crm_owner = _column_exists(con, "clients", "crm_owner")
            has_time_subject = has_time_logs and _column_exists(con, "time_logs", "subject")

            job_where_parts: list[str] = []
            job_params: list[object] = []
            # Industry filter only — crm filter applied below using effective CRM expression
            _apply_client_filters(
                job_where_parts,
                job_params,
                client_alias="c",
                industry=industry,
                crm_owner=None,
            )
            _apply_job_family_filter(job_where_parts, job_params, job_alias="j", job_family=family)
            if year is not None:
                job_where_parts.append("j.reporting_year = ?")
                job_params.append(int(year))

            job_plan_join = "LEFT JOIN job_plan jp ON jp.job_id = j.job_id" if has_job_plan else ""
            job_type_join = "LEFT JOIN job_types jt ON jt.job_type_id = j.job_type_id" if has_job_type_id else "LEFT JOIN job_types jt ON 1=0"
            estimated_hours_expr = "COALESCE(jt.estimated_hours, 0)" if has_job_type_estimated else "0"
            due_date_expr = "j.due_date" if has_job_due_date else "NULL"
            # Effective CRM: job's own crm_name takes priority over client's crm_owner
            if has_job_crm_name and has_client_crm_owner:
                crm_expr = "COALESCE(NULLIF(j.crm_name, ''), NULLIF(c.crm_owner, ''), 'Unassigned')"
            elif has_job_crm_name:
                crm_expr = "COALESCE(NULLIF(j.crm_name, ''), 'Unassigned')"
            elif has_client_crm_owner:
                crm_expr = "COALESCE(NULLIF(c.crm_owner, ''), 'Unassigned')"
            else:
                crm_expr = "'Unassigned'"

            # Filter by effective CRM so jobs assigned directly via crm_name are included
            if crm_owner:
                crm_value = str(crm_owner).strip()
                if crm_value.lower() == "unassigned":
                    job_where_parts.append(f"({crm_expr} IS NULL OR TRIM({crm_expr}) = '')")
                else:
                    job_where_parts.append(f"{crm_expr} = ?")
                    job_params.append(crm_value)

            job_where = f"WHERE {' AND '.join(job_where_parts)}" if job_where_parts else ""

            milestone_select = """
                jp.data_collection_due,
                jp.data_collection_completed_at,
                jp.first_draft_due,
                jp.first_draft_completed_at,
                jp.final_report_due,
                jp.final_report_completed_at,
            """ if has_job_plan else """
                NULL AS data_collection_due,
                NULL AS data_collection_completed_at,
                NULL AS first_draft_due,
                NULL AS first_draft_completed_at,
                NULL AS final_report_due,
                NULL AS final_report_completed_at,
            """

            jobs_df = con.execute(
                f"""
                SELECT
                    j.job_id,
                    j.client_db_id,
                    j.job_number,
                    j.title,
                    COALESCE(NULLIF(TRIM(j.status), ''), 'Unknown') AS status,
                    c.client_name,
                    {crm_expr} AS crm_name,
                    {estimated_hours_expr} AS estimated_hours,
                    j.start_date,
                    {due_date_expr} AS due_date,
                    {milestone_select}
                    j.created_at
                FROM jobs j
                LEFT JOIN clients c ON c.db_id = j.client_db_id
                {job_type_join}
                {job_plan_join}
                {job_where}
                ORDER BY j.job_id DESC
                """,
                job_params,
            ).df()

            time_by_job: dict[int, dict[str, object]] = {}
            time_by_subject: list[dict[str, object]] = []
            if has_time_logs:
                time_where_parts: list[str] = []
                time_params: list[object] = []
                _apply_client_filters(
                    time_where_parts,
                    time_params,
                    client_alias="c",
                    industry=industry,
                    crm_owner=crm_owner,
                )
                if year is not None:
                    time_where_parts.append("COALESCE(j.reporting_year, EXTRACT(YEAR FROM tl.work_date)::INTEGER) = ?")
                    time_params.append(int(year))
                time_where = f"WHERE {' AND '.join(time_where_parts)}" if time_where_parts else ""

                time_jobs_df = con.execute(
                    f"""
                    SELECT
                        tl.job_id,
                        COALESCE(SUM(tl.minutes), 0) AS total_minutes,
                        MAX(tl.work_date) AS last_work_date
                    FROM time_logs tl
                    LEFT JOIN jobs j ON j.job_id = tl.job_id
                    LEFT JOIN clients c ON c.db_id = j.client_db_id
                    {time_where}
                    GROUP BY tl.job_id
                    """,
                    time_params,
                ).df()
                if time_jobs_df is not None and not time_jobs_df.empty:
                    for _, row in time_jobs_df.iterrows():
                        job_id = int(row["job_id"]) if row["job_id"] is not None else None
                        if job_id is None:
                            continue
                        time_by_job[job_id] = {
                            "hours": round(float(row["total_minutes"] or 0.0) / 60.0, 2),
                            "last_work_date": row["last_work_date"],
                        }

                subject_expr = "COALESCE(NULLIF(TRIM(tl.subject), ''), 'Unspecified')" if has_time_subject else "'Unspecified'"
                subject_df = con.execute(
                    f"""
                    SELECT
                        {subject_expr} AS subject,
                        COALESCE(SUM(tl.minutes), 0) AS total_minutes
                    FROM time_logs tl
                    LEFT JOIN jobs j ON j.job_id = tl.job_id
                    LEFT JOIN clients c ON c.db_id = j.client_db_id
                    {time_where}
                    GROUP BY {subject_expr}
                    ORDER BY total_minutes DESC, subject
                    LIMIT 8
                    """,
                    time_params,
                ).df()
                if subject_df is not None and not subject_df.empty:
                    for _, row in subject_df.iterrows():
                        time_by_subject.append({
                            "subject": row["subject"],
                            "hours": round(float(row["total_minutes"] or 0.0) / 60.0, 2),
                        })

            metrics = {
                "active_jobs": 0,
                "healthy_jobs": 0,
                "due_soon_jobs": 0,
                "overdue_jobs": 0,
                "no_milestone_jobs": 0,
                "jobs_over_estimate": 0,
                "time_logged_hours": 0.0,
                "estimated_hours_total": 0.0,
                "utilisation_pct": 0.0,
                "completed_milestones": 0,
                "upcoming_milestones_30d": 0,
            }
            milestone_counts = {
                "green": 0,
                "amber": 0,
                "red": 0,
                "completed": 0,
                "no_milestones": 0,
            }
            crm_workload_map: dict[str, dict[str, object]] = {}
            attention_rows: list[dict[str, object]] = []
            current_jobs: list[dict[str, object]] = []

            if jobs_df is not None and not jobs_df.empty:
                for _, row in jobs_df.iterrows():
                    job_id = int(row["job_id"])
                    job_status = _normalize_text_value(row.get("status"), "Unknown")
                    normalized_job_status = job_status.strip().lower()
                    is_active = normalized_job_status not in ("completed", "archived", "cancelled")
                    crm_name = _normalize_text_value(row.get("crm_name"), "Unassigned")
                    estimated_hours = _normalize_float_value(row.get("estimated_hours"), 0.0)
                    logged_hours = _normalize_float_value((time_by_job.get(job_id) or {}).get("hours"), 0.0)

                    milestone_rows = [
                        ("Data Collection", row.get("data_collection_due"), row.get("data_collection_completed_at")),
                        ("First Draft", row.get("first_draft_due"), row.get("first_draft_completed_at")),
                        ("Final Report", row.get("final_report_due"), row.get("final_report_completed_at")),
                    ]
                    available_milestones = [item for item in milestone_rows if _normalize_to_date(item[1]) is not None]
                    milestone_statuses = [_milestone_status(due_date, completed_at) for _, due_date, completed_at in available_milestones]
                    overall_status = _overall_milestone_status(milestone_statuses)

                    next_due_date = None
                    next_due_name = None
                    next_due_days = None
                    completed_count = 0
                    upcoming_count = 0
                    for milestone_name, due_date, completed_at in available_milestones:
                        due_obj = _normalize_to_date(due_date)
                        completed_obj = _normalize_to_date(completed_at) if completed_at is not None else completed_at
                        if completed_obj is not None:
                            completed_count += 1
                        if due_obj and completed_obj is None:
                            days_until_due = (due_obj - date.today()).days
                            if days_until_due <= 30:
                                upcoming_count += 1
                            if next_due_date is None or due_obj < next_due_date:
                                next_due_date = due_obj
                                next_due_name = milestone_name
                                next_due_days = days_until_due

                    metrics["time_logged_hours"] += logged_hours
                    metrics["estimated_hours_total"] += estimated_hours
                    metrics["completed_milestones"] += completed_count
                    metrics["upcoming_milestones_30d"] += upcoming_count
                    if estimated_hours > 0 and logged_hours > estimated_hours:
                        metrics["jobs_over_estimate"] += 1

                    if overall_status is None:
                        milestone_counts["no_milestones"] += 1
                    else:
                        milestone_counts[str(overall_status)] += 1

                    if is_active:
                        metrics["active_jobs"] += 1
                        if overall_status == "red":
                            metrics["overdue_jobs"] += 1
                        elif overall_status == "amber":
                            metrics["due_soon_jobs"] += 1
                        elif overall_status == "green":
                            metrics["healthy_jobs"] += 1
                        elif overall_status is None:
                            metrics["no_milestone_jobs"] += 1

                        crm_bucket = crm_workload_map.setdefault(
                            crm_name,
                            {
                                "crm_name": crm_name,
                                "total_jobs": 0,
                                "red_jobs": 0,
                                "amber_jobs": 0,
                                "green_jobs": 0,
                                "no_milestone_jobs": 0,
                                "logged_hours": 0.0,
                                "estimated_hours": 0.0,
                            },
                        )
                        crm_bucket["total_jobs"] = int(crm_bucket["total_jobs"]) + 1
                        crm_bucket["logged_hours"] = float(crm_bucket["logged_hours"]) + logged_hours
                        crm_bucket["estimated_hours"] = float(crm_bucket["estimated_hours"]) + estimated_hours
                        if overall_status == "red":
                            crm_bucket["red_jobs"] = int(crm_bucket["red_jobs"]) + 1
                        elif overall_status == "amber":
                            crm_bucket["amber_jobs"] = int(crm_bucket["amber_jobs"]) + 1
                        elif overall_status == "green":
                            crm_bucket["green_jobs"] = int(crm_bucket["green_jobs"]) + 1
                        else:
                            crm_bucket["no_milestone_jobs"] = int(crm_bucket["no_milestone_jobs"]) + 1

                        final_report_due = _normalize_to_date(row.get("final_report_due"))
                        final_report_completed = _normalize_to_date(row.get("final_report_completed_at"))
                        days_to_final_report = (final_report_due - date.today()).days if final_report_due and final_report_completed is None else None
                        current_jobs.append({
                            "job_id": job_id,
                            "client_db_id": (lambda v: None if v is None or v != v else int(v))(row.get("client_db_id")),
                            "job_number": _normalize_text_value(row.get("job_number"), ""),
                            "title": _normalize_text_value(row.get("title"), ""),
                            "client_name": _normalize_text_value(row.get("client_name"), ""),
                            "crm_name": crm_name,
                            "status": job_status,
                            "milestone_status": overall_status,
                            "due_date": _normalize_to_date(row.get("due_date")).isoformat() if _normalize_to_date(row.get("due_date")) else None,
                            "final_report_due": final_report_due.isoformat() if final_report_due else None,
                            "final_report_completed_at": final_report_completed.isoformat() if final_report_completed else None,
                            "days_to_final_report_due": days_to_final_report,
                            "next_due_date": next_due_date.isoformat() if next_due_date else None,
                            "next_due_name": next_due_name,
                            "days_to_next_due": next_due_days,
                        })

                    utilisation_pct = (logged_hours / estimated_hours * 100.0) if estimated_hours > 0 else None
                    reason_parts: list[str] = []
                    if overall_status == "red":
                        reason_parts.append("Overdue milestone")
                    elif overall_status == "amber":
                        reason_parts.append("Milestone due soon")
                    if estimated_hours > 0 and logged_hours > estimated_hours:
                        reason_parts.append("Over estimate")
                    if not available_milestones and is_active:
                        reason_parts.append("No milestone dates")

                    if reason_parts:
                        attention_rows.append({
                            "job_id": job_id,
                            "job_number": _normalize_text_value(row.get("job_number"), ""),
                            "title": _normalize_text_value(row.get("title"), ""),
                            "client_name": _normalize_text_value(row.get("client_name"), ""),
                            "crm_name": crm_name,
                            "status": job_status,
                            "milestone_status": overall_status,
                            "next_due_date": next_due_date.isoformat() if next_due_date else None,
                            "next_due_name": next_due_name,
                            "days_to_next_due": next_due_days,
                            "logged_hours": round(logged_hours, 2),
                            "estimated_hours": round(estimated_hours, 2),
                            "utilisation_pct": round(utilisation_pct, 1) if utilisation_pct is not None else None,
                            "reason": ", ".join(reason_parts),
                        })

            if metrics["estimated_hours_total"] > 0:
                metrics["utilisation_pct"] = round(
                    (metrics["time_logged_hours"] / metrics["estimated_hours_total"]) * 100.0,
                    1,
                )
            metrics["time_logged_hours"] = round(metrics["time_logged_hours"], 2)
            metrics["estimated_hours_total"] = round(metrics["estimated_hours_total"], 2)

            milestone_breakdown = [
                {"status": "Healthy", "key": "green", "count": int(milestone_counts["green"])},
                {"status": "Due Soon", "key": "amber", "count": int(milestone_counts["amber"])},
                {"status": "Overdue", "key": "red", "count": int(milestone_counts["red"])},
                {"status": "Completed", "key": "completed", "count": int(milestone_counts["completed"])},
                {"status": "No Milestones", "key": "no_milestones", "count": int(milestone_counts["no_milestones"])},
            ]

            crm_workload = []
            for bucket in crm_workload_map.values():
                est = _normalize_float_value(bucket["estimated_hours"], 0.0)
                logged = _normalize_float_value(bucket["logged_hours"], 0.0)
                crm_workload.append({
                    "crm_name": bucket["crm_name"],
                    "total_jobs": int(bucket["total_jobs"]),
                    "red_jobs": int(bucket["red_jobs"]),
                    "amber_jobs": int(bucket["amber_jobs"]),
                    "green_jobs": int(bucket["green_jobs"]),
                    "no_milestone_jobs": int(bucket["no_milestone_jobs"]),
                    "logged_hours": round(logged, 2),
                    "estimated_hours": round(est, 2),
                    "utilisation_pct": round((logged / est) * 100.0, 1) if est > 0 else None,
                })

            avg_health_by_crm: dict[str, float | None] = {}
            last_contact_by_crm: dict[str, str | None] = {}
            if _table_exists(con, "client_health_snapshots"):
                health_rows = con.execute(
                    """
                    SELECT
                        COALESCE(NULLIF(TRIM(c.crm_owner), ''), 'Unassigned') AS crm_name,
                        AVG(s.health_score) AS avg_health_score
                    FROM clients c
                    LEFT JOIN client_health_snapshots s
                      ON s.client_db_id = c.db_id
                     AND s.org_id = c.org_id
                    WHERE c.org_id = ?
                    GROUP BY COALESCE(NULLIF(TRIM(c.crm_owner), ''), 'Unassigned')
                    """,
                    [org_id],
                ).fetchall()
                for row in health_rows or []:
                    crm_key = _normalize_text_value(row[0], "Unassigned")
                    avg_health_by_crm[crm_key] = round(_normalize_float_value(row[1], 0.0), 1) if not _is_missing_value(row[1]) else None
            if _table_exists(con, "client_touchpoints"):
                touch_rows = con.execute(
                    """
                    SELECT
                        COALESCE(NULLIF(TRIM(c.crm_owner), ''), 'Unassigned') AS crm_name,
                        MAX(ct.occurred_at) AS last_contact_at
                    FROM clients c
                    LEFT JOIN client_touchpoints ct
                      ON ct.client_db_id = c.db_id
                     AND ct.org_id = c.org_id
                    WHERE c.org_id = ?
                    GROUP BY COALESCE(NULLIF(TRIM(c.crm_owner), ''), 'Unassigned')
                    """,
                    [org_id],
                ).fetchall()
                for row in touch_rows or []:
                    crm_key = _normalize_text_value(row[0], "Unassigned")
                    if _is_missing_value(row[1]):
                        last_contact_by_crm[crm_key] = None
                    else:
                        try:
                            last_contact_by_crm[crm_key] = row[1].isoformat()
                        except Exception:
                            last_contact_by_crm[crm_key] = _normalize_text_value(row[1], None)  # type: ignore[arg-type]

            for item in crm_workload:
                crm_name = _normalize_text_value(item.get("crm_name"), "Unassigned")
                item["avg_health_score"] = avg_health_by_crm.get(crm_name)
                item["last_contact_date"] = last_contact_by_crm.get(crm_name)

            crm_workload.sort(
                key=lambda item: (
                    -int(item["red_jobs"]),
                    -int(item["amber_jobs"]),
                    -_normalize_float_value(item.get("logged_hours"), 0.0),
                    _normalize_text_value(item.get("crm_name"), "Unassigned"),
                )
            )

            status_priority = {"red": 0, "amber": 1, "green": 2, None: 3}
            attention_rows.sort(
                key=lambda item: (
                    status_priority.get(item.get("milestone_status"), 4),
                    item.get("days_to_next_due") if item.get("days_to_next_due") is not None else 99999,
                    -(float(item.get("utilisation_pct") or 0.0)),
                    str(item.get("job_number") or ""),
                )
            )
            current_jobs.sort(
                key=lambda item: (
                    0 if item.get("final_report_due") else 1,
                    item.get("days_to_final_report_due") if item.get("days_to_final_report_due") is not None else 99999,
                    status_priority.get(item.get("milestone_status"), 4),
                    str(item.get("job_number") or ""),
                )
            )

            return {
                "metrics": metrics,
                "milestone_breakdown": milestone_breakdown,
                "time_by_subject": time_by_subject,
                "crm_workload": crm_workload[:8],
                "jobs_needing_attention": attention_rows[:50],
                "current_jobs": current_jobs[:200],
            }
    except Exception:
        logger.exception("Failed to fetch dashboard operations overview; returning empty fallback")
        return {
            **_empty_dashboard_operations_overview(),
            "warning": "operations_overview_unavailable",
        }


def _build_insights_report(
    con,
    *,
    view: str,
    year: int | None,
    industry: str | None,
    crm_owner: str | None,
    job_family: str | None,
    limit: int,
) -> dict:
    family = str(job_family or "").strip().lower() or None
    has_job_plan = _table_exists(con, "job_plan")
    has_time_logs = _table_exists(con, "time_logs")
    has_job_crm_name = _column_exists(con, "jobs", "crm_name")
    has_client_crm_owner = _column_exists(con, "clients", "crm_owner")
    crm_expr = _crm_expression(has_job_crm_name=has_job_crm_name, has_client_crm_owner=has_client_crm_owner)

    if view == "client_portfolio":
        where_parts: list[str] = []
        params: list[object] = []
        _apply_client_filters(
            where_parts,
            params,
            client_alias="c",
            industry=industry,
            crm_owner=crm_owner,
        )
        if family:
            where_parts.append(
                "EXISTS (SELECT 1 FROM jobs jf WHERE jf.client_db_id = c.db_id AND "
                f"{_job_family_expression('jf')} = ?)"
            )
            params.append(family)
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        year_case = "j.reporting_year = ?" if year is not None else "1=1"
        extra_year_params = [int(year), int(year), int(year)] if year is not None else []
        rows_df = con.execute(
            f"""
            SELECT
                c.db_id AS client_id,
                c.client_name,
                COALESCE(NULLIF(TRIM(c.industry), ''), 'Unspecified') AS industry,
                COALESCE(NULLIF(TRIM(c.crm_owner), ''), 'Unassigned') AS crm_owner,
                COUNT(CASE WHEN {year_case} THEN 1 END) AS total_jobs,
                COUNT(CASE WHEN {year_case} AND COALESCE(NULLIF(TRIM(j.status), ''), 'Open') NOT IN ('Completed', 'Archived', 'Cancelled') THEN 1 END) AS active_jobs,
                MAX(CASE WHEN {year_case} THEN j.reporting_year END) AS latest_reporting_year
            FROM clients c
            LEFT JOIN jobs j ON j.client_db_id = c.db_id
            {where_sql}
            GROUP BY c.db_id, c.client_name, c.industry, c.crm_owner
            ORDER BY active_jobs DESC, total_jobs DESC, c.client_name
            LIMIT ?
            """,
            [*params, *extra_year_params, int(limit)],
        ).df()
        rows = []
        if rows_df is not None and not rows_df.empty:
            for _, row in rows_df.iterrows():
                rows.append({
                    "client_id": int(row["client_id"]),
                    "client_name": row["client_name"],
                    "industry": row["industry"],
                    "crm_owner": row["crm_owner"],
                    "total_jobs": int(row["total_jobs"] or 0),
                    "active_jobs": int(row["active_jobs"] or 0),
                    "latest_reporting_year": int(row["latest_reporting_year"]) if row["latest_reporting_year"] is not None else None,
                })
        return {
            "view": view,
            "title": "Client Portfolio",
            "description": "Filtered client portfolio with CRM ownership and delivery volume.",
            "columns": [
                {"key": "client_name", "label": "Client"},
                {"key": "industry", "label": "Industry"},
                {"key": "crm_owner", "label": "CRM Owner"},
                {"key": "active_jobs", "label": "Active Jobs"},
                {"key": "total_jobs", "label": "Total Jobs"},
                {"key": "latest_reporting_year", "label": "Latest Reporting Year"},
            ],
            "rows": rows,
            "row_count": len(rows),
        }

    if view == "job_delivery":
        where_parts = []
        params = []
        _apply_client_filters(
            where_parts,
            params,
            client_alias="c",
            industry=industry,
            crm_owner=crm_owner,
        )
        _apply_job_family_filter(where_parts, params, job_alias="j", job_family=family)
        if year is not None:
            where_parts.append("j.reporting_year = ?")
            params.append(int(year))
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        due_date_expr = "j.due_date" if _column_exists(con, "jobs", "due_date") else "NULL"
        estimated_hours_expr = "COALESCE(jt.estimated_hours, 0)" if _column_exists(con, "job_types", "estimated_hours") else "0"
        time_join = """
            LEFT JOIN (
                SELECT job_id, COALESCE(SUM(minutes), 0) AS total_minutes
                FROM time_logs
                GROUP BY job_id
            ) tl ON tl.job_id = j.job_id
        """ if has_time_logs else "LEFT JOIN (SELECT NULL::integer AS job_id, 0::numeric AS total_minutes) tl ON 1=0"

        milestone_due_exprs = {
            "data_collection_due": "jp.data_collection_due" if has_job_plan and _column_exists(con, "job_plan", "data_collection_due") else "NULL",
            "data_collection_completed_at": "jp.data_collection_completed_at" if has_job_plan and _column_exists(con, "job_plan", "data_collection_completed_at") else "NULL",
            "first_draft_due": "jp.first_draft_due" if has_job_plan and _column_exists(con, "job_plan", "first_draft_due") else "NULL",
            "first_draft_completed_at": "jp.first_draft_completed_at" if has_job_plan and _column_exists(con, "job_plan", "first_draft_completed_at") else "NULL",
            "final_report_due": "jp.final_report_due" if has_job_plan and _column_exists(con, "job_plan", "final_report_due") else "NULL",
            "final_report_completed_at": "jp.final_report_completed_at" if has_job_plan and _column_exists(con, "job_plan", "final_report_completed_at") else "NULL",
        }
        rows_df = con.execute(
            f"""
            SELECT
                j.job_id,
                j.job_number,
                j.title,
                c.db_id AS client_id,
                c.client_name,
                {crm_expr} AS crm_name,
                COALESCE(NULLIF(TRIM(j.status), ''), 'Unknown') AS status,
                {due_date_expr} AS due_date,
                {estimated_hours_expr} AS estimated_hours,
                COALESCE(tl.total_minutes, 0) AS total_minutes,
                {milestone_due_exprs["data_collection_due"]} AS data_collection_due,
                {milestone_due_exprs["data_collection_completed_at"]} AS data_collection_completed_at,
                {milestone_due_exprs["first_draft_due"]} AS first_draft_due,
                {milestone_due_exprs["first_draft_completed_at"]} AS first_draft_completed_at,
                {milestone_due_exprs["final_report_due"]} AS final_report_due,
                {milestone_due_exprs["final_report_completed_at"]} AS final_report_completed_at
            FROM jobs j
            LEFT JOIN clients c ON c.db_id = j.client_db_id
            LEFT JOIN job_types jt ON jt.job_type_id = j.job_type_id
            {"LEFT JOIN job_plan jp ON jp.job_id = j.job_id" if has_job_plan else ""}
            {time_join}
            {where_sql}
            ORDER BY j.job_id DESC
            LIMIT ?
            """,
            [*params, int(limit)],
        ).df()
        rows = []
        if rows_df is not None and not rows_df.empty:
            for _, row in rows_df.iterrows():
                logged_hours = round(float(row["total_minutes"] or 0.0) / 60.0, 2)
                estimated_hours = round(float(row["estimated_hours"] or 0.0), 2)
                milestone_statuses = []
                if row.get("data_collection_due") is not None:
                    milestone_statuses.append(_milestone_status(row.get("data_collection_due"), row.get("data_collection_completed_at")))
                if row.get("first_draft_due") is not None:
                    milestone_statuses.append(_milestone_status(row.get("first_draft_due"), row.get("first_draft_completed_at")))
                if row.get("final_report_due") is not None:
                    milestone_statuses.append(_milestone_status(row.get("final_report_due"), row.get("final_report_completed_at")))
                milestone_status = _overall_milestone_status(milestone_statuses)
                rows.append({
                    "job_id": int(row["job_id"]),
                    "job_number": row["job_number"],
                    "title": row["title"],
                    "client_id": int(row["client_id"]) if row["client_id"] is not None else None,
                    "client_name": row["client_name"],
                    "crm_name": row["crm_name"],
                    "status": row["status"],
                    "milestone_status": milestone_status,
                    "due_date": row["due_date"].isoformat() if hasattr(row["due_date"], "isoformat") else (str(row["due_date"]) if row["due_date"] else None),
                    "logged_hours": logged_hours,
                    "estimated_hours": estimated_hours,
                    "utilisation_pct": round((logged_hours / estimated_hours) * 100.0, 1) if estimated_hours > 0 else None,
                })
        return {
            "view": view,
            "title": "Job Delivery",
            "description": "Live delivery report across jobs, milestone health, and tracked effort.",
            "columns": [
                {"key": "job_number", "label": "Job"},
                {"key": "title", "label": "Title"},
                {"key": "client_name", "label": "Client"},
                {"key": "crm_name", "label": "CRM"},
                {"key": "status", "label": "Status"},
                {"key": "milestone_status", "label": "Milestone"},
                {"key": "due_date", "label": "Due Date"},
                {"key": "logged_hours", "label": "Logged Hours"},
                {"key": "estimated_hours", "label": "Estimate"},
                {"key": "utilisation_pct", "label": "Utilisation %"},
            ],
            "rows": rows,
            "row_count": len(rows),
        }

    if view == "invoice_follow_up":
        has_invoice_amount_paid = _column_exists(con, "invoices", "amount_paid")
        amount_paid_expr = "COALESCE(i.amount_paid, 0)" if has_invoice_amount_paid else "0"
        where_parts = []
        params = []
        _apply_client_filters(
            where_parts,
            params,
            client_alias="c",
            industry=industry,
            crm_owner=crm_owner,
        )
        _apply_job_family_filter(where_parts, params, job_alias="j", job_family=family)
        if year is not None:
            where_parts.append("COALESCE(j.reporting_year, jq.reporting_year, EXTRACT(YEAR FROM COALESCE(i.invoice_date, i.created_at::date))::INTEGER) = ?")
            params.append(int(year))
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        rows_df = con.execute(
            f"""
            SELECT
                i.invoice_id,
                i.invoice_number,
                c.db_id AS client_id,
                c.client_name,
                {crm_expr} AS crm_name,
                COALESCE(NULLIF(TRIM(i.status), ''), 'Unknown') AS status,
                i.invoice_date,
                i.due_date,
                COALESCE(i.total, 0) AS total,
                {amount_paid_expr} AS amount_paid
            FROM invoices i
            LEFT JOIN clients c ON c.db_id = i.client_db_id
            LEFT JOIN jobs j ON j.job_id = i.job_id
            LEFT JOIN quotes q ON q.quote_id = i.quote_id
            LEFT JOIN jobs jq ON jq.job_number = q.job_number
            {where_sql}
            ORDER BY COALESCE(i.due_date, i.invoice_date, i.created_at::date) ASC NULLS LAST, i.invoice_id DESC
            LIMIT ?
            """,
            [*params, int(limit)],
        ).df()
        rows = []
        if rows_df is not None and not rows_df.empty:
            for _, row in rows_df.iterrows():
                total = round(float(row["total"] or 0.0), 2)
                amount_paid = round(float(row["amount_paid"] or 0.0), 2)
                rows.append({
                    "invoice_id": int(row["invoice_id"]),
                    "invoice_number": row["invoice_number"],
                    "client_id": int(row["client_id"]) if row["client_id"] is not None else None,
                    "client_name": row["client_name"],
                    "crm_name": row["crm_name"],
                    "status": row["status"],
                    "invoice_date": row["invoice_date"].isoformat() if hasattr(row["invoice_date"], "isoformat") else (str(row["invoice_date"]) if row["invoice_date"] else None),
                    "due_date": row["due_date"].isoformat() if hasattr(row["due_date"], "isoformat") else (str(row["due_date"]) if row["due_date"] else None),
                    "total": total,
                    "amount_paid": amount_paid,
                    "outstanding": round(max(0.0, total - amount_paid), 2),
                })
        return {
            "view": view,
            "title": "Invoice Follow-Up",
            "description": "Collections-focused invoice report for follow-up and cash visibility.",
            "columns": [
                {"key": "invoice_number", "label": "Invoice"},
                {"key": "client_name", "label": "Client"},
                {"key": "crm_name", "label": "CRM"},
                {"key": "status", "label": "Status"},
                {"key": "invoice_date", "label": "Invoice Date"},
                {"key": "due_date", "label": "Due Date"},
                {"key": "total", "label": "Total"},
                {"key": "amount_paid", "label": "Paid"},
                {"key": "outstanding", "label": "Outstanding"},
            ],
            "rows": rows,
            "row_count": len(rows),
        }

    if view == "quote_pipeline":
        has_quote_job_number = _column_exists(con, "quotes", "job_number") and _column_exists(con, "jobs", "job_number")
        has_quote_approved_at = _column_exists(con, "quotes", "approved_at")
        has_quote_line_vat = _column_exists(con, "quote_lines", "vat_rate_pct")
        quote_where_parts = []
        quote_params = []
        _apply_client_filters(
            quote_where_parts,
            quote_params,
            client_alias="c",
            industry=industry,
            crm_owner=crm_owner,
        )
        _apply_job_family_filter(quote_where_parts, quote_params, job_alias="j", job_family=family)
        _financial_year_filter(
            quote_where_parts,
            quote_params,
            date_expr="COALESCE(q.quote_date, q.created_at::date)",
            job_year_expr=("j.reporting_year" if has_quote_job_number else "NULL"),
            year=year,
        )
        quote_where = f"WHERE {' AND '.join(quote_where_parts)}" if quote_where_parts else ""
        quote_job_join = "LEFT JOIN jobs j ON j.job_number = q.job_number" if has_quote_job_number else "LEFT JOIN jobs j ON 1=0"
        quote_approved_expr = "q.approved_at" if has_quote_approved_at else "NULL"
        quote_vat_expr = "COALESCE(ql.vat_rate_pct, 0)" if has_quote_line_vat else "0"
        rows_df = con.execute(
            f"""
            WITH quote_totals AS (
                SELECT
                    q.quote_id,
                    q.client_db_id,
                    c.client_name,
                    {crm_expr} AS crm_name,
                    q.quote_number,
                    q.quote_date,
                    q.valid_to,
                    COALESCE(NULLIF(TRIM(q.status), ''), 'Unknown') AS status,
                    {quote_approved_expr} AS approved_at,
                    COALESCE(SUM(
                        CASE
                            WHEN LOWER(COALESCE(ql.line_type, 'main')) = 'option' THEN 0
                            ELSE COALESCE(ql.qty, 0) * COALESCE(ql.unit_price_ex_vat, 0) * (1 + {quote_vat_expr} / 100.0)
                        END
                    ), 0) AS quote_value
                FROM quotes q
                LEFT JOIN quote_lines ql ON q.quote_id = ql.quote_id
                LEFT JOIN clients c ON c.db_id = q.client_db_id
                {quote_job_join}
                {quote_where}
                GROUP BY q.quote_id, q.client_db_id, c.client_name, {crm_expr}, q.quote_number, q.quote_date, q.valid_to, q.status, {quote_approved_expr}
            )
            SELECT *
            FROM quote_totals
            ORDER BY quote_value DESC, quote_date DESC NULLS LAST, quote_id DESC
            LIMIT ?
            """,
            [*quote_params, int(limit)],
        ).df()
        rows = []
        if rows_df is not None and not rows_df.empty:
            for _, row in rows_df.iterrows():
                rows.append({
                    "quote_id": int(row["quote_id"]),
                    "client_id": int(row["client_db_id"]) if row["client_db_id"] is not None else None,
                    "quote_number": row["quote_number"],
                    "client_name": row["client_name"],
                    "crm_name": row["crm_name"],
                    "status": row["status"],
                    "quote_date": row["quote_date"].isoformat() if hasattr(row["quote_date"], "isoformat") else (str(row["quote_date"]) if row["quote_date"] else None),
                    "valid_to": row["valid_to"].isoformat() if hasattr(row["valid_to"], "isoformat") else (str(row["valid_to"]) if row["valid_to"] else None),
                    "quote_value": round(float(row["quote_value"] or 0.0), 2),
                    "approved_at": row["approved_at"].isoformat() if hasattr(row["approved_at"], "isoformat") else (str(row["approved_at"]) if row["approved_at"] else None),
                })
        return {
            "view": view,
            "title": "Quote Pipeline",
            "description": "Open and approved quote pipeline with client ownership and total quoted value.",
            "columns": [
                {"key": "quote_number", "label": "Quote"},
                {"key": "client_name", "label": "Client"},
                {"key": "crm_name", "label": "CRM"},
                {"key": "status", "label": "Status"},
                {"key": "quote_date", "label": "Quote Date"},
                {"key": "valid_to", "label": "Valid To"},
                {"key": "quote_value", "label": "Quote Value"},
                {"key": "approved_at", "label": "Approved At"},
            ],
            "rows": rows,
            "row_count": len(rows),
        }

    if view == "crm_workload":
        has_job_plan = _table_exists(con, "job_plan")
        has_time_logs = _table_exists(con, "time_logs")
        has_job_type_estimated = _column_exists(con, "job_types", "estimated_hours")
        where_parts = []
        params = []
        _apply_client_filters(
            where_parts,
            params,
            client_alias="c",
            industry=industry,
            crm_owner=crm_owner,
        )
        _apply_job_family_filter(where_parts, params, job_alias="j", job_family=family)
        if year is not None:
            where_parts.append("j.reporting_year = ?")
            params.append(int(year))
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        estimated_expr = "COALESCE(jt.estimated_hours, 0)" if has_job_type_estimated else "0"
        time_join = """
            LEFT JOIN (
                SELECT job_id, COALESCE(SUM(minutes), 0) AS total_minutes
                FROM time_logs
                GROUP BY job_id
            ) tl ON tl.job_id = j.job_id
        """ if has_time_logs else "LEFT JOIN (SELECT NULL::integer AS job_id, 0::numeric AS total_minutes) tl ON 1=0"
        milestone_due_exprs = {
            "data_collection_due": "jp.data_collection_due" if has_job_plan and _column_exists(con, "job_plan", "data_collection_due") else "NULL",
            "data_collection_completed_at": "jp.data_collection_completed_at" if has_job_plan and _column_exists(con, "job_plan", "data_collection_completed_at") else "NULL",
            "first_draft_due": "jp.first_draft_due" if has_job_plan and _column_exists(con, "job_plan", "first_draft_due") else "NULL",
            "first_draft_completed_at": "jp.first_draft_completed_at" if has_job_plan and _column_exists(con, "job_plan", "first_draft_completed_at") else "NULL",
            "final_report_due": "jp.final_report_due" if has_job_plan and _column_exists(con, "job_plan", "final_report_due") else "NULL",
            "final_report_completed_at": "jp.final_report_completed_at" if has_job_plan and _column_exists(con, "job_plan", "final_report_completed_at") else "NULL",
        }
        jobs_df = con.execute(
            f"""
            SELECT
                j.job_id,
                {crm_expr} AS crm_name,
                COALESCE(NULLIF(TRIM(j.status), ''), 'Unknown') AS status,
                {estimated_expr} AS estimated_hours,
                COALESCE(tl.total_minutes, 0) AS total_minutes,
                {milestone_due_exprs["data_collection_due"]} AS data_collection_due,
                {milestone_due_exprs["data_collection_completed_at"]} AS data_collection_completed_at,
                {milestone_due_exprs["first_draft_due"]} AS first_draft_due,
                {milestone_due_exprs["first_draft_completed_at"]} AS first_draft_completed_at,
                {milestone_due_exprs["final_report_due"]} AS final_report_due,
                {milestone_due_exprs["final_report_completed_at"]} AS final_report_completed_at
            FROM jobs j
            LEFT JOIN clients c ON c.db_id = j.client_db_id
            LEFT JOIN job_types jt ON jt.job_type_id = j.job_type_id
            {"LEFT JOIN job_plan jp ON jp.job_id = j.job_id" if has_job_plan else ""}
            {time_join}
            {where_sql}
            ORDER BY j.job_id DESC
            LIMIT ?
            """,
            [*params, int(max(limit * 5, limit))],
        ).df()
        crm_map: dict[str, dict[str, object]] = {}
        if jobs_df is not None and not jobs_df.empty:
            for _, row in jobs_df.iterrows():
                crm_name = str(row["crm_name"] or "Unassigned")
                status = str(row["status"] or "Unknown").strip().lower()
                if status in ("completed", "archived", "cancelled"):
                    continue
                bucket = crm_map.setdefault(
                    crm_name,
                    {
                        "crm_name": crm_name,
                        "active_jobs": 0,
                        "overdue_jobs": 0,
                        "due_soon_jobs": 0,
                        "healthy_jobs": 0,
                        "no_milestone_jobs": 0,
                        "logged_hours": 0.0,
                        "estimated_hours": 0.0,
                    },
                )
                bucket["active_jobs"] = int(bucket["active_jobs"]) + 1
                logged_hours = float(row["total_minutes"] or 0.0) / 60.0
                estimated_hours = float(row["estimated_hours"] or 0.0)
                bucket["logged_hours"] = float(bucket["logged_hours"]) + logged_hours
                bucket["estimated_hours"] = float(bucket["estimated_hours"]) + estimated_hours
                milestone_statuses = []
                if row.get("data_collection_due") is not None:
                    milestone_statuses.append(_milestone_status(row.get("data_collection_due"), row.get("data_collection_completed_at")))
                if row.get("first_draft_due") is not None:
                    milestone_statuses.append(_milestone_status(row.get("first_draft_due"), row.get("first_draft_completed_at")))
                if row.get("final_report_due") is not None:
                    milestone_statuses.append(_milestone_status(row.get("final_report_due"), row.get("final_report_completed_at")))
                overall_status = _overall_milestone_status(milestone_statuses)
                if overall_status == "red":
                    bucket["overdue_jobs"] = int(bucket["overdue_jobs"]) + 1
                elif overall_status == "amber":
                    bucket["due_soon_jobs"] = int(bucket["due_soon_jobs"]) + 1
                elif overall_status == "green":
                    bucket["healthy_jobs"] = int(bucket["healthy_jobs"]) + 1
                else:
                    bucket["no_milestone_jobs"] = int(bucket["no_milestone_jobs"]) + 1
        rows = []
        for bucket in crm_map.values():
            logged = round(float(bucket["logged_hours"] or 0.0), 2)
            estimated = round(float(bucket["estimated_hours"] or 0.0), 2)
            rows.append({
                "crm_name": bucket["crm_name"],
                "active_jobs": int(bucket["active_jobs"]),
                "overdue_jobs": int(bucket["overdue_jobs"]),
                "due_soon_jobs": int(bucket["due_soon_jobs"]),
                "healthy_jobs": int(bucket["healthy_jobs"]),
                "no_milestone_jobs": int(bucket["no_milestone_jobs"]),
                "logged_hours": logged,
                "estimated_hours": estimated,
                "utilisation_pct": round((logged / estimated) * 100.0, 1) if estimated > 0 else None,
            })
        rows.sort(key=lambda item: (-int(item["overdue_jobs"]), -int(item["due_soon_jobs"]), -int(item["active_jobs"]), str(item["crm_name"])))
        rows = rows[:limit]
        return {
            "view": view,
            "title": "CRM Workload",
            "description": "Delivery workload and effort pressure summarised by CRM owner.",
            "columns": [
                {"key": "crm_name", "label": "CRM"},
                {"key": "active_jobs", "label": "Active Jobs"},
                {"key": "overdue_jobs", "label": "Overdue"},
                {"key": "due_soon_jobs", "label": "Due Soon"},
                {"key": "healthy_jobs", "label": "Healthy"},
                {"key": "no_milestone_jobs", "label": "No Milestones"},
                {"key": "logged_hours", "label": "Logged Hours"},
                {"key": "estimated_hours", "label": "Estimated Hours"},
                {"key": "utilisation_pct", "label": "Utilisation %"},
            ],
            "rows": rows,
            "row_count": len(rows),
        }

    if view == "emissions_portfolio":
        where_parts = []
        params = []
        _apply_client_filters(
            where_parts,
            params,
            client_alias="c",
            industry=industry,
            crm_owner=crm_owner,
        )
        if family:
            where_parts.append(
                "EXISTS (SELECT 1 FROM jobs jf WHERE jf.client_db_id = c.db_id AND "
                f"{_job_family_expression('jf')} = ?)"
            )
            params.append(family)
        if year is not None:
            where_parts.append("j.reporting_year = ?")
            params.append(int(year))
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        counts_df = con.execute(
            f"""
            SELECT
                c.db_id AS client_id,
                c.client_name,
                COALESCE(NULLIF(TRIM(c.industry), ''), 'Unspecified') AS industry,
                COALESCE(NULLIF(TRIM(c.crm_owner), ''), 'Unassigned') AS crm_owner,
                COUNT(DISTINCT j.job_id) AS total_jobs,
                COUNT(DISTINCT CASE WHEN COALESCE(NULLIF(TRIM(j.status), ''), 'Open') NOT IN ('Completed', 'Archived', 'Cancelled') THEN j.job_id END) AS active_jobs
            FROM clients c
            LEFT JOIN jobs j ON j.client_db_id = c.db_id
            {where_sql}
            GROUP BY c.db_id, c.client_name, c.industry, c.crm_owner
            ORDER BY active_jobs DESC, total_jobs DESC, c.client_name
            """,
            params,
        ).df()

        emissions_jobs_df = _load_dashboard_emissions_jobs(
            con,
            year=year,
            industry=industry,
            crm_owner=crm_owner,
            job_family=family,
        )
        emissions_rows_df = None
        if emissions_jobs_df is not None and not emissions_jobs_df.empty:
            emissions_job_ids = [int(job_id) for job_id in emissions_jobs_df["job_id"].tolist() if job_id is not None]
            emissions_rows_df = load_combined_reporting_rows(con, emissions_job_ids)
            if emissions_rows_df is not None and not emissions_rows_df.empty:
                emissions_rows_df = emissions_rows_df.merge(
                    emissions_jobs_df[["job_id", "client_id", "client_name"]],
                    on="job_id",
                    how="left",
                )
                emissions_rows_df = _attach_dashboard_emissions(con, emissions_rows_df)
                if year is not None:
                    emissions_rows_df = emissions_rows_df[emissions_rows_df["dashboard_year_norm"] == int(year)].copy()

        emissions_by_client = {}
        if emissions_rows_df is not None and not emissions_rows_df.empty:
            grouped = (
                emissions_rows_df
                .groupby(["client_id", "client_name"], dropna=False)["emissions"]
                .sum()
                .reset_index()
            )
            for _, row in grouped.iterrows():
                client_id = _normalize_int_value(row.get("client_id"))
                client_name = str(row.get("client_name") or "Unspecified").strip() or "Unspecified"
                if client_id is None:
                    continue
                emissions_by_client[client_id] = {
                    "client_id": client_id,
                    "client_name": client_name,
                    "total_emissions": float(row["emissions"]),
                }

        rows_df = counts_df.copy()
        if rows_df is not None and not rows_df.empty:
            emissions_values = []
            for _, row in rows_df.iterrows():
                client_id = _normalize_int_value(row.get("client_id"))
                emission_entry = emissions_by_client.get(client_id or -1)
                emissions_values.append(float(emission_entry["total_emissions"]) if emission_entry else 0.0)
            rows_df["total_emissions"] = emissions_values
        rows = []
        if rows_df is not None and not rows_df.empty:
            for _, row in rows_df.iterrows():
                rows.append({
                    "client_id": int(row["client_id"]),
                    "client_name": row["client_name"],
                    "industry": row["industry"],
                    "crm_owner": row["crm_owner"],
                    "active_jobs": int(row["active_jobs"] or 0),
                    "total_jobs": int(row["total_jobs"] or 0),
                    "total_emissions": round(float(row["total_emissions"] or 0.0), 1),
                })
            rows.sort(key=lambda item: (-float(item["total_emissions"] or 0.0), -int(item["active_jobs"]), str(item["client_name"])))
            rows = rows[:limit]
        return {
            "view": view,
            "title": "Emissions Portfolio",
            "description": "Client-level emissions ranking for the selected portfolio filters.",
            "columns": [
                {"key": "client_name", "label": "Client"},
                {"key": "industry", "label": "Industry"},
                {"key": "crm_owner", "label": "CRM Owner"},
                {"key": "active_jobs", "label": "Active Jobs"},
                {"key": "total_jobs", "label": "Total Jobs"},
                {"key": "total_emissions", "label": "tCO₂e"},
            ],
            "rows": rows,
            "row_count": len(rows),
        }

    raise HTTPException(status_code=400, detail=f"Unsupported report view: {view}")


@router.get("/dashboard/bi-portfolio")
def get_dashboard_bi_portfolio(
    year: int = Query(None, description="Reporting year filter"),
    industry: str | None = Query(None),
    crm_owner: str | None = Query(None),
    job_family: str | None = Query(None),
    _user: dict[str, str] = Depends(_current_user),
):
    """
    BI-focused portfolio snapshot for business leaders.
    Returns client portfolio health, cumulative/scope emissions, and geography.
    """
    import datetime as _dt

    try:
        with get_conn() as con:
            family = str(job_family or "").strip().lower() or None
            has_clients = _table_exists(con, "clients")
            has_jobs = _table_exists(con, "jobs")
            has_client_status = has_clients and _column_exists(con, "clients", "status")
            has_client_targets = has_clients and _column_exists(con, "clients", "net_zero_year")
            has_client_created_at = has_clients and _column_exists(con, "clients", "created_at")

            # â”€â”€ Client filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            client_where_parts: list[str] = []
            client_params: list[object] = []
            if industry:
                client_where_parts.append("c.industry = ?")
                client_params.append(industry)
            if crm_owner:
                client_where_parts.append("COALESCE(c.crm_owner,'Unassigned') = ?")
                client_params.append(crm_owner)
            if family:
                client_where_parts.append(
                    "EXISTS (SELECT 1 FROM jobs jf WHERE jf.client_db_id = c.db_id AND "
                    f"{_job_family_expression('jf')} = ?)"
                )
                client_params.append(family)
            client_where = ("WHERE " + " AND ".join(client_where_parts)) if client_where_parts else ""

            # â”€â”€ Client portfolio summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            client_status_breakdown: list[dict] = []
            total_clients = 0
            active_clients = 0
            clients_with_targets = 0
            new_clients_this_year = 0

            if has_clients:
                if has_client_status:
                    status_rows = con.execute(
                        f"""
                        SELECT COALESCE(c.status, 'Active') AS status, COUNT(*) AS cnt
                        FROM clients c
                        {client_where}
                        GROUP BY COALESCE(c.status, 'Active')
                        ORDER BY cnt DESC
                        """,
                        client_params,
                    ).fetchall()
                    for row in status_rows:
                        client_status_breakdown.append({"status": str(row[0]), "count": int(row[1])})
                        total_clients += int(row[1])
                        if str(row[0]).lower() == "active":
                            active_clients = int(row[1])
                else:
                    total_row = con.execute(
                        f"SELECT COUNT(*) FROM clients c {client_where}",
                        client_params,
                    ).fetchone()
                    total_clients = int(total_row[0]) if total_row else 0
                    active_clients = total_clients
                    client_status_breakdown = [{"status": "Active", "count": total_clients}]

                if has_client_targets:
                    targets_row = con.execute(
                        f"""
                        SELECT COUNT(*) FROM clients c
                        {client_where + (" AND " if client_where_parts else "WHERE ")}net_zero_year IS NOT NULL
                        """,
                        client_params,
                    ).fetchone()
                    clients_with_targets = int(targets_row[0]) if targets_row else 0

                current_year = year or _dt.date.today().year
                if has_client_created_at:
                    new_clients_row = con.execute(
                        f"""
                        SELECT COUNT(*) FROM clients c
                        {client_where + (" AND " if client_where_parts else "WHERE ")}
                        EXTRACT(YEAR FROM COALESCE(c.created_at, NOW())) = ?
                        """,
                        client_params + [current_year],
                    ).fetchone()
                    new_clients_this_year = int(new_clients_row[0]) if new_clients_row else 0

            # â”€â”€ Jobs delivered / completed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            jobs_delivered_this_year = 0
            if has_jobs:
                job_where_parts2: list[str] = ["j.status = 'Completed'"]
                job_params2: list[object] = []
                _apply_client_filters(
                    job_where_parts2, job_params2, client_alias="c",
                    industry=industry, crm_owner=crm_owner,
                )
                _apply_job_family_filter(job_where_parts2, job_params2, job_alias="j", job_family=family)
                if year:
                    job_where_parts2.append("j.reporting_year = ?")
                    job_params2.append(int(year))
                job_where2 = "WHERE " + " AND ".join(job_where_parts2)
                jd_row = con.execute(
                    f"SELECT COUNT(*) FROM jobs j LEFT JOIN clients c ON c.db_id = j.client_db_id {job_where2}",
                    job_params2,
                ).fetchone()
                jobs_delivered_this_year = int(jd_row[0]) if jd_row else 0

            # â”€â”€ Emissions pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            emissions_by_country: list[dict] = []
            emissions_by_scope: dict[str, float] = {"scope_1": 0.0, "scope_2": 0.0, "scope_3": 0.0, "other": 0.0}
            cumulative_by_year: list[dict] = []
            total_emissions_managed = 0.0
            top_clients_detail: list[dict] = []

            try:
                # Load ALL years (no year filter) so we can compute cumulative totals
                all_years_jobs_df = _load_dashboard_emissions_jobs(
                    con, year=None, industry=industry, crm_owner=crm_owner, job_family=family,
                )

                if all_years_jobs_df is not None and not all_years_jobs_df.empty:
                    all_job_ids = [int(j) for j in all_years_jobs_df["job_id"].tolist() if j is not None]
                    scope_df = load_combined_emissions_summary_rows(con, all_job_ids)

                    if scope_df is not None and not scope_df.empty:
                        scope_df = _attach_dashboard_emissions(con, scope_df)
                        scope_df = scope_df[scope_df["emissions"] > 0].copy()

                        # Merge country from jobs â†’ clients
                        if has_clients:
                            country_map_rows = con.execute(
                                """
                                SELECT j.job_id, COALESCE(NULLIF(TRIM(c.addr_country),''), 'Unknown') AS country
                                FROM jobs j
                                LEFT JOIN clients c ON c.db_id = j.client_db_id
                                WHERE j.is_crp = TRUE
                                """
                            ).fetchall()
                            country_by_job = {int(r[0]): str(r[1]) for r in country_map_rows}
                            scope_df["country"] = scope_df["job_id"].apply(
                                lambda jid: country_by_job.get(int(jid) if jid is not None else -1, "Unknown")
                            )

                        # â”€â”€ Cumulative emissions by year â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                        trend_grp = (
                            scope_df.dropna(subset=["dashboard_year_norm"])
                            .groupby("dashboard_year_norm")["emissions"]
                            .sum()
                            .reset_index()
                            .sort_values("dashboard_year_norm")
                        )
                        running = 0.0
                        for _, row in trend_grp.iterrows():
                            annual = float(row["emissions"])
                            running += annual
                            cumulative_by_year.append({
                                "year": int(row["dashboard_year_norm"]),
                                "annual_emissions": round(annual, 2),
                                "cumulative": round(running, 2),
                            })
                        total_emissions_managed = round(running, 2)

                        # â”€â”€ Scope breakdown (selected year or all years) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                        year_scope_df = scope_df
                        if year:
                            year_scope_df = scope_df[scope_df["dashboard_year_norm"] == int(year)].copy()
                        if "scope" in year_scope_df.columns:
                            scope_grp = year_scope_df.groupby("scope")["emissions"].sum()
                            for scope_key, scope_val in scope_grp.items():
                                k = str(scope_key or "").strip().lower()
                                if k in ("1", "scope 1", "scope1"):
                                    emissions_by_scope["scope_1"] = round(float(scope_val), 2)
                                elif k in ("2", "scope 2", "scope2"):
                                    emissions_by_scope["scope_2"] = round(float(scope_val), 2)
                                elif k in ("3", "scope 3", "scope3"):
                                    emissions_by_scope["scope_3"] = round(float(scope_val), 2)
                                else:
                                    emissions_by_scope["other"] += round(float(scope_val), 2)

                        # â”€â”€ Emissions by country â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                        if "country" in scope_df.columns:
                            country_grp = (
                                year_scope_df.groupby("country")["emissions"]
                                .sum()
                                .reset_index()
                                .sort_values("emissions", ascending=False)
                                .head(15)
                            )
                            for _, row in country_grp.iterrows():
                                emissions_by_country.append({
                                    "country": str(row["country"]),
                                    "emissions": round(float(row["emissions"]), 2),
                                })

                        # â”€â”€ Top 10 clients by emissions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                        top_df = (
                            year_scope_df
                            .groupby(["client_id", "client_name"], dropna=False)["emissions"]
                            .sum()
                            .reset_index()
                            .sort_values("emissions", ascending=False)
                            .head(10)
                        )
                        for _, row in top_df.iterrows():
                            cid = _normalize_int_value(row.get("client_id"))
                            top_clients_detail.append({
                                "client_id": cid,
                                "client_name": str(row.get("client_name") or "Unknown").strip(),
                                "emissions": round(float(row["emissions"]), 2),
                            })
            except Exception:
                logger.debug("Failed to build dashboard top clients breakdown; continuing without it", exc_info=True)

            return {
                "portfolio": {
                    "total_clients": total_clients,
                    "active_clients": active_clients,
                    "new_clients_this_year": new_clients_this_year,
                    "clients_with_targets": clients_with_targets,
                    "jobs_delivered": jobs_delivered_this_year,
                    "total_emissions_managed": total_emissions_managed,
                },
                "client_status_breakdown": client_status_breakdown,
                "emissions_by_country": emissions_by_country,
                "emissions_by_scope": emissions_by_scope,
                "cumulative_by_year": cumulative_by_year,
                "top_clients_detail": top_clients_detail,
            }

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/dashboard/saved-reports")
def list_dashboard_saved_reports(
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        user_id = _saved_report_user_id(_user)
        if not user_id:
            raise HTTPException(status_code=400, detail="Authenticated user is missing a user_id")
        with get_conn() as con:
            if not _saved_reports_available(con):
                return {"reports": []}
            rows = con.execute(
                """
                SELECT
                    saved_report_id,
                    name,
                    report_view,
                    report_year,
                    industry,
                    crm_owner,
                    created_at,
                    updated_at
                FROM saved_insights_reports
                WHERE user_id = ?
                ORDER BY updated_at DESC, saved_report_id DESC
                """,
                [user_id],
            ).fetchall()
        return {"reports": [_serialize_saved_report_row(row) for row in rows]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load saved reports: {e}")


@router.post("/dashboard/saved-reports")
def create_dashboard_saved_report(
    payload: SavedInsightsReportPayload,
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        user_id = _saved_report_user_id(_user)
        if not user_id:
            raise HTTPException(status_code=400, detail="Authenticated user is missing a user_id")
        name = _normalize_saved_report_text(payload.name)
        if not name:
            raise HTTPException(status_code=400, detail="Saved report name is required")
        view = _validate_report_view(payload.view)
        with get_conn() as con:
            _require_saved_reports_table(con)
            if _saved_report_name_exists(con, user_id=user_id, name=name):
                raise HTTPException(status_code=409, detail="A saved report with this name already exists")
            row = con.execute(
                """
                INSERT INTO saved_insights_reports (
                    user_id,
                    name,
                    report_view,
                    report_year,
                    industry,
                    crm_owner
                )
                VALUES (?, ?, ?, ?, ?, ?)
                RETURNING
                    saved_report_id,
                    name,
                    report_view,
                    report_year,
                    industry,
                    crm_owner,
                    created_at,
                    updated_at
                """,
                [
                    user_id,
                    name,
                    view,
                    payload.year,
                    _normalize_saved_report_text(payload.industry),
                    _normalize_saved_report_text(payload.crm_owner),
                ],
            ).fetchone()
        return {"report": _serialize_saved_report_row(row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save dashboard report: {e}")


@router.put("/dashboard/saved-reports/{saved_report_id}")
def update_dashboard_saved_report(
    saved_report_id: int,
    payload: SavedInsightsReportPayload,
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        user_id = _saved_report_user_id(_user)
        if not user_id:
            raise HTTPException(status_code=400, detail="Authenticated user is missing a user_id")
        name = _normalize_saved_report_text(payload.name)
        if not name:
            raise HTTPException(status_code=400, detail="Saved report name is required")
        view = _validate_report_view(payload.view)
        with get_conn() as con:
            _require_saved_reports_table(con)
            existing = con.execute(
                """
                SELECT 1
                FROM saved_insights_reports
                WHERE saved_report_id = ? AND user_id = ?
                LIMIT 1
                """,
                [int(saved_report_id), user_id],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Saved report not found")
            if _saved_report_name_exists(con, user_id=user_id, name=name, exclude_id=int(saved_report_id)):
                raise HTTPException(status_code=409, detail="A saved report with this name already exists")
            row = con.execute(
                """
                UPDATE saved_insights_reports
                SET
                    name = ?,
                    report_view = ?,
                    report_year = ?,
                    industry = ?,
                    crm_owner = ?,
                    updated_at = now()
                WHERE saved_report_id = ? AND user_id = ?
                RETURNING
                    saved_report_id,
                    name,
                    report_view,
                    report_year,
                    industry,
                    crm_owner,
                    created_at,
                    updated_at
                """,
                [
                    name,
                    view,
                    payload.year,
                    _normalize_saved_report_text(payload.industry),
                    _normalize_saved_report_text(payload.crm_owner),
                    int(saved_report_id),
                    user_id,
                ],
            ).fetchone()
        return {"report": _serialize_saved_report_row(row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update saved report: {e}")


@router.delete("/dashboard/saved-reports/{saved_report_id}")
def delete_dashboard_saved_report(
    saved_report_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        user_id = _saved_report_user_id(_user)
        if not user_id:
            raise HTTPException(status_code=400, detail="Authenticated user is missing a user_id")
        with get_conn() as con:
            _require_saved_reports_table(con)
            deleted = con.execute(
                """
                DELETE FROM saved_insights_reports
                WHERE saved_report_id = ? AND user_id = ?
                RETURNING saved_report_id
                """,
                [int(saved_report_id), user_id],
            ).fetchone()
            if not deleted:
                raise HTTPException(status_code=404, detail="Saved report not found")
        return {"ok": True, "saved_report_id": int(saved_report_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete saved report: {e}")


@router.get("/dashboard/report-view")
def get_dashboard_report_view(
    view: str = Query(..., description="Report view key"),
    year: int | None = Query(None, description="Optional reporting year filter"),
    industry: str | None = Query(None, description="Optional industry filter"),
    crm_owner: str | None = Query(None, description="Optional CRM owner filter"),
    job_family: str | None = Query(None, description="Optional job group filter"),
    limit: int = Query(100, ge=1, le=500, description="Maximum rows to return"),
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        with get_conn() as con:
            return _build_insights_report(
                con,
                view=view,
                year=year,
                industry=industry,
                crm_owner=crm_owner,
                job_family=job_family,
                limit=limit,
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch dashboard report view: {e}")


@router.get("/dashboard/report-export")
def export_dashboard_report(
    view: str = Query(..., description="Report view key"),
    year: int | None = Query(None, description="Optional reporting year filter"),
    industry: str | None = Query(None, description="Optional industry filter"),
    crm_owner: str | None = Query(None, description="Optional CRM owner filter"),
    job_family: str | None = Query(None, description="Optional job group filter"),
    limit: int = Query(500, ge=1, le=2000, description="Maximum rows to export"),
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        with get_conn() as con:
            report = _build_insights_report(
                con,
                view=view,
                year=year,
                industry=industry,
                crm_owner=crm_owner,
                job_family=job_family,
                limit=limit,
            )

        output = io.StringIO()
        writer = csv.writer(output)
        columns = report.get("columns") or []
        rows = report.get("rows") or []
        writer.writerow([str(col.get("label") or col.get("key") or "") for col in columns])
        for row in rows:
            writer.writerow([row.get(str(col.get("key") or ""), "") for col in columns])

        safe_view = "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in str(view or "report")).strip("-") or "report"
        filename = f"insights-{safe_view}.csv"
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export dashboard report: {e}")


@router.get("/dashboard/review-notifications")
def get_review_notifications(
    crm_owner: str | None = Query(None),
    _user: dict[str, str] = Depends(_current_user),
):
    """Jobs with open client portal comments awaiting CRM response."""
    try:
        with get_conn() as con:
            rows = con.execute(
                """
                SELECT
                    j.job_id,
                    COALESCE(j.job_number, '') AS job_number,
                    COALESCE(j.title, '')      AS title,
                    COALESCE(cl.client_name, '') AS client_name,
                    COALESCE(j.crm_owner, '')  AS crm_owner,
                    COUNT(rrc.comment_id)      AS open_count,
                    MAX(rrc.created_at)        AS last_comment_at,
                    rr.status                  AS review_status
                FROM report_reviews rr
                JOIN report_review_comments rrc ON rrc.review_id = rr.review_id
                JOIN jobs j ON j.job_id = rr.job_id
                LEFT JOIN clients cl ON cl.client_db_id = j.client_db_id
                WHERE rrc.author_type = 'client'
                  AND rrc.status = 'open'
                GROUP BY j.job_id, j.job_number, j.title, cl.client_name, j.crm_owner, rr.status
                ORDER BY MAX(rrc.created_at) DESC NULLS LAST
                """,
            ).fetchall()

        cols = ["job_id", "job_number", "title", "client_name", "crm_owner",
                "open_count", "last_comment_at", "review_status"]
        items = [dict(zip(cols, row)) for row in rows]

        if crm_owner:
            items = [i for i in items if (i.get("crm_owner") or "") == crm_owner]

        return {"ok": True, "items": items, "total": len(items)}
    except Exception:
        logger.exception("Failed to fetch dashboard review notifications; returning empty fallback")
        return {"ok": True, "items": [], "total": 0}
