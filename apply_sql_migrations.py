import hashlib
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

# Load local .env defaults without overriding explicitly provided runtime env.
load_dotenv(override=False)


def _ensure_sslmode(url: str) -> str:
    if "sslmode=" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}sslmode=require"


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _get_db_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Define it in your shell or .env before running migrations."
        )
    return _ensure_sslmode(url)


def _migration_files(folder: Path) -> list[Path]:
    files = [p for p in folder.glob("*.sql") if p.is_file()]
    include_manual = os.getenv("INCLUDE_MANUAL_SQL_MIGRATIONS", "").strip().lower() in {"1", "true", "yes"}
    selected: list[Path] = []
    for path in files:
        prefix = path.name.split("_", 1)[0]
        if not include_manual and prefix.isdigit() and int(prefix) >= 9000:
            continue
        selected.append(path)
    return sorted(selected, key=lambda p: p.name)


def apply_sql_migrations(folder: str = "sql_migrations") -> None:
    migrations_dir = Path(folder)
    if not migrations_dir.exists() or not migrations_dir.is_dir():
        raise RuntimeError(f"Migrations folder not found: {migrations_dir}")

    url = _get_db_url()

    # Use autocommit=False so each migration runs in a transaction.
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            # Some Supabase/pooler connections do not inherit a default schema.
            # Force all migration statements to run against public.
            cur.execute("CREATE SCHEMA IF NOT EXISTS public")
            cur.execute("SET search_path TO public")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public.applied_migrations (
                  filename TEXT PRIMARY KEY,
                  checksum TEXT NOT NULL,
                  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute("ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY")
            cur.execute("DROP POLICY IF EXISTS applied_migrations_service_role_all ON public.applied_migrations")
            cur.execute(
                """
                CREATE POLICY applied_migrations_service_role_all
                ON public.applied_migrations
                FOR ALL
                TO service_role
                USING (true)
                WITH CHECK (true)
                """
            )

            for path in _migration_files(migrations_dir):
                sql_text = path.read_text(encoding="utf-8")
                checksum = _sha256_text(sql_text)

                cur.execute(
                    "SELECT 1 FROM public.applied_migrations WHERE filename = %s LIMIT 1",
                    (path.name,),
                )
                already = cur.fetchone() is not None
                if already:
                    continue

                # Some dump-style migrations reset search_path to empty.
                # Re-apply public before every file so later unqualified CREATE TABLE
                # statements continue to work.
                cur.execute("SET search_path TO public")

                # Apply migration.
                cur.execute(sql_text)

                # Record it.
                cur.execute(
                    "INSERT INTO public.applied_migrations (filename, checksum) VALUES (%s, %s)",
                    (path.name, checksum),
                )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public.applied_maintenance_tasks (
                  task_key TEXT PRIMARY KEY,
                  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )

    _run_post_migration_maintenance(url)


def _run_post_migration_maintenance(url: str) -> None:
    task_key = "spend_unit_backfill_v1"
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET search_path TO public")
            cur.execute(
                "SELECT 1 FROM public.applied_maintenance_tasks WHERE task_key = %s LIMIT 1",
                (task_key,),
            )
            if cur.fetchone() is not None:
                return

    try:
        from types import SimpleNamespace

        from utils.backfill_spend_rows import backfill_spend_rows

        backfill_spend_rows(
            SimpleNamespace(
                all_jobs=True,
                job_id=None,
                row_id=None,
                original_id=None,
                report_label=None,
                dry_run=False,
            )
        )
    except Exception:
        # Fail loudly so we don't silently ship the code fix without
        # repairing existing stored rows.
        raise

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET search_path TO public")
            cur.execute(
                "INSERT INTO public.applied_maintenance_tasks (task_key) VALUES (%s)",
                (task_key,),
            )


if __name__ == "__main__":
    apply_sql_migrations()
