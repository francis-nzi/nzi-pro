from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import services.permissions as permissions


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _FakeConn:
    def __init__(self, row: _FakeRow | None):
        self.row = row
        self.queries: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        return self

    def fetchone(self):
        return self.row

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_client_access_requires_matching_org(monkeypatch):
    fake = _FakeConn(_FakeRow("org-a"))
    monkeypatch.setattr(permissions, "get_conn", lambda: fake)
    monkeypatch.setattr(permissions, "get_default_org_id", lambda: "org-a")

    assert permissions.user_can_access_client({"org_id": "org-a"}, 123) is True
    assert permissions.user_can_access_client({"org_id": "org-b"}, 123) is False


def test_client_access_allows_legacy_null_org_for_default_org(monkeypatch):
    fake = _FakeConn(_FakeRow(None))
    monkeypatch.setattr(permissions, "get_conn", lambda: fake)
    monkeypatch.setattr(permissions, "get_default_org_id", lambda: "org-a")

    assert permissions.user_can_access_client({"org_id": "org-a"}, 123) is True
    assert permissions.user_can_access_client({"org_id": "org-b"}, 123) is False


def test_client_access_denies_missing_org_even_with_id_match(monkeypatch):
    fake = _FakeConn(_FakeRow("org-a"))
    monkeypatch.setattr(permissions, "get_conn", lambda: fake)

    assert permissions.user_can_access_client({"user_id": "u1", "linked_client_ids": [123]}, 123) is False


def test_job_access_requires_matching_org(monkeypatch):
    fake = _FakeConn(_FakeRow(123, "org-a"))
    monkeypatch.setattr(permissions, "get_conn", lambda: fake)
    monkeypatch.setattr(permissions, "get_default_org_id", lambda: "org-a")

    assert permissions.user_can_access_job({"org_id": "org-a"}, 55) is True
    assert permissions.user_can_access_job({"org_id": "org-b"}, 55) is False


def test_job_access_allows_legacy_null_org_for_default_org(monkeypatch):
    fake = _FakeConn(_FakeRow(123, None))
    monkeypatch.setattr(permissions, "get_conn", lambda: fake)
    monkeypatch.setattr(permissions, "get_default_org_id", lambda: "org-a")

    assert permissions.user_can_access_job({"org_id": "org-a"}, 55) is True
    assert permissions.user_can_access_job({"org_id": "org-b"}, 55) is False


def test_job_access_denies_missing_org(monkeypatch):
    fake = _FakeConn(_FakeRow(123, "org-a"))
    monkeypatch.setattr(permissions, "get_conn", lambda: fake)

    assert permissions.user_can_access_job({"user_id": "u1"}, 55) is False
