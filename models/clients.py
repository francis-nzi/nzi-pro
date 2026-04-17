from core.database import db_backend, get_conn, next_id


def _org_filter_clause(org_id: str | None) -> tuple[str, list[object]]:
    if org_id is None or not str(org_id).strip():
        return "", []
    return " AND org_id = ?", [str(org_id).strip()]


def list_crm_owners(org_id: str | None = None):
    """Distinct CRM owners from users + existing clients. Keeps dropdown stable without hardcoding."""
    client_filter, client_params = _org_filter_clause(org_id)
    with get_conn() as con:
        a = con.execute(
            f"SELECT DISTINCT crm_owner AS v FROM clients WHERE crm_owner IS NOT NULL AND crm_owner <> ''{client_filter}",
            client_params,
        ).df()
        b = con.execute(
            "SELECT DISTINCT full_name AS v FROM users WHERE status='Active' AND full_name IS NOT NULL AND full_name <> ''",
        ).df()
    vals = sorted({str(x) for x in list(a["v"]) + list(b["v"]) if x is not None and str(x).strip() != ""})
    return ["(Unassigned)"] + vals


def list_portfolios(org_id: str | None = None):
    try:
        with get_conn() as con:
            org_filter, params = _org_filter_clause(org_id)
            df = con.execute(
                f"SELECT name FROM portfolios_lookup WHERE is_active=TRUE{org_filter} ORDER BY name",
                params,
            ).df()
        vals = df["name"].tolist() if not df.empty else []
        if "NZI" not in vals:
            vals = ["NZI"] + vals
        return vals
    except Exception:
        with get_conn() as con:
            org_filter, params = _org_filter_clause(org_id)
            a = con.execute(
                f"SELECT DISTINCT portfolio AS v FROM clients WHERE portfolio IS NOT NULL AND portfolio <> ''{org_filter}",
                params,
            ).df()
        vals = sorted({str(x) for x in list(a["v"]) if x is not None and str(x).strip() != ""})
        if "NZI" not in vals:
            vals = ["NZI"] + vals
        return vals


def list_industries():
    try:
        with get_conn() as con:
            df = con.execute(
                "SELECT name FROM industries_lookup WHERE is_active=TRUE ORDER BY name"
            ).df()
        return df["name"].tolist() if not df.empty else []
    except Exception:
        return []


def list_clients(search: str = "", org_id: str | None = None):
    org_filter, params = _org_filter_clause(org_id)
    with get_conn() as con:
        return con.execute(
            f"""
          SELECT db_id, client_name, crm_owner, portfolio, industry, addr_city, addr_country
          FROM clients
          WHERE status='Active' AND client_name ILIKE ?{org_filter}
          ORDER BY client_name
        """,
            [f"%{search}%"] + params,
        ).df()


def get_client(client_id: int, org_id: str | None = None):
    org_filter, params = _org_filter_clause(org_id)
    with get_conn() as con:
        df = con.execute(
            f"SELECT * FROM clients WHERE db_id=?{org_filter}",
            [client_id] + params,
        ).df()
    return df.iloc[0] if not df.empty else None


def create_client(payload: dict, org_id: str | None = None):
    backend = db_backend()
    nid = None
    cols = ("client_name, industry, description_long, website, year_end_month, company_reg, "
            "headquarters, addr_line1, addr_line2, addr_city, addr_region, addr_postcode, addr_country, "
            "logo_url, crm_owner, status, net_zero_year, interim_year, interim_s1_pct, interim_s2_pct, interim_s3_pct")
    # Keep insert stable (additive columns only)
    cols += ", portfolio, target_s1_year, target_s2_year, target_s3_year, target_s1_pct, target_s2_pct, target_s3_pct"

    nz_year = payload.get("net_zero_year", 2050)
    vals = [
        payload.get("client_name"),
        payload.get("industry"),
        payload.get("description_long"),
        payload.get("website"),
        payload.get("year_end_month"),
        payload.get("company_reg"),
        payload.get("headquarters"),
        payload.get("addr_line1"),
        payload.get("addr_line2"),
        payload.get("addr_city"),
        payload.get("addr_region"),
        payload.get("addr_postcode"),
        payload.get("addr_country"),
        payload.get("logo_url"),
        payload.get("crm_owner"),
        "Active",
        payload.get("net_zero_year", 2050),
        payload.get("interim_year", 2035),
        payload.get("interim_s1_pct", 50),
        payload.get("interim_s2_pct", 50),
        payload.get("interim_s3_pct", 50),
    ]
    vals += [
        payload.get("portfolio", "NZI"),
        payload.get("target_s1_year", nz_year),
        payload.get("target_s2_year", nz_year),
        payload.get("target_s3_year", nz_year),
        payload.get("target_s1_pct", 100),
        payload.get("target_s2_pct", 100),
        payload.get("target_s3_pct", 100),
    ]

    if org_id is not None and str(org_id).strip():
        cols = "org_id, " + cols
        vals = [str(org_id).strip()] + vals

    q = f"INSERT INTO clients ({cols}) VALUES ({','.join(['?'] * len(vals))})"
    with get_conn() as con:
        if backend == "postgres":
            row = con.execute(q + " RETURNING db_id", vals).fetchone()
            return int(row[0])

        # DuckDB fallback
        nid = next_id("clients", "db_id")
        q2 = f"INSERT INTO clients (db_id, {cols}) VALUES ({','.join(['?'] * (len(vals) + 1))})"
        con.execute(q2, [nid] + vals)
        return int(nid)


def update_client(client_id: int, payload: dict, org_id: str | None = None):
    # Minimal update helper for Client Profile edits
    cols = [
        "client_name", "industry", "description_long", "website", "year_end_month", "company_reg",
        "headquarters", "addr_line1", "addr_line2", "addr_city", "addr_region", "addr_postcode", "addr_country",
        "logo_url", "crm_owner", "portfolio",
        "net_zero_year", "interim_year", "interim_s1_pct", "interim_s2_pct", "interim_s3_pct",
        "target_s1_year", "target_s2_year", "target_s3_year", "target_s1_pct", "target_s2_pct", "target_s3_pct",
        "benchmark_year", "benchmark_period_start", "benchmark_period_end", "currency",
    ]
    sets = []
    vals = []
    for c in cols:
        if c in payload:
            sets.append(f"{c}=?")
            vals.append(payload.get(c))
    if not sets:
        return
    vals.append(client_id)
    params = [*vals]
    where = "WHERE db_id=?"
    if org_id is not None and str(org_id).strip():
        where += " AND org_id=?"
        params.append(str(org_id).strip())
    with get_conn() as con:
        con.execute(f"UPDATE clients SET {', '.join(sets)} {where}", params)


def archive_client(client_id: int, org_id: str | None = None):
    with get_conn() as con:
        if org_id is None or not str(org_id).strip():
            con.execute("UPDATE clients SET status='Archived' WHERE db_id=?", [client_id])
        else:
            con.execute("UPDATE clients SET status='Archived' WHERE db_id=? AND org_id=?", [client_id, str(org_id).strip()])


def list_archived_clients(search: str = "", org_id: str | None = None):
    org_filter, params = _org_filter_clause(org_id)
    with get_conn() as con:
        return con.execute(
            f"""
          SELECT db_id, client_name, crm_owner, portfolio, industry, addr_city, addr_country
          FROM clients
          WHERE status='Archived' AND client_name ILIKE ?{org_filter}
          ORDER BY client_name
        """,
            [f"%{search}%"] + params,
        ).df()


def reactivate_client(client_id: int, org_id: str | None = None):
    with get_conn() as con:
        if org_id is None or not str(org_id).strip():
            con.execute("UPDATE clients SET status='Active' WHERE db_id=?", [client_id])
        else:
            con.execute("UPDATE clients SET status='Active' WHERE db_id=? AND org_id=?", [client_id, str(org_id).strip()])
