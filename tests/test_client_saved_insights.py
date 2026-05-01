from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.client_dashboard_routes as client_dashboard_routes


class _SavedInsightsConn:
    def __init__(self, rows=None, inserted_row=None, updated_row=None, deleted_row=None, existing_row=None):
        self.rows = rows or []
        self.inserted_row = inserted_row
        self.updated_row = updated_row
        self.deleted_row = deleted_row
        self.existing_row = existing_row
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "information_schema.tables" in self._last_sql:
            return (1,)
        if "INSERT INTO saved_client_insights" in self._last_sql:
            return self.inserted_row
        if "SELECT 1" in self._last_sql and "FROM saved_client_insights" in self._last_sql:
            return self.existing_row or (1,)
        if "UPDATE saved_client_insights" in self._last_sql:
            return self.updated_row
        if "DELETE FROM saved_client_insights" in self._last_sql:
            return self.deleted_row
        if "FROM saved_client_insights" in self._last_sql:
            return None
        return None

    def fetchall(self):
        if "FROM saved_client_insights" in self._last_sql:
            return self.rows
        return []


def test_list_client_saved_insights_returns_timestamped_rows(monkeypatch) -> None:
    conn = _SavedInsightsConn(
        rows=[
            (
                12,
                205,
                "u1",
                "org-a",
                "anthropic",
                "Saved insight body",
                '{"summary":"Saved summary"}',
                '[{"label":"Latest total emissions","value":"12.3 tCO2e (2024)"}]',
                "2026-05-01 10:00:00+00",
            )
        ]
    )
    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(client_dashboard_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_dashboard_routes, "require_org", lambda *_args, **_kwargs: "org-a")

    result = client_dashboard_routes.list_client_saved_insights(205, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["saved_insights"][0]["provider"] == "anthropic"
    assert result["saved_insights"][0]["created_at"] == "2026-05-01 10:00:00+00"
    assert result["saved_insights"][0]["preview"] == "Saved summary"
    assert any("saved_client_insights" in sql for sql, _ in conn.queries)


def test_save_client_insight_persists_payload(monkeypatch) -> None:
    conn = _SavedInsightsConn(
        inserted_row=(
            13,
            205,
            "u1",
            "org-a",
            "openai",
            "Generated insight body",
            '{"summary":"Generated summary"}',
            '[{"label":"Top driver","value":"Office energy"}]',
            "2026-05-01 11:00:00+00",
        )
    )
    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(client_dashboard_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_dashboard_routes, "require_org", lambda *_args, **_kwargs: "org-a")

    result = client_dashboard_routes.save_client_insight(
        205,
        {
            "provider": "openai",
            "insights": "Generated insight body",
            "structured": {"summary": "Generated summary"},
            "citations": [{"label": "Top driver", "value": "Office energy"}],
        },
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["saved_insight"]["provider"] == "openai"
    assert result["saved_insight"]["created_at"] == "2026-05-01 11:00:00+00"
    assert any("INSERT INTO saved_client_insights" in sql for sql, _ in conn.queries)


def test_update_client_saved_insight_persists_changes(monkeypatch) -> None:
    conn = _SavedInsightsConn(
        existing_row=(1,),
        updated_row=(
            13,
            205,
            "u1",
            "org-a",
            "anthropic",
            "Edited insight body",
            '{"summary":"Edited summary"}',
            '[{"label":"Driver","value":"Energy"}]',
            "2026-05-01 11:00:00+00",
        )
    )
    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(client_dashboard_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_dashboard_routes, "require_org", lambda *_args, **_kwargs: "org-a")

    result = client_dashboard_routes.update_client_saved_insight(
        205,
        13,
        {
            "provider": "anthropic",
            "insights": "Edited insight body",
            "structured": {"summary": "Edited summary"},
            "citations": [{"label": "Driver", "value": "Energy"}],
        },
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["saved_insight"]["insights"] == "Edited insight body"
    assert any("UPDATE saved_client_insights" in sql for sql, _ in conn.queries)


def test_delete_client_saved_insight_removes_row(monkeypatch) -> None:
    conn = _SavedInsightsConn(deleted_row=(13,))
    conn.existing_row = (1,)
    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(client_dashboard_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_dashboard_routes, "require_org", lambda *_args, **_kwargs: "org-a")

    result = client_dashboard_routes.delete_client_saved_insight(205, 13, _user={"user_id": "u1", "org_id": "org-a"})

    assert result == {"ok": True, "saved_client_insight_id": 13}
    assert any("DELETE FROM saved_client_insights" in sql for sql, _ in conn.queries)
