"""Integration tests for the SRS Readiness assessment (survey-round) history.

Runs against the real database in a single transaction that is always rolled
back, so nothing is persisted. Skipped when DATABASE_URL is not configured.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

psycopg2 = pytest.importorskip("psycopg2")

from fastapi import HTTPException  # noqa: E402

from core.database import _PgConn  # noqa: E402
from services import srs_readiness as srs  # noqa: E402


def _database_url() -> str | None:
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip()
    return None


@pytest.fixture()
def con():
    url = _database_url()
    if not url:
        pytest.skip("DATABASE_URL not configured")
    raw = psycopg2.connect(url)
    raw.autocommit = False
    # Reset the memoized schema flag so ensure_* re-runs inside this txn.
    srs._SRS_READINESS_SCHEMA_READY = False
    wrapped = _PgConn(raw, autocommit=False)
    try:
        srs.ensure_srs_readiness_schema(wrapped)
        yield wrapped
    finally:
        raw.rollback()
        raw.close()
        srs._SRS_READINESS_SCHEMA_READY = False


@pytest.fixture()
def client_id(con):
    row = con.execute(
        "INSERT INTO clients (client_name) VALUES ('__srs_assessment_test__') RETURNING db_id"
    ).fetchone()
    return int(row[0])


def _q_ids(con):
    return [q["question_id"] for q in srs.list_srs_readiness_questions(include_inactive=False, con=con)]


def test_score_change_without_draft_is_rejected(con, client_id):
    qid = _q_ids(con)[0]
    with pytest.raises(HTTPException) as exc:
        srs.save_client_srs_responses(
            client_id, [{"question_id": qid, "score": 2, "status": "not_started"}],
            actor="tester", con=con,
        )
    assert exc.value.status_code == 409


def test_tracker_fields_save_without_a_draft(con, client_id):
    qid = _q_ids(con)[0]
    srs.save_client_srs_responses(
        client_id,
        [{"question_id": qid, "priority": "High", "owner": "Leadership", "status": "in_progress"}],
        actor="tester", con=con,
    )
    row = con.execute(
        "SELECT priority, owner, status, score FROM srs_readiness_responses WHERE client_db_id=%s AND question_id=%s",
        [client_id, qid],
    ).fetchone()
    assert row[0] == "High" and row[1] == "Leadership" and row[2] == "in_progress"
    assert row[3] is None  # score untouched


def test_one_draft_per_client(con, client_id):
    srs.start_assessment(
        client_id, period_year=2026, conducted_on="2026-01-15", label=None, period_label=None,
        actor="tester", con=con,
    )
    with pytest.raises(HTTPException) as exc:
        srs.start_assessment(
            client_id, period_year=2026, conducted_on=None, label=None, period_label=None,
            actor="tester", con=con,
        )
    assert exc.value.status_code == 409


def test_baseline_flow_and_progression(con, client_id):
    qids = _q_ids(con)

    # --- Round 1: baseline ---
    a1 = srs.start_assessment(
        client_id, period_year=2026, conducted_on="2026-02-01", label="Baseline", period_label=None,
        actor="tester", con=con,
    )
    assert a1["status"] == "draft"
    # Score every question a 2.
    srs.save_client_srs_responses(
        client_id,
        [{"question_id": q, "score": 2, "status": "not_started"} for q in qids],
        actor="tester", con=con,
    )
    fin1 = srs.finalise_assessment(a1["assessment_id"], client_id, actor="tester", con=con)
    assert fin1["status"] == "finalised" and fin1["is_baseline"] is True

    summary = srs.get_srs_readiness_summary(client_id, con=con)
    assert summary["overall_avg_score"] == 2.0

    # --- Round 2: one Governance question improves to 3 ---
    a2 = srs.start_assessment(
        client_id, period_year=2027, conducted_on="2027-02-01", label="2027 Review", period_label=None,
        actor="tester", con=con,
    )
    assert a2["assessment_id"] != a1["assessment_id"]
    # carry-forward: the draft already holds the round-1 scores
    seeded = con.execute(
        "SELECT count(*) FROM srs_readiness_assessment_scores WHERE assessment_id=%s AND score=2",
        [a2["assessment_id"]],
    ).fetchone()[0]
    assert seeded == len(qids)

    gov_qid = next(
        q["question_id"]
        for q in srs.list_srs_readiness_questions(include_inactive=False, con=con)
        if q["section"] == "Governance"
    )
    srs.save_client_srs_responses(
        client_id, [{"question_id": gov_qid, "score": 3, "status": "complete"}],
        actor="tester", con=con,
    )
    srs.finalise_assessment(a2["assessment_id"], client_id, actor="tester", con=con)

    prog = srs.get_srs_progression(client_id, con=con)
    assert [p["label"] for p in prog["periods"]] == ["Baseline", "2027 Review"]
    assert prog["periods"][0]["is_baseline"] is True

    moved = next(qs for qs in prog["question_series"] if qs["question_id"] == gov_qid)
    assert moved["delta_vs_previous"] == 1
    assert moved["delta_vs_baseline"] == 1
    # a question that never changed
    flat = next(qs for qs in prog["question_series"] if qs["question_id"] != gov_qid)
    assert flat["delta_vs_previous"] == 0


def test_discard_draft_reverts_score_mirror(con, client_id):
    qids = _q_ids(con)
    a1 = srs.start_assessment(
        client_id, period_year=2026, conducted_on="2026-02-01", label="Baseline", period_label=None,
        actor="tester", con=con,
    )
    srs.save_client_srs_responses(
        client_id, [{"question_id": qids[0], "score": 2, "status": "not_started"}],
        actor="tester", con=con,
    )
    srs.finalise_assessment(a1["assessment_id"], client_id, actor="tester", con=con)

    a2 = srs.start_assessment(
        client_id, period_year=2027, conducted_on="2027-02-01", label=None, period_label=None,
        actor="tester", con=con,
    )
    srs.save_client_srs_responses(
        client_id, [{"question_id": qids[0], "score": 3, "status": "not_started"}],
        actor="tester", con=con,
    )
    srs.delete_assessment(a2["assessment_id"], client_id, con=con)

    row = con.execute(
        "SELECT score FROM srs_readiness_responses WHERE client_db_id=%s AND question_id=%s",
        [client_id, qids[0]],
    ).fetchone()
    assert row[0] == 2  # rolled back to the finalised baseline
