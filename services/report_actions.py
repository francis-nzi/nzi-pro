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


def list_report_action_options(
    *,
    include_inactive: bool = False,
    con=None,
) -> list[dict[str, Any]]:
    if con is None:
        with get_conn() as managed:
            return list_report_action_options(include_inactive=include_inactive, con=managed)

    ensure_report_actions_schema(con)
    where_sql = "" if include_inactive else "WHERE COALESCE(is_active, TRUE) = TRUE"
    rows = con.execute(
        f"""
        SELECT
          action_option_id,
          action_name,
          description,
          action_term,
          action_category,
          scope_focus,
          sort_order,
          COALESCE(is_active, TRUE) AS is_active,
          created_at,
          updated_at,
          COALESCE(is_default, FALSE) AS is_default
        FROM report_action_options
        {where_sql}
        ORDER BY sort_order ASC, action_name ASC, action_option_id ASC
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
              (action_name, description, action_term, action_category, scope_focus, sort_order, is_active, is_default, created_by, updated_by)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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


def list_job_report_actions(job_id: int, *, con=None) -> list[dict[str, Any]]:
    if con is None:
        with get_conn() as managed:
            return list_job_report_actions(job_id, con=managed)

    ensure_report_actions_schema(con)
    rows = con.execute(
        """
        SELECT
          a.job_action_id,
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
          cc.full_name                  AS owner_name
        FROM job_report_actions a
        LEFT JOIN client_contacts cc ON cc.contact_id = a.owner_contact_id
        WHERE a.job_id = %s
        ORDER BY a.sort_order ASC, a.action_name ASC, a.job_action_id ASC
        """,
        [int(job_id)],
    ).fetchall()

    items: list[dict[str, Any]] = []
    for row in rows or []:
        term = normalize_action_term(row[4], default="medium")
        items.append(
            {
                "job_action_id": int(row[0]),
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
            }
        )
    return items


def replace_job_report_actions(
    job_id: int,
    items: list[dict[str, Any]] | None,
    *,
    actor: str,
    con=None,
) -> list[dict[str, Any]]:
    if con is None:
        with get_conn(autocommit=False) as managed:
            return replace_job_report_actions(job_id, items, actor=actor, con=managed)

    ensure_report_actions_schema(con)
    job_exists = con.execute("SELECT 1 FROM jobs WHERE job_id = %s", [int(job_id)]).fetchone()
    if not job_exists:
        raise HTTPException(status_code=404, detail="Job not found")

    # Snapshot existing progress/status/owner so a re-save from the CRM doesn't wipe client updates
    state_snapshot: dict[int, dict[str, Any]] = {}
    existing_rows = con.execute(
        """
        SELECT job_action_id, status, progress, target_date, completed_at, owner_contact_id
        FROM job_report_actions WHERE job_id = %s
        """,
        [int(job_id)],
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

        # Restore preserved state from snapshot keyed by job_action_id
        incoming_action_id = raw_dict.get("job_action_id")
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
                "is_custom": bool(raw_dict.get("is_custom")) or option_id_int is None,
                "sort_order": _safe_int(raw_dict.get("sort_order"), (idx + 1) * 10),
                "status": saved_state["status"] if saved_state else str(raw_dict.get("status") or "open"),
                "progress": saved_state["progress"] if saved_state else _safe_int(raw_dict.get("progress"), 0),
                "target_date": saved_state["target_date"] if saved_state else raw_dict.get("target_date"),
                "completed_at": saved_state["completed_at"] if saved_state else None,
                "owner_contact_id": saved_state["owner_contact_id"] if saved_state else raw_dict.get("owner_contact_id"),
            }
        )

    con.execute("DELETE FROM job_report_actions WHERE job_id = %s", [int(job_id)])

    for idx, item in enumerate(normalized_items):
        con.execute(
            """
            INSERT INTO job_report_actions
              (job_id, action_option_id, action_name, description, action_term, action_category,
               scope_focus, is_custom, sort_order, status, progress, target_date, completed_at,
               owner_contact_id, created_by, updated_by)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                int(job_id),
                item["action_option_id"],
                item["action_name"],
                item["description"],
                item["action_term"],
                item["action_category"],
                item["scope_focus"],
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

    return list_job_report_actions(int(job_id), con=con)


def get_job_report_actions_payload(
    job_id: int,
    *,
    include_suggested_options: bool = False,
    con=None,
) -> dict[str, Any]:
    if con is None:
        with get_conn() as managed:
            return get_job_report_actions_payload(
                job_id,
                include_suggested_options=include_suggested_options,
                con=managed,
            )

    items = list_job_report_actions(int(job_id), con=con)
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
        "job_id": int(job_id),
        "items": items,
        "grouped": grouped,
        "term_counts": term_counts,
        "term_options": action_term_options(),
        "total_actions": len(items),
        "summary_sentence": summary_sentence,
    }

    if include_suggested_options:
        payload["suggested_options"] = list_report_action_options(include_inactive=False, con=con)

    return payload


def update_job_action(
    job_id: int,
    job_action_id: int,
    *,
    payload: dict[str, Any],
    actor: str,
    source: str = "crm",
    con=None,
) -> dict[str, Any]:
    """Update progress/status/owner/target_date for a single action and log the change."""
    if con is None:
        with get_conn(autocommit=False) as managed:
            return update_job_action(
                job_id, job_action_id,
                payload=payload, actor=actor, source=source, con=managed,
            )

    ensure_report_actions_schema(con)

    existing = con.execute(
        """
        SELECT job_action_id, status, progress, target_date, completed_at, owner_contact_id
        FROM job_report_actions
        WHERE job_action_id = %s AND job_id = %s
        """,
        [int(job_action_id), int(job_id)],
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
        UPDATE job_report_actions
        SET status = %s, progress = %s, target_date = %s,
            completed_at = %s, owner_contact_id = %s,
            updated_at = NOW(), updated_by = %s
        WHERE job_action_id = %s
        """,
        [new_status, new_progress, new_target, new_completed_at, new_owner, actor, int(job_action_id)],
    )

    if new_status != old_status or new_progress != old_progress or note:
        con.execute(
            """
            INSERT INTO job_report_action_updates
              (job_action_id, changed_by, source, old_progress, new_progress,
               old_status, new_status, note)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [int(job_action_id), actor, source,
             old_progress, new_progress, old_status, new_status, note],
        )

    rows = list_job_report_actions(int(job_id), con=con)
    for row in rows:
        if int(row["job_action_id"]) == int(job_action_id):
            return row
    raise HTTPException(status_code=500, detail="Updated action could not be reloaded")
