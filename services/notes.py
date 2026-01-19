from __future__ import annotations

import pandas as pd
from datetime import datetime, timezone

from core.database import db_backend, get_conn, next_id


def list_notes(client_db_id: int) -> pd.DataFrame:
    with get_conn() as con:
        return con.execute(
            """
            SELECT author, note_text, created_at
            FROM client_notes
            WHERE client_db_id=?
            ORDER BY created_at DESC
            """,
            [int(client_db_id)],
        ).df()


def add_note(
    client_db_id: int,
    author: str,
    note_text: str,
    created_at: str | None = None,
) -> int:
    ts = created_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    with get_conn() as con:
        if db_backend() == "postgres":
            row = con.execute(
                """
                INSERT INTO client_notes (client_db_id, author, note_text, created_at)
                VALUES (?, ?, ?, ?)
                RETURNING note_id
                """,
                [int(client_db_id), str(author), str(note_text), ts],
            ).fetchone()
            return int(row[0])

        # DuckDB fallback
        note_id = next_id("client_notes", "note_id")
        con.execute(
            """
            INSERT INTO client_notes (note_id, client_db_id, author, note_text, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [int(note_id), int(client_db_id), str(author), str(note_text), ts],
        )
        return int(note_id)
