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

        # Roles lookup used by Admin -> NZI Team
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS roles_lookup (
                role_name VARCHAR PRIMARY KEY,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )

        # Ensure baseline roles exist (additive)
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

        # Users table (strict provisioning gate)
        # NOTE: email is the stable identifier (we also keep user_id for backwards compatibility).
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

        # Additive safety for older schemas (non-destructive)
        # (Older DBs may have users without these columns/constraints.)
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR")
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR")
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR")
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR")

        # Backfill / normalise email (critical before enforcing uniqueness)
        # Legacy behaviour: user_id is commonly the email.
        con.execute(
            """
            UPDATE users
            SET email = user_id
            WHERE email IS NULL OR TRIM(email) = ''
            """
        )

        # Normalise email casing/whitespace so uniqueness behaves as expected
        con.execute(
            """
            UPDATE users
            SET email = LOWER(TRIM(email))
            WHERE email IS NOT NULL
            """
        )

        # Ensure role/status defaults don’t break existing rows
        con.execute("UPDATE users SET role='ReadOnly' WHERE role IS NULL OR TRIM(role)=''")
        con.execute("UPDATE users SET status='Active' WHERE status IS NULL OR TRIM(status)=''")

        # Deduplicate any historical duplicates (keeps newest row per email)
        # We must do this BEFORE adding a unique index/constraint.
        con.execute(
            """
            DELETE FROM users u
            USING users v
            WHERE u.email = v.email
              AND u.ctid < v.ctid
            """
        )

        # Ensure a UNIQUE index exists for ON CONFLICT (email).
        # Important: if an older NON-UNIQUE index exists with the same name,
        # "IF NOT EXISTS" would skip creation and ON CONFLICT would still fail.
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
                    -- If the existing index is NOT unique, drop it so we can recreate as UNIQUE.
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
        # INDUSTRIES LOOKUP (NEW)
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

        # Ensure clients.industry exists (safe even if already present)
        # This stores the chosen industry name from industries_lookup.
        try:
            con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry VARCHAR")
        except Exception:
            # If clients table isn't created yet at this point in your full migrations,
            # later migrations will handle it; we ignore safely here.
            pass

        # =========================
        # FACTOR LOOKUP (existing)
        # =========================
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS year INTEGER")
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS level_4 VARCHAR")
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS ghg_unit VARCHAR")
