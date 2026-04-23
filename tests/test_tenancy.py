from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import services.tenancy as tenancy


def test_require_org_returns_existing_org() -> None:
    user = {"org_id": "org-123"}

    assert tenancy.require_org(user) == "org-123"


def test_require_org_raises_without_org() -> None:
    with pytest.raises(HTTPException) as exc_info:
        tenancy.require_org({})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"


@dataclass
class _FakeRow:
    value: object

    def __getitem__(self, idx: int) -> object:
        assert idx == 0
        return self.value


class _FakeConn:
    def __init__(self, row_value: object | None):
        self.row_value = row_value
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        if "SELECT org_id FROM users" in sql:
            return self
        return self

    def fetchone(self):
        if self.row_value is None:
            return None
        return _FakeRow(self.row_value)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_attach_org_id_falls_back_to_default_org(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _FakeConn(row_value=None)
    monkeypatch.setattr(tenancy, "get_conn", lambda: conn)
    monkeypatch.setattr(tenancy, "get_default_org_id", lambda: "default-org")

    user = {"user_id": "user-1"}

    result = tenancy.attach_org_id(user)

    assert result["org_id"] == "default-org"
    assert any("UPDATE users SET org_id" in sql for sql, _ in conn.executed)
