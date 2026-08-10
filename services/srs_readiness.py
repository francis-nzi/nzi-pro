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

    return {
        "client_db_id": int(client_db_id),
        "sections": [
            {"section": s, "questions": by_section.get(s, []), "suggested_action": SRS_SECTION_SUGGESTED_ACTIONS.get(s)}
            for s in SRS_READINESS_SECTIONS
        ],
    }


def save_client_srs_responses(client_db_id: int, items: list[dict[str, Any]], *, actor: str, con=None) -> dict[str, Any]:
    if con is None:
        with get_conn(autocommit=False) as managed:
            return save_client_srs_responses(client_db_id, items, actor=actor, con=managed)

    ensure_srs_readiness_schema(con)
    for item in items or []:
        question_id = _safe_int(item.get("question_id"))
        if not question_id:
            continue
        score = _safe_int(item.get("score"))
        if score is not None and score not in (1, 2, 3):
            raise HTTPException(status_code=400, detail=f"score must be 1, 2, or 3 (question_id {question_id})")
        status = _clean_text(item.get("status")) or "not_started"
        if status not in RESPONSE_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {RESPONSE_STATUSES}")
        con.execute(
            """
            INSERT INTO srs_readiness_responses
              (client_db_id, question_id, score, evidence_notes, priority, owner, target_date, status, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (client_db_id, question_id) DO UPDATE SET
              score = EXCLUDED.score,
              evidence_notes = EXCLUDED.evidence_notes,
              priority = EXCLUDED.priority,
              owner = EXCLUDED.owner,
              target_date = EXCLUDED.target_date,
              status = EXCLUDED.status,
              updated_at = NOW(),
              updated_by = EXCLUDED.updated_by
            """,
            [
                int(client_db_id), int(question_id), score,
                _clean_text(item.get("evidence_notes")), _clean_text(item.get("priority")),
                _clean_text(item.get("owner")), _clean_text(item.get("target_date")) or None,
                status, actor,
            ],
        )
    return get_client_srs_responses(client_db_id, con=con)


def get_srs_readiness_summary(client_db_id: int, *, con=None) -> dict[str, Any]:
    """Section averages + maturity bands, computed on read -- same approach as
    get_action_lever_summary. Only questions with a score count toward the average."""
    if con is None:
        with get_conn() as managed:
            return get_srs_readiness_summary(client_db_id, con=managed)

    ensure_srs_readiness_schema(con)
    rows = con.execute(
        """
        SELECT q.section,
               COUNT(*) FILTER (WHERE COALESCE(q.is_active, TRUE) = TRUE) AS active_questions,
               COUNT(r.score) AS questions_scored,
               COALESCE(AVG(r.score), 0) AS avg_score
        FROM srs_readiness_questions q
        LEFT JOIN srs_readiness_responses r
          ON r.question_id = q.question_id AND r.client_db_id = %s
        WHERE COALESCE(q.is_active, TRUE) = TRUE
        GROUP BY q.section
        """,
        [int(client_db_id)],
    ).fetchall()
    by_section = {str(row[0]): row for row in rows or []}

    sections_out = []
    all_scores: list[float] = []
    for section in SRS_READINESS_SECTIONS:
        row = by_section.get(section)
        active_questions = int(row[1]) if row else 0
        questions_scored = int(row[2]) if row else 0
        avg_score = float(row[3]) if row and questions_scored > 0 else None
        if avg_score is not None:
            all_scores.append(avg_score)
        band = maturity_band(avg_score)
        sections_out.append({
            "section": section,
            "active_questions": active_questions,
            "questions_scored": questions_scored,
            "avg_score": round(avg_score, 2) if avg_score is not None else None,
            "maturity_label": band["label"] if band else None,
            "maturity_description": band["description"] if band else None,
            "suggested_action": SRS_SECTION_SUGGESTED_ACTIONS.get(section),
        })

    overall_avg = round(sum(all_scores) / len(all_scores), 2) if all_scores else None
    overall_band = maturity_band(overall_avg)
    return {
        "client_db_id": int(client_db_id),
        "sections": sections_out,
        "overall_avg_score": overall_avg,
        "overall_maturity_label": overall_band["label"] if overall_band else None,
        "overall_maturity_description": overall_band["description"] if overall_band else None,
    }
