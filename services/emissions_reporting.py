from __future__ import annotations

def load_combined_reporting_rows(con, job_ids: list[int]):
    """Load legacy job_scope_rows plus source-register rows for the given jobs."""
    if not job_ids:
        return con.execute("SELECT NULL::INTEGER AS job_id WHERE FALSE").df()

    placeholders = ",".join(["%s"] * len(job_ids))
    return con.execute(
        f"""
        WITH job_context AS (
            SELECT
                j.job_id,
                COALESCE(
                    EXTRACT(YEAR FROM j.reporting_period_end),
                    EXTRACT(YEAR FROM cjd.reporting_period_to),
                    j.reporting_year
                ) AS dashboard_year
            FROM jobs j
            LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
            WHERE j.job_id IN ({placeholders})
        ),
        legacy_rows AS (
            SELECT
                jsr.job_id,
                jsr.row_id,
                jc.dashboard_year,
                'legacy'::text AS record_type,
                jsr.scope,
                COALESCE(jsr.category, jsr.level_2, 'Uncategorized') AS category,
                COALESCE(s.site_name, 'No Site Assigned') AS site_name,
                jsr.dataset_id,
                jsr.factor_db_id,
                jsr.original_id,
                'Legacy Data Entry'::text AS source_family,
                NULL::numeric AS source_qty,
                NULL::text AS source_uom,
                jsr.qty,
                jsr.uom,
                jsr.factor,
                jsr.ghg_unit,
                jsr.apply_pct,
                jsr.notes,
                NULL::text AS source_type,
                NULL::text AS group_name,
                NULL::text AS asset_identifier,
                NULL::text AS employee_name,
                jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
            FROM job_scope_rows jsr
            JOIN job_context jc ON jc.job_id = jsr.job_id
            LEFT JOIN client_sites s ON jsr.site_id = s.site_id
            WHERE jsr.enabled = TRUE
        ),
        source_rows AS (
            SELECT
                js.job_id,
                js.source_id AS row_id,
                jc.dashboard_year,
                'source_register'::text AS record_type,
                js.scope,
                COALESCE(js.category, 'Uncategorized') AS category,
                COALESCE(cs.site_name, 'No Site Assigned') AS site_name,
                COALESCE(g.dataset_id, js.dataset_id) AS dataset_id,
                COALESCE(g.factor_db_id, js.factor_db_id) AS factor_db_id,
                COALESCE(g.original_id, js.original_id) AS original_id,
                CASE
                    WHEN js.source_type = 'business_travel' THEN 'Business Travel Register'
                    ELSE 'Asset Register'
                END AS source_family,
                NULL::numeric AS source_qty,
                NULL::text AS source_uom,
                js.qty,
                COALESCE(g.uom, js.uom) AS uom,
                COALESCE(g.factor, js.factor) AS factor,
                COALESCE(g.ghg_unit, js.ghg_unit) AS ghg_unit,
                js.apply_pct,
                js.notes,
                js.source_type,
                g.group_name,
                js.asset_identifier,
                js.employee_name,
                NULL::numeric AS month_1, NULL::numeric AS month_2, NULL::numeric AS month_3, NULL::numeric AS month_4,
                NULL::numeric AS month_5, NULL::numeric AS month_6, NULL::numeric AS month_7, NULL::numeric AS month_8,
                NULL::numeric AS month_9, NULL::numeric AS month_10, NULL::numeric AS month_11, NULL::numeric AS month_12
            FROM job_emission_sources js
            JOIN job_context jc ON jc.job_id = js.job_id
            LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
            LEFT JOIN client_sites cs ON cs.site_id = js.site_id
            WHERE COALESCE(js.enabled, TRUE) = TRUE
        )
        SELECT *
        FROM (
            SELECT * FROM legacy_rows
            UNION ALL
            SELECT * FROM source_rows
        ) combined_rows
        ORDER BY dashboard_year, scope, category, site_name
        """,
        job_ids,
    ).df()
