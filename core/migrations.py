# nzi_pro/core/migrations.py
from core.database import get_conn

def run_migrations():
    with get_conn() as con:
        # Ensure lookups exists (used by Admin → Lookups)
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

        # Expand factor_lookup
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS year INTEGER")
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS level_4 VARCHAR")
        con.execute("ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS ghg_unit VARCHAR")
