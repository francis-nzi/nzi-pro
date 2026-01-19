import pandas as pd

from core.database import db_backend, get_conn, next_id


def list_contacts(client_db_id: int) -> pd.DataFrame:
    with get_conn() as con:
        return con.execute(
            """
            SELECT full_name, job_title, email
            FROM client_contacts
            WHERE client_db_id=?
            ORDER BY full_name
            """,
            [int(client_db_id)],
        ).df()


def add_contact(
    client_db_id: int,
    full_name: str,
    job_title: str | None,
    email: str | None,
) -> int:
    with get_conn() as con:
        if db_backend() == "postgres":
            row = con.execute(
                """
                INSERT INTO client_contacts (client_db_id, full_name, job_title, email)
                VALUES (?, ?, ?, ?)
                RETURNING contact_id
                """,
                [int(client_db_id), full_name, (job_title or None), (email or None)],
            ).fetchone()
            return int(row[0])

        # DuckDB fallback
        contact_id = next_id("client_contacts", "contact_id")
        con.execute(
            """
            INSERT INTO client_contacts (contact_id, client_db_id, full_name, job_title, email)
            VALUES (?, ?, ?, ?, ?)
            """,
            [int(contact_id), int(client_db_id), full_name, (job_title or None), (email or None)],
        )
        return int(contact_id)
