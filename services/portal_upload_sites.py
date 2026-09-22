"""Site validation shared by portal workbook flows."""
from fastapi import HTTPException


def permitted_sites(con, user):
    rows = con.execute("""SELECT site_id, site_name FROM client_sites
        WHERE client_db_id=%s AND COALESCE(archived,FALSE)=FALSE
        ORDER BY COALESCE(is_registered_office,FALSE) DESC, site_name""",
        [int(user["client_db_id"])]).fetchall()
    allowed = user.get("site_ids")
    return [{"site_id": int(row[0]), "site_name": str(row[1])} for row in rows
            if allowed is None or int(row[0]) in allowed]


def selected_site(sites, site_id):
    if site_id is None:
        return None
    site = next((site for site in sites if site["site_id"] == site_id), None)
    if site is None:
        raise HTTPException(400, "Selected site is not an active permitted site for this account")
    return site


def row_site(sites, name, default_id=None):
    name = str(name or "").strip()
    if not name:
        site = selected_site(sites, default_id)
        if site is None:
            raise HTTPException(400, "Choose a site for this row or select a default site before uploading")
        return site["site_id"]
    matches = [site for site in sites if site["site_name"].strip().casefold() == name.casefold()]
    if len(matches) != 1:
        raise HTTPException(400, f"Site '{name}' is not a unique permitted site. Choose a site from the Sites sheet.")
    return matches[0]["site_id"]
