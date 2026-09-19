"""Exercise action/question persistence in temporary PostgreSQL tables only."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.database import _PgConn
from services import report_actions
from fastapi import HTTPException


@pytest.fixture
def con(monkeypatch):
    psycopg = pytest.importorskip("psycopg")
    url = os.getenv("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not configured")
    raw = psycopg.connect(url, connect_timeout=10)
    wrapped = _PgConn(raw, autocommit=False)
    monkeypatch.setattr(report_actions, "_REPORT_ACTIONS_SCHEMA_READY", True)
    try:
        wrapped.execute("""CREATE TEMP TABLE srs_readiness_questions
            (question_id INTEGER PRIMARY KEY, is_active BOOLEAN)""")
        wrapped.execute("INSERT INTO srs_readiness_questions VALUES (1, TRUE), (2, FALSE)")
        wrapped.execute("""CREATE TEMP TABLE action_levers_lookup (
            lever_id INTEGER PRIMARY KEY, lever_code TEXT, lever_name TEXT,
            sphere_name TEXT, sub_sphere_name TEXT, is_custom BOOLEAN, is_active BOOLEAN)""")
        wrapped.execute("INSERT INTO action_levers_lookup VALUES (1, 'TEST', 'Test', '', '', FALSE, TRUE)")
        wrapped.execute("""CREATE TEMP TABLE report_action_options (
            action_option_id SERIAL PRIMARY KEY, action_name TEXT, description TEXT,
            action_term TEXT, action_category TEXT, scope_focus TEXT, sort_order INTEGER,
            is_active BOOLEAN, is_default BOOLEAN, lever_id INTEGER,
            srs_question_id INTEGER REFERENCES srs_readiness_questions(question_id),
            created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
            created_by TEXT, updated_by TEXT)""")
        yield wrapped
    finally:
        raw.rollback()
        raw.close()


def test_question_link_create_edit_archive_preserve_and_clear(con):
    payload = {"action_name": "Test action", "lever_id": 1, "srs_question_id": 1}
    item = report_actions.upsert_report_action_option(payload=payload, actor="test", con=con)
    assert item["srs_question_id"] == 1
    option_id = item["action_option_id"]
    def update(changes):
        return report_actions.upsert_report_action_option(
            payload={"action_name": "Test action", "lever_id": 1, **changes},
            actor="test", action_option_id=option_id, con=con)
    assert update({"srs_question_id": 2})["srs_question_id"] == 2
    # Older clients and archive requests must not silently erase the mapping.
    archived = update({"is_active": False})
    assert archived["srs_question_id"] == 2
    assert archived["is_active"] is False
    assert update({"srs_question_id": None})["srs_question_id"] is None


def test_missing_question_rejected_without_saving(con):
    with pytest.raises(HTTPException) as exc:
        report_actions.upsert_report_action_option(
            payload={"action_name": "Invalid", "lever_id": 1, "srs_question_id": 999},
            actor="test", con=con)
    assert exc.value.status_code == 400
    assert con.execute("SELECT COUNT(*) FROM report_action_options").fetchone()[0] == 0
