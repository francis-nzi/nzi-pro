from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from core.database import get_conn

ACTION_TERM_ORDER = ["short", "medium", "long"]
ACTION_TERM_LABELS = {
    "short": "Short term",
    "medium": "Medium term",
    "long": "Long term",
}
ACTION_TERM_HINTS = {
    "short": "0-12 months",
    "medium": "1-3 years",
    "long": "3+ years",
}

ACTION_STATUSES = ["open", "approved", "in_progress", "completed", "cancelled"]

DEFAULT_ACTION_CATEGORIES = [
    "Energy", "Buildings", "Travel", "Commuting",
    "Fleet", "Procurement", "Renewables", "Data & Governance",
]

UNCLASSIFIED_LEGACY_LEVER_CODE = "UNCLASSIFIED-LEGACY"

# ISO 14060-style action lever framework: 3 Spheres -> 9 Sub-Spheres -> 24
# Levers. Text transcribed verbatim from the reference "Sub-Spheres and
# Action Levers" table. Mirrored in sql_migrations/0064_action_lever_framework.sql.
STANDARD_ACTION_LEVERS: list[dict[str, Any]] = [
    {"sphere_code": "A", "sphere_name": "Products and Services", "sub_sphere_code": "A1", "sub_sphere_name": "Product and Service Innovation", "lever_code": "A1.1", "lever_description": "Develop and scale products that accelerate others' emissions reductions (i.e., resulting in avoided emissions)", "sort_order": 10},
    {"sphere_code": "A", "sphere_name": "Products and Services", "sub_sphere_code": "A1", "sub_sphere_name": "Product and Service Innovation", "lever_code": "A1.2", "lever_description": "Develop and scale services that accelerate others' emissions reductions (i.e., resulting in avoided emissions)", "sort_order": 20},
    {"sphere_code": "A", "sphere_name": "Products and Services", "sub_sphere_code": "A2", "sub_sphere_name": "Business Model Innovation", "lever_code": "A2.1", "lever_description": "Implement revenue models that decouple growth from material consumption", "sort_order": 30},
    {"sphere_code": "A", "sphere_name": "Products and Services", "sub_sphere_code": "A2", "sub_sphere_name": "Business Model Innovation", "lever_code": "A2.2", "lever_description": "Implement incentives for sustainable consumer behaviours", "sort_order": 40},
    {"sphere_code": "A", "sphere_name": "Products and Services", "sub_sphere_code": "A3", "sub_sphere_name": "Climate Solutions Research and Development", "lever_code": "A3.1", "lever_description": "Catalyze and invest in internal climate solutions R&D (e.g., patents for climate solutions)", "sort_order": 50},
    {"sphere_code": "A", "sphere_name": "Products and Services", "sub_sphere_code": "A3", "sub_sphere_name": "Climate Solutions Research and Development", "lever_code": "A3.2", "lever_description": "Conduct joint climate solutions R&D for own products and services with external partners", "sort_order": 60},

    {"sphere_code": "B", "sphere_name": "Portfolio of Climate System Investments", "sub_sphere_code": "B1", "sub_sphere_name": "Low-carbon systems and solutions", "lever_code": "B1.1", "lever_description": "Scale high-integrity credits/certificates for low-carbon technology and solutions beyond the emissions inventory", "sort_order": 70},
    {"sphere_code": "B", "sphere_name": "Portfolio of Climate System Investments", "sub_sphere_code": "B1", "sub_sphere_name": "Low-carbon systems and solutions", "lever_code": "B1.2", "lever_description": "Support the scaling of low-carbon solutions through advanced financing (e.g., accelerators, incubator funds, offtake deals)", "sort_order": 80},
    {"sphere_code": "B", "sphere_name": "Portfolio of Climate System Investments", "sub_sphere_code": "B1", "sub_sphere_name": "Low-carbon systems and solutions", "lever_code": "B1.3", "lever_description": "Invest in enabling infrastructure (e.g., grids, renewables) and shift money from high-emitting activities to low-emitting activities to grow new markets for solutions", "sort_order": 90},
    {"sphere_code": "B", "sphere_name": "Portfolio of Climate System Investments", "sub_sphere_code": "B2", "sub_sphere_name": "Nature conservation and restoration", "lever_code": "B2.1", "lever_description": "Purchase and retire high-integrity credits/certificates supporting nature-based solutions beyond the emissions inventory", "sort_order": 100},
    {"sphere_code": "B", "sphere_name": "Portfolio of Climate System Investments", "sub_sphere_code": "B2", "sub_sphere_name": "Nature conservation and restoration", "lever_code": "B2.2", "lever_description": "Support conservation and restoration programmes/initiatives", "sort_order": 110},
    {"sphere_code": "B", "sphere_name": "Portfolio of Climate System Investments", "sub_sphere_code": "B2", "sub_sphere_name": "Nature conservation and restoration", "lever_code": "B2.3", "lever_description": "Invest in enabling infrastructure, services and wider local programmes that support the longevity and impact of restoration projects", "sort_order": 120},
    {"sphere_code": "B", "sphere_name": "Portfolio of Climate System Investments", "sub_sphere_code": "B3", "sub_sphere_name": "Carbon removals", "lever_code": "B3.1", "lever_description": "Purchase and retire high-integrity removal credits/certificates the beyond emissions inventory", "sort_order": 130},
    {"sphere_code": "B", "sphere_name": "Portfolio of Climate System Investments", "sub_sphere_code": "B3", "sub_sphere_name": "Carbon removals", "lever_code": "B3.2", "lever_description": "Support removal technology development through forward looking purchases and financing (e.g., offtake agreements, demand aggregation partnerships)", "sort_order": 140},
    {"sphere_code": "B", "sphere_name": "Portfolio of Climate System Investments", "sub_sphere_code": "B3", "sub_sphere_name": "Carbon removals", "lever_code": "B3.3", "lever_description": "Invest in enabling infrastructure for removals", "sort_order": 150},

    {"sphere_code": "C", "sphere_name": "Policy and Public Engagement", "sub_sphere_code": "C1", "sub_sphere_name": "Government and Policy Engagement", "lever_code": "C1.1", "lever_description": "Advocate for policies to address external dependencies and climate risk", "sort_order": 160},
    {"sphere_code": "C", "sphere_name": "Policy and Public Engagement", "sub_sphere_code": "C1", "sub_sphere_name": "Government and Policy Engagement", "lever_code": "C1.2", "lever_description": "Advocate for policies to incentivize corporate climate action", "sort_order": 170},
    {"sphere_code": "C", "sphere_name": "Policy and Public Engagement", "sub_sphere_code": "C1", "sub_sphere_name": "Government and Policy Engagement", "lever_code": "C1.3", "lever_description": "Advocate for policies to remove barriers for net zero compatible lifestyles", "sort_order": 180},
    {"sphere_code": "C", "sphere_name": "Policy and Public Engagement", "sub_sphere_code": "C2", "sub_sphere_name": "Industry Engagement", "lever_code": "C2.1", "lever_description": "Advocate and engage with suppliers and partners to implement climate action and sustainable practices", "sort_order": 190},
    {"sphere_code": "C", "sphere_name": "Policy and Public Engagement", "sub_sphere_code": "C2", "sub_sphere_name": "Industry Engagement", "lever_code": "C2.2", "lever_description": "Advocate for alignment to the Paris Agreement for all affiliated coalitions, business and trade associations", "sort_order": 200},
    {"sphere_code": "C", "sphere_name": "Policy and Public Engagement", "sub_sphere_code": "C2", "sub_sphere_name": "Industry Engagement", "lever_code": "C2.3", "lever_description": "Participate in a multistakeholder coalition or initiative with the explicit objective of aligning with global net zero", "sort_order": 210},
    {"sphere_code": "C", "sphere_name": "Policy and Public Engagement", "sub_sphere_code": "C2", "sub_sphere_name": "Industry Engagement", "lever_code": "C2.4", "lever_description": "Open-source climate knowledge and solutions", "sort_order": 220},
    {"sphere_code": "C", "sphere_name": "Policy and Public Engagement", "sub_sphere_code": "C3", "sub_sphere_name": "Public Engagement and Empowerment", "lever_code": "C3.1", "lever_description": "Equip the public with science-backed efforts to generate demand for and enable sustainable lifestyles (e.g., campaigns, entertainment or advertising to clients, customers, employees, or broader public)", "sort_order": 230},
    {"sphere_code": "C", "sphere_name": "Policy and Public Engagement", "sub_sphere_code": "C3", "sub_sphere_name": "Public Engagement and Empowerment", "lever_code": "C3.2", "lever_description": "Participate in public climate advocacy campaigns", "sort_order": 240},
]


DEFAULT_REPORT_ACTION_OPTIONS: list[dict[str, Any]] = [
    {
        "action_name": "Switch to a renewable electricity tariff",
        "description": "Move all suitable sites to renewable electricity procurement and confirm supplier evidence for reporting.",
        "action_term": "short",
        "action_category": "Energy",
        "scope_focus": "Scope 2",
        "sort_order": 10,
    },
    {
        "action_name": "Optimize HVAC controls and setpoints",
        "description": "Review heating, cooling, and ventilation schedules to reduce wasted energy while maintaining comfort.",
        "action_term": "short",
        "action_category": "Buildings",
        "scope_focus": "Scope 1 and Scope 2",
        "sort_order": 20,
    },
    {
        "action_name": "Upgrade lighting to LED and smart controls",
        "description": "Replace inefficient lighting and add occupancy or daylight controls where appropriate.",
        "action_term": "short",
        "action_category": "Energy",
        "scope_focus": "Scope 2",
        "sort_order": 30,
    },
    {
        "action_name": "Introduce travel hierarchy and virtual-first meetings",
        "description": "Prioritize remote meetings, rail travel, and lower-emission options before approving flights.",
        "action_term": "short",
        "action_category": "Travel",
        "scope_focus": "Scope 3",
        "sort_order": 40,
    },
    {
        "action_name": "Launch commuting reduction measures",
        "description": "Support hybrid working, public transport, cycling, and car sharing to reduce commuting emissions.",
        "action_term": "medium",
        "action_category": "Commuting",
        "scope_focus": "Scope 3",
        "sort_order": 50,
    },
    {
        "action_name": "Install submetering and energy monitoring",
        "description": "Improve visibility of major loads so high-consumption sites and equipment can be managed proactively.",
        "action_term": "medium",
        "action_category": "Energy",
        "scope_focus": "Scope 1 and Scope 2",
        "sort_order": 60,
    },
    {
        "action_name": "Improve refrigerant management",
        "description": "Reduce fugitive emissions through leak detection, maintenance planning, and lower-GWP replacements.",
        "action_term": "medium",
        "action_category": "Buildings",
        "scope_focus": "Scope 1",
        "sort_order": 70,
    },
    {
        "action_name": "Electrify company vehicles",
        "description": "Replace suitable fossil-fuel vehicles with electric alternatives and align charging infrastructure plans.",
        "action_term": "medium",
        "action_category": "Fleet",
        "scope_focus": "Scope 1 and Scope 3",
        "sort_order": 80,
    },
    {
        "action_name": "Engage suppliers on lower-carbon procurement",
        "description": "Embed emissions expectations in procurement and work with priority suppliers on lower-carbon alternatives.",
        "action_term": "medium",
        "action_category": "Procurement",
        "scope_focus": "Scope 3",
        "sort_order": 90,
    },
    {
        "action_name": "Run building fabric efficiency improvements",
        "description": "Review insulation, glazing, and building envelope upgrades to reduce long-term heating and cooling demand.",
        "action_term": "long",
        "action_category": "Buildings",
        "scope_focus": "Scope 1 and Scope 2",
        "sort_order": 100,
    },
    {
        "action_name": "Assess onsite solar generation",
        "description": "Evaluate suitable sites for solar PV or other onsite renewable generation to reduce grid demand over time.",
        "action_term": "long",
        "action_category": "Renewables",
        "scope_focus": "Scope 2",
        "sort_order": 110,
    },
    {
        "action_name": "Improve emissions data quality and evidence capture",
        "description": "Strengthen meter reads, supplier evidence, and activity records so reporting quality improves alongside reductions.",
        "action_term": "short",
        "action_category": "Data & Governance",
        "scope_focus": "All scopes",
        "sort_order": 120,
    },
]


def normalize_action_term(value: Any, *, default: str = "medium") -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return default

    normalized = raw.replace("_", " ").replace("-", " ")
    mapping = {
        "short": "short",
        "short term": "short",
        "medium": "medium",
        "medium term": "medium",
        "long": "long",
        "long term": "long",
    }
    term = mapping.get(normalized)
    if not term:
        raise HTTPException(status_code=400, detail="action_term must be short, medium, or long")
    return term


def action_term_options() -> list[dict[str, str]]:
    return [
        {
            "value": term,
            "label": ACTION_TERM_LABELS[term],
            "hint": ACTION_TERM_HINTS[term],
        }
        for term in ACTION_TERM_ORDER
    ]


def _clean_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def ensure_report_actions_schema(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS report_action_options (
          action_option_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          action_name TEXT NOT NULL,
          description TEXT,
          action_term VARCHAR(12) NOT NULL DEFAULT 'medium',
          action_category TEXT,
          scope_focus TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_by VARCHAR,
          updated_by VARCHAR
        )
        """
    )
    con.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_report_action_options_name_ci
        ON report_action_options (LOWER(action_name))
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS job_report_actions (
          job_action_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          job_id INTEGER NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          action_option_id INTEGER REFERENCES report_action_options(action_option_id) ON DELETE SET NULL,
          action_name TEXT NOT NULL,
          description TEXT,
          action_term VARCHAR(12) NOT NULL DEFAULT 'medium',
          action_category TEXT,
          scope_focus TEXT,
          is_custom BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_by VARCHAR,
          updated_by VARCHAR
        )
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_job_report_actions_job_id
        ON job_report_actions (job_id, sort_order, job_action_id)
        """
    )

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS action_categories_lookup (
          category_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          name VARCHAR NOT NULL UNIQUE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE
        )
        """
    )
    for cat in DEFAULT_ACTION_CATEGORIES:
        con.execute(
            """
            INSERT INTO action_categories_lookup (name)
            SELECT %s WHERE NOT EXISTS (
              SELECT 1 FROM action_categories_lookup WHERE lower(name) = lower(%s)
            )
            """,
            [cat, cat],
        )

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS job_report_action_updates (
          update_id   SERIAL PRIMARY KEY,
          job_action_id INTEGER NOT NULL REFERENCES job_report_actions(job_action_id) ON DELETE CASCADE,
          changed_by  VARCHAR,
          source      VARCHAR,
          old_progress INTEGER,
          new_progress INTEGER,
          old_status  VARCHAR,
          new_status  VARCHAR,
          note        TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_job_report_action_updates_action_id
        ON job_report_action_updates (job_action_id)
        """
    )

    # Actions moved from job-scoped to client-scoped (2026-07-21): a client
    # has one shared, ongoing action list across all its jobs/reporting
    # years, not a separate list per job. job_report_actions above is kept
    # in place, untouched, as a rollback reference -- the app no longer
    # writes to it. sql_migrations/9002_backfill_client_report_actions.sql
    # backfills existing job-level data into this table once.
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS client_report_actions (
          client_action_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          client_db_id INTEGER NOT NULL REFERENCES clients(db_id) ON DELETE CASCADE,
          origin_job_id INTEGER REFERENCES jobs(job_id) ON DELETE SET NULL,
          action_option_id INTEGER REFERENCES report_action_options(action_option_id) ON DELETE SET NULL,
          action_name TEXT NOT NULL,
          description TEXT,
          action_term VARCHAR(12) NOT NULL DEFAULT 'medium',
          action_category TEXT,
          scope_focus TEXT,
          is_custom BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'open',
          progress INTEGER NOT NULL DEFAULT 0,
          target_date DATE,
          completed_at TIMESTAMPTZ,
          owner_contact_id INTEGER REFERENCES client_contacts(contact_id) ON DELETE SET NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_by VARCHAR,
          updated_by VARCHAR
        )
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_client_report_actions_client_id
        ON client_report_actions (client_db_id, sort_order, client_action_id)
        """
    )
    con.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_client_report_actions_client_name_ci
        ON client_report_actions (client_db_id, LOWER(action_name))
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS client_report_action_updates (
          update_id SERIAL PRIMARY KEY,
          client_action_id INTEGER NOT NULL REFERENCES client_report_actions(client_action_id) ON DELETE CASCADE,
          changed_by VARCHAR,
          source VARCHAR,
          old_progress INTEGER,
          new_progress INTEGER,
          old_status VARCHAR,
          new_status VARCHAR,
          note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_client_report_action_updates_action_id
        ON client_report_action_updates (client_action_id)
        """
    )

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS action_levers_lookup (
          lever_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          sphere_code VARCHAR,
          sphere_name VARCHAR,
          sub_sphere_code VARCHAR,
          sub_sphere_name VARCHAR,
          lever_code VARCHAR NOT NULL,
          lever_name VARCHAR NOT NULL,
          lever_description TEXT,
          is_custom BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_by VARCHAR,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_by VARCHAR
        )
        """
    )
    con.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_action_levers_lookup_code_ci
        ON action_levers_lookup (LOWER(lever_code))
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_action_levers_lookup_sort
        ON action_levers_lookup (sort_order, lever_id)
        """
    )
    for lever in STANDARD_ACTION_LEVERS:
        con.execute(
            """
            INSERT INTO action_levers_lookup
              (sphere_code, sphere_name, sub_sphere_code, sub_sphere_name, lever_code, lever_name, lever_description, is_custom, sort_order)
            SELECT %s, %s, %s, %s, %s, %s, %s, FALSE, %s
            WHERE NOT EXISTS (
              SELECT 1 FROM action_levers_lookup WHERE lower(lever_code) = lower(%s)
            )
            """,
            [
                lever["sphere_code"], lever["sphere_name"], lever["sub_sphere_code"], lever["sub_sphere_name"],
                lever["lever_code"], lever["lever_code"], lever["lever_description"], lever["sort_order"],
                lever["lever_code"],
            ],
        )
    con.execute(
        """
        INSERT INTO action_levers_lookup
          (sphere_code, sphere_name, sub_sphere_code, sub_sphere_name, lever_code, lever_name, lever_description, is_custom, sort_order)
        SELECT NULL, NULL, NULL, NULL, %s, 'Unclassified (Legacy)',
          'Actions and library options created before the lever framework was introduced. Reclassify as time allows.', TRUE, 9999
        WHERE NOT EXISTS (
          SELECT 1 FROM action_levers_lookup WHERE lower(lever_code) = lower(%s)
        )
        """,
        [UNCLASSIFIED_LEGACY_LEVER_CODE, UNCLASSIFIED_LEGACY_LEVER_CODE],
    )
    con.execute("ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS lever_id INTEGER REFERENCES action_levers_lookup(lever_id)")
    con.execute("ALTER TABLE client_report_actions ADD COLUMN IF NOT EXISTS lever_id INTEGER REFERENCES action_levers_lookup(lever_id)")
    con.execute(
        """
        UPDATE report_action_options
        SET lever_id = (SELECT lever_id FROM action_levers_lookup WHERE lower(lever_code) = lower(%s))
        WHERE lever_id IS NULL
        """,
        [UNCLASSIFIED_LEGACY_LEVER_CODE],
    )
    con.execute(
        """
        UPDATE client_report_actions
        SET lever_id = (SELECT lever_id FROM action_levers_lookup WHERE lower(lever_code) = lower(%s))
        WHERE lever_id IS NULL
        """,
        [UNCLASSIFIED_LEGACY_LEVER_CODE],
    )

    for ddl in (
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS action_term VARCHAR(12) NOT NULL DEFAULT 'medium'",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS action_category TEXT",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS scope_focus TEXT",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS created_by VARCHAR",
        "ALTER TABLE report_action_options ADD COLUMN IF NOT EXISTS updated_by VARCHAR",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS action_option_id INTEGER",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS action_term VARCHAR(12) NOT NULL DEFAULT 'medium'",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS action_category TEXT",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS scope_focus TEXT",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS created_by VARCHAR",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS updated_by VARCHAR",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open'",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS target_date DATE",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ",
        "ALTER TABLE job_report_actions ADD COLUMN IF NOT EXISTS owner_contact_id INTEGER",
    ):
        try:
            con.execute(ddl)
        except Exception:
            pass

    # Bootstrap defaults only when the table is empty. The previous per-default
    # "INSERT WHERE NOT EXISTS (name match)" reseeded any default whose name an
    # admin had renamed, producing duplicates on the next page load.
    existing_count_row = con.execute(
        "SELECT COUNT(*) FROM report_action_options"
    ).fetchone()
    existing_count = int(existing_count_row[0]) if existing_count_row else 0
    if existing_count == 0:
        for item in DEFAULT_REPORT_ACTION_OPTIONS:
            con.execute(
                """
                INSERT INTO report_action_options
                  (action_name, description, action_term, action_category, scope_focus, sort_order, is_active, created_by, updated_by)
                VALUES
                  (%s, %s, %s, %s, %s, %s, TRUE, 'system', 'system')
                """,
                [
                    item["action_name"],
                    item.get("description"),
                    normalize_action_term(item.get("action_term")),
                    item.get("action_category"),
                    item.get("scope_focus"),
                    int(item.get("sort_order") or 0),
                ],
            )


def list_action_levers(*, include_inactive: bool = False, con=None) -> list[dict[str, Any]]:
    if con is None:
        with get_conn() as managed:
            return list_action_levers(include_inactive=include_inactive, con=managed)

    ensure_report_actions_schema(con)
    where_sql = "" if include_inactive else "WHERE COALESCE(is_active, TRUE) = TRUE"
    rows = con.execute(
        f"""
        SELECT lever_id, sphere_code, sphere_name, sub_sphere_code, sub_sphere_name,
               lever_code, lever_name, lever_description, is_custom, is_active, sort_order
        FROM action_levers_lookup
        {where_sql}
        ORDER BY is_custom ASC, sort_order ASC, lever_id ASC
        """
    ).fetchall()
    return [
        {
            "lever_id": int(row[0]),
            "sphere_code": row[1],
            "sphere_name": row[2],
            "sub_sphere_code": row[3],
            "sub_sphere_name": row[4],
            "lever_code": str(row[5] or ""),
            "lever_name": str(row[6] or ""),
            "lever_description": str(row[7] or "") or None,
            "is_custom": bool(row[8]),
            "is_active": bool(row[9]),
            "sort_order": int(row[10] or 0),
        }
        for row in rows or []
    ]


def create_custom_lever(*, name: str, description: str | None = None, actor: str, con=None) -> dict[str, Any]:
    if con is None:
        with get_conn(autocommit=False) as managed:
            return create_custom_lever(name=name, description=description, actor=actor, con=managed)

    ensure_report_actions_schema(con)
    clean_name = _clean_text(name)
    if not clean_name:
        raise HTTPException(status_code=400, detail="Custom lever name is required")

    duplicate = con.execute(
        "SELECT lever_id FROM action_levers_lookup WHERE lower(lever_name) = lower(%s) AND is_custom = TRUE",
        [clean_name],
    ).fetchone()
    if duplicate:
        raise HTTPException(status_code=400, detail="A custom lever with this name already exists")

    next_seq_row = con.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTRING(lever_code FROM 'CUSTOM-(\\d+)') AS INTEGER)), 0) + 1
        FROM action_levers_lookup
        WHERE lever_code LIKE %s
        """,
        ["CUSTOM-%"],
    ).fetchone()
    next_seq = int(next_seq_row[0]) if next_seq_row and next_seq_row[0] is not None else 1
    lever_code = f"CUSTOM-{next_seq}"

    row = con.execute(
        """
        INSERT INTO action_levers_lookup
          (sphere_code, sphere_name, sub_sphere_code, sub_sphere_name, lever_code, lever_name, lever_description,
           is_custom, is_active, sort_order, created_by, updated_by)
        VALUES
          (NULL, NULL, NULL, NULL, %s, %s, %s, TRUE, TRUE, %s, %s, %s)
        RETURNING lever_id
        """,
        [lever_code, clean_name, _clean_text(description), 9999 + next_seq, actor, actor],
    ).fetchone()
    lever_id = int(row[0])

    for lever in list_action_levers(include_inactive=True, con=con):
        if int(lever["lever_id"]) == lever_id:
            return lever
    raise HTTPException(status_code=500, detail="Custom lever could not be reloaded")


def _resolve_lever_id(raw_lever_id: Any, *, con, field_label: str = "lever_id") -> int:
    """Validate that raw_lever_id refers to a real, active lever. Raises 400 if
    missing or unknown -- lever assignment is mandatory for every action."""
    lever_id_int = _safe_int(raw_lever_id, 0) if raw_lever_id not in (None, "") else None
    if not lever_id_int:
        raise HTTPException(status_code=400, detail=f"{field_label} is required")
    row = con.execute(
        "SELECT lever_id FROM action_levers_lookup WHERE lever_id = %s AND COALESCE(is_active, TRUE) = TRUE",
        [int(lever_id_int)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail=f"Unknown or inactive {field_label}: {lever_id_int}")
    return int(lever_id_int)


def get_action_lever_summary(client_db_id: int, *, con=None) -> dict[str, Any]:
    if con is None:
        with get_conn() as managed:
            return get_action_lever_summary(client_db_id, con=managed)

    ensure_report_actions_schema(con)
    levers = list_action_levers(include_inactive=False, con=con)
    stats_rows = con.execute(
        """
        SELECT lever_id,
               COUNT(*) AS action_count,
               COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
               COALESCE(AVG(progress), 0) AS avg_progress
        FROM client_report_actions
        WHERE client_db_id = %s AND lever_id IS NOT NULL
        GROUP BY lever_id
        """,
        [int(client_db_id)],
    ).fetchall()
    stats_by_lever = {
        int(row[0]): {
            "action_count": int(row[1] or 0),
            "completed_count": int(row[2] or 0),
            "avg_progress": round(float(row[3] or 0)),
        }
        for row in stats_rows or []
    }

    standard_levers = []
    custom_levers = []
    for lever in levers:
        stats = stats_by_lever.get(int(lever["lever_id"]), {"action_count": 0, "completed_count": 0, "avg_progress": 0})
        entry = {**lever, **stats}
        if lever["is_custom"]:
            custom_levers.append(entry)
        else:
            standard_levers.append(entry)

    return {
        "client_db_id": int(client_db_id),
        "levers": standard_levers,
        "custom_levers": custom_levers,
    }


def list_report_action_options(
    *,
    include_inactive: bool = False,
    con=None,
) -> list[dict[str, Any]]:
    if con is None:
        with get_conn() as managed:
            return list_report_action_options(include_inactive=include_inactive, con=managed)

    ensure_report_actions_schema(con)
    where_sql = "" if include_inactive else "WHERE COALESCE(o.is_active, TRUE) = TRUE"
    rows = con.execute(
        f"""
        SELECT
          o.action_option_id,
          o.action_name,
          o.description,
          o.action_term,
          o.action_category,
          o.scope_focus,
          o.sort_order,
          COALESCE(o.is_active, TRUE) AS is_active,
          o.created_at,
          o.updated_at,
          COALESCE(o.is_default, FALSE) AS is_default,
          o.lever_id,
          l.lever_code,
          l.lever_name,
          l.sphere_name,
          l.sub_sphere_name,
          l.is_custom AS lever_is_custom
        FROM report_action_options o
        LEFT JOIN action_levers_lookup l ON l.lever_id = o.lever_id
        {where_sql}
        ORDER BY o.sort_order ASC, o.action_name ASC, o.action_option_id ASC
        """
    ).fetchall()

    items: list[dict[str, Any]] = []
    for row in rows or []:
        term = normalize_action_term(row[3], default="medium")
        items.append(
            {
                "action_option_id": int(row[0]),
                "action_name": str(row[1] or ""),
                "description": str(row[2] or "") or None,
                "action_term": term,
                "action_term_label": ACTION_TERM_LABELS[term],
                "action_term_hint": ACTION_TERM_HINTS[term],
                "action_category": str(row[4] or "") or None,
                "scope_focus": str(row[5] or "") or None,
                "sort_order": int(row[6] or 0),
                "is_active": bool(row[7]),
                "created_at": str(row[8]) if row[8] is not None else None,
                "updated_at": str(row[9]) if row[9] is not None else None,
                "is_default": bool(row[10]),
                "lever_id": int(row[11]) if row[11] is not None else None,
                "lever_code": str(row[12] or "") or None,
                "lever_name": str(row[13] or "") or None,
                "lever_sphere_name": str(row[14] or "") or None,
                "lever_sub_sphere_name": str(row[15] or "") or None,
                "lever_is_custom": bool(row[16]) if row[16] is not None else None,
            }
        )
    return items


def upsert_report_action_option(
    *,
    payload: dict[str, Any],
    actor: str,
    action_option_id: int | None = None,
    con=None,
) -> dict[str, Any]:
    if con is None:
        with get_conn(autocommit=False) as managed:
            return upsert_report_action_option(
                payload=payload,
                actor=actor,
                action_option_id=action_option_id,
                con=managed,
            )

    ensure_report_actions_schema(con)

    action_name = _clean_text(payload.get("action_name"))
    if not action_name:
        raise HTTPException(status_code=400, detail="action_name is required")

    action_term = normalize_action_term(payload.get("action_term"), default="medium")
    description = _clean_text(payload.get("description"))
    action_category = _clean_text(payload.get("action_category"))
    scope_focus = _clean_text(payload.get("scope_focus"))
    sort_order = _safe_int(payload.get("sort_order"), 0)
    is_active = bool(payload.get("is_active", True))
    is_default = bool(payload.get("is_default", False))
    lever_id = _resolve_lever_id(payload.get("lever_id"), con=con)

    duplicate = con.execute(
        """
        SELECT action_option_id
        FROM report_action_options
        WHERE LOWER(action_name) = LOWER(%s)
          AND (%s::INT IS NULL OR action_option_id <> %s::INT)
        LIMIT 1
        """,
        [action_name, action_option_id, action_option_id],
    ).fetchone()
    if duplicate:
        raise HTTPException(status_code=400, detail="An action option with this name already exists")

    if action_option_id is None:
        row = con.execute(
            """
            INSERT INTO report_action_options
              (action_name, description, action_term, action_category, scope_focus, sort_order, is_active, is_default, lever_id, created_by, updated_by)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING action_option_id
            """,
            [
                action_name,
                description,
                action_term,
                action_category,
                scope_focus,
                sort_order,
                is_active,
                is_default,
                lever_id,
                actor,
                actor,
            ],
        ).fetchone()
        resolved_id = int(row[0])
    else:
        existing = con.execute(
            "SELECT action_option_id FROM report_action_options WHERE action_option_id = %s",
            [int(action_option_id)],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Action option not found")

        con.execute(
            """
            UPDATE report_action_options
            SET action_name = %s,
                description = %s,
                action_term = %s,
                action_category = %s,
                scope_focus = %s,
                sort_order = %s,
                is_active = %s,
                is_default = %s,
                lever_id = %s,
                updated_at = NOW(),
                updated_by = %s
            WHERE action_option_id = %s
            """,
            [
                action_name,
                description,
                action_term,
                action_category,
                scope_focus,
                sort_order,
                is_active,
                is_default,
                lever_id,
                actor,
                int(action_option_id),
            ],
        )
        resolved_id = int(action_option_id)

    options = list_report_action_options(include_inactive=True, con=con)
    for item in options:
        if int(item["action_option_id"]) == resolved_id:
            return item
    raise HTTPException(status_code=500, detail="Saved action option could not be reloaded")


def list_client_report_actions(client_db_id: int, *, con=None) -> list[dict[str, Any]]:
    if con is None:
        with get_conn() as managed:
            return list_client_report_actions(client_db_id, con=managed)

    ensure_report_actions_schema(con)
    rows = con.execute(
        """
        SELECT
          a.client_action_id,
          a.action_option_id,
          a.action_name,
          a.description,
          a.action_term,
          a.action_category,
          a.scope_focus,
          a.is_custom,
          a.sort_order,
          a.created_at,
          a.updated_at,
          COALESCE(a.status, 'open')    AS status,
          COALESCE(a.progress, 0)       AS progress,
          a.target_date,
          a.completed_at,
          a.owner_contact_id,
          cc.full_name                  AS owner_name,
          a.lever_id,
          l.lever_code,
          l.lever_name,
          l.sphere_name,
          l.sub_sphere_name,
          l.is_custom                   AS lever_is_custom
        FROM client_report_actions a
        LEFT JOIN client_contacts cc ON cc.contact_id = a.owner_contact_id
        LEFT JOIN action_levers_lookup l ON l.lever_id = a.lever_id
        WHERE a.client_db_id = %s
        ORDER BY a.sort_order ASC, a.action_name ASC, a.client_action_id ASC
        """,
        [int(client_db_id)],
    ).fetchall()

    items: list[dict[str, Any]] = []
    for row in rows or []:
        term = normalize_action_term(row[4], default="medium")
        items.append(
            {
                "client_action_id": int(row[0]),
                "action_option_id": int(row[1]) if row[1] is not None else None,
                "action_name": str(row[2] or ""),
                "description": str(row[3] or "") or None,
                "action_term": term,
                "action_term_label": ACTION_TERM_LABELS[term],
                "action_term_hint": ACTION_TERM_HINTS[term],
                "action_category": str(row[5] or "") or None,
                "scope_focus": str(row[6] or "") or None,
                "is_custom": bool(row[7]),
                "sort_order": int(row[8] or 0),
                "created_at": str(row[9]) if row[9] is not None else None,
                "updated_at": str(row[10]) if row[10] is not None else None,
                "status": str(row[11] or "open"),
                "progress": int(row[12] or 0),
                "target_date": str(row[13]) if row[13] is not None else None,
                "completed_at": str(row[14]) if row[14] is not None else None,
                "owner_contact_id": int(row[15]) if row[15] is not None else None,
                "owner_name": str(row[16] or "") or None,
                "lever_id": int(row[17]) if row[17] is not None else None,
                "lever_code": str(row[18] or "") or None,
                "lever_name": str(row[19] or "") or None,
                "lever_sphere_name": str(row[20] or "") or None,
                "lever_sub_sphere_name": str(row[21] or "") or None,
                "lever_is_custom": bool(row[22]) if row[22] is not None else None,
            }
        )
    return items


def replace_client_report_actions(
    client_db_id: int,
    items: list[dict[str, Any]] | None,
    *,
    actor: str,
    con=None,
) -> list[dict[str, Any]]:
    if con is None:
        with get_conn(autocommit=False) as managed:
            return replace_client_report_actions(client_db_id, items, actor=actor, con=managed)

    ensure_report_actions_schema(con)
    client_exists = con.execute("SELECT 1 FROM clients WHERE db_id = %s", [int(client_db_id)]).fetchone()
    if not client_exists:
        raise HTTPException(status_code=404, detail="Client not found")

    # Snapshot existing progress/status/owner so a re-save from the CRM doesn't wipe client updates
    state_snapshot: dict[int, dict[str, Any]] = {}
    existing_rows = con.execute(
        """
        SELECT client_action_id, status, progress, target_date, completed_at, owner_contact_id
        FROM client_report_actions WHERE client_db_id = %s
        """,
        [int(client_db_id)],
    ).fetchall()
    for r in existing_rows or []:
        state_snapshot[int(r[0])] = {
            "status": str(r[1] or "open"),
            "progress": int(r[2] or 0),
            "target_date": r[3],
            "completed_at": r[4],
            "owner_contact_id": int(r[5]) if r[5] is not None else None,
        }

    option_lookup = {
        int(item["action_option_id"]): item
        for item in list_report_action_options(include_inactive=True, con=con)
    }

    seen_option_ids: set[int] = set()
    seen_names: set[str] = set()
    normalized_items: list[dict[str, Any]] = []
    for idx, raw in enumerate(items or []):
        raw_dict = raw if isinstance(raw, dict) else {}
        option_id = raw_dict.get("action_option_id")
        option_id_int = int(option_id) if option_id not in (None, "", 0, "0") else None
        option_defaults = option_lookup.get(option_id_int) if option_id_int is not None else None

        if option_id_int is not None:
            if option_defaults is None:
                raise HTTPException(status_code=400, detail=f"Unknown action_option_id: {option_id_int}")
            if option_id_int in seen_option_ids:
                raise HTTPException(status_code=400, detail="The same suggested action cannot be selected twice")
            seen_option_ids.add(option_id_int)

        action_name = _clean_text(raw_dict.get("action_name")) or (
            str(option_defaults.get("action_name") or "").strip() if option_defaults else None
        )
        if not action_name:
            raise HTTPException(status_code=400, detail=f"action_name is required for action {idx + 1}")
        name_key = action_name.strip().lower()
        if name_key in seen_names:
            raise HTTPException(status_code=409, detail=f'An action named "{action_name}" appears more than once')
        seen_names.add(name_key)

        description = _clean_text(raw_dict.get("description"))
        if description is None and option_defaults:
            description = _clean_text(option_defaults.get("description"))

        action_term = normalize_action_term(
            raw_dict.get("action_term") or (option_defaults.get("action_term") if option_defaults else None),
            default="medium",
        )
        action_category = _clean_text(raw_dict.get("action_category"))
        if action_category is None and option_defaults:
            action_category = _clean_text(option_defaults.get("action_category"))

        scope_focus = _clean_text(raw_dict.get("scope_focus"))
        if scope_focus is None and option_defaults:
            scope_focus = _clean_text(option_defaults.get("scope_focus"))

        raw_lever_id = raw_dict.get("lever_id")
        if raw_lever_id in (None, "", 0, "0") and option_defaults:
            raw_lever_id = option_defaults.get("lever_id")
        try:
            lever_id = _resolve_lever_id(raw_lever_id, con=con)
        except HTTPException as exc:
            raise HTTPException(status_code=400, detail=f"lever_id is required for action {idx + 1} ({action_name})") from exc

        # Restore preserved state from snapshot keyed by client_action_id
        incoming_action_id = raw_dict.get("client_action_id")
        incoming_action_id_int = int(incoming_action_id) if incoming_action_id else None
        saved_state = state_snapshot.get(incoming_action_id_int) if incoming_action_id_int else None

        normalized_items.append(
            {
                "action_option_id": option_id_int,
                "action_name": action_name,
                "description": description,
                "action_term": action_term,
                "action_category": action_category,
                "scope_focus": scope_focus,
                "lever_id": lever_id,
                "is_custom": bool(raw_dict.get("is_custom")) or option_id_int is None,
                "sort_order": _safe_int(raw_dict.get("sort_order"), (idx + 1) * 10),
                "status": saved_state["status"] if saved_state else str(raw_dict.get("status") or "open"),
                "progress": saved_state["progress"] if saved_state else _safe_int(raw_dict.get("progress"), 0),
                "target_date": saved_state["target_date"] if saved_state else raw_dict.get("target_date"),
                "completed_at": saved_state["completed_at"] if saved_state else None,
                "owner_contact_id": saved_state["owner_contact_id"] if saved_state else raw_dict.get("owner_contact_id"),
            }
        )

    con.execute("DELETE FROM client_report_actions WHERE client_db_id = %s", [int(client_db_id)])

    for idx, item in enumerate(normalized_items):
        con.execute(
            """
            INSERT INTO client_report_actions
              (client_db_id, action_option_id, action_name, description, action_term, action_category,
               scope_focus, lever_id, is_custom, sort_order, status, progress, target_date, completed_at,
               owner_contact_id, created_by, updated_by)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                int(client_db_id),
                item["action_option_id"],
                item["action_name"],
                item["description"],
                item["action_term"],
                item["action_category"],
                item["scope_focus"],
                item["lever_id"],
                bool(item["is_custom"]),
                int(item.get("sort_order") or ((idx + 1) * 10)),
                item.get("status") or "open",
                _safe_int(item.get("progress"), 0),
                item.get("target_date"),
                item.get("completed_at"),
                item.get("owner_contact_id"),
                actor,
                actor,
            ],
        )

    return list_client_report_actions(int(client_db_id), con=con)


def get_client_report_actions_payload(
    client_db_id: int,
    *,
    include_suggested_options: bool = False,
    con=None,
) -> dict[str, Any]:
    if con is None:
        with get_conn() as managed:
            return get_client_report_actions_payload(
                client_db_id,
                include_suggested_options=include_suggested_options,
                con=managed,
            )

    items = list_client_report_actions(int(client_db_id), con=con)
    term_counts = {term: 0 for term in ACTION_TERM_ORDER}
    grouped: list[dict[str, Any]] = []

    for term in ACTION_TERM_ORDER:
        term_items = [item for item in items if item.get("action_term") == term]
        term_counts[term] = len(term_items)
        grouped.append(
            {
                "term": term,
                "label": ACTION_TERM_LABELS[term],
                "hint": ACTION_TERM_HINTS[term],
                "count": len(term_items),
                "items": term_items,
            }
        )

    parts = []
    for term in ACTION_TERM_ORDER:
        count = term_counts[term]
        if count:
            parts.append(f"{count} {term}-term")

    summary_sentence = None
    if parts:
        if len(parts) == 1:
            summary_sentence = f"The current action plan includes {parts[0]} action."
        else:
            summary_sentence = f"The current action plan includes {', '.join(parts[:-1])} and {parts[-1]} actions."

    payload: dict[str, Any] = {
        "client_db_id": int(client_db_id),
        "items": items,
        "grouped": grouped,
        "term_counts": term_counts,
        "term_options": action_term_options(),
        "total_actions": len(items),
        "summary_sentence": summary_sentence,
        # Every action must carry a lever_id, so the picker needs to be available
        # to anyone who can edit a client's actions (jobs.edit), not just admins --
        # bundled here rather than behind the admin-only /admin/action-levers route.
        "levers": list_action_levers(include_inactive=False, con=con),
    }

    if include_suggested_options:
        payload["suggested_options"] = list_report_action_options(include_inactive=False, con=con)

    return payload


def update_client_action(
    client_db_id: int,
    client_action_id: int,
    *,
    payload: dict[str, Any],
    actor: str,
    source: str = "crm",
    con=None,
) -> dict[str, Any]:
    """Update progress/status/owner/target_date/name/description/category/
    scope/term for a single action and log the change."""
    if con is None:
        with get_conn(autocommit=False) as managed:
            return update_client_action(
                client_db_id, client_action_id,
                payload=payload, actor=actor, source=source, con=managed,
            )

    ensure_report_actions_schema(con)

    existing = con.execute(
        """
        SELECT client_action_id, status, progress, target_date, completed_at, owner_contact_id,
               action_name, description, action_category, scope_focus, action_term, lever_id
        FROM client_report_actions
        WHERE client_action_id = %s AND client_db_id = %s
        """,
        [int(client_action_id), int(client_db_id)],
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Action not found")

    old_status = str(existing[1] or "open")
    old_progress = int(existing[2] or 0)

    new_status = _clean_text(payload.get("status")) or old_status
    if new_status not in ACTION_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of: {', '.join(ACTION_STATUSES)}",
        )

    raw_progress = payload.get("progress")
    new_progress = max(0, min(100, int(raw_progress))) if raw_progress is not None else old_progress

    raw_owner = payload.get("owner_contact_id")
    if "owner_contact_id" in payload:
        new_owner = int(raw_owner) if raw_owner else None
    else:
        new_owner = int(existing[5]) if existing[5] is not None else None

    raw_target = payload.get("target_date")
    new_target = _clean_text(raw_target) if "target_date" in payload else existing[3]

    note = _clean_text(payload.get("note"))

    if "action_name" in payload:
        new_name = _clean_text(payload.get("action_name"))
        if not new_name:
            raise HTTPException(status_code=400, detail="action_name cannot be blank")
    else:
        new_name = existing[6]

    if new_name != existing[6]:
        duplicate = con.execute(
            """
            SELECT client_action_id FROM client_report_actions
            WHERE client_db_id = %s AND LOWER(action_name) = LOWER(%s) AND client_action_id <> %s
            LIMIT 1
            """,
            [int(client_db_id), new_name, int(client_action_id)],
        ).fetchone()
        if duplicate:
            raise HTTPException(status_code=400, detail="An action with this name already exists")

    new_description = _clean_text(payload.get("description")) if "description" in payload else existing[7]
    new_category = _clean_text(payload.get("action_category")) if "action_category" in payload else existing[8]
    new_scope = _clean_text(payload.get("scope_focus")) if "scope_focus" in payload else existing[9]
    new_term = (
        normalize_action_term(payload.get("action_term"), default=str(existing[10] or "medium"))
        if "action_term" in payload
        else existing[10]
    )
    new_lever_id = _resolve_lever_id(payload.get("lever_id"), con=con) if "lever_id" in payload else existing[11]

    # Auto-set completed_at on first transition to completed; clear it when re-opened
    old_completed_at = existing[4]
    if new_status == "completed" and old_status != "completed":
        new_completed_at = datetime.now(timezone.utc)
    elif new_status != "completed":
        new_completed_at = None
    else:
        new_completed_at = old_completed_at

    con.execute(
        """
        UPDATE client_report_actions
        SET status = %s, progress = %s, target_date = %s,
            completed_at = %s, owner_contact_id = %s,
            action_name = %s, description = %s, action_category = %s,
            scope_focus = %s, action_term = %s, lever_id = %s,
            updated_at = NOW(), updated_by = %s
        WHERE client_action_id = %s
        """,
        [
            new_status, new_progress, new_target, new_completed_at, new_owner,
            new_name, new_description, new_category, new_scope, new_term, new_lever_id,
            actor, int(client_action_id),
        ],
    )

    if new_status != old_status or new_progress != old_progress or note:
        con.execute(
            """
            INSERT INTO client_report_action_updates
              (client_action_id, changed_by, source, old_progress, new_progress,
               old_status, new_status, note)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [int(client_action_id), actor, source,
             old_progress, new_progress, old_status, new_status, note],
        )

    rows = list_client_report_actions(int(client_db_id), con=con)
    for row in rows:
        if int(row["client_action_id"]) == int(client_action_id):
            return row
    raise HTTPException(status_code=500, detail="Updated action could not be reloaded")
