from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

import api.main as main


class _HealthConn:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params=None):
        self.sql = sql
        return self

    def fetchone(self):
        return (1,)


def test_health_checks_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "get_conn", lambda: _HealthConn())

    result = main.health()

    assert result["ok"] is True
    assert result["database"] == "ok"


def test_health_returns_503_when_database_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(main, "get_conn", boom)

    with pytest.raises(HTTPException) as exc_info:
        main.health()

    assert exc_info.value.status_code == 503
