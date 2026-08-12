from __future__ import annotations

import logging
import os
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any, Sequence

from dotenv import load_dotenv

# Load local .env defaults without overriding deployment/runtime environment.
load_dotenv(override=False)

import pandas as pd

logger = logging.getLogger(__name__)


def db_backend() -> str:
    """Compatibility helper. The application now runs Postgres only."""
    return "postgres"


def _ensure_sslmode(url: str) -> str:
    # Supabase requires TLS. If the user forgets, we force sslmode=require.
    if "sslmode=" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}sslmode=require"


def _qmark_to_percent_s(sql: str) -> str:
    # Allow existing queries that still use "?" placeholder style.
    return sql.replace("?", "%s")


@dataclass
class _PgResult:
    cursor: Any

    def df(self) -> pd.DataFrame:
        try:
            cols = [d.name if hasattr(d, "name") else d[0] for d in (self.cursor.description or [])]
        except Exception:
            cols = []
        if not cols:
            return pd.DataFrame()
        rows = self.cursor.fetchall()
        return pd.DataFrame(rows, columns=cols)

    def fetchone(self):
        return self.cursor.fetchone()

    def fetchall(self):
        return self.cursor.fetchall()


class _PgConn:
    def __init__(self, conn, autocommit=False, _pool_ctx=None):
        self._conn = conn
        self._autocommit = autocommit
        self._pool_ctx = _pool_ctx  # pool connection context manager, if borrowed from pool
        self._apply_tenant_session_context()

    def _apply_tenant_session_context(self):
        try:
            from services.tenancy import get_current_org_context
        except Exception:
            return

        org_id = get_current_org_context()
        if not org_id:
            return

        try:
            cur = self._conn.cursor()
            cur.execute("SELECT set_config(%s, %s, false)", ["app.current_org_id", org_id])
            try:
                cur.close()
            except Exception:
                pass
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._pool_ctx is not None:
            # The pool context commits/rolls back transactional connections
            # before returning them to the pool.  Do not swallow commit errors:
            # callers must not receive a successful response for a failed write.
            return self._pool_ctx.__exit__(exc_type, exc, tb)
        else:
            # Direct connection — commit/rollback then close.
            try:
                if not self._autocommit:
                    if exc_type is None:
                        self._conn.commit()
                    else:
                        try:
                            self._conn.rollback()
                        except Exception:
                            logger.exception("Database rollback failed")
            finally:
                self._conn.close()
        return False

    def execute(self, sql: str, params: Sequence[Any] | None = None):
        import json
        q = _qmark_to_percent_s(sql)
        cur = self._conn.cursor()
        # Convert dict parameters to JSON strings for JSONB columns
        if params:
            processed_params = []
            for p in params:
                if isinstance(p, dict):
                    processed_params.append(json.dumps(p))
                else:
                    processed_params.append(p)
            cur.execute(q, processed_params)
        else:
            cur.execute(q, params or [])
        return _PgResult(cur)

    def executemany(self, sql: str, params_seq):
        q = _qmark_to_percent_s(sql)
        cur = self._conn.cursor()
        cur.executemany(q, params_seq)
        return _PgResult(cur)


# ── Connection pool ────────────────────────────────────────────────────────────
# psycopg_pool maintains persistent connections so requests avoid paying the
# Supabase TLS handshake cost on every call.
#
# IMPORTANT: pool init runs in a background thread so it never blocks a request
# handler.  While the pool is still warming up, get_conn() falls back to a
# direct connection.  Once the pool is ready all subsequent requests use it.
# If init fails permanently the _pool_init_failed flag prevents retry loops
# (which would block every request for ~30 s each time).

_pool = None
_pool_init_failed = False
_pool_init_started = False
_pool_lock = threading.Lock()


def _configure_pool_conn(conn) -> None:
    conn.autocommit = True


def _init_pool() -> None:
    """Run in a daemon thread — establishes the pool without blocking requests."""
    global _pool, _pool_init_failed
    try:
        from psycopg_pool import ConnectionPool  # type: ignore[import]
        url = os.getenv("DATABASE_URL")
        if not url:
            _pool_init_failed = True
            logger.warning("DB pool skipped — DATABASE_URL not set")
            return
        url = _ensure_sslmode(url)
        p = ConnectionPool(
            url,
            min_size=1,
            # Supabase's own session-mode pooler has a hard ceiling of 15
            # total client sessions (confirmed in production: raising this to
            # 15 caused "FATAL: max clients reached in session mode - max
            # clients are limited to pool_size: 15" under real concurrent
            # load, since our app alone could then claim the pooler's entire
            # capacity, leaving nothing for anything else and cascading into
            # connection failures and a server restart). 8 gives real headroom
            # over the original 5 for Report Printing's parallel task
            # fan-out, while staying safely under Supabase's own limit.
            max_size=8,
            configure=_configure_pool_conn,
            open=True,   # blocks inside the background thread — fine
            reconnect_timeout=30,
        )
        _pool = p
        logger.info("DB connection pool ready (min=1, max=8)")
    except Exception as exc:
        _pool_init_failed = True
        logger.warning("DB pool init failed permanently — using direct connections: %s", exc)


def _ensure_pool_started() -> None:
    """Start pool-init background thread exactly once."""
    global _pool_init_started
    if _pool_init_started:
        return
    with _pool_lock:
        if _pool_init_started:
            return
        _pool_init_started = True
        threading.Thread(target=_init_pool, daemon=True, name="db-pool-init").start()


def _get_pool():
    _ensure_pool_started()
    if _pool_init_failed:
        return None
    return _pool  # None while pool is still warming up


_CONNECT_ATTEMPTS = 3
_CONNECT_RETRY_BACKOFF_SECONDS = 0.25


def get_conn(*, autocommit: bool = True):
    """Borrow a connection, retrying transient failures a couple of times.

    Supabase's session-mode pooler has a hard ceiling on total client
    sessions (see the pool sizing comment above); under real concurrent
    load a borrow or a direct connect can occasionally fail even though
    the database itself is fine a moment later. Previously a single
    failure here surfaced straight to the caller as a 500 -- e.g. a file
    upload would succeed, then the immediate reload of the file list
    would 500 purely from this kind of momentary contention. Retrying a
    couple of times with a short backoff lets that self-heal instead.
    """
    last_exc: Exception | None = None
    for attempt in range(_CONNECT_ATTEMPTS):
        pool = _get_pool()
        if pool is not None:
            try:
                pool_ctx = pool.connection(timeout=5)
                raw_conn = pool_ctx.__enter__()
                try:
                    # Pool configuration establishes a safe idle default, but the
                    # requested mode must be applied on every borrow.  Previously
                    # pooled connections always remained autocommit=True, so code
                    # using get_conn(autocommit=False) could partially commit before
                    # a later exception.
                    raw_conn.autocommit = autocommit
                except Exception:
                    pool_ctx.__exit__(*sys.exc_info())
                    raise
                return _PgConn(raw_conn, autocommit=autocommit, _pool_ctx=pool_ctx)
            except Exception as exc:
                last_exc = exc
                logger.warning("Pool borrow failed (attempt %d/%d): %s", attempt + 1, _CONNECT_ATTEMPTS, exc)

        # Fallback: direct connection (pool not ready yet, unavailable, or just failed above)
        try:
            import psycopg
        except Exception as e:
            raise RuntimeError(
                "Postgres backend requires psycopg. Add psycopg[binary] to requirements."
            ) from e

        url = os.getenv("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL is not set")
        url = _ensure_sslmode(url)
        try:
            conn = psycopg.connect(url, autocommit=autocommit, connect_timeout=5)
            return _PgConn(conn, autocommit=autocommit)
        except Exception as exc:
            last_exc = exc
            logger.warning("Direct connection failed (attempt %d/%d): %s", attempt + 1, _CONNECT_ATTEMPTS, exc)

        if attempt < _CONNECT_ATTEMPTS - 1:
            time.sleep(_CONNECT_RETRY_BACKOFF_SECONDS * (attempt + 1))

    raise RuntimeError(f"Could not obtain a database connection after {_CONNECT_ATTEMPTS} attempts: {last_exc}") from last_exc


def next_id(table: str, pk: str) -> int:
    """Compatibility helper for legacy call sites.

    Prefer IDENTITY/RETURNING in new code paths.
    """
    with get_conn() as con:
        row = con.execute(f"SELECT COALESCE(MAX({pk}), 0) + 1 FROM {table}").fetchone()
    return int(row[0] if row and row[0] is not None else 1)
