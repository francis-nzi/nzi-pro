from __future__ import annotations

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

import api.main as main


class _TemplateConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        normalized_sql = " ".join(self._last_sql.split())
        if "SELECT 1 FROM job_templates WHERE template_key = %s" in normalized_sql:
            return None
        if "SELECT 1 FROM job_templates WHERE job_template_id = %s" in normalized_sql:
            return (1,)
        if "FROM job_templates WHERE job_template_id = %s" in normalized_sql:
            return (
                "STANDARD_UK_DEFAULT",
                "NZI Standard UK Default Template",
                "dataset",
                "uploaded_templates/Standard_UK_Default_dataset.xlsx",
                None,
                None,
            )
        if "INSERT INTO job_templates" in normalized_sql:
            return (101,)
        return None

    def df(self):
        normalized_sql = " ".join(self._last_sql.split())
        if "FROM job_templates" not in normalized_sql:
            return pd.DataFrame([])

        rows = [
            {
                "job_template_id": 101,
                "template_key": "STANDARD_UK",
                "template_name": "NZI Standard UK Template",
                "template_type": "dataset",
                "file_path": "templates/NZI Data Upload Template - Standard UK.xlsx",
                "excel_template_path": "templates/NZI Data Upload Template - Standard UK.xlsx",
                "crp_template_path": None,
                "is_active": True,
                "archived": False,
                "archived_at": None,
                "archived_by": None,
                "created_at": pd.Timestamp("2026-04-23 10:15:00"),
                "created_by": "system",
            },
            {
                "job_template_id": 102,
                "template_key": "STANDARD_UK_OLD",
                "template_name": "Old Template",
                "template_type": "dataset",
                "file_path": "uploaded_templates/old_template.xlsx",
                "excel_template_path": None,
                "crp_template_path": None,
                "is_active": False,
                "archived": True,
                "archived_at": pd.Timestamp("2026-04-23 12:00:00"),
                "archived_by": "tester@example.com",
                "created_at": pd.Timestamp("2026-04-23 09:00:00"),
                "created_by": "tester@example.com",
            },
        ]

        if "COALESCE(archived, FALSE) = FALSE" in normalized_sql:
            rows = [rows[0]]

        return pd.DataFrame(rows)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_list_job_templates_excludes_archived_and_returns_metadata(monkeypatch):
    fake = _TemplateConn()
    monkeypatch.setattr(main, "get_conn", lambda: fake)

    result = main.list_job_templates(_user={"email": "owner@example.com"})

    assert len(result["items"]) == 1
    item = result["items"][0]
    assert item["template_key"] == "STANDARD_UK"
    assert item["file_name"] == "NZI Data Upload Template - Standard UK.xlsx"
    assert item["created_by"] == "system"
    assert str(item["created_at"]) == "2026-04-23 10:15:00"
    assert item["archived"] is False


def test_update_job_template_deactivate_archives_template(monkeypatch):
    fake = _TemplateConn()
    monkeypatch.setattr(main, "get_conn", lambda: fake)

    result = asyncio.run(main.update_job_template(
        101,
        template_key="STANDARD_UK",
        template_name="NZI Standard UK Template",
        template_type="dataset",
        is_active="false",
        file=None,
        _user={"email": "owner@example.com", "name": "Owner"},
    ))

    assert result["ok"] is True
    update_sql = " ".join(sql for sql, _ in fake.executed if "UPDATE job_templates SET" in sql)
    assert "is_active = %s" in update_sql
    assert "archived = TRUE" in update_sql
    assert "archived_at = NOW()" in update_sql


def test_archive_job_template_marks_inactive_and_archived(monkeypatch):
    fake = _TemplateConn()
    monkeypatch.setattr(main, "get_conn", lambda: fake)

    result = main.archive_job_template(
        101,
        {"archived": True},
        _user={"email": "owner@example.com", "name": "Owner"},
    )

    assert result["ok"] is True
    update_sql = " ".join(sql for sql, _ in fake.executed if "UPDATE job_templates" in sql)
    assert "is_active = FALSE" in update_sql
    assert "archived = %s" in update_sql
