"""Client Portal Data Entry (Phase 1) — generic tabbed scope-data submission.

Covers the 5 structurally-alike buckets (Company Vehicles, Business Travel,
Energy, Fuels, Other). Employee Commuting reuses its own existing bespoke
flow (api/employee_commuting_routes.py) and Purchased Goods & Services is
Phase 2 (client_spend_mappings-based, no factor at ingestion) -- neither is
handled here. See CLIENT_PORTAL_DATA_ENTRY_SCOPE.md for the full plan.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

logger = logging.getLogger(__name__)

_schema_seeded = False
_expiry_schema_seeded = False

PORTAL_DATA_ENTRY_EXPIRED_MESSAGE = "Data entry milestone has expired — contact your CRM if you need access."
PORTAL_DATA_ENTRY_OVERRIDE_MAX_DAYS = 30

# Bucket keys, in display order.
BUCKET_KEYS = ["company_vehicles", "business_travel", "energy", "fuels", "other"]
BUCKET_LABELS = {
    "company_vehicles": "Company Vehicles",
    "business_travel": "Business Travel",
    "energy": "Energy",
    "fuels": "Fuels",
    "other": "Other",
}

# Seed mapping from v_factor_lookup.category values (confirmed live against
# production this session -- these are the curated, GHG-Protocol-style names
# emission_factor_definitions.category already normalizes raw CSV categories
# into, per sql_migrations/0050_phase2_dual_read_view.sql:50 -- NOT the raw
# per-dataset CSV "Category" column, which is a different, messier layer
# underneath this). Anything not matched here falls back to "other" rather
# than being excluded -- see bucket_for_category below.
_SEED_CATEGORY_TO_BUCKET = {
    "Company Vehicles": "company_vehicles",
    "Business Travel": "business_travel",
    "Energy": "energy",
    "Electricity Generation": "energy",
    "Fuels and Energy Related Activities": "energy",
    "Fuels": "fuels",
}

# These categories exist in the same taxonomy but are deliberately handled by
# a different flow, not this generic 5-bucket table -- Employee Commuting has
# its own bespoke survey system (api/employee_commuting_routes.py) and
# Purchased Goods and Services is Phase 2 (client_spend_mappings-based, no
# factor at ingestion). They must never fall into "other" as a catch-all.
_EXCLUDED_CATEGORIES = {"Employee Commuting", "Purchased Goods and Services"}


def ensure_portal_data_entry_schema(con) -> None:
    """Create/seed portal_data_entry_buckets and add the review-workflow
    columns job_scope_rows needs for portal-submitted rows. Idempotent,
    matching the ALTER TABLE ... IF NOT EXISTS convention used throughout."""
    global _schema_seeded
    if _schema_seeded:
        return

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS portal_data_entry_buckets (
          bucket_id SERIAL PRIMARY KEY,
          bucket_key VARCHAR NOT NULL,
          match_category VARCHAR,
          match_level_1 VARCHAR,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute(
        "CREATE INDEX IF NOT EXISTS ix_portal_data_entry_buckets_key ON portal_data_entry_buckets (bucket_key)"
    )
    con.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_data_entry_buckets_category
        ON portal_data_entry_buckets (match_category) WHERE match_category IS NOT NULL
        """
    )

    existing = con.execute("SELECT COUNT(*) FROM portal_data_entry_buckets").fetchone()
    if not existing or int(existing[0]) == 0:
        for category, bucket_key in _SEED_CATEGORY_TO_BUCKET.items():
            con.execute(
                """
                INSERT INTO portal_data_entry_buckets (bucket_key, match_category)
                VALUES (%s, %s)
                ON CONFLICT (match_category) WHERE match_category IS NOT NULL DO NOTHING
                """,
                [bucket_key, category],
            )

    _schema_seeded = True


def load_bucket_category_map(con) -> dict[str, str]:
    """Returns {category_value: bucket_key} for every mapped category."""
    df = con.execute("SELECT bucket_key, match_category FROM portal_data_entry_buckets WHERE match_category IS NOT NULL").df()
    if df is None or df.empty:
        return {}
    return {str(row["match_category"]): str(row["bucket_key"]) for _, row in df.iterrows()}


def bucket_for_category(category_map: dict[str, str], category: str | None) -> str | None:
    """Returns None for categories deliberately excluded from this generic
    table (Employee Commuting, Purchased Goods and Services -- handled by
    other flows entirely) so they never leak into "Other" as a catch-all.
    Any other unmapped category defaults to 'other' rather than being
    silently excluded from every tab."""
    text = str(category or "").strip()
    if not text:
        return "other"
    if text in _EXCLUDED_CATEGORIES:
        return None
    return category_map.get(text, "other")


def load_client_category_history(con, client_db_id: int, category_filter) -> list[dict[str, Any]]:
    """Per-year, per-activity emissions + quantity totals for a client's own
    historical data, restricted to categories where `category_filter(cat)`
    is True -- powers the "previous years" table on each portal Data Entry
    tab. Reuses the CRM's own Year-over-Year reporting computation
    (api/client_reporting_routes.py's by_activity_detail path -- same job
    resolution, same JobMonthlyEmissionsResolver/combined_row_metrics calc
    used for the real reported totals, never the frozen job_scope_rows.calc_
    tco2e column) so the portal's figures always reconcile with the CRM's.

    `category_filter` receives the row's resolved category string (the same
    vocabulary bucket_for_category consumes) and returns True to include it
    -- e.g. `lambda cat: bucket_for_category(category_map, cat) == bucket_key`
    for a generic bucket, or `lambda cat: cat == "Employee Commuting"`."""
    # Local imports: these are CRM-reporting internals (api/client_reporting_
    # routes.py, services/monthly_emissions.py), not portal-layer code --
    # importing at call time avoids a module-load-order dependency between
    # the two route files.
    from api.client_reporting_routes import _build_year_jobs, _clean_label, _dataset_category_label, _load_client_jobs
    from services.emissions_reporting import combined_row_metrics, load_combined_reporting_rows
    from services.monthly_emissions import JobMonthlyEmissionsResolver

    jobs_df = _load_client_jobs(con, int(client_db_id), crp_only=False)
    if jobs_df is None or jobs_df.empty:
        return []
    year_jobs = _build_year_jobs(jobs_df)
    job_ids = [yj["job_id"] for yj in year_jobs]
    if not job_ids:
        return []

    scope_df = load_combined_reporting_rows(con, job_ids)
    if scope_df is None or scope_df.empty:
        return []

    resolver_by_job: dict[int, Any] = {}
    emissions_vals: list[float] = []
    quantity_vals: list[float] = []
    uom_vals: list[str] = []
    for _, row in scope_df.iterrows():
        row_type = str(row.get("record_type") or "legacy").strip().lower()
        if row_type == "source_register":
            metrics = combined_row_metrics(row)
        else:
            row_job_id = int(row.get("job_id"))
            resolver = resolver_by_job.get(row_job_id)
            if resolver is None:
                resolver = JobMonthlyEmissionsResolver(con, row_job_id)
                resolver_by_job[row_job_id] = resolver
            metrics = combined_row_metrics(row, resolver)
        emissions_vals.append(round(float(metrics.get("calc_tco2e") or 0.0), 2))
        quantity_vals.append(float(metrics.get("display_qty") or 0.0))
        uom_vals.append(str(metrics.get("display_uom") or "").strip())

    scope_df = scope_df.copy()
    scope_df["emissions"] = emissions_vals
    scope_df["quantity"] = quantity_vals
    scope_df["uom"] = uom_vals
    scope_df["category"] = scope_df.apply(lambda row: _dataset_category_label(row), axis=1)
    if "activity_name" in scope_df.columns:
        scope_df["activity_name"] = scope_df["activity_name"].apply(lambda v: _clean_label(v, "Unknown"))
    else:
        scope_df["activity_name"] = scope_df["category"]

    scope_df = scope_df[scope_df["category"].apply(category_filter)]
    if scope_df.empty:
        return []

    # first-non-blank uom per (year, activity) -- quantities aren't
    # summable across differing units, so the frontend needs to know what
    # unit each cell's quantity figure is actually in.
    def _first_uom(values: Any) -> str:
        for value in values:
            if value:
                return value
        return ""

    detail_groups = (
        scope_df.groupby(["dashboard_year", "activity_name"])
        .agg(emissions=("emissions", "sum"), quantity=("quantity", "sum"), uom=("uom", _first_uom))
        .reset_index()
    )
    out: list[dict[str, Any]] = []
    for _, row in detail_groups.iterrows():
        if row["dashboard_year"] is None or str(row["dashboard_year"]).strip().lower() in {"", "nan", "none"}:
            continue
        out.append(
            {
                "year": int(row["dashboard_year"]),
                "activity": _clean_label(row["activity_name"], "Unknown"),
                "emissions_tco2e": round(float(row["emissions"]), 2),
                "quantity": round(float(row["quantity"]), 2),
                "uom": str(row["uom"] or "").strip() or None,
            }
        )
    out.sort(key=lambda r: (r["year"], r["activity"]))
    return out


def resolve_current_job_for_client(con, client_db_id: int) -> int | None:
    """Auto-pick the client's most recent non-archived, portal-visible job --
    the same heuristic the old (removed) portal_add_action used before
    Actions went client-scoped (git show bf863308^:api/portal_routes.py)."""
    row = con.execute(
        """
        SELECT job_id FROM jobs
        WHERE client_db_id = %s AND COALESCE(portal_visible, TRUE) = TRUE
          AND LOWER(COALESCE(status, '')) NOT LIKE '%%closed%%'
        ORDER BY reporting_year DESC NULLS LAST, job_id DESC
        LIMIT 1
        """,
        [int(client_db_id)],
    ).fetchone()
    return int(row[0]) if row else None


def ensure_portal_expiry_schema(con) -> None:
    global _expiry_schema_seeded
    if _expiry_schema_seeded:
        return
    con.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS portal_data_entry_expiry_override DATE")
    _expiry_schema_seeded = True


def get_portal_data_entry_status(con, job_id: int) -> dict[str, Any]:
    """Data-entry expiry for a job, derived from the job's Data Collection
    Deadline milestone (job_plan.data_collection_due), or a CRM-set override
    if one is present. No milestone set at all means "open" (never expired)
    -- see CLIENT_PORTAL_DATA_ENTRY_SCOPE.md; this must never silently lock
    out a job that predates this feature or hasn't had milestones configured."""
    ensure_portal_expiry_schema(con)
    row = con.execute(
        """
        SELECT jp.data_collection_due, j.portal_data_entry_expiry_override
        FROM jobs j
        LEFT JOIN job_plan jp ON jp.job_id = j.job_id
        WHERE j.job_id = %s
        """,
        [int(job_id)],
    ).fetchone()
    data_collection_due = row[0] if row else None
    expiry_override = row[1] if row else None
    effective_expiry = expiry_override or data_collection_due
    expired = bool(effective_expiry and effective_expiry < date.today())
    return {
        "data_collection_due": data_collection_due.isoformat() if data_collection_due else None,
        "portal_data_entry_expiry_override": expiry_override.isoformat() if expiry_override else None,
        "portal_data_entry_expiry": effective_expiry.isoformat() if effective_expiry else None,
        "portal_data_entry_expired": expired,
    }


def max_portal_data_entry_override_date() -> str:
    """Latest override date allowed -- always PORTAL_DATA_ENTRY_OVERRIDE_MAX_DAYS
    from today, regardless of the Data Collection Deadline milestone. This is a
    rolling cap, not anchored to the original milestone: a CRM can extend up to
    30 days out, and once that runs down, extend again for another 30 days from
    whatever "today" is then -- there's no limit on how many times this repeats."""
    return (date.today() + timedelta(days=PORTAL_DATA_ENTRY_OVERRIDE_MAX_DAYS)).isoformat()


def get_job_summary(con, job_id: int) -> dict[str, Any]:
    """Job context the portal Data Entry tabs show so a client can see which
    job their submissions are attached to, plus the data-entry expiry status
    that gates whether they can still submit."""
    row = con.execute(
        "SELECT job_number, reporting_year, reporting_period_start FROM jobs WHERE job_id = %s",
        [int(job_id)],
    ).fetchone()
    base = {
        "job_id": int(job_id),
        "job_number": row[0] if row else None,
        "reporting_year": row[1] if row else None,
        "reporting_period_start": str(row[2]) if row and row[2] else None,
    }
    base.update(get_portal_data_entry_status(con, job_id))
    return base


def get_previous_bucket_rows(
    con, client_db_id: int, exclude_job_id: int, bucket_key: str,
    category_map: dict[str, str], limit: int = 15,
) -> list[dict[str, Any]]:
    """Distinct factor rows this client has used in prior jobs, most-recent
    job first -- lets a client re-add a recurring item without re-searching.
    Only draws from enabled (i.e. real/reviewed) rows so a still-pending or
    rejected submission never gets suggested back as if it were validated."""
    df = con.execute(
        """
        SELECT jsr.job_id, j.reporting_year, jsr.scope, jsr.category,
               jsr.report_label, jsr.original_id, jsr.uom, jsr.qty
        FROM job_scope_rows jsr
        JOIN jobs j ON j.job_id = jsr.job_id
        WHERE j.client_db_id = %s AND jsr.job_id <> %s
          AND COALESCE(jsr.enabled, TRUE) = TRUE
          AND COALESCE(jsr.is_custom_entry, FALSE) = FALSE
          AND COALESCE(jsr.original_id, '') <> ''
        ORDER BY jsr.job_id DESC, jsr.row_id DESC
        """,
        [int(client_db_id), int(exclude_job_id)],
    ).df()
    if df is None or df.empty:
        return []
    # astype(object) first -- see api/portal_data_entry_routes.py for why the
    # plain df.where(df.notna(), None) is a no-op on float64 columns and
    # breaks JSON serialization for rows with a null qty.
    df = df.astype(object).where(df.notna(), None)
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        original_id = r.get("original_id")
        if not original_id or original_id in seen:
            continue
        if bucket_for_category(category_map, r.get("category")) != bucket_key:
            continue
        seen.add(str(original_id))
        out.append(
            {
                "scope": r.get("scope"),
                "category": r.get("category"),
                "report_label": r.get("report_label"),
                "original_id": original_id,
                "uom": r.get("uom"),
                "last_qty": r.get("qty"),
                "last_job_id": int(r.get("job_id")),
                "last_reporting_year": r.get("reporting_year"),
            }
        )
        if len(out) >= limit:
            break
    return out


def get_previous_register_bucket_rows(
    con, client_db_id: int, exclude_job_id: int, source_type: str, limit: int = 15,
) -> list[dict[str, Any]]:
    """Same idea as get_previous_bucket_rows, but for the two buckets backed
    by job_emission_sources instead of job_scope_rows -- Company Vehicles
    ('asset') and Business Travel ('business_travel'). See
    api/portal_data_entry_routes.py _BUCKET_REGISTER_SOURCE_TYPE."""
    df = con.execute(
        """
        SELECT s.job_id, j.reporting_year, s.scope, s.category,
               s.source_name AS report_label, s.original_id, s.uom, s.qty
        FROM job_emission_sources s
        JOIN jobs j ON j.job_id = s.job_id
        WHERE j.client_db_id = %s AND s.job_id <> %s AND s.source_type = %s
          AND COALESCE(s.enabled, TRUE) = TRUE
          AND COALESCE(s.original_id, '') <> ''
        ORDER BY s.job_id DESC, s.source_id DESC
        """,
        [int(client_db_id), int(exclude_job_id), source_type],
    ).df()
    if df is None or df.empty:
        return []
    df = df.astype(object).where(df.notna(), None)
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        original_id = r.get("original_id")
        if not original_id or original_id in seen:
            continue
        seen.add(str(original_id))
        out.append(
            {
                "scope": r.get("scope"),
                "category": r.get("category"),
                "report_label": r.get("report_label"),
                "original_id": original_id,
                "uom": r.get("uom"),
                "last_qty": r.get("qty"),
                "last_job_id": int(r.get("job_id")),
                "last_reporting_year": r.get("reporting_year"),
            }
        )
        if len(out) >= limit:
            break
    return out


def get_top_register_bucket_factors(
    con, client_db_id: int, source_type: str, limit: int = 8,
) -> list[dict[str, Any]]:
    """Same ranking idea as get_top_factors_for_categories, but ranking
    job_emission_sources rows for a register-backed bucket instead of
    job_scope_rows rows for a category set."""

    def _rank(client_filter: bool) -> list[dict[str, Any]]:
        where = ["s.source_type = %s", "COALESCE(s.enabled, TRUE) = TRUE", "COALESCE(s.original_id, '') <> ''"]
        params: list[Any] = [source_type]
        if client_filter:
            where.append("j.client_db_id = %s")
            params.append(int(client_db_id))
        df = con.execute(
            f"""
            SELECT s.scope, s.category, s.source_name AS report_label, s.original_id, s.uom, COUNT(*) AS use_count
            FROM job_emission_sources s
            JOIN jobs j ON j.job_id = s.job_id
            WHERE {" AND ".join(where)}
            GROUP BY s.scope, s.category, s.source_name, s.original_id, s.uom
            ORDER BY use_count DESC
            LIMIT %s
            """,
            params + [int(limit)],
        ).df()
        if df is None or df.empty:
            return []
        return [
            {
                "scope": r.get("scope"),
                "category": r.get("category"),
                "report_label": r.get("report_label"),
                "original_id": r.get("original_id"),
                "uom": r.get("uom"),
                "use_count": int(r.get("use_count")),
            }
            for _, r in df.iterrows()
        ]

    personal = _rank(client_filter=True) if client_db_id is not None else []
    if len(personal) >= limit:
        return personal
    seen = {item["original_id"] for item in personal}
    for item in _rank(client_filter=False):
        if item["original_id"] in seen:
            continue
        personal.append(item)
        seen.add(item["original_id"])
        if len(personal) >= limit:
            break
    return personal


def get_top_factors_for_categories(
    con, client_db_id: int | None, categories: list[str], limit: int = 8,
) -> list[dict[str, Any]]:
    """Ranks factors in the given categories by usage count across
    job_scope_rows -- this client's own usage first (most-used first); if
    they have no history yet (or client_db_id is None, e.g. a CRM-wide
    browse), falls back to the most-used factors across ALL clients so the
    quick-pick is never just empty. Pure COUNT(*) over existing rows, no new
    schema needed. Shared by both the portal (bucket-grouped categories) and
    the CRM's own factor search (a single selected category)."""
    if not categories:
        return []
    placeholders = ",".join(["%s"] * len(categories))

    def _rank(client_filter: bool) -> list[dict[str, Any]]:
        where = [f"jsr.category IN ({placeholders})", "COALESCE(jsr.enabled, TRUE) = TRUE", "COALESCE(jsr.original_id, '') <> ''"]
        params: list[Any] = list(categories)
        if client_filter:
            where.append("j.client_db_id = %s")
            params.append(int(client_db_id))
        df = con.execute(
            f"""
            SELECT jsr.scope, jsr.category, jsr.report_label, jsr.original_id, jsr.uom, COUNT(*) AS use_count
            FROM job_scope_rows jsr
            JOIN jobs j ON j.job_id = jsr.job_id
            WHERE {" AND ".join(where)}
            GROUP BY jsr.scope, jsr.category, jsr.report_label, jsr.original_id, jsr.uom
            ORDER BY use_count DESC
            LIMIT %s
            """,
            params + [int(limit)],
        ).df()
        if df is None or df.empty:
            return []
        return [
            {
                "scope": r.get("scope"),
                "category": r.get("category"),
                "report_label": r.get("report_label"),
                "original_id": r.get("original_id"),
                "uom": r.get("uom"),
                "use_count": int(r.get("use_count")),
            }
            for _, r in df.iterrows()
        ]

    personal = _rank(client_filter=True) if client_db_id is not None else []
    if len(personal) >= limit:
        return personal
    seen = {item["original_id"] for item in personal}
    for item in _rank(client_filter=False):
        if item["original_id"] in seen:
            continue
        personal.append(item)
        seen.add(item["original_id"])
        if len(personal) >= limit:
            break
    return personal


def get_top_bucket_factors(
    con, client_db_id: int, bucket_key: str, category_map: dict[str, str], limit: int = 8,
) -> list[dict[str, Any]]:
    """Bucket-grouped wrapper around get_top_factors_for_categories -- a
    portal bucket (e.g. "energy") maps to several raw categories."""
    categories = [cat for cat, key in category_map.items() if key == bucket_key]
    return get_top_factors_for_categories(con, client_db_id, categories, limit)


def get_top_spend_categories(con, client_db_id: int, limit: int = 8) -> list[dict[str, Any]]:
    """Same ranking idea as get_top_factors_for_categories, but for
    Purchased Goods & Services -- ranks previously-confirmed spend
    categories by how often this client (falling back to all clients) has
    mapped a line to them, so the category picker can lead with the most
    likely matches instead of a blank search box."""

    def _rank(client_filter: bool) -> list[dict[str, Any]]:
        where = ["e.mapping_status = 'mapped'", "COALESCE(e.is_deleted, FALSE) = FALSE", "e.factor_db_id IS NOT NULL"]
        params: list[Any] = []
        if client_filter:
            where.append("j.client_db_id = %s")
            params.append(int(client_db_id))
        df = con.execute(
            f"""
            SELECT e.factor_db_id, e.mapped_scope AS scope, e.mapped_category AS category,
                   e.mapped_report_label AS report_label, COUNT(*) AS use_count
            FROM job_spend_entries e
            JOIN jobs j ON j.job_id = e.job_id
            WHERE {" AND ".join(where)}
            GROUP BY e.factor_db_id, e.mapped_scope, e.mapped_category, e.mapped_report_label
            ORDER BY use_count DESC
            LIMIT %s
            """,
            params + [int(limit)],
        ).df()
        if df is None or df.empty:
            return []
        return [
            {
                "db_id": int(r.get("factor_db_id")),
                "scope": r.get("scope"),
                "category": r.get("category"),
                "report_label": r.get("report_label"),
                "use_count": int(r.get("use_count")),
            }
            for _, r in df.iterrows()
        ]

    personal = _rank(client_filter=True)
    if len(personal) >= limit:
        return personal
    seen = {item["db_id"] for item in personal}
    for item in _rank(client_filter=False):
        if item["db_id"] in seen:
            continue
        personal.append(item)
        seen.add(item["db_id"])
        if len(personal) >= limit:
            break
    return personal


def job_scope_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    """Shared shaping for a job_scope_rows row as returned to the portal."""
    return {
        "row_id": row.get("row_id"),
        "site_id": row.get("site_id"),
        "scope": row.get("scope"),
        "category": row.get("category"),
        "report_label": row.get("report_label"),
        "original_id": row.get("original_id"),
        "uom": row.get("uom"),
        "qty": row.get("qty"),
        "factor": row.get("factor"),
        "calc_tco2e": row.get("calc_tco2e"),
        "month_1": row.get("month_1"), "month_2": row.get("month_2"), "month_3": row.get("month_3"),
        "month_4": row.get("month_4"), "month_5": row.get("month_5"), "month_6": row.get("month_6"),
        "month_7": row.get("month_7"), "month_8": row.get("month_8"), "month_9": row.get("month_9"),
        "month_10": row.get("month_10"), "month_11": row.get("month_11"), "month_12": row.get("month_12"),
        "review_status": row.get("review_status"),
        "review_note": row.get("review_note"),
        "reviewed_by": row.get("reviewed_by"),
        "reviewed_at": str(row.get("reviewed_at")) if row.get("reviewed_at") else None,
        "submitted_by_portal": bool(row.get("submitted_by_portal")),
        "enabled": bool(row.get("enabled")),
    }
