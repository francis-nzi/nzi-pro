"""Helper to fetch existing scope entry data for pre-filling templates."""

from core.database import get_conn


def fetch_existing_scope_entries(job_id: int) -> dict:
    """Return map original_id -> existing values."""
    existing_data = {}

    with get_conn() as con:
        result = con.execute(
            """
            SELECT original_id, qty, notes
            FROM job_scope_rows
            WHERE job_id = ?
              AND enabled = TRUE
            ORDER BY original_id
            """,
            [job_id],
        )

        while True:
            row = result.fetchone()
            if not row:
                break

            original_id = row[0]
            qty = row[1]
            notes = row[2]

            existing_data[original_id] = {
                "qty": qty,
                "monthly": [],
                "apply_pct": 100,
                "notes": notes,
            }

        if not existing_data:
            result = con.execute(
                """
                SELECT original_id, qty, notes
                FROM crp_scope_entries
                WHERE job_id = ?
                  AND is_archived = FALSE
                ORDER BY original_id
                """,
                [job_id],
            )

            while True:
                row = result.fetchone()
                if not row:
                    break

                original_id = row[0]
                qty = row[1]
                notes = row[2]

                existing_data[original_id] = {
                    "qty": qty,
                    "monthly": [],
                    "apply_pct": 100,
                    "notes": notes,
                }

    return existing_data
