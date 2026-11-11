from core import database


class _Cursor:
    def __init__(self, log):
        self.log = log

    def execute(self, sql, params=None):
        self.log.append((sql, params))


class _RawConn:
    def __init__(self):
        self.log = []
        self.autocommit = True

    def cursor(self):
        return _Cursor(self.log)


class _PoolCtx:
    def __init__(self):
        self.exited = False

    def __exit__(self, *exc):
        self.exited = True
        return False


def _borrow(timeout_ms):
    raw, ctx = _RawConn(), _PoolCtx()
    con = database._with_statement_timeout(database._PgConn(raw, _pool_ctx=ctx), timeout_ms)
    return raw, ctx, con


def test_timeout_is_set_on_borrow_and_reset_before_returning_to_pool():
    raw, ctx, con = _borrow(15000)
    with con:
        assert raw.log[-1] == ("SELECT set_config('statement_timeout', %s, false)", ["15000ms"])
    assert raw.log[-1] == ("RESET statement_timeout", None) or raw.log[-1][0] == "RESET statement_timeout"
    assert ctx.exited


def test_no_timeout_leaves_connection_untouched():
    raw, ctx, con = _borrow(None)
    with con:
        pass
    assert not any("statement_timeout" in sql for sql, _ in raw.log)
    assert ctx.exited
