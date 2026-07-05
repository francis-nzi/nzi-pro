from __future__ import annotations

import logging
import os
import threading
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
            # Return connection to pool instead of closing it.
            try:
                self._pool_ctx.__exit__(exc_type, exc, tb)
            except Exception:
                pass
        else:
            # Direct connection — commit/rollback then close.
            if not self._autocommit:
                try:
                    if exc_type is None:
                        self._conn.commit()
                    else:
                        self._conn.rollback()
                except Exception:
                    pass
            try:
                self._conn.close()
            except Exception:
                pass

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
# Supabase TLS handshake cost (10–40 s) on every call.  Falls back to direct
# connections if the pool cannot be initialised (e.g. missing package).

_pool = None
_pool_lock = threading.Lock()


def _configure_pool_conn(conn) -> None:
    conn.autocommit = True


def _get_pool():
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is not None:
            return _pool
        try:
            from psycopg_pool import ConnectionPool  # type: ignore[import]
            url = os.getenv("DATABASE_URL")
            if not url:
                return None
            url = _ensure_sslmode(url)
            _pool = ConnectionPool(
                url,
                min_size=1,
                max_size=5,
                configure=_configure_pool_conn,
                open=True,
                reconnect_timeout=30,
            )
            logger.info("DB connection pool initialised (min=1, max=5)")
            return _pool
        except Exception as exc:
            logger.warning("DB pool init failed — using direct connections: %s", exc)
            return None


def get_conn(*, autocommit: bool = True):
    pool = _get_pool()
    if pool is not None:
        try:
            pool_ctx = pool.connection(timeout=10)
            raw_conn = pool_ctx.__enter__()
            return _PgConn(raw_conn, autocommit=autocommit, _pool_ctx=pool_ctx)
        except Exception as exc:
            logger.warning("Pool borrow failed, falling back to direct connection: %s", exc)

    # Fallback: direct connection (no pool available or pool timed out)
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
    conn = psycopg.connect(url, autocommit=autocommit)
    return _PgConn(conn, autocommit=autocommit)


def next_id(table: str, pk: str) -> int:
    """Compatibility helper for legacy call sites.

    Prefer IDENTITY/RETURNING in new code paths.
    """
    with get_conn() as con:
        row = con.execute(f"SELECT COALESCE(MAX({pk}), 0) + 1 FROM {table}").fetchone()
    return int(row[0] if row and row[0] is not None else 1)
