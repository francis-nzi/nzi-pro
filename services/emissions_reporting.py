from __future__ import annotations

from typing import Any, Mapping


def _table_columns(con, table_name: str) -> set[str]:
    try:
        rows = con.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = CURRENT_SCHEMA()
              AND table_name = %s
            """,
            [table_name],
        ).fetchall()
    except Exception:
        return set()
    return {str(row[0]).strip().lower() for row in rows if row and row[0] is not None}


def _factor_lookup_category_expr(con) -> str:
    return "fl.category" if "category" in _table_columns(con, "factor_lookup") else "NULL::text"


def _clean_label(value: Any, fallback: str = "Uncategorized") -> str:
    txt = str(value or "").strip()
    if not txt:
        return fallback
    if txt.lower() in {"nan", "none", "null"}:
        return fallback
    return txt


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        out = float(value)
    except Exception:
        return None
    if out != out:  # NaN check without importing math
        return None
    return out


def _safe_text(value: Any) -> str | None:
    txt = str(value or "").strip()
    return txt or None


def _site_name_lookup(con) -> dict[int, str]:
    from services.sites import site_display_name

    try:
        result = con.execute(
            """
            SELECT site_id, site_name, location
            FROM client_sites
            """
        )
        rows = result.fetchall()
    except Exception:
        return {}
    lookup: dict[int, str] = {}
    for site_id, site_name, location in rows:
        try:
            key = int(site_id)
        except Exception:
            continue
        # Some sites (e.g. added with only an address, no separate display
        # name) have an empty site_name -- fall back to location the same
        # way the CRM's own site list does, instead of "Site {id}".
        lookup[key] = site_display_name(site_id, site_name, location)
    return lookup


def resolve_site_name(row: Mapping[str, Any], site_lookup: Mapping[int, str] | None = None, fallback: str = "No Site Assigned") -> str:
    site_name = _clean_label(row.get("site_name"), "")
    if site_name and site_name.lower() not in {"no site assigned", "unknown"}:
        return site_name

    site_id = row.get("site_id")
    try:
        site_id_int = int(site_id) if site_id is not None else None
    except Exception:
        site_id_int = None

    if site_lookup and site_id_int is not None:
        resolved = site_lookup.get(site_id_int)
        if resolved:
            return resolved

    if site_name:
        return site_name
    if site_id_int is not None:
        return f"Site {site_id_int}"
    return fallback


def combined_row_metrics(row: Mapping[str, Any], resolver=None) -> dict[str, Any]:
    """Return row metrics for mixed legacy + source-register emissions rows.

    Source-register rows already persist their calculated tCO2e, so we can avoid
    re-running the heavier legacy resolver for those rows.
    """
    record_type = str(row.get("record_type") or "legacy").strip().lower()
    if record_type == "source_register":
        qty = _safe_float(row.get("qty")) or 0.0
        factor = _safe_float(row.get("factor"))
        apply_pct = _safe_float(row.get("apply_pct")) or 100.0
        ghg_unit = _safe_text(row.get("ghg_unit"))
        calc_tco2e = _safe_float(row.get("calc_tco2e"))
        if calc_tco2e is None:
            calc_tco2e = float(qty or 0.0) * float(factor or 0.0) * (apply_pct / 100.0)
            if "kg" in str(ghg_unit or "kgCO2e").lower():
                calc_tco2e /= 1000.0
        return {
            "display_qty": qty,
            "display_uom": _safe_text(row.get("uom")),
            "display_factor": factor,
            "factor_label": None,
            "dataset_label": _safe_text(row.get("dataset_name")),
            "calc_tco2e": float(calc_tco2e or 0.0),
            "tco2e_before_apply": float(calc_tco2e or 0.0),
            "monthly_factor_details": [],
            "uses_monthly_factors": False,
            "source_qty": None,
            "source_uom": None,
            "storage_qty": qty,
            "storage_uom": _safe_text(row.get("uom")),
            "storage_factor": factor,
            "reference_factor": None,
            "reference_ghg_unit": ghg_unit,
            "factor_reference": None,
            "storage_reason": None,
            "uses_emissions_fallback": False,
            "source_volume_available": False,
            "display_dataset_id": row.get("dataset_id"),
        }

    if resolver is None:
        raise ValueError("resolver is required for legacy rows")
    return resolver.row_metrics(row)

def load_combined_reporting_rows(con, job_ids: list[int]):
    """Load legacy job_scope_rows plus source-register rows for the given jobs."""
    if not job_ids:
        return con.execute("SELECT NULL::INTEGER AS job_id WHERE FALSE").df()

    placeholders = ",".join(["%s"] * len(job_ids))
    factor_category_expr = _factor_lookup_category_expr(con)
    df = con.execute(
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
                jsr.level_1,
                COALESCE(
                    NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.level_1 AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.level_2 AS VARCHAR)), ''),
                    'Uncategorized'
                ) AS dataset_category,
                COALESCE(
                    NULLIF(TRIM(CAST(jsr.category AS VARCHAR)), ''),
                    'Uncategorized'
                ) AS category,
                COALESCE(s.site_name, 'No Site Assigned') AS site_name,
                jsr.site_id AS site_id,
                jsr.dataset_id,
                jsr.factor_db_id,
                jsr.original_id,
                'Legacy Data Entry'::text AS source_family,
                NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), '') AS lookup_category,
                fl.level_1 AS lookup_level_1,
                fl.level_2 AS lookup_level_2,
                NULL::numeric AS source_qty,
                NULL::text AS source_uom,
                jsr.qty,
                jsr.uom,
                jsr.factor,
                jsr.ghg_unit,
                jsr.apply_pct,
                NULL::numeric AS calc_tco2e,
                jsr.notes,
                NULL::text AS source_type,
                NULL::text AS group_name,
                NULL::text AS asset_identifier,
                NULL::text AS employee_name,
                COALESCE(jsr.report_label, jsr.column_text) AS activity_name,
                jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
            FROM job_scope_rows jsr
            JOIN job_context jc ON jc.job_id = jsr.job_id
            LEFT JOIN client_sites s ON jsr.site_id = s.site_id
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(NULLIF(TRIM(_efd.category),''), NULLIF(TRIM(_fl.category),'')) AS category,
                    COALESCE(NULLIF(TRIM(_efd.level_1),''), NULLIF(TRIM(_fl.level_1),'')) AS level_1,
                    COALESCE(NULLIF(TRIM(_efd.level_2),''), NULLIF(TRIM(_fl.level_2),'')) AS level_2
                FROM factor_lookup _fl
                LEFT JOIN emission_factor_aliases _efa ON _efa.dataset_id = _fl.dataset_id AND _efa.original_id = _fl.original_id
                LEFT JOIN emission_factor_definitions _efd ON _efd.factor_id = _efa.factor_id
                WHERE _fl.db_id = jsr.factor_db_id
                LIMIT 1
            ) fl ON TRUE
            WHERE jsr.enabled = TRUE
        ),
        source_rows AS (
            SELECT
                js.job_id,
                js.source_id AS row_id,
                jc.dashboard_year,
                'source_register'::text AS record_type,
                js.scope,
                NULL::text AS level_1,
                COALESCE(
                    NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(js.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(g.category AS VARCHAR)), ''),
                    'Uncategorized'
                ) AS dataset_category,
                COALESCE(
                    NULLIF(TRIM(CAST(js.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(g.category AS VARCHAR)), ''),
                    'Uncategorized'
                ) AS category,
                COALESCE(cs.site_name, 'No Site Assigned') AS site_name,
                js.site_id AS site_id,
                COALESCE(g.dataset_id, js.dataset_id) AS dataset_id,
                COALESCE(g.factor_db_id, js.factor_db_id) AS factor_db_id,
                COALESCE(g.original_id, js.original_id) AS original_id,
                CASE
                    WHEN js.source_type = 'business_travel' THEN 'Business Travel Register'
                    ELSE 'Asset Register'
                END AS source_family,
                NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), '') AS lookup_category,
                fl.level_1 AS lookup_level_1,
                fl.level_2 AS lookup_level_2,
                NULL::numeric AS source_qty,
                NULL::text AS source_uom,
                js.qty,
                COALESCE(g.uom, js.uom) AS uom,
                COALESCE(g.factor, js.factor) AS factor,
                COALESCE(g.ghg_unit, js.ghg_unit) AS ghg_unit,
                js.apply_pct,
                js.calc_tco2e AS calc_tco2e,
                js.notes,
                js.source_type,
                g.group_name,
                js.asset_identifier,
                js.employee_name,
                COALESCE(
                    NULLIF(TRIM(CAST(js.source_name AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(g.group_name AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(js.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(g.category AS VARCHAR)), ''),
                    'Unknown'
                ) AS activity_name,
                NULL::numeric AS month_1, NULL::numeric AS month_2, NULL::numeric AS month_3, NULL::numeric AS month_4,
                NULL::numeric AS month_5, NULL::numeric AS month_6, NULL::numeric AS month_7, NULL::numeric AS month_8,
                NULL::numeric AS month_9, NULL::numeric AS month_10, NULL::numeric AS month_11, NULL::numeric AS month_12
            FROM job_emission_sources js
            JOIN job_context jc ON jc.job_id = js.job_id
            LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
            LEFT JOIN client_sites cs ON cs.site_id = js.site_id
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(NULLIF(TRIM(_efd.category),''), NULLIF(TRIM(_fl.category),'')) AS category,
                    COALESCE(NULLIF(TRIM(_efd.level_1),''), NULLIF(TRIM(_fl.level_1),'')) AS level_1,
                    COALESCE(NULLIF(TRIM(_efd.level_2),''), NULLIF(TRIM(_fl.level_2),'')) AS level_2
                FROM factor_lookup _fl
                LEFT JOIN emission_factor_aliases _efa ON _efa.dataset_id = _fl.dataset_id AND _efa.original_id = _fl.original_id
                LEFT JOIN emission_factor_definitions _efd ON _efd.factor_id = _efa.factor_id
                WHERE _fl.db_id = COALESCE(g.factor_db_id, js.factor_db_id)
                LIMIT 1
            ) fl ON TRUE
            WHERE COALESCE(js.enabled, TRUE) = TRUE
        )
        SELECT *
        FROM (
            SELECT * FROM legacy_rows
            UNION ALL
            SELECT * FROM source_rows
        ) combined_rows
        ORDER BY dashboard_year, scope, dataset_category, site_name
        """,
        job_ids,
    ).df()
    if not df.empty:
        site_lookup = _site_name_lookup(con)
        if "site_id" in df.columns:
            df["site_name"] = df.apply(lambda row: resolve_site_name(row, site_lookup), axis=1)
    if not df.empty and "category" in df.columns:
        df["category"] = df["category"].apply(_clean_label)
    if not df.empty and "dataset_category" in df.columns:
        df["dataset_category"] = df["dataset_category"].apply(_clean_label)
    return df


def attach_exact_emissions(con, rows_df):
    """Attach exact tCO2e values using the same per-row calculation as job reports."""
    if rows_df is None or rows_df.empty:
        return rows_df

    from services.monthly_emissions import JobMonthlyEmissionsResolver

    resolver_by_job: dict[int, JobMonthlyEmissionsResolver] = {}
    emissions_vals: list[float] = []

    for _, row in rows_df.iterrows():
        row_type = str(row.get("record_type") or "legacy").strip().lower()
        if row_type == "source_register":
            metrics = combined_row_metrics(row)
        else:
            job_id = _safe_float(row.get("job_id"))
            if job_id is None:
                emissions_vals.append(0.0)
                continue

            job_id_int = int(job_id)
            resolver = resolver_by_job.get(job_id_int)
            if resolver is None:
                resolver = JobMonthlyEmissionsResolver(con, job_id_int)
                resolver_by_job[job_id_int] = resolver
            metrics = combined_row_metrics(row, resolver)

        emissions_vals.append(float(metrics.get("calc_tco2e") or 0.0))

    result = rows_df.copy()
    result["emissions"] = emissions_vals
    return result


def exact_job_total_emissions(con, job_id: int) -> float:
    """Return the exact total emissions for a single job."""
    try:
        from api.job_report_routes import get_scope_totals

        totals = get_scope_totals(int(job_id))
        return round(float(totals.get("Total") or 0.0), 2)
    except Exception:
        rows_df = load_combined_reporting_rows(con, [int(job_id)])
        if rows_df is None or rows_df.empty:
            return 0.0
        rows_df = attach_exact_emissions(con, rows_df)
        return round(float(rows_df["emissions"].sum()), 2)


def load_combined_emissions_summary_rows(con, job_ids: list[int]):
    """Load pre-aggregated emissions rows for dashboards and high-level reporting."""
    if not job_ids:
        return con.execute("SELECT NULL::INTEGER AS job_id WHERE FALSE").df()

    placeholders = ",".join(["%s"] * len(job_ids))
    factor_category_expr = _factor_lookup_category_expr(con)
    return con.execute(
        f"""
        WITH job_context AS (
            SELECT
                j.job_id,
                j.client_db_id AS client_id,
                c.client_name,
                COALESCE(
                    EXTRACT(YEAR FROM j.reporting_period_end),
                    EXTRACT(YEAR FROM cjd.reporting_period_to),
                    j.reporting_year
                ) AS dashboard_year
            FROM jobs j
            LEFT JOIN clients c ON c.db_id = j.client_db_id
            LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
            WHERE j.job_id IN ({placeholders})
        ),
        legacy_rows AS (
            SELECT
                jc.job_id,
                jc.client_id,
                jc.client_name,
                jc.dashboard_year,
                jsr.scope,
                COALESCE(
                    NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.level_1 AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.level_2 AS VARCHAR)), ''),
                    'Uncategorized'
                ) AS category,
                COALESCE(
                    SUM(
                        CASE
                            WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%' THEN
                                (
                                    COALESCE(
                                        jsr.qty,
                                        COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) +
                                        COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) +
                                        COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) +
                                        COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) +
                                        COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) +
                                        COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0),
                                        0
                                    ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0
                                ) / 1000.0
                            ELSE
                                (
                                    COALESCE(
                                        jsr.qty,
                                        COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) +
                                        COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) +
                                        COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) +
                                        COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) +
                                        COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) +
                                        COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0),
                                        0
                                    ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0
                                )
                        END
                ),
                0
                ) AS emissions
            FROM job_scope_rows jsr
            JOIN job_context jc ON jc.job_id = jsr.job_id
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(NULLIF(TRIM(_efd.category),''), NULLIF(TRIM(_fl.category),'')) AS category
                FROM factor_lookup _fl
                LEFT JOIN emission_factor_aliases _efa ON _efa.dataset_id = _fl.dataset_id AND _efa.original_id = _fl.original_id
                LEFT JOIN emission_factor_definitions _efd ON _efd.factor_id = _efa.factor_id
                WHERE _fl.db_id = jsr.factor_db_id
                LIMIT 1
            ) fl ON TRUE
            WHERE jsr.enabled = TRUE
            GROUP BY
                jc.job_id,
                jc.client_id,
                jc.client_name,
                jc.dashboard_year,
                jsr.scope,
                COALESCE(
                    NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.level_1 AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.level_2 AS VARCHAR)), ''),
                    'Uncategorized'
                )
        ),
        source_rows AS (
            SELECT
                jc.job_id,
                jc.client_id,
                jc.client_name,
                jc.dashboard_year,
                js.scope,
                COALESCE(
                    NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(g.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(js.category AS VARCHAR)), ''),
                    'Uncategorized'
                ) AS category,
                COALESCE(
                    SUM(
                        ROUND(COALESCE(
                            js.calc_tco2e,
                            CASE
                                WHEN LOWER(COALESCE(js.ghg_unit, COALESCE(g.ghg_unit, 'kgCO2e'))) LIKE '%%kg%%' THEN
                                    (
                                        COALESCE(
                                            js.qty,
                                            0
                                        ) * COALESCE(js.factor, g.factor, 0) * COALESCE(js.apply_pct, 100) / 100.0
                                    ) / 1000.0
                                ELSE
                                    (
                                        COALESCE(js.qty, 0) * COALESCE(js.factor, g.factor, 0) * COALESCE(js.apply_pct, 100) / 100.0
                                    )
                            END
                        ), 2)
                    ),
                    0
                ) AS emissions
            FROM job_emission_sources js
            JOIN job_context jc ON jc.job_id = js.job_id
            LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(NULLIF(TRIM(_efd.category),''), NULLIF(TRIM(_fl.category),'')) AS category
                FROM factor_lookup _fl
                LEFT JOIN emission_factor_aliases _efa ON _efa.dataset_id = _fl.dataset_id AND _efa.original_id = _fl.original_id
                LEFT JOIN emission_factor_definitions _efd ON _efd.factor_id = _efa.factor_id
                WHERE _fl.db_id = COALESCE(g.factor_db_id, js.factor_db_id)
                LIMIT 1
            ) fl ON TRUE
            WHERE COALESCE(js.enabled, TRUE) = TRUE
            GROUP BY
                jc.job_id,
                jc.client_id,
                jc.client_name,
                jc.dashboard_year,
                js.scope,
                COALESCE(
                    NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(g.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(js.category AS VARCHAR)), ''),
                    'Uncategorized'
                )
        )
        SELECT *
        FROM (
            SELECT * FROM legacy_rows
            UNION ALL
            SELECT * FROM source_rows
        ) combined_rows
        ORDER BY dashboard_year, scope, category, client_name
        """,
        job_ids,
    ).df()
