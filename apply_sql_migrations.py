import hashlib
import os
from pathlib import Path

import psycopg


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
        raise RuntimeError("DATABASE_URL is not set")
    return _ensure_sslmode(url)


def _migration_files(folder: Path) -> list[Path]:
    files = [p for p in folder.glob("*.sql") if p.is_file()]
    return sorted(files, key=lambda p: p.name)


def apply_sql_migrations(folder: str = "sql_migrations") -> None:
    migrations_dir = Path(folder)
    if not migrations_dir.exists() or not migrations_dir.is_dir():
        raise RuntimeError(f"Migrations folder not found: {migrations_dir}")

    url = _get_db_url()

    # Use autocommit=False so each migration runs in a transaction.
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public.applied_migrations (
                  filename TEXT PRIMARY KEY,
                  checksum TEXT NOT NULL,
                  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
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

                # Apply migration.
                cur.execute(sql_text)

                # Record it.
                cur.execute(
                    "INSERT INTO public.applied_migrations (filename, checksum) VALUES (%s, %s)",
                    (path.name, checksum),
                )


if __name__ == "__main__":
    apply_sql_migrations()
