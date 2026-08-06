from __future__ import annotations

import pytest

from core import database


class _FakeRawConnection:
    def __init__(self, *, autocommit: bool):
        self.autocommit = autocommit
        self.commits = 0
        self.rollbacks = 0

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class _FakePoolContext:
    def __init__(self, connection: _FakeRawConnection):
        self.connection = connection
        self.exit_calls = []

    def __enter__(self):
        return self.connection

    def __exit__(self, exc_type, exc, tb):
        self.exit_calls.append((exc_type, exc, tb))
        if not self.connection.autocommit:
            if exc_type is None:
                self.connection.commit()
            else:
                self.connection.rollback()
        return False


class _FakePool:
    def __init__(self, connection: _FakeRawConnection):
        self.context = _FakePoolContext(connection)

    def connection(self, *, timeout: int):
        assert timeout == 5
        return self.context


@pytest.fixture(autouse=True)
def _skip_tenant_session_setup(monkeypatch):
    monkeypatch.setattr(
        database._PgConn,
        "_apply_tenant_session_context",
        lambda self: None,
    )


def test_pooled_non_autocommit_connection_commits_on_success(monkeypatch):
    raw = _FakeRawConnection(autocommit=True)
    pool = _FakePool(raw)
    monkeypatch.setattr(database, "_get_pool", lambda: pool)

    with database.get_conn(autocommit=False):
        assert raw.autocommit is False

    assert raw.commits == 1
    assert raw.rollbacks == 0


def test_pooled_non_autocommit_connection_rolls_back_on_error(monkeypatch):
    raw = _FakeRawConnection(autocommit=True)
    pool = _FakePool(raw)
    monkeypatch.setattr(database, "_get_pool", lambda: pool)

    with pytest.raises(RuntimeError, match="write failed"):
        with database.get_conn(autocommit=False):
            raise RuntimeError("write failed")

    assert raw.commits == 0
    assert raw.rollbacks == 1


def test_each_pool_borrow_applies_requested_autocommit_mode(monkeypatch):
    raw = _FakeRawConnection(autocommit=False)
    pool = _FakePool(raw)
    monkeypatch.setattr(database, "_get_pool", lambda: pool)

    with database.get_conn():
        assert raw.autocommit is True

    assert raw.commits == 0
    assert raw.rollbacks == 0


def test_pool_exit_error_is_not_swallowed(monkeypatch):
    class _FailingPoolContext(_FakePoolContext):
        def __exit__(self, exc_type, exc, tb):
            raise RuntimeError("commit failed")

    raw = _FakeRawConnection(autocommit=False)
    context = _FailingPoolContext(raw)
    connection = database._PgConn(raw, autocommit=False, _pool_ctx=context)

    with pytest.raises(RuntimeError, match="commit failed"):
        with connection:
            pass
