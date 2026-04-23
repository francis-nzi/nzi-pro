from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

import api.main as main


class _FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, *args, **kwargs):
        raise AssertionError("get_conn should not be reached when org context is missing")


def test_list_clients_requires_org(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: _FakeConn())
    monkeypatch.setattr(main, "db_backend", lambda: "postgres")

    with pytest.raises(HTTPException) as exc_info:
        main.list_clients(_user={"user_id": "u1", "org_id": ""})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"


def test_get_client_requires_org(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: _FakeConn())

    with pytest.raises(HTTPException) as exc_info:
        main.get_client(123, _user={"user_id": "u1", "org_id": ""})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"


def test_get_job_does_not_fail_open_on_legacy_org_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    class _JobConn(_FakeConn):
        def execute(self, *args, **kwargs):
            raise AssertionError("get_job should stop at assert_job_access when org is missing")

    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_job_access", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(status_code=403, detail="Organisation context required")))
    monkeypatch.setattr(main, "get_conn", lambda: _JobConn())

    with pytest.raises(HTTPException) as exc_info:
        main.get_job(123, _user={"user_id": "u1", "org_id": ""})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"
