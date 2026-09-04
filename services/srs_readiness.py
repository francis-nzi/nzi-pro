from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from core.database import get_conn

# Same memoization pattern as services.ai_prompt_schema / services.report_actions
# -- this runs a seed loop of 24 questions on every call unless memoized.
_SRS_READINESS_SCHEMA_READY = False

SRS_READINESS_SECTIONS = ["Governance", "Strategy", "Risk Management", "Metrics & Targets"]

SRS_SCORE_LABELS = {1: "Compliance", 2: "Maturing", 3: "Cultural"}

# From the UK SRS Readiness Tracker "Scoring" tab.
SRS_SECTION_SUGGESTED_ACTIONS = {
    "Governance": "Formalise accountability, reporting cadence, and governance documents.",
    "Strategy": "Link customer expectations to business planning and a practical roadmap.",
    "Risk Management": "Maintain a risk register with review, escalation, and mitigation actions.",
    "Metrics & Targets": "Improve data coverage, methods, KPIs, and target tracking.",
}

RESPONSE_STATUSES = ["not_started", "in_progress", "complete"]

# Transcribed verbatim from the UK SRS Readiness Tracker "Assessment" tab.
# Mirrored in sql_migrations/0065_srs_readiness.sql.
STANDARD_SRS_QUESTIONS: list[dict[str, Any]] = [
    {"code": "GOV-1", "section": "Governance", "theme": "Leadership oversight", "question_text": "Is there a named senior leader or leadership team with accountability for sustainability-related decisions?", "evidence_examples": "Board papers, leadership terms of reference, named role profile, management structure.", "sort_order": 10},
    {"code": "GOV-2", "section": "Governance", "theme": "Roles and responsibilities", "question_text": "Are sustainability roles and responsibilities documented and communicated across the business?", "evidence_examples": "RACI, job descriptions, policy statements, induction material.", "sort_order": 20},
    {"code": "GOV-3", "section": "Governance", "theme": "Reporting cadence", "question_text": "Is sustainability performance reviewed on a defined timetable by leadership?", "evidence_examples": "Meeting calendar, agenda papers, minutes, KPI packs.", "sort_order": 30},
    {"code": "GOV-4", "section": "Governance", "theme": "Decision-making", "question_text": "Is sustainability considered in major business decisions such as bids, supplier choices, investment, or product changes?", "evidence_examples": "Approval papers, tender sign-off checklist, procurement template, capex form.", "sort_order": 40},
    {"code": "GOV-5", "section": "Governance", "theme": "Policy framework", "question_text": "Does the business have a current policy or governance statement covering sustainability commitments and expectations?", "evidence_examples": "Approved policy, intranet page, external statement, supplier code.", "sort_order": 50},
    {"code": "GOV-6", "section": "Governance", "theme": "Accountability", "question_text": "Are sustainability objectives or responsibilities reflected in management objectives or team plans?", "evidence_examples": "Performance objectives, departmental plans, management scorecards.", "sort_order": 60},

    {"code": "STR-1", "section": "Strategy", "theme": "Customer expectations", "question_text": "Has the business identified what large customers are asking for on climate, carbon, or sustainability reporting?", "evidence_examples": "Bid requirements log, customer questionnaires, account notes, sales feedback.", "sort_order": 70},
    {"code": "STR-2", "section": "Strategy", "theme": "Business planning", "question_text": "Is sustainability reflected in the business plan, growth plan, or strategic priorities?", "evidence_examples": "Strategy documents, annual plan, investment roadmap.", "sort_order": 80},
    {"code": "STR-3", "section": "Strategy", "theme": "Commercial opportunity", "question_text": "Has the business assessed where stronger sustainability performance could help win, retain, or deepen customer relationships?", "evidence_examples": "Customer account plan, market analysis, pipeline review, workshop notes.", "sort_order": 90},
    {"code": "STR-4", "section": "Strategy", "theme": "Value chain understanding", "question_text": "Has the business considered where it sits in customers' supply chains and what data or action it may need to provide?", "evidence_examples": "Supply chain map, customer reporting templates, materiality discussion.", "sort_order": 100},
    {"code": "STR-5", "section": "Strategy", "theme": "Resource planning", "question_text": "Has the business identified the people, systems, and budget needed to improve sustainability reporting readiness?", "evidence_examples": "Budget line, project plan, system review, resourcing plan.", "sort_order": 110},
    {"code": "STR-6", "section": "Strategy", "theme": "Forward priorities", "question_text": "Is there a documented 12-24 month plan for improving sustainability capability?", "evidence_examples": "Roadmap, implementation plan, milestone tracker.", "sort_order": 120},

    {"code": "RISK-1", "section": "Risk Management", "theme": "Risk identification", "question_text": "Has the business identified sustainability-related risks that could affect operations, customers, compliance, or reputation?", "evidence_examples": "Risk register, workshop output, board paper.", "sort_order": 130},
    {"code": "RISK-2", "section": "Risk Management", "theme": "Customer risk", "question_text": "Does the business assess the risk of losing work or being excluded from tenders due to weak sustainability data or performance?", "evidence_examples": "Tender review, lost-opportunity log, customer feedback.", "sort_order": 140},
    {"code": "RISK-3", "section": "Risk Management", "theme": "Regulatory awareness", "question_text": "Is there a process for monitoring relevant reporting developments and customer-driven requirements?", "evidence_examples": "Horizon scanning note, legal update, advisor update, compliance calendar.", "sort_order": 150},
    {"code": "RISK-4", "section": "Risk Management", "theme": "Mitigation actions", "question_text": "Are actions in place to manage key sustainability risks once identified?", "evidence_examples": "Action plan, mitigation owners, project tracker.", "sort_order": 160},
    {"code": "RISK-5", "section": "Risk Management", "theme": "Review cycle", "question_text": "Are sustainability-related risks reviewed regularly alongside other business risks?", "evidence_examples": "Risk committee papers, quarterly risk reviews, board minutes.", "sort_order": 170},
    {"code": "RISK-6", "section": "Risk Management", "theme": "Escalation", "question_text": "Is there a clear route to escalate sustainability issues or customer concerns to leadership?", "evidence_examples": "Escalation procedure, governance map, incident log.", "sort_order": 180},

    {"code": "MET-1", "section": "Metrics & Targets", "theme": "Data coverage", "question_text": "Does the business collect a defined set of sustainability or carbon data relevant to customer requirements?", "evidence_examples": "Data map, spreadsheet, software export, reporting template.", "sort_order": 190},
    {"code": "MET-2", "section": "Metrics & Targets", "theme": "Data quality", "question_text": "Are data sources, assumptions, and calculation methods documented?", "evidence_examples": "Methodology note, calculation file, assumptions log.", "sort_order": 200},
    {"code": "MET-3", "section": "Metrics & Targets", "theme": "KPIs", "question_text": "Are sustainability KPIs reported internally on a regular basis?", "evidence_examples": "KPI dashboard, monthly report, management pack.", "sort_order": 210},
    {"code": "MET-4", "section": "Metrics & Targets", "theme": "Targets", "question_text": "Does the business have formal sustainability or carbon targets with baselines and dates?", "evidence_examples": "Target statement, baseline year note, transition plan.", "sort_order": 220},
    {"code": "MET-5", "section": "Metrics & Targets", "theme": "Action tracking", "question_text": "Are actions to improve performance tracked against milestones, owners, and dates?", "evidence_examples": "Action tracker, project plan, governance pack.", "sort_order": 230},
    {"code": "MET-6", "section": "Metrics & Targets", "theme": "Customer reporting readiness", "question_text": "Can the business respond efficiently to customer requests for sustainability data, policies, and evidence?", "evidence_examples": "Completed customer questionnaires, data room, bid library, case examples.", "sort_order": 240},
]


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _safe_int(value: Any, default: int | None = None) -> int | None:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def maturity_band(avg_score: float | None) -> dict[str, str] | None:
    """Bands from the Scoring tab: 1.0-1.4 Compliance, 1.5-2.3 Maturing, 2.4-3.0 Cultural."""
    if avg_score is None:
        return None
    if avg_score < 1.5:
        return {"label": "Compliance", "description": "Basic / reactive"}
    if avg_score < 2.4:
        return {"label": "Maturing", "description": "Structured / improving"}
    return {"label": "Cultural", "description": "Embedded / proactive"}


def ensure_srs_readiness_schema(con) -> None:
    global _SRS_READINESS_SCHEMA_READY
    if _SRS_READINESS_SCHEMA_READY:
        return

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS srs_readiness_questions (
          question_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          question_code VARCHAR NOT NULL,
          section VARCHAR NOT NULL,
          theme VARCHAR,
          question_text TEXT NOT NULL,
          evidence_examples TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          is_custom BOOLEAN NOT NULL DEFAULT FALSE,
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
        CREATE UNIQUE INDEX IF NOT EXISTS ux_srs_readiness_questions_code_ci
        ON srs_readiness_questions (LOWER(question_code))
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_srs_readiness_questions_sort
        ON srs_readiness_questions (sort_order, question_id)
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS srs_readiness_responses (
          response_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          client_db_id INTEGER NOT NULL REFERENCES clients(db_id) ON DELETE CASCADE,
          question_id INTEGER NOT NULL REFERENCES srs_readiness_questions(question_id) ON DELETE CASCADE,
          score SMALLINT,
          evidence_notes TEXT,
          priority VARCHAR,
          owner VARCHAR,
          target_date DATE,
          status VARCHAR NOT NULL DEFAULT 'not_started',
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_by VARCHAR,
          CONSTRAINT ck_srs_readiness_responses_score CHECK (score IS NULL OR score BETWEEN 1 AND 3),
          CONSTRAINT ux_srs_readiness_responses_client_question UNIQUE (client_db_id, question_id)
        )
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_srs_readiness_responses_client
        ON srs_readiness_responses (client_db_id)
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS client_teams_lookup (
          client_team_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          name VARCHAR NOT NULL UNIQUE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE
        )
        """
    )
    for team_name in ["HR", "Finance", "Sales and Marketing", "Operations", "Board"]:
        con.execute(
            """
            INSERT INTO client_teams_lookup (name, is_active)
            SELECT %s, TRUE WHERE NOT EXISTS (
              SELECT 1 FROM client_teams_lookup WHERE lower(name) = lower(%s)
            )
            """,
            [team_name, team_name],
        )

    # Assessment history -- mirrored in sql_migrations/0069_srs_readiness_assessments.sql
    # (schema only; the backfill lives in the migration file). See that file's
    # header for why srs_readiness_responses is now the rolling action tracker.
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS srs_readiness_assessments (
          assessment_id  INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          client_db_id   INTEGER NOT NULL REFERENCES clients(db_id) ON DELETE CASCADE,
          label          VARCHAR,
          period_year    INTEGER NOT NULL,
          period_label   VARCHAR,
          conducted_on   DATE NOT NULL DEFAULT CURRENT_DATE,
          status         VARCHAR NOT NULL DEFAULT 'draft',
          is_baseline    BOOLEAN NOT NULL DEFAULT FALSE,
          workshop_notes TEXT,
          finalised_at   TIMESTAMP,
          finalised_by   VARCHAR,
          created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
          created_by     VARCHAR,
          updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_by     VARCHAR,
          CONSTRAINT ck_srs_readiness_assessments_status CHECK (status IN ('draft', 'finalised'))
        )
        """
    )
    con.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_srs_assessments_one_draft
        ON srs_readiness_assessments (client_db_id) WHERE status = 'draft'
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_srs_assessments_client
        ON srs_readiness_assessments (client_db_id, conducted_on)
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS srs_readiness_assessment_scores (
          assessment_id  INTEGER NOT NULL REFERENCES srs_readiness_assessments(assessment_id) ON DELETE CASCADE,
          question_id    INTEGER NOT NULL REFERENCES srs_readiness_questions(question_id),
          question_code  VARCHAR NOT NULL,
          section        VARCHAR NOT NULL,
          theme          VARCHAR,
          question_text  TEXT NOT NULL,
          score          SMALLINT,
          evidence_notes TEXT,
          updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT ck_srs_assessment_scores_score CHECK (score IS NULL OR score BETWEEN 1 AND 3),
          CONSTRAINT pk_srs_assessment_scores PRIMARY KEY (assessment_id, question_id)
        )
        """
    )

    for q in STANDARD_SRS_QUESTIONS:
        con.execute(
            """
            INSERT INTO srs_readiness_questions
              (question_code, section, theme, question_text, evidence_examples, is_custom, sort_order)
            SELECT %s, %s, %s, %s, %s, FALSE, %s
            WHERE NOT EXISTS (
              SELECT 1 FROM srs_readiness_questions WHERE lower(question_code) = lower(%s)
            )
            """,
            [
                q["code"], q["section"], q["theme"], q["question_text"], q["evidence_examples"], q["sort_order"],
                q["code"],
            ],
        )

    _SRS_READINESS_SCHEMA_READY = True


def list_srs_readiness_questions(*, include_inactive: bool = False, con=None) -> list[dict[str, Any]]:
    if con is None:
        with get_conn() as managed:
            return list_srs_readiness_questions(include_inactive=include_inactive, con=managed)

    ensure_srs_readiness_schema(con)
    where_sql = "" if include_inactive else "WHERE COALESCE(is_active, TRUE) = TRUE"
    rows = con.execute(
        f"""
        SELECT question_id, question_code, section, theme, question_text, evidence_examples,
               is_active, is_custom, sort_order
        FROM srs_readiness_questions
        {where_sql}
        ORDER BY sort_order ASC, question_id ASC
        """
    ).fetchall()
    return [
        {
            "question_id": int(row[0]),
            "question_code": str(row[1] or ""),
            "section": str(row[2] or ""),
            "theme": row[3],
            "question_text": str(row[4] or ""),
            "evidence_examples": row[5],
            "is_active": bool(row[6]),
            "is_custom": bool(row[7]),
            "sort_order": int(row[8] or 0),
        }
        for row in rows or []
    ]


def upsert_srs_readiness_question(
    *,
    payload: dict[str, Any],
    actor: str,
    question_id: int | None = None,
    con=None,
) -> dict[str, Any]:
    if con is None:
        with get_conn(autocommit=False) as managed:
            return upsert_srs_readiness_question(payload=payload, actor=actor, question_id=question_id, con=managed)

    ensure_srs_readiness_schema(con)
    section = _clean_text(payload.get("section"))
    question_text = _clean_text(payload.get("question_text"))
    if not section or section not in SRS_READINESS_SECTIONS:
        raise HTTPException(status_code=400, detail=f"section must be one of {SRS_READINESS_SECTIONS}")
    if not question_text:
        raise HTTPException(status_code=400, detail="question_text is required")

    theme = _clean_text(payload.get("theme"))
    evidence_examples = _clean_text(payload.get("evidence_examples"))
    is_active = bool(payload.get("is_active", True))
    sort_order = _safe_int(payload.get("sort_order"), 0) or 0

    if question_id is None:
        next_seq_row = con.execute(
            """
            SELECT COALESCE(MAX(CAST(SUBSTRING(question_code FROM 'CUSTOM-(\\d+)') AS INTEGER)), 0) + 1
            FROM srs_readiness_questions
            WHERE question_code LIKE %s
            """,
            ["CUSTOM-%"],
        ).fetchone()
        next_seq = int(next_seq_row[0]) if next_seq_row and next_seq_row[0] is not None else 1
        question_code = f"CUSTOM-{next_seq}"
        row = con.execute(
            """
            INSERT INTO srs_readiness_questions
              (question_code, section, theme, question_text, evidence_examples, is_active, is_custom, sort_order, created_by, updated_by)
            VALUES
              (%s, %s, %s, %s, %s, %s, TRUE, %s, %s, %s)
            RETURNING question_id
            """,
            [question_code, section, theme, question_text, evidence_examples, is_active, sort_order, actor, actor],
        ).fetchone()
        new_id = int(row[0])
    else:
        existing = con.execute(
            "SELECT question_id FROM srs_readiness_questions WHERE question_id = %s",
            [int(question_id)],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Question not found")
        con.execute(
            """
            UPDATE srs_readiness_questions
            SET section = %s, theme = %s, question_text = %s, evidence_examples = %s,
                is_active = %s, sort_order = %s, updated_at = NOW(), updated_by = %s
            WHERE question_id = %s
            """,
            [section, theme, question_text, evidence_examples, is_active, sort_order, actor, int(question_id)],
        )
        new_id = int(question_id)

    for item in list_srs_readiness_questions(include_inactive=True, con=con):
        if item["question_id"] == new_id:
            return item
    raise HTTPException(status_code=500, detail="Question could not be reloaded")


def get_client_srs_responses(client_db_id: int, *, con=None) -> dict[str, Any]:
    """Active questions LEFT JOINed with this client's saved responses, grouped by
    section in the fixed Governance/Strategy/Risk/Metrics order. Used by both the
    CRM scoring tab (editable) and the portal read-only view."""
    if con is None:
        with get_conn() as managed:
            return get_client_srs_responses(client_db_id, con=managed)

    ensure_srs_readiness_schema(con)
    rows = con.execute(
        """
        SELECT q.question_id, q.question_code, q.section, q.theme, q.question_text, q.evidence_examples,
               q.sort_order,
               r.score, r.evidence_notes, r.priority, r.owner, r.target_date, r.status
        FROM srs_readiness_questions q
        LEFT JOIN srs_readiness_responses r
          ON r.question_id = q.question_id AND r.client_db_id = %s
        WHERE COALESCE(q.is_active, TRUE) = TRUE
        ORDER BY q.sort_order ASC, q.question_id ASC
        """,
        [int(client_db_id)],
    ).fetchall()

    by_section: dict[str, list[dict[str, Any]]] = {s: [] for s in SRS_READINESS_SECTIONS}
    for row in rows or []:
        section = str(row[2] or "")
        entry = {
            "question_id": int(row[0]),
            "question_code": str(row[1] or ""),
            "section": section,
            "theme": row[3],
            "question_text": str(row[4] or ""),
            "evidence_examples": row[5],
            "sort_order": int(row[6] or 0),
            "score": int(row[7]) if row[7] is not None else None,
            "score_label": SRS_SCORE_LABELS.get(int(row[7])) if row[7] is not None else None,
            "evidence_notes": row[8],
            "priority": row[9],
            "owner": row[10],
            "target_date": str(row[11]) if row[11] else None,
            "status": str(row[12] or "not_started"),
        }
        by_section.setdefault(section, []).append(entry)

    contact_rows = con.execute(
        """
        SELECT contact_id, full_name, job_title
        FROM client_contacts
        WHERE client_db_id = %s AND COALESCE(TRIM(full_name), '') <> ''
        ORDER BY COALESCE(is_primary, FALSE) DESC, full_name ASC
        """,
        [int(client_db_id)],
    ).fetchall()
    team_rows = con.execute(
        """
        SELECT client_team_id, name
        FROM client_teams_lookup
        WHERE COALESCE(is_active, TRUE) = TRUE
        ORDER BY name ASC
        """
    ).fetchall()

    return {
        "client_db_id": int(client_db_id),
        "owner_options": {
            "contacts": [
                {"id": int(row[0]), "name": str(row[1]), "detail": str(row[2]) if row[2] else None}
                for row in contact_rows or []
            ],
            "teams": [{"id": int(row[0]), "name": str(row[1])} for row in team_rows or []],
        },
        "sections": [
            {"section": s, "questions": by_section.get(s, []), "suggested_action": SRS_SECTION_SUGGESTED_ACTIONS.get(s)}
            for s in SRS_READINESS_SECTIONS
        ],
        "current_assessment": _get_open_draft(con, int(client_db_id)),
        "assessments": list_assessments(int(client_db_id), con=con),
    }


def save_client_srs_responses(client_db_id: int, items: list[dict[str, Any]], *, actor: str, con=None) -> dict[str, Any]:
    """Save the rolling action-tracker fields (priority / owner / target_date /
    status / working notes) for one or more questions. A `score` is only
    accepted while a draft assessment is open -- it is routed to that draft's
    frozen score row and mirrored back onto the response for the live gauges.
    Changing a score with no draft open is a 409 (start a survey first)."""
    if con is None:
        with get_conn(autocommit=False) as managed:
            return save_client_srs_responses(client_db_id, items, actor=actor, con=managed)

    ensure_srs_readiness_schema(con)
    draft = _get_open_draft(con, int(client_db_id))
    draft_id = int(draft["assessment_id"]) if draft else None

    for item in items or []:
        question_id = _safe_int(item.get("question_id"))
        if not question_id:
            continue
        status = _clean_text(item.get("status")) or "not_started"
        if status not in RESPONSE_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {RESPONSE_STATUSES}")

        # Tracker fields -- always upsert, never touching the score column.
        con.execute(
            """
            INSERT INTO srs_readiness_responses
              (client_db_id, question_id, evidence_notes, priority, owner, target_date, status, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (client_db_id, question_id) DO UPDATE SET
              evidence_notes = EXCLUDED.evidence_notes,
              priority = EXCLUDED.priority,
              owner = EXCLUDED.owner,
              target_date = EXCLUDED.target_date,
              status = EXCLUDED.status,
              updated_at = NOW(),
              updated_by = EXCLUDED.updated_by
            """,
            [
                int(client_db_id), int(question_id),
                _clean_text(item.get("evidence_notes")), _clean_text(item.get("priority")),
                _clean_text(item.get("owner")), _clean_text(item.get("target_date")) or None,
                status, actor,
            ],
        )

        if "score" not in item:
            continue
        score = _safe_int(item.get("score"))
        if score is not None and score not in (1, 2, 3):
            raise HTTPException(status_code=400, detail=f"score must be 1, 2, or 3 (question_id {question_id})")
        current_row = con.execute(
            "SELECT score FROM srs_readiness_responses WHERE client_db_id = %s AND question_id = %s",
            [int(client_db_id), int(question_id)],
        ).fetchone()
        current_score = int(current_row[0]) if current_row and current_row[0] is not None else None
        if score == current_score:
            continue
        if draft_id is None:
            raise HTTPException(
                status_code=409,
                detail="Start an assessment to change scores.",
            )
        _upsert_assessment_score(con, draft_id, int(question_id), score, _clean_text(item.get("evidence_notes")))
        con.execute(
            """
            UPDATE srs_readiness_responses SET score = %s, updated_at = NOW(), updated_by = %s
            WHERE client_db_id = %s AND question_id = %s
            """,
            [score, actor, int(client_db_id), int(question_id)],
        )

    return get_client_srs_responses(client_db_id, con=con)


def _summarise_scores(pairs: Any) -> dict[str, Any]:
    """Turn an iterable of (section, score|None) -- one entry per question --
    into the section-average / maturity-band summary shared by the live
    readiness summary and each historical assessment. Overall is the mean of
    the section averages (not of every question), matching the Scoring tab."""
    buckets: dict[str, dict[str, float]] = {
        s: {"active": 0.0, "scored": 0.0, "sum": 0.0} for s in SRS_READINESS_SECTIONS
    }
    for section, score in pairs:
        b = buckets.setdefault(str(section or ""), {"active": 0.0, "scored": 0.0, "sum": 0.0})
        b["active"] += 1
        if score is not None:
            b["scored"] += 1
            b["sum"] += int(score)

    sections_out: list[dict[str, Any]] = []
    section_avgs: list[float] = []
    for section in SRS_READINESS_SECTIONS:
        b = buckets.get(section, {"active": 0.0, "scored": 0.0, "sum": 0.0})
        avg_score = (b["sum"] / b["scored"]) if b["scored"] > 0 else None
        if avg_score is not None:
            section_avgs.append(avg_score)
        band = maturity_band(avg_score)
        sections_out.append({
            "section": section,
            "active_questions": int(b["active"]),
            "questions_scored": int(b["scored"]),
            "avg_score": round(avg_score, 2) if avg_score is not None else None,
            "maturity_label": band["label"] if band else None,
            "maturity_description": band["description"] if band else None,
            "suggested_action": SRS_SECTION_SUGGESTED_ACTIONS.get(section),
        })

    overall_avg = round(sum(section_avgs) / len(section_avgs), 2) if section_avgs else None
    overall_band = maturity_band(overall_avg)
    return {
        "sections": sections_out,
        "overall_avg_score": overall_avg,
        "overall_maturity_label": overall_band["label"] if overall_band else None,
        "overall_maturity_description": overall_band["description"] if overall_band else None,
    }


def get_srs_readiness_summary(client_db_id: int, *, con=None) -> dict[str, Any]:
    """Section averages + maturity bands for the client's *current* position
    (latest finalised assessment, or the open draft while a survey is in
    progress -- both are mirrored onto srs_readiness_responses.score).
    Only questions with a score count toward the average."""
    if con is None:
        with get_conn() as managed:
            return get_srs_readiness_summary(client_db_id, con=managed)

    ensure_srs_readiness_schema(con)
    rows = con.execute(
        """
        SELECT q.section, r.score
        FROM srs_readiness_questions q
        LEFT JOIN srs_readiness_responses r
          ON r.question_id = q.question_id AND r.client_db_id = %s
        WHERE COALESCE(q.is_active, TRUE) = TRUE
        """,
        [int(client_db_id)],
    ).fetchall()
    summary = _summarise_scores(
        (str(row[0] or ""), int(row[1]) if row[1] is not None else None) for row in rows or []
    )
    return {"client_db_id": int(client_db_id), **summary}


# ── Assessments (timestamped survey rounds) ───────────────────────────────────

ASSESSMENT_STATUSES = ["draft", "finalised"]


def _assessment_row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "assessment_id": int(row[0]),
        "client_db_id": int(row[1]),
        "label": row[2],
        "period_year": int(row[3]) if row[3] is not None else None,
        "period_label": row[4],
        "conducted_on": str(row[5]) if row[5] else None,
        "status": str(row[6] or "draft"),
        "is_baseline": bool(row[7]),
        "workshop_notes": row[8],
        "finalised_at": str(row[9]) if row[9] else None,
        "finalised_by": row[10],
    }


_ASSESSMENT_COLS = (
    "assessment_id, client_db_id, label, period_year, period_label, conducted_on, "
    "status, is_baseline, workshop_notes, finalised_at, finalised_by"
)


def _get_assessment(con, assessment_id: int, client_db_id: int | None = None) -> dict[str, Any] | None:
    sql = f"SELECT {_ASSESSMENT_COLS} FROM srs_readiness_assessments WHERE assessment_id = %s"
    params: list[Any] = [int(assessment_id)]
    if client_db_id is not None:
        sql += " AND client_db_id = %s"
        params.append(int(client_db_id))
    row = con.execute(sql, params).fetchone()
    return _assessment_row_to_dict(row) if row else None


def _get_open_draft(con, client_db_id: int) -> dict[str, Any] | None:
    row = con.execute(
        f"SELECT {_ASSESSMENT_COLS} FROM srs_readiness_assessments "
        "WHERE client_db_id = %s AND status = 'draft'",
        [int(client_db_id)],
    ).fetchone()
    return _assessment_row_to_dict(row) if row else None


def _latest_finalised(con, client_db_id: int) -> dict[str, Any] | None:
    row = con.execute(
        f"SELECT {_ASSESSMENT_COLS} FROM srs_readiness_assessments "
        "WHERE client_db_id = %s AND status = 'finalised' "
        "ORDER BY conducted_on DESC, assessment_id DESC LIMIT 1",
        [int(client_db_id)],
    ).fetchone()
    return _assessment_row_to_dict(row) if row else None


def _assessment_score_pairs(con, assessment_id: int) -> list[tuple[str, int | None]]:
    rows = con.execute(
        "SELECT section, score FROM srs_readiness_assessment_scores WHERE assessment_id = %s",
        [int(assessment_id)],
    ).fetchall()
    return [(str(r[0] or ""), int(r[1]) if r[1] is not None else None) for r in rows or []]


def _upsert_assessment_score(
    con, assessment_id: int, question_id: int, score: int | None, evidence_notes: str | None
) -> None:
    """Write one question's score into a draft assessment, snapshotting the
    question text so later question-bank edits don't rewrite history."""
    q = con.execute(
        "SELECT question_code, section, theme, question_text FROM srs_readiness_questions WHERE question_id = %s",
        [int(question_id)],
    ).fetchone()
    if not q:
        raise HTTPException(status_code=404, detail=f"Question {question_id} not found")
    con.execute(
        """
        INSERT INTO srs_readiness_assessment_scores
          (assessment_id, question_id, question_code, section, theme, question_text, score, evidence_notes)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (assessment_id, question_id) DO UPDATE SET
          score = EXCLUDED.score,
          evidence_notes = EXCLUDED.evidence_notes,
          question_code = EXCLUDED.question_code,
          section = EXCLUDED.section,
          theme = EXCLUDED.theme,
          question_text = EXCLUDED.question_text,
          updated_at = NOW()
        """,
        [int(assessment_id), int(question_id), q[0], q[1], q[2], q[3], score, evidence_notes],
    )


def list_assessments(client_db_id: int, *, con=None) -> list[dict[str, Any]]:
    """All survey rounds for a client, newest first, each with its computed
    section summary. The open draft (if any) is included and flagged."""
    if con is None:
        with get_conn() as managed:
            return list_assessments(client_db_id, con=managed)

    ensure_srs_readiness_schema(con)
    rows = con.execute(
        f"SELECT {_ASSESSMENT_COLS} FROM srs_readiness_assessments "
        "WHERE client_db_id = %s ORDER BY conducted_on DESC, assessment_id DESC",
        [int(client_db_id)],
    ).fetchall()
    out = []
    for row in rows or []:
        a = _assessment_row_to_dict(row)
        a["summary"] = _summarise_scores(_assessment_score_pairs(con, a["assessment_id"]))
        out.append(a)
    return out


def start_assessment(
    client_db_id: int,
    *,
    period_year: int | None,
    conducted_on: str | None,
    label: str | None,
    period_label: str | None,
    actor: str,
    con=None,
) -> dict[str, Any]:
    """Open a new draft survey round. Fails if one is already open. Seeds every
    active question's score/evidence from the latest finalised assessment so the
    consultant adjusts rather than re-enters 24 answers."""
    if con is None:
        with get_conn(autocommit=False) as managed:
            return start_assessment(
                client_db_id, period_year=period_year, conducted_on=conducted_on,
                label=label, period_label=period_label, actor=actor, con=managed,
            )

    ensure_srs_readiness_schema(con)
    if _get_open_draft(con, int(client_db_id)):
        raise HTTPException(status_code=409, detail="A survey round is already in progress. Finalise or discard it first.")

    prev = _latest_finalised(con, int(client_db_id))
    resolved_year = _safe_int(period_year) or _current_year()
    resolved_label = _clean_text(label) or ("Baseline" if prev is None else f"{resolved_year} Review")
    row = con.execute(
        """
        INSERT INTO srs_readiness_assessments
          (client_db_id, label, period_year, period_label, conducted_on, status, created_by, updated_by)
        VALUES (%s, %s, %s, %s, COALESCE(%s::date, CURRENT_DATE), 'draft', %s, %s)
        RETURNING assessment_id
        """,
        [
            int(client_db_id), resolved_label, int(resolved_year), _clean_text(period_label),
            _clean_text(conducted_on), actor, actor,
        ],
    ).fetchone()
    new_id = int(row[0])

    prev_scores: dict[int, tuple[int | None, str | None]] = {}
    if prev is not None:
        for sr in con.execute(
            "SELECT question_id, score, evidence_notes FROM srs_readiness_assessment_scores WHERE assessment_id = %s",
            [prev["assessment_id"]],
        ).fetchall():
            prev_scores[int(sr[0])] = (int(sr[1]) if sr[1] is not None else None, sr[2])

    for q in list_srs_readiness_questions(include_inactive=False, con=con):
        seed_score, seed_notes = prev_scores.get(int(q["question_id"]), (None, None))
        _upsert_assessment_score(con, new_id, int(q["question_id"]), seed_score, seed_notes)

    return _get_assessment(con, new_id) or {}


def update_assessment_meta(
    assessment_id: int, client_db_id: int, patch: dict[str, Any], *, actor: str, con=None
) -> dict[str, Any]:
    if con is None:
        with get_conn(autocommit=False) as managed:
            return update_assessment_meta(assessment_id, client_db_id, patch, actor=actor, con=managed)

    ensure_srs_readiness_schema(con)
    current = _get_assessment(con, int(assessment_id), int(client_db_id))
    if not current:
        raise HTTPException(status_code=404, detail="Assessment not found")

    sets: list[str] = []
    params: list[Any] = []
    editable_when_draft = current["status"] == "draft"
    if "workshop_notes" in patch:
        sets.append("workshop_notes = %s")
        params.append(_clean_text(patch.get("workshop_notes")))
    if editable_when_draft:
        if "label" in patch:
            sets.append("label = %s")
            params.append(_clean_text(patch.get("label")))
        if "period_year" in patch and _safe_int(patch.get("period_year")):
            sets.append("period_year = %s")
            params.append(int(_safe_int(patch.get("period_year"))))
        if "period_label" in patch:
            sets.append("period_label = %s")
            params.append(_clean_text(patch.get("period_label")))
        if "conducted_on" in patch and _clean_text(patch.get("conducted_on")):
            sets.append("conducted_on = %s::date")
            params.append(_clean_text(patch.get("conducted_on")))
    elif any(k in patch for k in ("label", "period_year", "period_label", "conducted_on")):
        raise HTTPException(status_code=409, detail="A finalised assessment's period and date are locked.")

    if sets:
        sets.append("updated_at = NOW()")
        sets.append("updated_by = %s")
        params.append(actor)
        params.extend([int(assessment_id), int(client_db_id)])
        con.execute(
            f"UPDATE srs_readiness_assessments SET {', '.join(sets)} WHERE assessment_id = %s AND client_db_id = %s",
            params,
        )
    return _get_assessment(con, int(assessment_id)) or {}


def finalise_assessment(assessment_id: int, client_db_id: int, *, actor: str, con=None) -> dict[str, Any]:
    """Lock the draft, timestamp it, and (for the first ever) mark it the
    baseline. Scores are already mirrored onto srs_readiness_responses.score
    during scoring, so gauges need no further work."""
    if con is None:
        with get_conn(autocommit=False) as managed:
            return finalise_assessment(assessment_id, client_db_id, actor=actor, con=managed)

    ensure_srs_readiness_schema(con)
    current = _get_assessment(con, int(assessment_id), int(client_db_id))
    if not current:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if current["status"] == "finalised":
        raise HTTPException(status_code=409, detail="Assessment is already finalised.")

    is_first = _latest_finalised(con, int(client_db_id)) is None
    con.execute(
        """
        UPDATE srs_readiness_assessments
        SET status = 'finalised', is_baseline = %s, finalised_at = NOW(), finalised_by = %s,
            updated_at = NOW(), updated_by = %s
        WHERE assessment_id = %s
        """,
        [bool(is_first), actor, actor, int(assessment_id)],
    )
    # Re-sync the live score mirror from the frozen scores, in case a response
    # row was missing when a score was set.
    con.execute(
        """
        INSERT INTO srs_readiness_responses (client_db_id, question_id, score, updated_by)
        SELECT %s, s.question_id, s.score, %s
        FROM srs_readiness_assessment_scores s
        WHERE s.assessment_id = %s
        ON CONFLICT (client_db_id, question_id) DO UPDATE SET
          score = EXCLUDED.score, updated_at = NOW(), updated_by = EXCLUDED.updated_by
        """,
        [int(client_db_id), actor, int(assessment_id)],
    )
    return _get_assessment(con, int(assessment_id)) or {}


def delete_assessment(assessment_id: int, client_db_id: int, *, con=None) -> None:
    if con is None:
        with get_conn(autocommit=False) as managed:
            return delete_assessment(assessment_id, client_db_id, con=managed)

    ensure_srs_readiness_schema(con)
    current = _get_assessment(con, int(assessment_id), int(client_db_id))
    if not current:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if current["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only a draft assessment can be discarded.")
    con.execute("DELETE FROM srs_readiness_assessments WHERE assessment_id = %s", [int(assessment_id)])

    # Roll the live score mirror back to the previous finalised position.
    prev = _latest_finalised(con, int(client_db_id))
    if prev is None:
        con.execute("UPDATE srs_readiness_responses SET score = NULL WHERE client_db_id = %s", [int(client_db_id)])
    else:
        con.execute(
            """
            UPDATE srs_readiness_responses r
            SET score = s.score, updated_at = NOW()
            FROM srs_readiness_assessment_scores s
            WHERE s.assessment_id = %s AND s.question_id = r.question_id AND r.client_db_id = %s
            """,
            [prev["assessment_id"], int(client_db_id)],
        )


def get_srs_progression(client_db_id: int, *, con=None) -> dict[str, Any]:
    """Period-on-period history for the CRM and portal: one point per finalised
    assessment with its section averages, plus a per-question movement series
    with deltas vs the previous survey and vs the baseline."""
    if con is None:
        with get_conn() as managed:
            return get_srs_progression(client_db_id, con=managed)

    ensure_srs_readiness_schema(con)
    assessments = con.execute(
        f"SELECT {_ASSESSMENT_COLS} FROM srs_readiness_assessments "
        "WHERE client_db_id = %s AND status = 'finalised' "
        "ORDER BY conducted_on ASC, assessment_id ASC",
        [int(client_db_id)],
    ).fetchall()

    periods: list[dict[str, Any]] = []
    scores_by_assessment: dict[int, list[Any]] = {}
    for row in assessments or []:
        a = _assessment_row_to_dict(row)
        rows = con.execute(
            """
            SELECT question_id, question_code, question_text, section, score
            FROM srs_readiness_assessment_scores WHERE assessment_id = %s
            ORDER BY section, question_code
            """,
            [a["assessment_id"]],
        ).fetchall()
        scores_by_assessment[a["assessment_id"]] = rows
        summary = _summarise_scores(
            (str(r[3] or ""), int(r[4]) if r[4] is not None else None) for r in rows or []
        )
        periods.append({
            "assessment_id": a["assessment_id"],
            "label": a["label"],
            "period_year": a["period_year"],
            "period_label": a["period_label"],
            "conducted_on": a["conducted_on"],
            "is_baseline": a["is_baseline"],
            "sections": summary["sections"],
            "overall_avg_score": summary["overall_avg_score"],
            "overall_maturity_label": summary["overall_maturity_label"],
        })

    question_series: list[dict[str, Any]] = []
    if periods:
        baseline_id = periods[0]["assessment_id"]
        latest_id = periods[-1]["assessment_id"]
        prev_id = periods[-2]["assessment_id"] if len(periods) >= 2 else None

        def _score_map(aid: int | None) -> dict[int, int | None]:
            if aid is None:
                return {}
            return {int(r[0]): (int(r[4]) if r[4] is not None else None) for r in scores_by_assessment.get(aid, [])}

        latest_map, prev_map, baseline_map = _score_map(latest_id), _score_map(prev_id), _score_map(baseline_id)
        for r in scores_by_assessment.get(latest_id, []):
            qid = int(r[0])
            latest_score = latest_map.get(qid)
            points = []
            for p in periods:
                pm = _score_map(p["assessment_id"])
                points.append({"conducted_on": p["conducted_on"], "score": pm.get(qid)})
            question_series.append({
                "question_id": qid,
                "question_code": r[1],
                "question_text": r[2],
                "section": r[3],
                "points": points,
                "delta_vs_previous": _delta(latest_score, prev_map.get(qid)) if prev_id else None,
                "delta_vs_baseline": _delta(latest_score, baseline_map.get(qid)) if baseline_id != latest_id else None,
            })

    return {"client_db_id": int(client_db_id), "periods": periods, "question_series": question_series}


def _delta(current: int | None, other: int | None) -> int | None:
    if current is None or other is None:
        return None
    return current - other


def _current_year() -> int:
    from datetime import date
    return date.today().year
