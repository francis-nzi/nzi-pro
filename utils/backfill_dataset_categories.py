from __future__ import annotations

import os
import sys
from typing import Iterable

import psycopg


def _normalize_job_ids(values: Iterable[str]) -> list[int]:
    job_ids: list[int] = []
    for value in values:
        txt = str(value).strip()
        if not txt:
            continue
        try:
            job_ids.append(int(txt))
        except ValueError:
            raise SystemExit(f"Invalid job id: {value}")
    return job_ids


def _build_job_filter(job_ids: list[int]) -> tuple[str, list[int]]:
    if not job_ids:
        return "", []
    placeholders = ",".join(["%s"] * len(job_ids))
    return f" AND job_id IN ({placeholders})", job_ids


def main() -> int:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set")

    job_ids = _normalize_job_ids(sys.argv[1:]) if len(sys.argv) > 1 else []
    job_filter, params = _build_job_filter(job_ids)

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            scope_update = f"""
                UPDATE job_scope_rows jsr
                SET category = COALESCE(
                    NULLIF(TRIM(CAST(jsr.level_1 AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(fl.level_1 AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.level_2 AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(jsr.category AS VARCHAR)), '')
                ),
                    updated_at = NOW()
                FROM factor_lookup fl
                WHERE fl.db_id = jsr.factor_db_id
                  AND (
                      COALESCE(TRIM(CAST(jsr.category AS VARCHAR)), '') = ''
                      OR LOWER(TRIM(CAST(jsr.category AS VARCHAR))) IN ('nan', 'none', 'null', 'uncategorized')
                  )
                  {job_filter}
            """
            cur.execute(scope_update, params)
            scope_updated = cur.rowcount or 0

            source_update = f"""
                UPDATE job_emission_sources js
                SET category = COALESCE(
                    NULLIF(TRIM(CAST(g.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(fl.level_1 AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(js.category AS VARCHAR)), '')
                ),
                    updated_at = NOW()
                FROM job_emission_groups g
                LEFT JOIN factor_lookup fl ON fl.db_id = COALESCE(g.factor_db_id, js.factor_db_id)
                WHERE g.group_id = js.group_id
                  AND (
                      COALESCE(TRIM(CAST(js.category AS VARCHAR)), '') = ''
                      OR LOWER(TRIM(CAST(js.category AS VARCHAR))) IN ('nan', 'none', 'null', 'uncategorized')
                  )
                  {job_filter.replace('job_id', 'js.job_id')}
            """
            cur.execute(source_update, params)
            source_updated = cur.rowcount or 0

        conn.commit()

    print(f"Updated {scope_updated} job_scope_rows and {source_updated} job_emission_sources")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
