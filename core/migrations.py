# nzi_pro/core/migrations.py
from core.database import get_conn


def run_migrations():
    with get_conn() as con:
        # =========================
        # BASE LOOKUPS (legacy)
        # =========================
        con.execute("CREATE TABLE IF NOT EXISTS lookups (type VARCHAR, value VARCHAR)")

        # Migrate legacy job_types -> lookups (if present)
        try:
            has_job_types = con.execute(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='job_types'"
            ).fetchone()[0]
        except Exception:
            has_job_types = 0

        if has_job_types:
            con.execute(
                """
                INSERT INTO lookups (type, value)
                SELECT 'JobType', name
                FROM job_types
                WHERE NOT EXISTS (
                    SELECT 1 FROM lookups l WHERE l.type='JobType' AND l.value=job_types.name
                )
                """
            )

        # =========================
        # AUTH / RBAC (strict provisioning)
        # =========================
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS roles_lookup (
                role_name VARCHAR PRIMARY KEY,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )

        con.execute(
            """
            INSERT INTO roles_lookup (role_name, is_active)
            VALUES
              ('Admin', TRUE),
              ('Consultant', TRUE),
              ('ReadOnly', TRUE),
              ('CRM', TRUE),
              ('QA', TRUE),
              ('Support', TRUE)
            ON CONFLICT (role_name) DO NOTHING
            """
        )

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id VARCHAR PRIMARY KEY,
                full_name VARCHAR,
                role VARCHAR NOT NULL DEFAULT 'ReadOnly',
                email VARCHAR NOT NULL,
                status VARCHAR NOT NULL DEFAULT 'Active'
            )
            """
        )

        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR")
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR")
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR")
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR")

        con.execute(
            """
            UPDATE users
            SET email = user_id
            WHERE email IS NULL OR TRIM(email) = ''
            """
        )

        con.execute(
            """
            UPDATE users
            SET email = LOWER(TRIM(email))
            WHERE email IS NOT NULL
            """
        )

        con.execute("UPDATE users SET role='ReadOnly' WHERE role IS NULL OR TRIM(role)=''")
        con.execute("UPDATE users SET status='Active' WHERE status IS NULL OR TRIM(status)=''")

        con.execute(
            """
            DELETE FROM users u
            USING users v
            WHERE u.email = v.email
              AND u.ctid < v.ctid
            """
        )

        con.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relkind = 'i'
                      AND c.relname = 'users_email_uidx'
                ) THEN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_index i
                        JOIN pg_class c ON c.oid = i.indexrelid
                        WHERE c.relname = 'users_email_uidx'
                          AND i.indisunique
                    ) THEN
                        EXECUTE 'DROP INDEX IF EXISTS users_email_uidx';
                    END IF;
                END IF;
            END $$;
            """
        )

        con.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx
            ON users (email)
            """
        )

        # =========================
        # Seed your 3 admins (strict provisioning)
        # =========================
        admins = [
            ("francis@netzero.international", "Francis Doherty", "Admin", "Active"),
            ("david@netzero.international", "David Hawes", "Admin", "Active"),
            ("jennie@netzero.international", "Jennie Davide", "Admin", "Active"),
        ]

        for email, full_name, role, status in admins:
            email_norm = email.strip().lower()
            con.execute(
                """
                INSERT INTO users (user_id, full_name, role, email, status)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (email) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    role      = EXCLUDED.role,
                    status    = EXCLUDED.status,
                    user_id   = EXCLUDED.user_id
                """,
                [email_norm, full_name, role, email_norm, status],
            )

        # =========================
        # INDUSTRIES LOOKUP
        # =========================
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS industries_lookup (
                industry_id INTEGER PRIMARY KEY,
                name VARCHAR NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )

        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry VARCHAR")
        except Exception:
            pass

        # =========================
        # PAYMENT TERMS LOOKUP (NEW)
        # =========================
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS payment_terms_lookup (
                term_id INTEGER PRIMARY KEY,
                name VARCHAR NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )

        # Default term: 100% in advance
        con.execute(
            """
            INSERT INTO payment_terms_lookup (term_id, name, is_active)
            VALUES (1, '100%% in advance', TRUE)
            ON CONFLICT (term_id) DO NOTHING
            """
        )

        # =========================
        # CRP JOB DETAILS (NEW) - 1:1 with jobs
        # Reporting Year is REQUIRED even for Benchmark (Benchmark: B)
        # Payment terms is FK to lookup (Payment terms: FK)
        # =========================
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS crp_job_details (
              job_id INTEGER PRIMARY KEY,

              reporting_period_from DATE,
              reporting_period_to   DATE,
              is_benchmark BOOLEAN NOT NULL DEFAULT FALSE,
              reporting_year INTEGER NOT NULL,

              is_renewal BOOLEAN NOT NULL DEFAULT FALSE,
              client_order_number VARCHAR,

              client_contact_name  VARCHAR,
              client_contact_email VARCHAR,

              report_signee_name     VARCHAR,
              report_signee_position VARCHAR,

              payment_term_id INTEGER NOT NULL DEFAULT 1
                REFERENCES payment_terms_lookup(term_id),

              free_training_place BOOLEAN NOT NULL DEFAULT FALSE,

              num_employees INTEGER,
              turnover_gbp NUMERIC,
              premises_size_m2 NUMERIC,
              vehicles_owned INTEGER,
              vehicles_leased INTEGER,
              premises_owned INTEGER,
              premises_leased INTEGER,

              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )

        # =========================
        # JOB PLAN MILESTONES (NEW)
        # =========================
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS job_plan (
              job_id INTEGER PRIMARY KEY,
              data_collection_due DATE,
              first_draft_due DATE,
              final_report_due DATE,
              override_dates BOOLEAN NOT NULL DEFAULT FALSE,
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )

        # =========================
        # SCOPE / DATASET CONFIG (NEW)
        # =========================
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS job_scope_config (
              job_id INTEGER NOT NULL,
              scope VARCHAR NOT NULL,
              include_scope BOOLEAN NOT NULL DEFAULT TRUE,
              dataset_id INTEGER,
              factor_method VARCHAR,
              PRIMARY KEY (job_id, scope)
            )
            """
        )

        # =========================
        # FACTOR LOOKUP (existing)
        # =========================
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS year INTEGER")
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS level_4 VARCHAR")
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS ghg_unit VARCHAR")

        # =========================
        # CRP Scope data entries (NEW)
        # =========================
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS crp_scope_entries (
              entry_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              job_id INTEGER NOT NULL,
              scope VARCHAR NOT NULL,                -- 'Scope 1' | 'Scope 2' | 'Scope 3'

              category VARCHAR,
              subcategory VARCHAR,
              description VARCHAR,

              amount NUMERIC,
              unit VARCHAR,

              dataset_id INTEGER,                    -- copied from job_scope_config at time of entry
              factor_id INTEGER,                     -- optional link to factor_lookup
              factor_value NUMERIC,                  -- store the chosen factor value
              tco2e NUMERIC,                         -- calculated or overridden

              method VARCHAR,                        -- 'Activity' | 'Spend' | 'Custom'
              notes VARCHAR,

              is_archived BOOLEAN NOT NULL DEFAULT FALSE,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )

        con.execute(
            """
            CREATE INDEX IF NOT EXISTS crp_scope_entries_job_scope_idx
            ON crp_scope_entries (job_id, scope, is_archived)
            """
        )


# =========================
# PHASE A: SIMPLIFIED SCOPE ROWS (job_scope_rows)
# =========================
con.execute(
    """
    CREATE TABLE IF NOT EXISTS job_scope_rows (
      row_id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(job_id),
      scope VARCHAR NOT NULL,                 -- 'Scope 1' | 'Scope 2' | 'Scope 3'

      dataset_id INTEGER REFERENCES datasets(dataset_id),
      factor_db_id INTEGER REFERENCES factor_lookup(db_id),
      original_id VARCHAR NOT NULL,           -- MUST match factor_lookup.original_id (DESNZ ID)

      level_1 VARCHAR,
      level_2 VARCHAR,
      level_3 VARCHAR,
      level_4 VARCHAR,
      column_text VARCHAR,

      report_label VARCHAR,
      notes VARCHAR,

      enabled BOOLEAN NOT NULL DEFAULT TRUE,

      qty NUMERIC,
      uom VARCHAR,
      factor NUMERIC,
      ghg_unit VARCHAR,

      calc_tco2e NUMERIC,
      override_tco2e NUMERIC,
      override_reason VARCHAR,

      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
    """
)

con.execute(
    """
    CREATE INDEX IF NOT EXISTS job_scope_rows_job_scope_idx
    ON job_scope_rows (job_id, scope)
    """
)

con.execute(
    """
    CREATE INDEX IF NOT EXISTS job_scope_rows_job_scope_enabled_idx
    ON job_scope_rows (job_id, scope, enabled)
    """
)
