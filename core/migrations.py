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
            con.execute("""
                INSERT INTO lookups (type, value)
                SELECT 'JobType', name
                FROM job_types
                WHERE NOT EXISTS (
                    SELECT 1 FROM lookups l WHERE l.type='JobType' AND l.value=job_types.name
                )
            """)

        # =========================
        # AUTH / RBAC (strict provisioning)
        # =========================

        # Roles lookup used by Admin -> NZI Team
        con.execute("""
            CREATE TABLE IF NOT EXISTS roles_lookup (
                role_name VARCHAR PRIMARY KEY,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
        """)

        # Ensure baseline roles exist (additive)
        con.execute("""
            INSERT INTO roles_lookup (role_name, is_active)
            VALUES
              ('Admin', TRUE),
              ('Consultant', TRUE),
              ('ReadOnly', TRUE),
              ('CRM', TRUE),
              ('QA', TRUE),
              ('Support', TRUE)
            ON CONFLICT (role_name) DO NOTHING
        """)

        # Users table (strict provisioning gate)
        # NOTE: email is the stable identifier (we also keep user_id for backwards compatibility).
        con.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id VARCHAR PRIMARY KEY,
                full_name VARCHAR,
                role VARCHAR NOT NULL DEFAULT 'ReadOnly',
                email VARCHAR UNIQUE NOT NULL,
                status VARCHAR NOT NULL DEFAULT 'Active'
            )
        """)

        # Ensure required columns exist (additive, safe)
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR")
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR")
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR")
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR")

        # Ensure role defaults don’t break existing rows
        con.execute("UPDATE users SET role='ReadOnly' WHERE role IS NULL OR TRIM(role)=''")
        con.execute("UPDATE users SET status='Active' WHERE status IS NULL OR TRIM(status)=''")

        # Seed your 3 admins (strict provisioning)
        admins = [
            ("francis@netzero.international", "Francis Doherty", "Admin", "Active"),
            ("david@netzero.international", "David Hawes", "Admin", "Active"),
            ("jennie@netzero.international", "Jennie Davide", "Admin", "Active"),
        ]
        for email, full_name, role, status in admins:
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
                [email, full_name, role, email, status],
            )

        # =========================
        # FACTOR LOOKUP (existing)
        # =========================
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS year INTEGER")
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS level_4 VARCHAR")
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS ghg_unit VARCHAR")
