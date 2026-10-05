"""Per-job site visibility for report presentation (not emissions accounting)."""
from services.sites import site_display_name


def ensure_report_site_schema(con):
    con.execute("""CREATE TABLE IF NOT EXISTS job_site_report_settings (
        job_id BIGINT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        site_id BIGINT NOT NULL REFERENCES client_sites(site_id) ON DELETE CASCADE,
        include_in_report BOOLEAN NOT NULL DEFAULT TRUE,
        PRIMARY KEY (job_id, site_id)
    )""")


def report_sites(con, job_id):
    ensure_report_site_schema(con)
    rows = con.execute("""
        SELECT s.site_id, s.site_name, s.location, s.is_registered_office,
               s.vacated_date, COALESCE(r.include_in_report, TRUE)
        FROM jobs j JOIN client_sites s ON s.client_db_id = j.client_db_id
        LEFT JOIN job_site_report_settings r ON r.job_id = j.job_id AND r.site_id = s.site_id
        WHERE j.job_id = %s
        ORDER BY s.is_registered_office DESC, s.site_name, s.site_id
    """, [int(job_id)]).fetchall()
    return [dict(site_id=int(r[0]), site_name=site_display_name(r[0], r[1], r[2]),
                 location=r[2], is_registered_office=bool(r[3]),
                 vacated_date=str(r[4]) if r[4] else None, include_in_report=bool(r[5])) for r in rows]


def excluded_report_sites(con, job_id):
    return [s for s in report_sites(con, job_id) if not s["include_in_report"]]


def visible_report_rows(rows, excluded):
    ids = {s["site_id"] for s in excluded}
    names = {s["site_name"] for s in excluded}
    def visible(row):
        sid = row.get("site_id")
        if sid is not None:
            try:
                return int(sid) not in ids
            except (ValueError, TypeError):
                pass
        return row.get("site_name") not in names
    return [row for row in rows if visible(row)]
