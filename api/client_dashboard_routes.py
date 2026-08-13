"""
Client Dashboard API Routes
Provides aggregated emissions data and metrics for client dashboards
"""

from fastapi import APIRouter, HTTPException, Depends, Query, Body
from copy import deepcopy
import json
import logging
import os
import threading
import time
from typing import Any
from core.database import get_conn
from api.auth import _current_user
from api.permissions import assert_client_access
from services.tenancy import require_org
from services.tenancy import org_context
from services import ai_insights
from services.client_benchmark import get_client_benchmark_metrics
from services.emissions_reporting import attach_exact_emissions, load_combined_emissions_summary_rows, load_combined_reporting_rows

logger = logging.getLogger(__name__)

router = APIRouter()

_DASHBOARD_CACHE_TTL_SECONDS = 15.0
_dashboard_cache: dict[tuple[int, int | None, str | None], tuple[float, dict[str, object]]] = {}
_dashboard_cache_lock = threading.Lock()


def _org_match_clause(job_alias: str = "j", client_alias: str = "c") -> str:
    return (
        f"COALESCE({job_alias}.org_id, {client_alias}.org_id) = %s"
    )


def _safe_year_value(value):
    try:
        if value is None:
            return None
        if str(value).strip().lower() in {"nan", "<na>", "none", "null", ""}:
            return None
        return int(value)
    except Exception:
        return None


def _extract_job_years(jobs_df) -> list[int]:
    if jobs_df is None or jobs_df.empty:
        return []
    years: list[int] = []
    for _, row in jobs_df.iterrows():
        year = _safe_year_value(row.get("dashboard_year"))
        if year is None:
            year = _safe_year_value(row.get("reporting_year"))
        if year is not None:
            years.append(year)
    return sorted(set(years))


def _dataset_category_label(row, fallback: str = "Uncategorized") -> str:
    values = (
        row.get("dataset_category"),
        row.get("lookup_category"),
        row.get("category"),
        row.get("lookup_level_1"),
        row.get("lookup_level_2"),
        row.get("level_1"),
        row.get("level_2"),
    )
    for value in values:
        txt = str(value or "").strip()
        if not txt or txt.lower() in {"nan", "none", "null", "uncategorized", "uncategorised"}:
            continue
        return txt
    return fallback


def _dashboard_cache_key(client_db_id: int, year: int | None, org_id: str | None) -> tuple[int, int | None, str | None]:
    return (int(client_db_id), _safe_year_value(year), str(org_id) if org_id else None)


def _get_cached_dashboard(client_db_id: int, year: int | None, org_id: str | None):
    key = _dashboard_cache_key(client_db_id, year, org_id)
    now = time.monotonic()
    with _dashboard_cache_lock:
        cached = _dashboard_cache.get(key)
        if not cached:
            return None
        created_at, payload = cached
        if (now - created_at) > _DASHBOARD_CACHE_TTL_SECONDS:
            _dashboard_cache.pop(key, None)
            return None
        return deepcopy(payload)


def _set_cached_dashboard(client_db_id: int, year: int | None, org_id: str | None, payload: dict[str, object]) -> None:
    key = _dashboard_cache_key(client_db_id, year, org_id)
    with _dashboard_cache_lock:
        _dashboard_cache[key] = (time.monotonic(), deepcopy(payload))


def _ensure_saved_client_insights_schema(con) -> None:
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS saved_client_insights (
                saved_client_insight_id BIGSERIAL PRIMARY KEY,
                user_id VARCHAR NOT NULL,
                org_id VARCHAR NOT NULL,
                client_db_id INTEGER NOT NULL,
                provider VARCHAR(32) NOT NULL,
                insights_text TEXT NOT NULL,
                structured_json TEXT,
                citations_json TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
    except Exception:
        pass
    try:
        con.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_saved_client_insights_user_client_created
            ON saved_client_insights (user_id, org_id, client_db_id, created_at DESC, saved_client_insight_id DESC)
            """
        )
    except Exception:
        pass


def _saved_client_insights_enabled(con) -> bool:
    try:
        row = con.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = CURRENT_SCHEMA()
              AND table_name = %s
            LIMIT 1
            """,
            ["saved_client_insights"],
        ).fetchone()
        return bool(row)
    except Exception:
        return False


def _safe_saved_insight_text(value: Any) -> str:
    return str(value or "").strip()


def _parse_saved_insight_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def _serialize_saved_client_insight_row(row) -> dict[str, Any]:
    if not row:
        return {}
    saved_at = row[8] if len(row) > 8 else None
    return {
        "saved_client_insight_id": int(row[0]),
        "client_db_id": int(row[1]) if row[1] is not None else None,
        "user_id": str(row[2]) if row[2] is not None else None,
        "org_id": str(row[3]) if row[3] is not None else None,
        "provider": str(row[4]) if row[4] is not None else None,
        "insights": str(row[5]) if row[5] is not None else "",
        "structured": _parse_saved_insight_json(row[6]),
        "citations": _parse_saved_insight_json(row[7]) or [],
        "created_at": str(saved_at) if saved_at is not None else None,
    }


def _saved_insight_user_id(user: dict[str, Any]) -> str:
    return str(user.get("user_id") or "").strip()


def _saved_insight_preview(insights_text: str, structured: Any) -> str:
    summary = None
    if isinstance(structured, dict):
        summary = structured.get("summary")
    text = str(summary or insights_text or "").strip()
    if len(text) <= 220:
        return text
    return text[:217].rstrip() + "..."


def _load_client_jobs(con, client_db_id: int, org_id: str | None, crp_only: bool = True):
    if org_id:
        if crp_only:
            return con.execute(
                """
                SELECT
                    j.job_id,
                    j.reporting_year,
                    COALESCE(
                        EXTRACT(YEAR FROM j.reporting_period_end),
                        EXTRACT(YEAR FROM cjd.reporting_period_to),
                        j.reporting_year
                    ) as dashboard_year,
                    j.title
                FROM jobs j
                LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
                JOIN clients c ON c.db_id = j.client_db_id
                WHERE j.client_db_id = %s AND j.is_crp = TRUE AND {org_match}
                ORDER BY dashboard_year ASC NULLS LAST, j.job_id ASC
                """.format(org_match=_org_match_clause()),
                [int(client_db_id), org_id],
            ).df()
        return con.execute(
            """
            SELECT
                j.job_id,
                j.reporting_year,
                COALESCE(
                    EXTRACT(YEAR FROM j.reporting_period_end),
                    EXTRACT(YEAR FROM cjd.reporting_period_to),
                    j.reporting_year
                ) as dashboard_year,
                j.title
            FROM jobs j
            LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
            JOIN clients c ON c.db_id = j.client_db_id
            WHERE j.client_db_id = %s AND {org_match}
                ORDER BY dashboard_year ASC NULLS LAST, j.job_id ASC
            """.format(org_match=_org_match_clause()),
            [int(client_db_id), org_id],
        ).df()

    if crp_only:
        return con.execute(
            """
            SELECT
                j.job_id,
                j.reporting_year,
                COALESCE(
                    EXTRACT(YEAR FROM j.reporting_period_end),
                    EXTRACT(YEAR FROM cjd.reporting_period_to),
                    j.reporting_year
                ) as dashboard_year,
                j.title
            FROM jobs j
            LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
            WHERE j.client_db_id = %s AND j.is_crp = TRUE
            ORDER BY dashboard_year ASC NULLS LAST, j.job_id ASC
            """,
            [int(client_db_id)],
        ).df()

    return con.execute(
        """
        SELECT
            j.job_id,
            j.reporting_year,
            COALESCE(
                EXTRACT(YEAR FROM j.reporting_period_end),
                EXTRACT(YEAR FROM cjd.reporting_period_to),
                j.reporting_year
            ) as dashboard_year,
            j.title
        FROM jobs j
        LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
        WHERE j.client_db_id = %s
        ORDER BY dashboard_year ASC NULLS LAST, j.job_id ASC
        """,
        [int(client_db_id)],
    ).df()


def _dashboard_rows_from_exact_reporting(con, job_ids: list[int]):
    if not job_ids:
        return con.execute("SELECT NULL::INTEGER AS job_id WHERE FALSE").df()
    rows_df = load_combined_reporting_rows(con, job_ids)
    if rows_df is None or rows_df.empty:
        return rows_df
    rows_df = attach_exact_emissions(con, rows_df)
    if "dashboard_year" not in rows_df.columns:
        return rows_df
    return rows_df


@router.get("/clients/{client_db_id}/dashboard")
def get_client_dashboard(
    client_db_id: int,
    year: int | None = Query(default=None),
    lite: bool = Query(default=False),
    _user: dict[str, str] = Depends(_current_user),
):
    """
    Get dashboard data for a client including:
    - Total emissions by year
    - Emissions by scope and year
    - Top emission categories
    - Intensity metrics (if available)
    """
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        cached = _get_cached_dashboard(int(client_db_id), year, org_id)
        if cached is not None:
            return cached
        with get_conn() as con:
            diagnostic: dict[str, object] = {
                "org_id": org_id,
                "jobs_source": None,
                "jobs_count": 0,
                "summary_row_count": 0,
                "exact_row_count": 0,
                "error": None,
            }
            jobs_df = None
            scope_df = None
            job_ids: list[int] = []

            # Stage 1: try to find CRP jobs scoped to the user's org.
            try:
                jobs_df = _load_client_jobs(con, int(client_db_id), org_id, crp_only=True)
                if jobs_df is not None and not jobs_df.empty:
                    diagnostic["jobs_source"] = "crp_org"
            except Exception as exc:
                logger.exception(
                    "dashboard.jobs_lookup_failed stage=crp_org client_db_id=%s org_id=%s",
                    client_db_id,
                    org_id,
                )
                diagnostic["error"] = f"crp_org: {exc}"

            # Stage 2: broaden to all jobs for this org.
            if jobs_df is None or jobs_df.empty:
                try:
                    jobs_df = _load_client_jobs(con, int(client_db_id), org_id, crp_only=False)
                    if jobs_df is not None and not jobs_df.empty:
                        diagnostic["jobs_source"] = "all_org"
                except Exception as exc:
                    logger.exception(
                        "dashboard.jobs_lookup_failed stage=all_org client_db_id=%s org_id=%s",
                        client_db_id,
                        org_id,
                    )
                    diagnostic["error"] = f"all_org: {exc}"

            # Stage 3: last-resort fallback that ignores org scoping. Kept for parity
            # with pre-tenancy clients whose jobs/clients rows still have a null org_id.
            if jobs_df is None or jobs_df.empty:
                try:
                    jobs_df = _load_client_jobs(con, int(client_db_id), None, crp_only=False)
                    if jobs_df is not None and not jobs_df.empty:
                        diagnostic["jobs_source"] = "any_org"
                        logger.warning(
                            "dashboard.jobs_lookup_any_org client_db_id=%s user_org_id=%s job_count=%s",
                            client_db_id,
                            org_id,
                            len(jobs_df),
                        )
                except Exception as exc:
                    logger.exception(
                        "dashboard.jobs_lookup_failed stage=any_org client_db_id=%s",
                        client_db_id,
                    )
                    diagnostic["error"] = f"any_org: {exc}"

            if jobs_df is not None and not jobs_df.empty:
                jobs_df['dashboard_year_norm'] = jobs_df['dashboard_year'].apply(_safe_year_value)
                job_ids = [int(j) for j in jobs_df['job_id'].tolist()]
            diagnostic["jobs_count"] = len(job_ids)

            if lite:
                try:
                    scope_df = load_combined_emissions_summary_rows(con, job_ids)
                    if scope_df is not None:
                        diagnostic["jobs_source"] = f"{diagnostic.get('jobs_source') or 'lite'}_summary"
                        diagnostic["summary_row_count"] = int(len(scope_df))
                except Exception as exc:
                    logger.exception(
                        "dashboard.summary_reporting_failed client_db_id=%s job_ids=%s",
                        client_db_id,
                        job_ids,
                    )
                    diagnostic["error"] = f"summary_reporting: {exc}"
                    scope_df = None
            else:
                # IMPORTANT: do not flip this primary/fallback order to "speed up"
                # the dashboard. The exact per-row resolver path MUST stay primary
                # because the aggregated summary SQL does not apply monthly emission
                # factors, so swapping it in produces totals that drift from the
                # per-job figure shown in the Jobs list and the /clients/{id}/reporting
                # page (e.g. 39.0 vs 40.6 for jobs with monthly-resolved factors).
                # The 15s response cache above is the right place to recover speed.
                #
                # Primary: exact per-row resolver path (matches /clients/{id}/reporting
                # and the per-job totals shown in the Jobs list, including monthly
                # factor handling).
                try:
                    scope_df = _dashboard_rows_from_exact_reporting(con, job_ids)
                    if scope_df is not None:
                        diagnostic["exact_row_count"] = int(len(scope_df))
                except Exception as exc:
                    logger.exception(
                        "dashboard.exact_reporting_failed client_db_id=%s job_ids=%s",
                        client_db_id,
                        job_ids,
                    )
                    diagnostic["error"] = f"exact_reporting: {exc}"
                    scope_df = None

                # Fallback: aggregated summary query — faster but uses a single factor
                # per row, so totals can drift from the per-job figure. Only consulted
                # if the exact path fails or returns nothing, to preserve a response.
                if (scope_df is None or scope_df.empty) and job_ids:
                    try:
                        scope_df = load_combined_emissions_summary_rows(con, job_ids)
                        if scope_df is not None:
                            diagnostic["summary_row_count"] = int(len(scope_df))
                    except Exception as exc:
                        logger.exception(
                            "dashboard.emissions_summary_failed client_db_id=%s job_ids=%s",
                            client_db_id,
                            job_ids,
                        )
                        diagnostic["error"] = f"emissions_summary: {exc}"
                        scope_df = None

            benchmark_metrics = None
            try:
                benchmark_metrics = get_client_benchmark_metrics(con, int(client_db_id))
            except Exception:
                benchmark_metrics = None

            if scope_df is None or scope_df.empty:
                available_years = _extract_job_years(jobs_df)
                selected_year = (
                    _safe_year_value(year)
                    if _safe_year_value(year) is not None and _safe_year_value(year) in available_years
                    else (available_years[-1] if available_years else None)
                )
                logger.warning(
                    "dashboard.empty_response client_db_id=%s diagnostic=%s",
                    client_db_id,
                    diagnostic,
                )
                return {
                    'client_db_id': int(client_db_id),
                    'selected_year': selected_year,
                    'available_years': available_years,
                    'current_metrics': {
                        'total_emissions': 0,
                        'scope1': 0,
                        'scope2': 0,
                        'scope3': 0,
                        'year': selected_year
                    },
                    'yoy_change': None,
                    'yearly_emissions': [],
                    'top_categories': [],
                    'intensity_metrics': [],
                    'currency': 'GBP',
                    'benchmark_metrics': benchmark_metrics,
                    'industry_average_emissions': None,
                    'net_zero_progress': None,
                    'diagnostic': diagnostic,
                }

            scope_df = scope_df.copy()
            scope_df['dashboard_year_norm'] = scope_df['dashboard_year'].apply(_safe_year_value)
            scope_df = scope_df[scope_df['dashboard_year_norm'].notna()].copy()
            scope_df['dataset_category'] = scope_df.apply(lambda row: _dataset_category_label(row), axis=1)
            scope_df['category'] = scope_df['dataset_category']
            years = sorted(
                [
                    int(y)
                    for y in scope_df['dashboard_year_norm'].dropna().unique().tolist()
                    if y is not None and str(y) != 'nan'
                ]
            )
            job_years = _extract_job_years(jobs_df)
            available_years = sorted(set(years + job_years)) if (years or job_years) else []
            if not years and job_ids:
                scope_df = _dashboard_rows_from_exact_reporting(con, job_ids)
                if scope_df is not None and not scope_df.empty:
                    scope_df = scope_df.copy()
                    scope_df['dashboard_year_norm'] = scope_df['dashboard_year'].apply(_safe_year_value)
                    scope_df = scope_df[scope_df['dashboard_year_norm'].notna()].copy()
                    years = sorted(
                        [
                            int(y)
                            for y in scope_df['dashboard_year_norm'].dropna().unique().tolist()
                            if y is not None and str(y) != 'nan'
                        ]
                    )
                    available_years = sorted(set(years + job_years)) if (years or job_years) else []
            requested_year = _safe_year_value(year)
            selected_year = (
                requested_year
                if requested_year is not None and requested_year in available_years
                else (available_years[-1] if available_years else None)
            )

            scope_groups = scope_df.groupby(['dashboard_year_norm', 'scope'])['emissions'].sum().reset_index()
            yearly_emissions = []
            for yr in available_years:
                year_rows = scope_groups[scope_groups['dashboard_year_norm'] == yr]
                scope1_total = float(year_rows[year_rows['scope'] == 'Scope 1']['emissions'].sum())
                scope2_total = float(year_rows[year_rows['scope'] == 'Scope 2']['emissions'].sum())
                scope3_total = float(year_rows[year_rows['scope'] == 'Scope 3']['emissions'].sum())
                yearly_emissions.append({
                    'year': int(yr),
                    'scope1': scope1_total,
                    'scope2': scope2_total,
                    'scope3': scope3_total,
                    'total': float(year_rows['emissions'].sum()),
                })

            current_metrics = {
                'total_emissions': 0,
                'scope1': 0,
                'scope2': 0,
                'scope3': 0,
                'year': selected_year
            }

            if selected_year is not None:
                selected_data = next((y for y in yearly_emissions if int(y['year']) == int(selected_year)), None)
                if selected_data:
                    current_metrics = {
                        'total_emissions': selected_data['total'],
                        'scope1': selected_data['scope1'],
                        'scope2': selected_data['scope2'],
                        'scope3': selected_data['scope3'],
                        'year': selected_data['year']
                    }

            yearly_top_categories = []
            yearly_intensity_metrics = []
            top_categories = []
            total_selected_emissions = float(current_metrics['total_emissions'] or 0)

            for yr in available_years:
                selected_rows = scope_df[scope_df['dashboard_year_norm'] == yr].copy()
                year_total = float(next((y['total'] for y in yearly_emissions if int(y['year']) == int(yr)), 0) or 0)
                year_top_categories = []
                if not selected_rows.empty:
                    category_groups = selected_rows.groupby('dataset_category')['emissions'].sum().reset_index()
                    category_groups = category_groups.sort_values('emissions', ascending=False).head(10)
                    for _, row in category_groups.iterrows():
                        category = str(row['dataset_category']).strip()
                        if not category or category.lower() in ['nan', 'none', 'null']:
                            continue
                        emissions = float(row['emissions'])
                        percentage = (emissions / year_total * 100) if year_total > 0 else 0
                        year_top_categories.append({
                            'category': category,
                            'dataset_category': category,
                            'emissions': emissions,
                            'percentage': round(percentage, 1)
                        })
                yearly_top_categories.append({
                    'year': int(yr),
                    'categories': year_top_categories,
                })

                year_intensity_metrics = []
                if jobs_df is not None and not jobs_df.empty:
                    selected_jobs = jobs_df[jobs_df['dashboard_year_norm'] == yr]
                    if selected_jobs is not None and not selected_jobs.empty:
                        latest_job_id = int(selected_jobs.iloc[-1]['job_id'])
                        metrics_result = con.execute(
                            "SELECT intensity_metrics FROM jobs WHERE job_id = %s",
                            [latest_job_id]
                        ).fetchone()
                        if metrics_result and metrics_result[0]:
                            job_metrics = metrics_result[0]
                            for key, metric in job_metrics.items():
                                if metric.get('value', 0) > 0:
                                    intensity = (year_total / metric['value']) * metric.get('divider', 1)
                                    year_intensity_metrics.append({
                                        'key': key,
                                        'label': metric.get('label', key),
                                        'value': metric.get('value', 0),
                                        'divider': metric.get('divider', 1),
                                        'intensity': round(intensity, 2)
                                    })
                yearly_intensity_metrics.append({
                    'year': int(yr),
                    'metrics': year_intensity_metrics,
                })

            if selected_year is not None:
                selected_top = next((y for y in yearly_top_categories if int(y['year']) == int(selected_year)), None)
                if selected_top:
                    top_categories = selected_top['categories']

            # Additional summary: net-zero progress.
            net_zero_progress = None

            try:
                client_info = con.execute(
                    "SELECT industry, net_zero_year FROM clients WHERE db_id = %s",
                    [int(client_db_id)],
                ).fetchone()
            except Exception:
                client_info = con.execute(
                    "SELECT industry, net_zero_year FROM clients WHERE db_id = %s",
                    [int(client_db_id)],
                ).fetchone()
            if not client_info:
                raise HTTPException(status_code=404, detail="Client not found")
            industry = client_info[0] if len(client_info) > 0 else None
            net_year = client_info[1] if len(client_info) > 1 else None
            if industry and not lite:
                try:
                    if org_id:
                        avg_df = con.execute(
                            """
                            SELECT AVG(total_emissions) FROM (
                                WITH job_context AS (
                                    SELECT
                                        j.job_id,
                                        j.client_db_id
                                    FROM jobs j
                                    JOIN clients c ON c.db_id = j.client_db_id
                                    WHERE c.industry = %s AND j.is_crp = TRUE AND {org_match}
                                ),
                                    legacy_rows AS (
                                        SELECT
                                            jc.client_db_id,
                                            jsr.qty,
                                            jsr.factor,
                                            jsr.ghg_unit,
                                            jsr.apply_pct,
                                            jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                                            jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                                            jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
                                        FROM job_scope_rows jsr
                                        JOIN job_context jc ON jc.job_id = jsr.job_id
                                        WHERE jsr.enabled = TRUE
                                    ),
                                    source_rows AS (
                                        SELECT
                                            jc.client_db_id,
                                            js.qty,
                                            COALESCE(g.factor, js.factor) AS factor,
                                            COALESCE(g.ghg_unit, js.ghg_unit) AS ghg_unit,
                                            js.apply_pct,
                                            NULL::numeric AS month_1, NULL::numeric AS month_2, NULL::numeric AS month_3, NULL::numeric AS month_4,
                                            NULL::numeric AS month_5, NULL::numeric AS month_6, NULL::numeric AS month_7, NULL::numeric AS month_8,
                                            NULL::numeric AS month_9, NULL::numeric AS month_10, NULL::numeric AS month_11, NULL::numeric AS month_12
                                        FROM job_emission_sources js
                                        JOIN job_context jc ON jc.job_id = js.job_id
                                        LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
                                        WHERE COALESCE(js.enabled, TRUE) = TRUE
                                    ),
                                    combined_rows AS (
                                        SELECT * FROM legacy_rows
                                        UNION ALL
                                        SELECT * FROM source_rows
                                    )
                                    SELECT
                                        client_db_id,
                                        COALESCE(SUM(
                                            CASE
                                                WHEN LOWER(COALESCE(ghg_unit,'kgCO2e')) LIKE '%%kg%%' THEN
                                                    (COALESCE(qty,
                                                            COALESCE(month_1,0)+COALESCE(month_2,0)+
                                                            COALESCE(month_3,0)+COALESCE(month_4,0)+
                                                            COALESCE(month_5,0)+COALESCE(month_6,0)+
                                                            COALESCE(month_7,0)+COALESCE(month_8,0)+
                                                            COALESCE(month_9,0)+COALESCE(month_10,0)+
                                                            COALESCE(month_11,0)+COALESCE(month_12,0),0)
                                                        * COALESCE(factor,0) * COALESCE(apply_pct,100)/100.0)/1000.0
                                                ELSE
                                                    (COALESCE(qty,
                                                            COALESCE(month_1,0)+COALESCE(month_2,0)+
                                                            COALESCE(month_3,0)+COALESCE(month_4,0)+
                                                            COALESCE(month_5,0)+COALESCE(month_6,0)+
                                                            COALESCE(month_7,0)+COALESCE(month_8,0)+
                                                            COALESCE(month_9,0)+COALESCE(month_10,0)+
                                                            COALESCE(month_11,0)+COALESCE(month_12,0),0)
                                                        * COALESCE(factor,0) * COALESCE(apply_pct,100)/100.0)
                                            END
                                        ),0) AS total_emissions
                                    FROM combined_rows
                                    GROUP BY client_db_id
                                ) sub
                                """.format(org_match=_org_match_clause()),
                            [industry, org_id],
                        ).fetchone()
                    else:
                        avg_df = con.execute(
                            """
                            SELECT AVG(total_emissions) FROM (
                                WITH job_context AS (
                                    SELECT
                                        j.job_id,
                                        j.client_db_id
                                    FROM jobs j
                                    JOIN clients c ON c.db_id = j.client_db_id
                                    WHERE c.industry = %s AND j.is_crp = TRUE
                                ),
                                    legacy_rows AS (
                                        SELECT
                                            jc.client_db_id,
                                            jsr.qty,
                                            jsr.factor,
                                            jsr.ghg_unit,
                                            jsr.apply_pct,
                                            jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                                            jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                                            jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
                                        FROM job_scope_rows jsr
                                        JOIN job_context jc ON jc.job_id = jsr.job_id
                                        WHERE jsr.enabled = TRUE
                                    ),
                                    source_rows AS (
                                        SELECT
                                            jc.client_db_id,
                                            js.qty,
                                            COALESCE(g.factor, js.factor) AS factor,
                                            COALESCE(g.ghg_unit, js.ghg_unit) AS ghg_unit,
                                            js.apply_pct,
                                            NULL::numeric AS month_1, NULL::numeric AS month_2, NULL::numeric AS month_3, NULL::numeric AS month_4,
                                            NULL::numeric AS month_5, NULL::numeric AS month_6, NULL::numeric AS month_7, NULL::numeric AS month_8,
                                            NULL::numeric AS month_9, NULL::numeric AS month_10, NULL::numeric AS month_11, NULL::numeric AS month_12
                                        FROM job_emission_sources js
                                        JOIN job_context jc ON jc.job_id = js.job_id
                                        LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
                                        WHERE COALESCE(js.enabled, TRUE) = TRUE
                                    ),
                                    combined_rows AS (
                                        SELECT * FROM legacy_rows
                                        UNION ALL
                                        SELECT * FROM source_rows
                                    )
                                    SELECT
                                        client_db_id,
                                        COALESCE(SUM(
                                            CASE
                                                WHEN LOWER(COALESCE(ghg_unit,'kgCO2e')) LIKE '%%kg%%' THEN
                                                    (COALESCE(qty,
                                                            COALESCE(month_1,0)+COALESCE(month_2,0)+
                                                            COALESCE(month_3,0)+COALESCE(month_4,0)+
                                                            COALESCE(month_5,0)+COALESCE(month_6,0)+
                                                            COALESCE(month_7,0)+COALESCE(month_8,0)+
                                                            COALESCE(month_9,0)+COALESCE(month_10,0)+
                                                            COALESCE(month_11,0)+COALESCE(month_12,0),0)
                                                        * COALESCE(factor,0) * COALESCE(apply_pct,100)/100.0)/1000.0
                                                ELSE
                                                    (COALESCE(qty,
                                                            COALESCE(month_1,0)+COALESCE(month_2,0)+
                                                            COALESCE(month_3,0)+COALESCE(month_4,0)+
                                                            COALESCE(month_5,0)+COALESCE(month_6,0)+
                                                            COALESCE(month_7,0)+COALESCE(month_8,0)+
                                                            COALESCE(month_9,0)+COALESCE(month_10,0)+
                                                            COALESCE(month_11,0)+COALESCE(month_12,0),0)
                                                        * COALESCE(factor,0) * COALESCE(apply_pct,100)/100.0)
                                            END
                                        ),0) AS total_emissions
                                    FROM combined_rows
                                    GROUP BY client_db_id
                                ) sub
                                """,
                            [industry],
                        ).fetchone()
                    industry_average_emissions = float(avg_df[0]) if avg_df and avg_df[0] is not None else None
                except Exception:
                    industry_average_emissions = None
            if net_year and yearly_emissions:
                yrs = [y['year'] for y in yearly_emissions if y['year'] is not None]
                if yrs:
                    cur_year = max(yrs)
                    net_zero_progress = {
                        "current_year": int(cur_year),
                        "net_zero_year": int(net_year),
                        "years_to_target": int(net_year) - int(cur_year)
                    }

            # Calculate year-over-year change for selected year
            yoy_change = None
            if selected_year is not None:
                ordered_years = [int(y['year']) for y in yearly_emissions if y.get('year') is not None]
                if selected_year in ordered_years:
                    selected_idx = ordered_years.index(selected_year)
                    if selected_idx > 0:
                        current = float(yearly_emissions[selected_idx]['total'])
                        previous = float(yearly_emissions[selected_idx - 1]['total'])
                        if previous > 0:
                            yoy_change = ((current - previous) / previous) * 100

            reports_issued = 0
            report_year = _safe_year_value(selected_year)
            if report_year is None:
                report_year = _safe_year_value(current_metrics.get("year"))
            if report_year is not None and job_ids:
                try:
                    job_placeholders = ",".join(["%s"] * len(job_ids))
                    report_row = con.execute(
                        f"""
                        SELECT COUNT(*)
                        FROM job_report_versions jrv
                        JOIN jobs j ON j.job_id = jrv.job_id
                        WHERE j.job_id IN ({job_placeholders})
                          AND LOWER(COALESCE(jrv.status, '')) = 'final'
                          AND COALESCE(
                                EXTRACT(YEAR FROM jrv.finalized_at),
                                EXTRACT(YEAR FROM jrv.generated_at),
                                j.reporting_year
                              ) = %s
                        """,
                        [*job_ids, int(report_year)],
                    ).fetchone()
                    reports_issued = int(report_row[0]) if report_row and report_row[0] is not None else 0
                except Exception:
                    reports_issued = 0
            
            intensity_metrics = []
            if selected_year is not None:
                selected_intensity = next((y for y in yearly_intensity_metrics if int(y['year']) == int(selected_year)), None)
                if selected_intensity:
                    intensity_metrics = selected_intensity['metrics']
            
            # Get client currency for display.
            try:
                if org_id:
                    client_currency = con.execute(
                        "SELECT currency FROM clients WHERE db_id = %s",
                        [int(client_db_id)]
                    ).fetchone()
                else:
                    client_currency = con.execute(
                        "SELECT currency FROM clients WHERE db_id = %s",
                        [int(client_db_id)]
                    ).fetchone()
            except Exception:
                client_currency = con.execute(
                    "SELECT currency FROM clients WHERE db_id = %s",
                    [int(client_db_id)]
                ).fetchone()
            
            currency = client_currency[0] if client_currency and client_currency[0] else 'GBP'
            payload = {
                'client_db_id': int(client_db_id),
                'selected_year': selected_year,
                'available_years': available_years,
                'current_metrics': {**current_metrics, 'reports_issued': reports_issued},
                'yoy_change': round(yoy_change, 1) if yoy_change is not None else None,
                'yearly_emissions': yearly_emissions,
                'yearly_top_categories': yearly_top_categories,
                'yearly_intensity_metrics': yearly_intensity_metrics,
                'top_categories': top_categories,
                'intensity_metrics': intensity_metrics,
                'currency': currency,
                'benchmark_metrics': benchmark_metrics,
                'industry_average_emissions': None if lite else industry_average_emissions,
                'net_zero_progress': net_zero_progress,
                'diagnostic': diagnostic,
            }
            _set_cached_dashboard(int(client_db_id), year, org_id, payload)
            return payload
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("dashboard.unhandled_error client_db_id=%s", client_db_id)
        raise HTTPException(status_code=500, detail=f"Failed to fetch dashboard data: {e}")


@router.post("/clients/{client_db_id}/insights")
def get_client_insights(
    client_db_id: int,
    payload: dict[str, Any] | None = Body(default=None),
    _user: dict[str, str] = Depends(_current_user),
):
    """Generate AI insights for a client using external LLM."""
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        template_id = None
        if isinstance(payload, dict) and payload.get("prompt_template_id") is not None:
            try:
                template_id = int(payload.get("prompt_template_id"))
            except Exception:
                template_id = None
        with org_context(org_id):
            payload = ai_insights.generate_client_insights(client_db_id, org_id=org_id, template_id=template_id)
        return payload
    except HTTPException:
        # Re-raise known HTTP exceptions (e.g., our 400 for missing key)
        raise
    except Exception as e:
        message = str(e)
        if "Anthropic package not installed" in message:
            raise HTTPException(
                status_code=503,
                detail="AI insights are temporarily unavailable: Anthropic SDK is not installed on the backend server.",
            )
        if "ANTHROPIC_API_KEY not set" in message:
            raise HTTPException(
                status_code=400,
                detail="ANTHROPIC_API_KEY is not configured. Set it in the backend environment and restart.",
            )
        if "AI model call failed" in message:
            raise HTTPException(status_code=502, detail=message)
        raise HTTPException(status_code=500, detail=f"AI insight generation failed: {message}")


@router.post("/clients/{client_db_id}/insights-openai")
def get_client_insights_openai(
    client_db_id: int,
    payload: dict[str, Any] | None = Body(default=None),
    _user: dict[str, str] = Depends(_current_user),
):
    """Generate non-Anthropic insights (OpenAI provider with rule-based fallback)."""
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        template_id = None
        if isinstance(payload, dict) and payload.get("prompt_template_id") is not None:
            try:
                template_id = int(payload.get("prompt_template_id"))
            except Exception:
                template_id = None
        with org_context(org_id):
            payload = ai_insights.generate_client_insights(
                client_db_id,
                provider="openai",
                org_id=org_id,
                template_id=template_id,
            )
        return payload
    except HTTPException:
        raise
    except Exception as e:
        message = str(e)
        if "OpenAI package not installed" in message:
            raise HTTPException(
                status_code=503,
                detail="OpenAI insights are temporarily unavailable: OpenAI SDK is not installed on the backend server.",
            )
        if "OPENAI_API_KEY not set" in message:
            raise HTTPException(
                status_code=400,
                detail="OPENAI_API_KEY is not configured. Set it in the backend environment and restart.",
            )
        raise HTTPException(status_code=500, detail=f"OpenAI insight generation failed: {message}")


@router.get("/clients/{client_db_id}/saved-insights")
def list_client_saved_insights(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        user_id = _saved_insight_user_id(_user)
        if not user_id:
            raise HTTPException(status_code=400, detail="Authenticated user is missing a user_id")
        with get_conn() as con:
            _ensure_saved_client_insights_schema(con)
            if not _saved_client_insights_enabled(con):
                return {"saved_insights": []}
            rows = con.execute(
                """
                SELECT
                    saved_client_insight_id,
                    client_db_id,
                    user_id,
                    org_id,
                    provider,
                    insights_text,
                    structured_json,
                    citations_json,
                    created_at
                FROM saved_client_insights
                WHERE client_db_id = %s
                  AND user_id = %s
                  AND org_id = %s
                ORDER BY created_at DESC, saved_client_insight_id DESC
                """,
                [int(client_db_id), user_id, org_id],
            ).fetchall()
        return {
            "saved_insights": [
                {
                    **_serialize_saved_client_insight_row(row),
                    "preview": _saved_insight_preview(str(row[5]) if len(row) > 5 and row[5] is not None else "", _parse_saved_insight_json(row[6]) if len(row) > 6 else None),
                }
                for row in rows
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load saved insights: {e}")


@router.post("/clients/{client_db_id}/saved-insights")
def save_client_insight(
    client_db_id: int,
    payload: dict[str, Any],
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        user_id = _saved_insight_user_id(_user)
        if not user_id:
            raise HTTPException(status_code=400, detail="Authenticated user is missing a user_id")

        provider = str(payload.get("provider") or "").strip().lower()
        if not provider:
            raise HTTPException(status_code=400, detail="provider is required")

        insights_text = _safe_saved_insight_text(payload.get("insights"))
        if not insights_text:
            raise HTTPException(status_code=400, detail="insights is required")

        structured = payload.get("structured")
        citations = payload.get("citations")

        with get_conn() as con:
            _ensure_saved_client_insights_schema(con)
            row = con.execute(
                """
                INSERT INTO saved_client_insights (
                    user_id,
                    org_id,
                    client_db_id,
                    provider,
                    insights_text,
                    structured_json,
                    citations_json
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING
                    saved_client_insight_id,
                    client_db_id,
                    user_id,
                    org_id,
                    provider,
                    insights_text,
                    structured_json,
                    citations_json,
                    created_at
                """,
                [
                    user_id,
                    org_id,
                    int(client_db_id),
                    provider,
                    insights_text,
                    json.dumps(structured) if structured is not None else None,
                    json.dumps(citations) if citations is not None else None,
                ],
            ).fetchone()

        return {"saved_insight": _serialize_saved_client_insight_row(row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save insight: {e}")


@router.put("/clients/{client_db_id}/saved-insights/{saved_client_insight_id}")
def update_client_saved_insight(
    client_db_id: int,
    saved_client_insight_id: int,
    payload: dict[str, Any],
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        user_id = _saved_insight_user_id(_user)
        if not user_id:
            raise HTTPException(status_code=400, detail="Authenticated user is missing a user_id")

        provider = str(payload.get("provider") or "").strip().lower()
        if not provider:
            raise HTTPException(status_code=400, detail="provider is required")

        insights_text = _safe_saved_insight_text(payload.get("insights"))
        if not insights_text:
            raise HTTPException(status_code=400, detail="insights is required")

        structured = payload.get("structured")
        citations = payload.get("citations")

        with get_conn() as con:
            _ensure_saved_client_insights_schema(con)
            existing = con.execute(
                """
                SELECT 1
                FROM saved_client_insights
                WHERE saved_client_insight_id = %s
                  AND client_db_id = %s
                  AND user_id = %s
                  AND org_id = %s
                LIMIT 1
                """,
                [int(saved_client_insight_id), int(client_db_id), user_id, org_id],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Saved insight not found")

            row = con.execute(
                """
                UPDATE saved_client_insights
                SET
                    provider = %s,
                    insights_text = %s,
                    structured_json = %s,
                    citations_json = %s
                WHERE saved_client_insight_id = %s
                  AND client_db_id = %s
                  AND user_id = %s
                  AND org_id = %s
                RETURNING
                    saved_client_insight_id,
                    client_db_id,
                    user_id,
                    org_id,
                    provider,
                    insights_text,
                    structured_json,
                    citations_json,
                    created_at
                """,
                [
                    provider,
                    insights_text,
                    json.dumps(structured) if structured is not None else None,
                    json.dumps(citations) if citations is not None else None,
                    int(saved_client_insight_id),
                    int(client_db_id),
                    user_id,
                    org_id,
                ],
            ).fetchone()

        return {"saved_insight": _serialize_saved_client_insight_row(row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update saved insight: {e}")


@router.delete("/clients/{client_db_id}/saved-insights/{saved_client_insight_id}")
def delete_client_saved_insight(
    client_db_id: int,
    saved_client_insight_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        user_id = _saved_insight_user_id(_user)
        if not user_id:
            raise HTTPException(status_code=400, detail="Authenticated user is missing a user_id")

        with get_conn() as con:
            _ensure_saved_client_insights_schema(con)
            deleted = con.execute(
                """
                DELETE FROM saved_client_insights
                WHERE saved_client_insight_id = %s
                  AND client_db_id = %s
                  AND user_id = %s
                  AND org_id = %s
                RETURNING saved_client_insight_id
                """,
                [int(saved_client_insight_id), int(client_db_id), user_id, org_id],
            ).fetchone()
            if not deleted:
                raise HTTPException(status_code=404, detail="Saved insight not found")

        return {"ok": True, "saved_client_insight_id": int(saved_client_insight_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete saved insight: {e}")
