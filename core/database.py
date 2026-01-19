from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import duckdb
import pandas as pd

from config import DB_PATH


def db_backend() -> str:
    """Database backend selector.

    Env:
      - DB_BACKEND: 'duckdb' (default) or 'postgres'
      - DATABASE_URL: Postgres connection URL (required for postgres)
    """
    return str(os.getenv("DB_BACKEND", "duckdb") or "duckdb").strip().lower()


def _ensure_sslmode(url: str) -> str:
    # Supabase requires TLS. If the user forgets, we force sslmode=require.
    if "sslmode=" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}sslmode=require"


def _qmark_to_percent_s(sql: str) -> str:
    # Minimal placeholder translation: DuckDB uses '?', psycopg uses '%s'.
    # We assume '?' are only used for placeholders (true for this project).
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


class _PgConn:
    def __init__(self, conn):
        self._conn = conn

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        finally:
            self._conn.close()

    def execute(self, sql: str, params: Sequence[Any] | None = None):
        q = _qmark_to_percent_s(sql)
        cur = self._conn.cursor()
        cur.execute(q, params or [])
        return _PgResult(cur)


def get_conn():
    backend = db_backend()
    if backend == "postgres":
        try:
            import psycopg
        except Exception as e:
            raise RuntimeError(
                "Postgres backend selected but psycopg is not installed. Add psycopg[binary] to requirements."
            ) from e

        url = os.getenv("DATABASE_URL")
        if not url:
            raise RuntimeError("DB_BACKEND=postgres but DATABASE_URL is not set")
        url = _ensure_sslmode(url)
        # For web apps / poolers, keep connections short-lived.
        conn = psycopg.connect(url)
        return _PgConn(conn)

    # Default: DuckDB
    return duckdb.connect(DB_PATH)


def run_ddl():
    """Create/upgrade DuckDB schema.

    For Postgres/Supabase, schema is managed via SQL migrations applied in Supabase.
    """
    if db_backend() != "duckdb":
        return

    with get_conn() as con:
        con.execute(
            """
        CREATE TABLE IF NOT EXISTS users (
          user_id VARCHAR PRIMARY KEY, full_name VARCHAR, role VARCHAR, email VARCHAR, status VARCHAR DEFAULT 'Active'
        );
        CREATE TABLE IF NOT EXISTS roles_lookup (role_name VARCHAR PRIMARY KEY, is_active BOOLEAN DEFAULT TRUE);

        CREATE TABLE IF NOT EXISTS clients (
          db_id INTEGER PRIMARY KEY,
          client_name VARCHAR, industry VARCHAR, description_long TEXT,
          website VARCHAR, year_end_month VARCHAR, company_reg VARCHAR,
          headquarters VARCHAR,
          addr_line1 VARCHAR, addr_line2 VARCHAR, addr_city VARCHAR, addr_region VARCHAR, addr_postcode VARCHAR, addr_country VARCHAR,
          logo_url VARCHAR,
          crm_owner VARCHAR, status VARCHAR DEFAULT 'Active',
          net_zero_year INTEGER DEFAULT 2050, interim_year INTEGER DEFAULT 2035,
          interim_s1_pct INTEGER DEFAULT 50, interim_s2_pct INTEGER DEFAULT 50, interim_s3_pct INTEGER DEFAULT 50,
          benchmark_year INTEGER
        );

        CREATE TABLE IF NOT EXISTS client_contacts (
          contact_id INTEGER PRIMARY KEY, client_db_id INTEGER, full_name VARCHAR, job_title VARCHAR, email VARCHAR
        );
        CREATE TABLE IF NOT EXISTS client_sites (
          site_id INTEGER PRIMARY KEY, client_db_id INTEGER, site_name VARCHAR, location VARCHAR, is_registered_office BOOLEAN DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS job_types (job_type_id INTEGER PRIMARY KEY, name VARCHAR UNIQUE, is_active BOOLEAN DEFAULT TRUE);
        CREATE TABLE IF NOT EXISTS jobs (
          job_id INTEGER PRIMARY KEY, client_db_id INTEGER, job_type_id INTEGER, job_type VARCHAR,
          job_number VARCHAR UNIQUE, title VARCHAR, reporting_year INTEGER,
          crp_id INTEGER, status VARCHAR DEFAULT 'Open',
          start_date DATE, due_date DATE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS crp_reports (
          crp_id INTEGER PRIMARY KEY, client_db_id INTEGER, reporting_year INTEGER, is_benchmark BOOLEAN DEFAULT FALSE, status VARCHAR,
          period_from DATE, period_to DATE,
          org_boundary_type VARCHAR, org_boundary_note TEXT,
          issued_date DATE,
          client_signee_name VARCHAR, client_signee_position VARCHAR, client_signature_date DATE,
          nzi_signee_name VARCHAR, nzi_signee_position VARCHAR, nzi_signature_date DATE,
          client_logo_url VARCHAR,
          premises_owned INTEGER, premises_leased INTEGER, vehicles_owned INTEGER, vehicles_leased INTEGER,
          employees INTEGER, turnover DOUBLE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS time_subjects (subject_id INTEGER PRIMARY KEY, name VARCHAR, is_active BOOLEAN DEFAULT TRUE);

        CREATE TABLE IF NOT EXISTS portfolios_lookup (
          portfolio_id INTEGER PRIMARY KEY,
          name VARCHAR,
          is_active BOOLEAN DEFAULT TRUE
        );
        CREATE TABLE IF NOT EXISTS time_logs (
          time_id INTEGER PRIMARY KEY, job_id INTEGER, user_id VARCHAR, subject VARCHAR,
          work_date DATE, minutes INTEGER, notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS datasets (
          dataset_id INTEGER PRIMARY KEY,
          name VARCHAR, source VARCHAR, analysis_type VARCHAR,
          country VARCHAR, region VARCHAR, currency VARCHAR,
          year INTEGER, version VARCHAR, license VARCHAR, notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS factor_lookup (
          db_id INTEGER PRIMARY KEY, dataset_id INTEGER,
          file_name VARCHAR, year INTEGER, original_id VARCHAR,
          scope VARCHAR, level_1 VARCHAR, level_2 VARCHAR, level_3 VARCHAR,
          column_text VARCHAR, uom VARCHAR, factor DOUBLE, source VARCHAR, region VARCHAR, currency VARCHAR
        );

        CREATE TABLE IF NOT EXISTS activity_data (
          activity_id INTEGER PRIMARY KEY, client_db_id INTEGER, crp_id INTEGER, site_id INTEGER,
          scope VARCHAR, category VARCHAR, subcategory VARCHAR,
          amount DOUBLE, unit VARCHAR, factor_id INTEGER, emissions_tco2e DOUBLE,
          source_type VARCHAR, note TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS client_notes (
          note_id INTEGER PRIMARY KEY, client_db_id INTEGER, author VARCHAR, note_text TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        )

        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS dataset_id INTEGER")
        con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS portfolio VARCHAR")

        # Seed portfolios
        try:
            cnt = con.execute("SELECT COUNT(*) FROM portfolios_lookup").fetchone()[0]
            if cnt == 0:
                con.execute("INSERT INTO portfolios_lookup (portfolio_id, name, is_active) VALUES (1, 'NZI', TRUE)")
        except Exception:
            pass

        con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s1_year INTEGER")
        con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s2_year INTEGER")
        con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s3_year INTEGER")
        con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s1_pct INTEGER")
        con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s2_pct INTEGER")
        con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s3_pct INTEGER")


def next_id(table, pk):
    """DuckDB-only helper.

    Postgres uses IDENTITY columns; do not call next_id() in postgres mode.
    """
    if db_backend() != "duckdb":
        raise RuntimeError("next_id() is DuckDB-only. Use IDENTITY/RETURNING in Postgres.")
    with get_conn() as con:
        return int(con.execute(f"SELECT COALESCE(MAX({pk}),0)+1 FROM {table}").fetchone()[0] or 1)
