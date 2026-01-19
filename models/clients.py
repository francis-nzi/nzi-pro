
from core.database import db_backend, get_conn, next_id

def list_crm_owners():
    """Distinct CRM owners from users + existing clients. Keeps dropdown stable without hardcoding."""
    with get_conn() as con:
        a = con.execute("SELECT DISTINCT crm_owner AS v FROM clients WHERE crm_owner IS NOT NULL AND crm_owner <> ''").df()
        b = con.execute("SELECT DISTINCT full_name AS v FROM users WHERE status='Active' AND full_name IS NOT NULL AND full_name <> ''").df()
    vals = sorted({str(x) for x in list(a["v"]) + list(b["v"]) if x is not None and str(x).strip() != ""})
    return ["(Unassigned)"] + vals

def list_portfolios():
    """Distinct portfolios already in use (plus default NZI)."""
    with get_conn() as con:
        a = con.execute("SELECT DISTINCT portfolio AS v FROM clients WHERE portfolio IS NOT NULL AND portfolio <> ''").df()
    vals = sorted({str(x) for x in list(a["v"]) if x is not None and str(x).strip() != ""})
    if "NZI" not in vals:
        vals = ["NZI"] + vals
    return vals

def list_clients(search:str=""):
    with get_conn() as con:
        return con.execute('''
          SELECT db_id, client_name, crm_owner, portfolio, industry, addr_city, addr_country
          FROM clients WHERE status='Active' AND client_name ILIKE ?
          ORDER BY client_name
        ''', [f"%{search}%"]).df()

def get_client(client_id:int):
    with get_conn() as con:
        df = con.execute("SELECT * FROM clients WHERE db_id=?", [client_id]).df()
    return df.iloc[0] if not df.empty else None

def create_client(payload:dict):
    backend = db_backend()
    nid = None
    cols = ("client_name, industry, description_long, website, year_end_month, company_reg, "
            "headquarters, addr_line1, addr_line2, addr_city, addr_region, addr_postcode, addr_country, "
            "logo_url, crm_owner, status, net_zero_year, interim_year, interim_s1_pct, interim_s2_pct, interim_s3_pct")
    # Keep insert stable (additive columns only)
    cols += ", portfolio, target_s1_year, target_s2_year, target_s3_year, target_s1_pct, target_s2_pct, target_s3_pct"

    nz_year = payload.get("net_zero_year", 2050)
    vals = [payload.get("client_name"), payload.get("industry"), payload.get("description_long"),
            payload.get("website"), payload.get("year_end_month"), payload.get("company_reg"),
            payload.get("headquarters"), payload.get("addr_line1"), payload.get("addr_line2"),
            payload.get("addr_city"), payload.get("addr_region"), payload.get("addr_postcode"), payload.get("addr_country"),
            payload.get("logo_url"), payload.get("crm_owner"), "Active", payload.get("net_zero_year",2050),
            payload.get("interim_year",2035), payload.get("interim_s1_pct",50), payload.get("interim_s2_pct",50), payload.get("interim_s3_pct",50)]
    vals += [payload.get("portfolio", "NZI"),
             payload.get("target_s1_year", nz_year), payload.get("target_s2_year", nz_year), payload.get("target_s3_year", nz_year),
             payload.get("target_s1_pct", 100), payload.get("target_s2_pct", 100), payload.get("target_s3_pct", 100)]
    q = f"INSERT INTO clients ({cols}) VALUES ({','.join(['?']*len(vals))})"
    with get_conn() as con:
        if backend == "postgres":
            row = con.execute(q + " RETURNING db_id", vals).fetchone()
            return int(row[0])

        # DuckDB fallback
        nid = next_id("clients", "db_id")
        q2 = f"INSERT INTO clients (db_id, {cols}) VALUES ({','.join(['?']*(len(vals)+1))})"
        con.execute(q2, [nid] + vals)
        return int(nid)

def update_client(client_id:int, payload:dict):
    # Minimal update helper for Client Profile edits
    cols = [
        "client_name", "industry", "description_long", "website", "year_end_month", "company_reg",
        "headquarters", "addr_line1", "addr_line2", "addr_city", "addr_region", "addr_postcode", "addr_country",
        "logo_url", "crm_owner", "portfolio",
        "net_zero_year", "interim_year", "interim_s1_pct", "interim_s2_pct", "interim_s3_pct",
        "target_s1_year", "target_s2_year", "target_s3_year", "target_s1_pct", "target_s2_pct", "target_s3_pct",
        "benchmark_year",
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
    with get_conn() as con:
        con.execute(f"UPDATE clients SET {', '.join(sets)} WHERE db_id=?", vals)

def archive_client(client_id:int):
    with get_conn() as con:
        con.execute("UPDATE clients SET status='Archived' WHERE db_id=?", [client_id])
def list_archived_clients(search: str = ""):
    with get_conn() as con:
        return con.execute('''
          SELECT db_id, client_name, crm_owner, portfolio, industry, addr_city, addr_country
          FROM clients WHERE status='Archived' AND client_name ILIKE ?
          ORDER BY client_name
        ''', [f"%{search}%"]).df()

def reactivate_client(client_id: int):
    with get_conn() as con:
        con.execute("UPDATE clients SET status='Active' WHERE db_id=?", [client_id])
