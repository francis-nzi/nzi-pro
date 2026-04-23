from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Sequence

from dotenv import load_dotenv

# Load local .env defaults without overriding deployment/runtime environment.
load_dotenv(override=False)

import pandas as pd


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
    def __init__(self, conn, autocommit=False):
        self._conn = conn
        self._autocommit = autocommit
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
        # For autocommit connections, just return self
        # No need to rollback since each query is auto-committed
        return self

    def __exit__(self, exc_type, exc, tb):
        # For transactional connections, commit on success and roll back on failure.
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


def get_conn(*, autocommit: bool = True):
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


def run_ddl():
    """Create/upgrade schema for Postgres.

    This is a convenience runner. For production Postgres usage prefer running
    the SQL migrations under `core/migrations`.
    """

    # Execute DDL statements individually.
    ddl = """
        CREATE TABLE IF NOT EXISTS users (
          user_id VARCHAR PRIMARY KEY, full_name VARCHAR, role VARCHAR, email VARCHAR, password_hash VARCHAR, status VARCHAR DEFAULT 'Active'
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
          benchmark_year INTEGER,
          benchmark_scope_1_tco2e DOUBLE,
          benchmark_scope_2_tco2e DOUBLE,
          benchmark_scope_3_tco2e DOUBLE,
          benchmark_total_tco2e DOUBLE
        );

        CREATE TABLE IF NOT EXISTS client_contacts (
          contact_id INTEGER PRIMARY KEY, client_db_id INTEGER, full_name VARCHAR, job_title VARCHAR, email VARCHAR
        );
        CREATE TABLE IF NOT EXISTS client_sites (
          site_id INTEGER PRIMARY KEY, client_db_id INTEGER, site_name VARCHAR, location VARCHAR, is_registered_office BOOLEAN DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS job_types (job_type_id INTEGER PRIMARY KEY, name VARCHAR UNIQUE, is_active BOOLEAN DEFAULT TRUE);

        CREATE TABLE IF NOT EXISTS job_statuses_lookup (
          status_id INTEGER PRIMARY KEY,
          name VARCHAR UNIQUE,
          sort_order INTEGER,
          is_active BOOLEAN DEFAULT TRUE
        );

        CREATE TABLE IF NOT EXISTS vat_rates_lookup (
          vat_rate_id INTEGER PRIMARY KEY,
          name VARCHAR,
          rate_pct DOUBLE,
          is_default BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE
        );
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

        CREATE TABLE IF NOT EXISTS currencies_lookup (
          currency_code VARCHAR PRIMARY KEY,
          symbol VARCHAR,
          name VARCHAR,
          is_active BOOLEAN DEFAULT TRUE
        );

        CREATE TABLE IF NOT EXISTS quotes (
          quote_id INTEGER PRIMARY KEY,
          client_db_id INTEGER,
          contact_id INTEGER,
          quote_date DATE,
          valid_to DATE,
          salesperson VARCHAR,
          payment_term_id INTEGER,
          currency_code VARCHAR,
          description TEXT,
          notes TEXT,
          status VARCHAR,
          revision_of_quote_id INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS quote_lines (
          line_id INTEGER PRIMARY KEY,
          quote_id INTEGER,
          line_type VARCHAR,
          sort_order INTEGER,
          job_type_id INTEGER,
          description TEXT,
          qty DOUBLE,
          unit_price_ex_vat DOUBLE,
          vat_rate_id INTEGER,
          is_selected BOOLEAN
        );
        """

    def _exec_script(con, script: str):
        # Split on semicolon and execute non-empty statements.
        for part in (s.strip() for s in script.split(";")):
            if not part:
                continue
            try:
                con.execute(part)
            except Exception:
                # Best-effort: continue on errors (existing behaviour)
                pass

    with get_conn() as con:
        _exec_script(con, ddl)

        # Post-create ALTERs (idempotent)
        try:
            con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS dataset_id INTEGER")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS portfolio VARCHAR")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_scope_1_tco2e DOUBLE")
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_scope_2_tco2e DOUBLE")
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_scope_3_tco2e DOUBLE")
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_total_tco2e DOUBLE")
        except Exception:
            pass

        try:
            con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS description VARCHAR")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS unit_price_ex_vat DOUBLE")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS vat_rate_id INTEGER")
        except Exception:
            pass

        try:
            con.execute("ALTER TABLE quotes ADD COLUMN IF NOT EXISTS currency_code VARCHAR")
        except Exception:
            pass

        try:
            cnt = con.execute("SELECT COUNT(*) FROM currencies_lookup").fetchone()[0]
            if cnt == 0:
                con.execute("INSERT INTO currencies_lookup (currency_code, symbol, name, is_active) VALUES ('GBP','£','Pound Sterling', TRUE)")
                con.execute("INSERT INTO currencies_lookup (currency_code, symbol, name, is_active) VALUES ('USD','$','US Dollar', TRUE)")
                con.execute("INSERT INTO currencies_lookup (currency_code, symbol, name, is_active) VALUES ('EUR','€','Euro', TRUE)")
        except Exception:
            pass

        # Seed job statuses
        try:
            defaults = [
                ("Open", 10, True),
                ("Data Gathering Phase", 20, True),
                ("Reporting Phase", 30, True),
                ("Awaiting Client Input", 40, True),
                ("Completed", 50, True),
                ("Closed", 60, True),
                ("Archived", 999, False),
            ]

            for name, sort_order, is_active in defaults:
                exists = con.execute(
                    "SELECT 1 FROM job_statuses_lookup WHERE lower(name)=lower(?) LIMIT 1",
                    [name],
                ).fetchone()
                if exists:
                    continue
                next_status_id = int(
                    con.execute("SELECT COALESCE(MAX(status_id),0)+1 FROM job_statuses_lookup").fetchone()[0]
                )
                con.execute(
                    "INSERT INTO job_statuses_lookup (status_id, name, sort_order, is_active) VALUES (?, ?, ?, ?)",
                    [next_status_id, name, int(sort_order), bool(is_active)],
                )
        except Exception:
            pass

        try:
            cnt = con.execute("SELECT COUNT(*) FROM vat_rates_lookup").fetchone()[0]
            if cnt == 0:
                con.execute(
                    "INSERT INTO vat_rates_lookup (vat_rate_id, name, rate_pct, is_default, is_active) VALUES (1, '20% Standard Rate', 20, TRUE, TRUE)"
                )
                con.execute(
                    "INSERT INTO vat_rates_lookup (vat_rate_id, name, rate_pct, is_default, is_active) VALUES (2, 'No VAT', 0, FALSE, TRUE)"
                )
        except Exception:
            pass

        # Seed portfolios
        try:
            cnt = con.execute("SELECT COUNT(*) FROM portfolios_lookup").fetchone()[0]
            if cnt == 0:
                con.execute("INSERT INTO portfolios_lookup (portfolio_id, name, is_active) VALUES (1, 'NZI', TRUE)")
        except Exception:
            pass

        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s1_year INTEGER")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s2_year INTEGER")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s3_year INTEGER")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s1_pct INTEGER")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s2_pct INTEGER")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_s3_pct INTEGER")
        except Exception:
            pass


def next_id(table: str, pk: str) -> int:
    """Compatibility helper for legacy call sites.

    Prefer IDENTITY/RETURNING in new code paths.
    """
    with get_conn() as con:
        row = con.execute(f"SELECT COALESCE(MAX({pk}), 0) + 1 FROM {table}").fetchone()
    return int(row[0] if row and row[0] is not None else 1)
