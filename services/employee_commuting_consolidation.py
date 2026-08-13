"""Roll up approved Employee Commuting source-register rows into read-only
job_scope_rows lines, so Data Entry -- and everything downstream that reads
job_scope_rows (Outputs, Insights, Report Preparation, PDF, Portal data) --
sees one consolidated line per (site, emission factor) instead of nothing.

Employee Commuting keeps per-employee rows in job_emission_sources, not
job_scope_rows, because job_scope_rows is one row per factor and can't hold
several people's distinct entries under the same factor (see
api/employee_commuting_routes.py). This module is the bridge: it never
accepts direct edits, it is regenerated wholesale from job_emission_sources
on every commuting mutation. Editing still only happens on the Employee
Commuting tab -- see the auto_pair_kind='employee_commuting' guard in
api/job_scope_data_routes.py's update/delete endpoints.
"""

from __future__ import annotations

CONSOLIDATED_COMMUTING_DATA_SOURCE = "Employee Commuting (Consolidated)"
COMMUTING_AUTO_PAIR_KIND = "employee_commuting"

_MONTH_COLS = [f"month_{i}" for i in range(1, 13)]


def sync_commuting_scope_rows(con, job_id: int) -> None:
    from api.job_scope_data_routes import _ensure_job_scope_rows_schema

    _ensure_job_scope_rows_schema(con)

    month_sum_select = ", ".join(f"SUM(js.month_{i}) AS month_{i}" for i in range(1, 13))
    groups = con.execute(
        f"""
        SELECT
            js.site_id,
            js.factor_db_id,
            MIN(js.scope) AS scope,
            MIN(js.dataset_id) AS dataset_id,
            MIN(js.original_id) AS original_id,
            MIN(js.uom) AS uom,
            MIN(js.factor) AS factor,
            MIN(js.ghg_unit) AS ghg_unit,
            MIN(fl.category) AS category,
            MIN(fl.level_1) AS level_1,
            MIN(fl.level_2) AS level_2,
            MIN(fl.level_3) AS level_3,
            MIN(fl.level_4) AS level_4,
            MIN(fl.column_text) AS column_text,
            MIN(fl.report_label) AS report_label,
            SUM(js.qty) AS total_qty,
            SUM(js.calc_tco2e) AS total_calc_tco2e,
            COUNT(*) AS employee_count,
            STRING_AGG(DISTINCT NULLIF(js.employee_name, ''), ', ' ORDER BY NULLIF(js.employee_name, '')) AS employee_names,
            {month_sum_select}
        FROM job_emission_sources js
        LEFT JOIN v_factor_lookup fl ON fl.db_id = js.factor_db_id
        WHERE js.job_id = %s
          AND js.source_type = 'employee_commuting'
          AND COALESCE(js.enabled, TRUE) = TRUE
          AND js.factor_db_id IS NOT NULL
        GROUP BY js.site_id, js.factor_db_id
        """,
        [int(job_id)],
    ).fetchall()

    # Regenerate wholesale: delete every previously-synced consolidated row
    # for this job, then reinsert the current groups. Simpler and safer than
    # diffing, and cheap -- there's at most a handful of distinct commuting
    # factors per job.
    con.execute(
        "DELETE FROM job_scope_rows WHERE job_id = %s AND data_source = %s",
        [int(job_id), CONSOLIDATED_COMMUTING_DATA_SOURCE],
    )

    for row in groups or []:
        (
            site_id, factor_db_id, scope, dataset_id, original_id, uom, factor, ghg_unit,
            category, level_1, level_2, level_3, level_4, column_text, report_label,
            total_qty, total_calc_tco2e, employee_count, employee_names,
            *months,
        ) = row

        if total_qty is None or float(total_qty) == 0:
            continue

        notes = f"Consolidated from {int(employee_count)} approved Employee Commuting {'entry' if employee_count == 1 else 'entries'}"
        if employee_names:
            notes = f"{notes}: {employee_names}"

        month_cols_sql = ", ".join(_MONTH_COLS)
        month_placeholders = ", ".join(["%s"] * 12)
        con.execute(
            f"""
            INSERT INTO job_scope_rows (
              job_id, scope, site_id, dataset_id, factor_db_id, original_id,
              category, level_1, level_2, level_3, level_4, column_text, report_label,
              qty, uom, factor, ghg_unit, calc_tco2e, apply_pct, data_source,
              data_confidence, notes, is_custom_entry, enabled,
              is_auto_generated, auto_pair_kind, {month_cols_sql}
            )
            VALUES (
              %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s,
              %s, %s, {month_placeholders}
            )
            """,
            [
                int(job_id), scope, site_id, dataset_id, factor_db_id, original_id,
                category or "Employee Commuting", level_1 or "Employee Commuting",
                level_2, level_3, level_4, column_text, report_label or "Employee Commuting",
                float(total_qty), uom, factor, ghg_unit,
                float(total_calc_tco2e or 0.0), 100, CONSOLIDATED_COMMUTING_DATA_SOURCE,
                "M", notes, False, True,
                True, COMMUTING_AUTO_PAIR_KIND,
                *[float(m) if m is not None else None for m in months],
            ],
        )
