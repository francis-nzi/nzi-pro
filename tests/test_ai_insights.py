from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import services.ai_insights as ai_insights


class _FakeAIResponseMessage:
    def __init__(self, text: str):
        self.text = text


class _FakeAIResponse:
    def __init__(self, text: str):
        self.content = [_FakeAIResponseMessage(text)]


class _FakeAnthropicClient:
    class messages:
        @staticmethod
        def create(**_kwargs):
            return _FakeAIResponse('{"summary":"OK","confidence":"high"}')


class _FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "FROM clients" in self._last_sql:
            return ("Acme Ltd", "Manufacturing", "https://example.com", "UK")
        return None

    def df(self):
        if "GROUP BY j.reporting_year" in self._last_sql:
            return pd.DataFrame([{"reporting_year": 2024, "total_emissions": 12.3}])
        if "GROUP BY jsr.level_2" in self._last_sql:
            return pd.DataFrame([{"category": "Energy", "total_emissions": 12.3}])
        return pd.DataFrame()


def test_generate_client_insights_uses_typed_org_filter(monkeypatch) -> None:
    fake_conn = _FakeConn()

    monkeypatch.setattr(ai_insights, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(ai_insights, "_get_anthropic_client", lambda: _FakeAnthropicClient())

    result = ai_insights.generate_client_insights(205, provider="anthropic", org_id="org-123")

    assert result["structured"]["summary"] == "OK"
    executed_sql = "\n".join(sql for sql, _ in fake_conn.executed)
    assert "c.org_id = %s::text" in executed_sql
    assert "(%s IS NULL OR c.org_id = %s)" not in executed_sql
