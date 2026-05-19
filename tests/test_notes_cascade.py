from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.client_notes_routes as client_notes_routes
import api.job_scope_data_routes as job_scope_data_routes


class _FakeResult:
    def __init__(self, *, fetchone_value=None, df_value=None):
        self._fetchone_value = fetchone_value
        self._df_value = df_value

    def fetchone(self):
        return self._fetchone_value

    def df(self):
        return self._df_value if self._df_value is not None else pd.DataFrame()


class _FakeConn:
    def __init__(self, df_map: dict[str, pd.DataFrame], fetchone_map: dict[str, object]):
        self.df_map = df_map
        self.fetchone_map = fetchone_map
        self.sql = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.sql = sql
        for key, value in sorted(self.fetchone_map.items(), key=lambda kv: len(kv[0]), reverse=True):
            if key in sql:
                return _FakeResult(fetchone_value=value)
        if "FROM job_scope_rows" in sql and "COALESCE(jsr.enabled, TRUE) = TRUE" in sql:
            df = self.df_map.get("FROM job_scope_rows")
            if df is not None and not df.empty and "enabled" in df.columns:
                enabled_df = df[df["enabled"].fillna(True).astype(bool)]
                return _FakeResult(df_value=enabled_df)
        for key, value in sorted(self.df_map.items(), key=lambda kv: len(kv[0]), reverse=True):
            if key in sql:
                return _FakeResult(df_value=value)
        return _FakeResult()


def test_job_notes_summary_includes_job_notes_and_row_notes(monkeypatch: pytest.MonkeyPatch) -> None:
    job_rows = pd.DataFrame(
        [
            {
                "row_id": 10,
                "job_id": 640,
                "scope": "Scope 1",
                "site_id": 1,
                "site_name": "HQ",
                "category": "Fuel",
                "level_1": "Fuel",
                "level_2": "Fuel",
                "level_3": None,
                "level_4": None,
                "column_text": "Fuel note",
                "report_label": "Fuel",
                "original_id": "R-10",
                "notes": "Row note",
                "enabled": True,
                "created_at": "2026-04-23T10:00:00",
                "updated_at": "2026-04-23T10:30:00",
            },
            {
                "row_id": 11,
                "job_id": 640,
                "scope": "Scope 1",
                "site_id": 1,
                "site_name": "HQ",
                "category": "Fuel",
                "level_1": "Fuel",
                "level_2": "Fuel",
                "level_3": None,
                "level_4": None,
                "column_text": "Fuel note deleted",
                "report_label": "Fuel",
                "original_id": "R-11",
                "notes": "Deleted row note",
                "enabled": False,
                "created_at": "2026-04-23T10:10:00",
                "updated_at": "2026-04-23T10:40:00",
            }
        ]
    )
    communications = pd.DataFrame(
        [
            {
                "communication_id": 1,
                "job_id": 640,
                "client_db_id": 143,
                "subject": "General note",
                "message_text": "Communication note",
                "created_by": "Alice",
                "created_at": "2026-04-23T11:00:00",
                "updated_at": "2026-04-23T11:05:00",
                "event_at": "2026-04-23T11:05:00",
                "job_number": "J000640",
                "job_title": "Job title",
            }
        ]
    )
    fake = _FakeConn(
        df_map={
            "FROM job_communications": communications,
            "FROM job_scope_rows": job_rows,
            "FROM audit_log": pd.DataFrame(),
        },
        fetchone_map={
            "FROM jobs": (640, "J000640", "Job title"),
        },
    )

    monkeypatch.setattr(job_scope_data_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(job_scope_data_routes, "_ensure_job_communications_tables", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_scope_data_routes, "_ensure_job_scope_rows_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_scope_data_routes, "ensure_audit_log_table", lambda *_args, **_kwargs: None)

    result = job_scope_data_routes.get_job_notes_summary(640, archive_state="all", _user={"user_id": "u1", "org_id": "org-123"})

    assert result["total"] == 2
    assert {item["source_type"] for item in result["items"]} == {"job-communication", "job-row"}
    assert any(item["source_label"] == "Job Note" for item in result["items"])
    assert any(item["source_label"] == "Job Row Note" for item in result["items"])
    assert all(item["row_id"] != 11 for item in result["items"] if item["source_type"] == "job-row")


def test_client_notes_summary_includes_cascaded_job_notes(monkeypatch: pytest.MonkeyPatch) -> None:
    client_events = pd.DataFrame(
        [
            {
                "event_id": 1,
                "client_db_id": 143,
                "job_id": 640,
                "subject": "Client subject",
                "body_text": "Client note",
                "created_by": "Alice",
                "created_at": "2026-04-23T09:00:00",
                "updated_at": "2026-04-23T09:05:00",
                "event_at": "2026-04-23T09:05:00",
                "job_number": "J000640",
                "job_title": "Job title",
            }
        ]
    )
    communications = pd.DataFrame(
        [
            {
                "communication_id": 2,
                "job_id": 640,
                "client_db_id": 143,
                "channel": "note",
                "subject": "Job subject",
                "message_text": "Job communication note",
                "created_by": "Bob",
                "created_at": "2026-04-23T10:00:00",
                "updated_at": "2026-04-23T10:05:00",
                "event_at": "2026-04-23T10:05:00",
                "job_number": "J000640",
                "job_title": "Job title",
            }
        ]
    )
    job_rows = pd.DataFrame(
        [
            {
                "row_id": 10,
                "job_id": 640,
                "scope": "Scope 1",
                "site_id": 1,
                "site_name": "HQ",
                "category": "Fuel",
                "level_1": "Fuel",
                "level_2": "Fuel",
                "level_3": None,
                "level_4": None,
                "column_text": "Fuel note",
                "report_label": "Fuel",
                "original_id": "R-10",
                "notes": "Job row note",
                "created_at": "2026-04-23T11:00:00",
                "updated_at": "2026-04-23T11:30:00",
            }
        ]
    )
    fake = _FakeConn(
        df_map={
            "FROM jobs": pd.DataFrame([{"job_id": 640, "job_number": "J000640", "title": "Job title", "reporting_year": 2025, "status": "Open"}]),
            "FROM crm_events": client_events,
            "FROM job_communications": communications,
            "FROM job_scope_rows": job_rows,
            "FROM audit_log": pd.DataFrame(),
        },
        fetchone_map={
            "FROM clients": (143, "Client name"),
        },
    )

    monkeypatch.setattr(client_notes_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(client_notes_routes, "_ensure_crm_timeline_tables", lambda *_args, **_kwargs: None)
    result = client_notes_routes.get_client_notes_summary(
        143,
        source=None,
        job_id=None,
        scope=None,
        site_id=None,
        author=None,
        q=None,
        _user={"user_id": "u1", "org_id": "org-123"},
    )

    assert result["total"] == 2
    assert {item["source_type"] for item in result["items"]} == {"client", "job-communication"}
