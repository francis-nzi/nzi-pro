"""Client Portal Data Entry (Phase 1) — generic tabbed scope-data submission.

Covers the 5 structurally-alike buckets (Company Vehicles, Business Travel,
Energy, Fuels, Other). Employee Commuting reuses its own existing bespoke
flow (api/employee_commuting_routes.py) and Purchased Goods & Services is
Phase 2 (client_spend_mappings-based, no factor at ingestion) -- neither is
handled here. See CLIENT_PORTAL_DATA_ENTRY_SCOPE.md for the full plan.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_schema_seeded = False

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
