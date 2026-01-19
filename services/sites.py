import pandas as pd

from core.database import db_backend, get_conn, next_id


def list_sites(client_db_id: int) -> pd.DataFrame:
    with get_conn() as con:
        return con.execute(
            """
            SELECT site_name, location, is_registered_office
            FROM client_sites
            WHERE client_db_id=?
            ORDER BY site_name
            """,
            [int(client_db_id)],
        ).df()


def add_site(client_db_id: int, site_name: str, location: str | None, is_registered_office: bool) -> int:
    with get_conn() as con:
        if db_backend() == "postgres":
            row = con.execute(
                """
                INSERT INTO client_sites (client_db_id, site_name, location, is_registered_office)
                VALUES (?, ?, ?, ?)
                RETURNING site_id
                """,
                [int(client_db_id), site_name, (location or None), bool(is_registered_office)],
            ).fetchone()
            return int(row[0])

        # DuckDB fallback
        site_id = next_id("client_sites", "site_id")
        con.execute(
            """
            INSERT INTO client_sites (site_id, client_db_id, site_name, location, is_registered_office)
            VALUES (?, ?, ?, ?, ?)
            """,
            [int(site_id), int(client_db_id), site_name, (location or None), bool(is_registered_office)],
        )
        return int(site_id)
