import pandas as pd

from core.database import db_backend, get_conn, next_id


def _ensure_client_site_flag_column(con) -> None:
    con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS create_site_from_address BOOLEAN")


def ensure_client_sites_runtime_columns(con) -> None:
    statements = [
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS archived_by VARCHAR",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS vacated_date DATE",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS latitude NUMERIC",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS longitude NUMERIC",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS geocode_source VARCHAR",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS geocode_precision VARCHAR",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMP",
    ]
    for ddl in statements:
        try:
            con.execute(ddl)
        except Exception:
            pass


def _build_registered_office_location(row) -> str | None:
    parts = [
        row[1],
        row[2],
        row[3],
        row[4],
        row[5],
        row[6],
    ]
    cleaned = [str(part).strip() for part in parts if part is not None and str(part).strip()]
    if not cleaned:
        return None
    return ", ".join(cleaned)


def ensure_registered_office_site(client_db_id: int, con=None) -> int | None:
    own_conn = con is None
    if own_conn:
        with get_conn() as managed_con:
            return ensure_registered_office_site(client_db_id, con=managed_con)

    _ensure_client_site_flag_column(con)
    ensure_client_sites_runtime_columns(con)
    row = con.execute(
        """
        SELECT create_site_from_address, addr_line1, addr_line2, addr_city, addr_region, addr_postcode, addr_country
        FROM clients
        WHERE db_id = ?
        """,
        [int(client_db_id)],
    ).fetchone()
    if not row:
        return None

    create_site_flag = row[0]
    location = _build_registered_office_location(row)
    if not location:
        return None
    if create_site_flag is False:
        return None

    existing_site = con.execute(
        """
        SELECT site_id, site_name, location
        FROM client_sites
        WHERE client_db_id = ? AND is_registered_office = ?
        ORDER BY site_id
        LIMIT 1
        """,
        [int(client_db_id), True],
    ).fetchone()

    if existing_site:
        # ``create_site_from_address`` is a creation preference, not an
        # instruction to keep overwriting the site forever. Once the site
        # exists, its editable name and location belong to the site record.
        return int(existing_site[0])

    if db_backend() == "postgres":
        inserted = con.execute(
            """
            INSERT INTO client_sites (client_db_id, site_name, location, is_registered_office)
            VALUES (?, ?, ?, ?)
            RETURNING site_id
            """,
            [int(client_db_id), "Registered Office", location, True],
        ).fetchone()
        return int(inserted[0]) if inserted else None

    site_id = next_id("client_sites", "site_id")
    con.execute(
        """
        INSERT INTO client_sites (site_id, client_db_id, site_name, location, is_registered_office)
        VALUES (?, ?, ?, ?, ?)
        """,
        [int(site_id), int(client_db_id), "Registered Office", location, True],
    )
    return int(site_id)


def list_sites(client_db_id: int) -> pd.DataFrame:
    with get_conn() as con:
        ensure_client_sites_runtime_columns(con)
        ensure_registered_office_site(int(client_db_id), con=con)
        result = con.execute(
            """
            SELECT site_id, site_name, location, is_registered_office
            FROM client_sites
            WHERE client_db_id=?
              AND (archived = FALSE OR archived IS NULL)
              AND vacated_date IS NULL
            ORDER BY site_name
            """,
            [int(client_db_id)],
        ).df()
        if not result.empty:
            result["site_name"] = result.apply(
                lambda row: site_display_name(row.get("site_id"), row.get("site_name"), row.get("location")),
                axis=1,
            )
        return result


def site_display_name(site_id: object, site_name: object, location: object) -> str:
    """Return a non-empty label for a site, including legacy location-only rows."""
    name = "" if site_name is None or pd.isna(site_name) else str(site_name).strip()
    if name:
        return name
    location_name = "" if location is None or pd.isna(location) else str(location).strip()
    if location_name:
        return location_name
    has_site_id = site_id is not None and not pd.isna(site_id)
    return f"Site {site_id}" if has_site_id else "Unnamed Site"


def fetch_client_sites_payload(client_db_id: int, con=None) -> dict[str, object]:
    own_conn = con is None
    if own_conn:
        with get_conn() as managed_con:
            return fetch_client_sites_payload(int(client_db_id), con=managed_con)

    _ensure_client_site_flag_column(con)
    ensure_client_sites_runtime_columns(con)
    ensure_registered_office_site(int(client_db_id), con=con)

    rows = con.execute(
        """
        SELECT site_id, site_name, location, is_registered_office, vacated_date, archived,
               latitude, longitude, geocode_source, geocode_precision, geocoded_at
        FROM client_sites
        WHERE client_db_id = ?
        ORDER BY
            CASE WHEN vacated_date IS NULL AND (archived = FALSE OR archived IS NULL) THEN 0 ELSE 1 END,
            is_registered_office DESC,
            site_name ASC,
            site_id ASC
        """,
        [int(client_db_id)],
    ).fetchall()

    active_sites: list[dict[str, object]] = []
    vacated_sites: list[dict[str, object]] = []

    for row in rows or []:
        (site_id, site_name, location, is_registered_office, vacated_date, archived,
         latitude, longitude, geocode_source, geocode_precision, geocoded_at) = row
        site_data = {
            "site_id": int(site_id) if site_id is not None else None,
            "site_name": site_display_name(site_id, site_name, location),
            "location": location,
            "is_registered_office": bool(is_registered_office) if is_registered_office is not None else False,
            "vacated_date": str(vacated_date) if vacated_date is not None else None,
            "archived": bool(archived) if archived is not None else False,
            "latitude": float(latitude) if latitude is not None else None,
            "longitude": float(longitude) if longitude is not None else None,
            "geocode_source": geocode_source,
            "geocode_precision": geocode_precision,
            "geocoded_at": str(geocoded_at) if geocoded_at is not None else None,
        }
        if vacated_date is None and not site_data["archived"]:
            active_sites.append(site_data)
        else:
            vacated_sites.append(site_data)

    return {
        "client_db_id": int(client_db_id),
        "active_sites": active_sites,
        "vacated_sites": vacated_sites,
    }


def add_site(client_db_id: int, site_name: str, location: str | None, is_registered_office: bool) -> int:
    normalized_location = str(location or "").strip() or None
    normalized_name = str(site_name or "").strip() or normalized_location
    if not normalized_name:
        raise ValueError("Site name or location is required")

    with get_conn() as con:
        if db_backend() == "postgres":
            row = con.execute(
                """
                INSERT INTO client_sites (client_db_id, site_name, location, is_registered_office)
                VALUES (?, ?, ?, ?)
                RETURNING site_id
                """,
                [int(client_db_id), normalized_name, normalized_location, bool(is_registered_office)],
            ).fetchone()
            return int(row[0])

        # DuckDB fallback
        site_id = next_id("client_sites", "site_id")
        con.execute(
            """
            INSERT INTO client_sites (site_id, client_db_id, site_name, location, is_registered_office)
            VALUES (?, ?, ?, ?, ?)
            """,
            [int(site_id), int(client_db_id), normalized_name, normalized_location, bool(is_registered_office)],
        )
        return int(site_id)
