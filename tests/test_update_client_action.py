"""Regression tests for update_client_action's inline-editable-field support
(2026-08): action_name/description/action_category/scope_focus/action_term
were added alongside the existing status/progress/target_date/owner_contact_id/
note fields, powering the portal Actions table's inline edit columns."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException

import services.report_actions as report_actions

_EXISTING_ROW = (
    1,          # client_action_id
    "open",     # status
    0,          # progress
    None,       # target_date
    None,       # completed_at
    None,       # owner_contact_id
    "Old Name",         # action_name
    "Old description",  # description
    "Old Category",      # action_category
    "Scope 1",           # scope_focus
    "medium",             # action_term
)


class _FakeConn:
    def __init__(self, *, duplicate_name: bool = False):
        self._duplicate_name = duplicate_name
        self.update_params: list | None = None

    def execute(self, sql: str, params: list | None = None):
        normalized = " ".join(sql.split()).lower()
        params = params or []
        if normalized.startswith("select client_action_id, status, progress"):
            return _Result(fetchone_value=_EXISTING_ROW)
        if "lower(action_name) = lower(%s)" in normalized:
            return _Result(fetchone_value=(99,) if self._duplicate_name else None)
        if normalized.startswith("update client_report_actions"):
            self.update_params = params
            return _Result()
        return _Result()


class _Result:
    def __init__(self, fetchone_value=None):
        self._fetchone_value = fetchone_value

    def fetchone(self):
        return self._fetchone_value


def _patch_common(monkeypatch, conn):
    monkeypatch.setattr(report_actions, "ensure_report_actions_schema", lambda *_a, **_k: None)
    monkeypatch.setattr(
        report_actions,
        "list_client_report_actions",
        lambda *_a, **_k: [{"client_action_id": 1, "action_name": "reloaded"}],
    )


def test_update_client_action_applies_new_inline_fields(monkeypatch) -> None:
    conn = _FakeConn()
    _patch_common(monkeypatch, conn)

    report_actions.update_client_action(
        1, 1,
        payload={
            "action_name": "New Name",
            "description": "New description",
            "action_category": "New Category",
            "scope_focus": "Scope 2",
            "action_term": "long",
        },
        actor="test",
        source="portal",
        con=conn,
    )

    assert conn.update_params is not None
    # UPDATE param order: status, progress, target_date, completed_at, owner,
    # action_name, description, action_category, scope_focus, action_term, actor, id
    assert conn.update_params[5] == "New Name"
    assert conn.update_params[6] == "New description"
    assert conn.update_params[7] == "New Category"
    assert conn.update_params[8] == "Scope 2"
    assert conn.update_params[9] == "long"


def test_update_client_action_keeps_existing_fields_when_not_in_payload(monkeypatch) -> None:
    conn = _FakeConn()
    _patch_common(monkeypatch, conn)

    report_actions.update_client_action(
        1, 1, payload={"status": "approved"}, actor="test", source="portal", con=conn,
    )

    assert conn.update_params[5] == "Old Name"
    assert conn.update_params[6] == "Old description"
    assert conn.update_params[7] == "Old Category"
    assert conn.update_params[8] == "Scope 1"
    assert conn.update_params[9] == "medium"


def test_update_client_action_rejects_blank_name(monkeypatch) -> None:
    conn = _FakeConn()
    _patch_common(monkeypatch, conn)

    with pytest.raises(HTTPException) as exc_info:
        report_actions.update_client_action(
            1, 1, payload={"action_name": "   "}, actor="test", source="portal", con=conn,
        )
    assert exc_info.value.status_code == 400


def test_update_client_action_rejects_duplicate_name(monkeypatch) -> None:
    conn = _FakeConn(duplicate_name=True)
    _patch_common(monkeypatch, conn)

    with pytest.raises(HTTPException) as exc_info:
        report_actions.update_client_action(
            1, 1, payload={"action_name": "Someone Else's Action"}, actor="test", source="portal", con=conn,
        )
    assert exc_info.value.status_code == 400
    assert "already exists" in exc_info.value.detail.lower()


def test_update_client_action_allows_unchanged_name_without_duplicate_check(monkeypatch) -> None:
    """Re-saving with the same name (e.g. a no-op inline edit) must not trip
    the duplicate check against itself."""
    conn = _FakeConn(duplicate_name=True)  # would raise if the check ran
    _patch_common(monkeypatch, conn)

    report_actions.update_client_action(
        1, 1, payload={"action_name": "Old Name", "status": "approved"}, actor="test", source="portal", con=conn,
    )
    assert conn.update_params[5] == "Old Name"


def test_update_client_action_normalizes_action_term(monkeypatch) -> None:
    conn = _FakeConn()
    _patch_common(monkeypatch, conn)

    report_actions.update_client_action(
        1, 1, payload={"action_term": "Long term"}, actor="test", source="portal", con=conn,
    )
    assert conn.update_params[9] == "long"
