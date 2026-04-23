from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

import api.business_development_routes as bdr
import api.main as main
import api.quotes_routes as quotes_routes


class _FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self


def test_create_job_respects_org_plan_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeConn()
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "require_org", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(main, "get_conn", lambda: fake)
    monkeypatch.setattr(
        main,
        "_require_org_plan_active",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(status_code=403, detail="Organisation plan is not active")),
    )

    with pytest.raises(HTTPException) as exc_info:
        main.create_job(
            request=None,
            body={"client_db_id": 10, "job_type": "CRP", "start_date": "2026-01-01", "due_date": "2026-12-31"},
            _user={"user_id": "u1", "org_id": "org-a"},
        )

    assert exc_info.value.status_code == 403


def test_create_quote_respects_org_plan_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeConn()
    monkeypatch.setattr(quotes_routes, "_quote_org_id", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(quotes_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(
        quotes_routes,
        "_require_org_plan_active",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(status_code=403, detail="Organisation plan is not active")),
    )

    with pytest.raises(HTTPException) as exc_info:
        quotes_routes.create_quote(
            10,
            {"description": "Test quote"},
            _user={"user_id": "u1", "org_id": "org-a"},
        )

    assert exc_info.value.status_code == 403


def test_create_invoice_respects_org_plan_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeConn()
    monkeypatch.setattr(quotes_routes, "_quote_org_id", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(quotes_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(
        quotes_routes,
        "_require_org_plan_active",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(status_code=403, detail="Organisation plan is not active")),
    )

    with pytest.raises(HTTPException) as exc_info:
        quotes_routes.create_invoice(
            10,
            {"invoice_number": "INV-1"},
            _user={"user_id": "u1", "org_id": "org-a"},
        )

    assert exc_info.value.status_code == 403


def test_create_job_invoice_respects_org_plan_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeConn()
    monkeypatch.setattr(quotes_routes, "_quote_org_id", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(quotes_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(
        quotes_routes,
        "_require_org_plan_active",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(status_code=403, detail="Organisation plan is not active")),
    )

    with pytest.raises(HTTPException) as exc_info:
        quotes_routes.create_job_invoice(
            10,
            {"invoice_number": "INV-1"},
            _user={"user_id": "u1", "org_id": "org-a"},
        )

    assert exc_info.value.status_code == 403


def test_create_job_from_opportunity_respects_org_plan_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeConn()
    monkeypatch.setattr(bdr, "require_org", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(bdr, "get_conn", lambda: fake)
    monkeypatch.setattr(bdr, "_ensure_tables", lambda con: None)
    monkeypatch.setattr(bdr, "_ensure_quote_tables", lambda con: None)
    monkeypatch.setattr(
        bdr,
        "_require_org_plan_active",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(status_code=403, detail="Organisation plan is not active")),
    )

    with pytest.raises(HTTPException) as exc_info:
        bdr.create_job_from_opportunity(
            123,
            {"title": "Test job"},
            _user={"user_id": "u1", "org_id": "org-a"},
        )

    assert exc_info.value.status_code == 403
