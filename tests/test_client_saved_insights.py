from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.client_dashboard_routes as client_dashboard_routes


class _SavedInsightsConn:
    def __init__(self, rows=None, inserted_row=None):
        self.rows = rows or []
        self.inserted_row = inserted_row
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
