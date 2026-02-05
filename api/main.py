import io
import os
from urllib.parse import urlparse

from dotenv import load_dotenv
load_dotenv()

import pandas as pd
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from openpyxl import load_workbook

from core.database import db_backend, get_conn
from nzi_pages.job_folder_excel import build_excel_template_bytes
from services.sites import list_sites
from api.admin_routes import router as admin_router

app = FastAPI(title="NZI Pro API", version="0.1.0")

# Include admin routes
app.include_router(admin_router)


def _current_user(
    x_user: str | None = Header(default=None, alias="X-User"),
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
) -> dict[str, str]:
    # Auth placeholder: later replace with real auth.
    # For now, accept either header and fall back to anonymous.
    user = (x_user_email or x_user or "").strip()
    if not user:
        return {"user": "anonymous"}
    return {"user": user}


def _job_template_paths(job_id: int) -> dict[str, str | None]:
    """Resolve the job-level template selection.

    Defaults to the legacy in-repo templates if no job_template_id/template row is present.
    """
    default_excel = "templates/NZI Data Upload Template - Basic UK.xlsx"
    default_crp = "templates/DEMOCO Carbon Reduction Plan Dec 2025 - Second Year Onwards.docx"

    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT jt.excel_template_path, jt.crp_template_path
                FROM jobs j
                LEFT JOIN job_templates jt ON jt.job_template_id = j.job_template_id
                WHERE j.job_id=?
                """,
                [int(job_id)],
            ).fetchone()
    except Exception:
        row = None

    excel_path = None
    crp_path = None
    if row:
        try:
            excel_path = (row[0] or None)
        except Exception:
            excel_path = None
        try:
            crp_path = (row[1] or None)
        except Exception:
            crp_path = None

    return {
        "excel_template_path": excel_path or default_excel,
        "crp_template_path": crp_path or default_crp,
    }


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health(_user: dict[str, str] = Depends(_current_user)):
    url = os.getenv("DATABASE_URL") or ""
    host = ""
    user = ""
    dbname = ""
    port: int | None = None
    try:
        if url:
            parsed = urlparse(url)
            host = parsed.hostname or ""
            user = parsed.username or ""
            dbname = (parsed.path or "").lstrip("/")
            port = parsed.port
    except Exception:
        host = ""
        user = ""
        dbname = ""
        port = None
    return {
        "ok": True,
        "db_backend": db_backend(),
        "database_url_host": host,
        "database_url_user": user,
        "database_url_dbname": dbname,
        "database_url_port": port,
        "database_url_has_sslmode": ("sslmode=" in url),
    }


@app.get("/debug/env")
def debug_env(_user: dict[str, str] = Depends(_current_user)):
    url = os.getenv("DATABASE_URL") or ""
    host = ""
    user = ""
    dbname = ""
    port: int | None = None
    try:
        if url:
            parsed = urlparse(url)
            host = parsed.hostname or ""
            user = parsed.username or ""
            dbname = (parsed.path or "").lstrip("/")
            port = parsed.port
    except Exception:
        host = ""
        user = ""
        dbname = ""
        port = None
    return {
        "db_backend": db_backend(),
        "database_url_host": host,
        "database_url_user": user,
        "database_url_dbname": dbname,
        "database_url_port": port,
        "database_url_has_sslmode": ("sslmode=" in url),
    }


@app.post("/jobs")
def create_job(body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    """Create a new job."""
    try:
        client_db_id = body.get("client_db_id")
        job_type = body.get("job_type")
        reporting_year = body.get("reporting_year")
        start_date = body.get("start_date")
        due_date = body.get("due_date")
        
        if not client_db_id or not job_type or not reporting_year:
            raise HTTPException(status_code=400, detail="client_db_id, job_type, and reporting_year are required")
        
        if not start_date or not due_date:
            raise HTTPException(status_code=400, detail="start_date and due_date are required")
        
        with get_conn() as con:
            row = con.execute(
                """
                INSERT INTO jobs (
                    client_db_id, job_type, job_number, title, reporting_year,
                    status, start_date, due_date
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING job_id
                """,
                [
                    int(client_db_id),
                    job_type,
                    "PENDING",
                    body.get("title", "Untitled").strip() or "Untitled",
                    int(reporting_year),
                    body.get("status", "Open"),
                    start_date,
                    due_date,
                ],
            ).fetchone()
            
            job_id = int(row[0])
            job_number = f"J{(job_id + 999):06d}"
            
            con.execute(
                "UPDATE jobs SET job_number = ? WHERE job_id = ?",
                [job_number, job_id],
            )
            
            return {"ok": True, "job_id": job_id, "job_number": job_number}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create job: {e}")


@app.get("/jobs")
def list_jobs(
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _user: dict[str, str] = Depends(_current_user),
):
    query = (q or "").strip()

    where_sql = ""
    params: list[object] = []
    if query:
        if db_backend() == "postgres":
            where_sql = (
                "WHERE (j.job_number ILIKE ? OR j.title ILIKE ? OR c.client_name ILIKE ?)"
            )
            like = f"%{query}%"
            params.extend([like, like, like])
        else:
            where_sql = (
                "WHERE (lower(coalesce(j.job_number,'')) LIKE ? OR lower(coalesce(j.title,'')) LIKE ? OR lower(coalesce(c.client_name,'')) LIKE ?)"
            )
            like = f"%{query.lower()}%"
            params.extend([like, like, like])

    try:
        with get_conn() as con:
            total_row = con.execute(
                f"""
                SELECT COUNT(*)
                FROM jobs j
                JOIN clients c ON c.db_id = j.client_db_id
                {where_sql}
                """,
                params,
            ).fetchone()

            rows = (
                con.execute(
                    f"""
                    SELECT j.job_id, j.job_number, j.title, j.reporting_year, j.status,
                           j.client_db_id, c.client_name
                    FROM jobs j
                    JOIN clients c ON c.db_id = j.client_db_id
                    {where_sql}
                    ORDER BY j.job_id DESC
                    LIMIT ? OFFSET ?
                    """,
                    [*params, int(limit), int(offset)],
                )
                .df()
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/jobs failed: {e}")

    items: list[dict[str, object]] = []
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            items.append(
                {
                    "job_id": int(r.get("job_id")),
                    "job_number": r.get("job_number"),
                    "title": r.get("title"),
                    "reporting_year": (int(r.get("reporting_year")) if r.get("reporting_year") is not None else None),
                    "status": r.get("status"),
                    "client_db_id": int(r.get("client_db_id")),
                    "client_name": r.get("client_name"),
                }
            )

    total = int(total_row[0] if total_row else 0)
    return {"items": items, "limit": int(limit), "offset": int(offset), "total": total}


@app.get("/jobs/{job_id}")
def get_job(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    with get_conn() as con:
        row = con.execute(
            """
            SELECT j.job_id, j.job_number, j.title, j.reporting_year, 
                   j.reporting_period_start, j.reporting_period_end,
                   j.status, j.job_template_id,
                   j.client_db_id, c.client_name
            FROM jobs j
            JOIN clients c ON c.db_id = j.client_db_id
            WHERE j.job_id=?
            """,
            [int(job_id)],
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    (
        jid,
        job_number,
        title,
        reporting_year,
        reporting_period_start,
        reporting_period_end,
        status,
        job_template_id,
        client_db_id,
        client_name,
    ) = row

    return {
        "job_id": int(jid),
        "job_number": job_number,
        "title": title,
        "reporting_year": (int(reporting_year) if reporting_year is not None else None),
        "reporting_period_start": (str(reporting_period_start) if reporting_period_start else None),
        "reporting_period_end": (str(reporting_period_end) if reporting_period_end else None),
        "status": status,
        "job_template_id": (int(job_template_id) if job_template_id is not None else None),
        "client_db_id": int(client_db_id),
        "client_name": client_name,
    }


@app.patch("/jobs/{job_id}")
def update_job(
    job_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update job fields including reporting period."""
    try:
        with get_conn() as con:
            # Check job exists
            exists = con.execute("SELECT 1 FROM jobs WHERE job_id = ?", [int(job_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Job not found")
            
            # Build update query dynamically based on provided fields
            updates = []
            params = []
            
            if "reporting_period_start" in body:
                updates.append("reporting_period_start = ?")
                params.append(body["reporting_period_start"])
            
            if "reporting_period_end" in body:
                updates.append("reporting_period_end = ?")
                params.append(body["reporting_period_end"])
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(int(job_id))
            query = f"UPDATE jobs SET {', '.join(updates)} WHERE job_id = ?"
            
            con.execute(query, params)
            
            return {"ok": True, "message": "Job updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


@app.get("/job-templates")
def list_job_templates(_user: dict[str, str] = Depends(_current_user)):
    try:
        with get_conn() as con:
            df = (
                con.execute(
                    """
                    SELECT job_template_id, template_key, template_name,
                           template_type, file_path, excel_template_path, crp_template_path, is_active
                    FROM job_templates
                    ORDER BY template_type, template_key
                    """
                ).df()
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/job-templates failed: {e}")

    items: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        import numpy as np
        df = df.replace({np.nan: None})
        for _, row in df.iterrows():
            items.append(
                {
                    "job_template_id": int(row["job_template_id"]),
                    "template_key": row["template_key"],
                    "template_name": row["template_name"],
                    "template_type": row["template_type"] or "dataset",
                    "file_path": row["file_path"],
                    "excel_template_path": row["excel_template_path"],
                    "crp_template_path": row["crp_template_path"],
                    "is_active": bool(row["is_active"]),
                }
            )

    return {"items": items}


@app.post("/job-templates")
async def create_job_template(
    template_key: str = Form(...),
    template_name: str = Form(""),
    template_type: str = Form("dataset"),
    is_active: str = Form("true"),
    file: UploadFile = File(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Create a new job template with file upload."""
    import os
    from pathlib import Path
    
    try:
        if not template_key:
            raise HTTPException(status_code=400, detail="template_key is required")
        
        # Create templates directory if it doesn't exist
        templates_dir = Path("uploaded_templates")
        templates_dir.mkdir(exist_ok=True)
        
        # Generate unique filename
        file_ext = Path(file.filename or "template").suffix
        safe_key = template_key.replace(" ", "_").replace("/", "_")
        file_name = f"{safe_key}_{template_type}{file_ext}"
        file_path = templates_dir / file_name
        
        # Save uploaded file
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)
        
        with get_conn() as con:
            # Check if template_key already exists
            exists = con.execute(
                "SELECT 1 FROM job_templates WHERE template_key = %s",
                [template_key]
            ).fetchone()
            
            if exists:
                raise HTTPException(status_code=400, detail="Template key already exists")
            
            row = con.execute(
                """
                INSERT INTO job_templates 
                (template_key, template_name, template_type, file_path, is_active)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING job_template_id
                """,
                [
                    template_key,
                    template_name or None,
                    template_type,
                    str(file_path),
                    is_active.lower() == "true"
                ]
            ).fetchone()
            
            return {"ok": True, "job_template_id": int(row[0]), "file_path": str(file_path)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Create failed: {e}")


@app.patch("/job-templates/{template_id}")
async def update_job_template(
    template_id: int,
    template_key: str = Form(None),
    template_name: str = Form(None),
    template_type: str = Form(None),
    is_active: str = Form(None),
    file: UploadFile = File(None),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update a job template with optional file upload."""
    from pathlib import Path
    
    try:
        with get_conn() as con:
            # Check template exists
            exists = con.execute(
                "SELECT 1 FROM job_templates WHERE job_template_id = %s",
                [int(template_id)]
            ).fetchone()
            
            if not exists:
                raise HTTPException(status_code=404, detail="Template not found")
            
            # Build update query
            updates = []
            params = []
            
            if template_key is not None:
                updates.append("template_key = %s")
                params.append(template_key)
            
            if template_name is not None:
                updates.append("template_name = %s")
                params.append(template_name or None)
            
            if template_type is not None:
                updates.append("template_type = %s")
                params.append(template_type)
            
            if is_active is not None:
                updates.append("is_active = %s")
                params.append(is_active.lower() == "true")
            
            # Handle file upload if provided
            if file and file.filename:
                templates_dir = Path("uploaded_templates")
                templates_dir.mkdir(exist_ok=True)
                
                file_ext = Path(file.filename).suffix
                safe_key = (template_key or f"template_{template_id}").replace(" ", "_").replace("/", "_")
                file_name = f"{safe_key}_{template_type or 'dataset'}{file_ext}"
                file_path = templates_dir / file_name
                
                contents = await file.read()
                with open(file_path, "wb") as f:
                    f.write(contents)
                
                updates.append("file_path = %s")
                params.append(str(file_path))
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(int(template_id))
            query = f"UPDATE job_templates SET {', '.join(updates)} WHERE job_template_id = %s"
            
            con.execute(query, params)
            
            return {"ok": True, "message": "Template updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


@app.put("/jobs/{job_id}/job-template")
def update_job_template(
    job_id: int,
    payload: dict[str, object] = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    raw_id = payload.get("job_template_id")
    if raw_id is None:
        raise HTTPException(status_code=400, detail="job_template_id is required")
    try:
        jt_id = int(raw_id)
    except Exception:
        raise HTTPException(status_code=400, detail="job_template_id must be an integer")

    try:
        with get_conn() as con:
            exists_job = con.execute("SELECT 1 FROM jobs WHERE job_id=?", [int(job_id)]).fetchone()
            if not exists_job:
                raise HTTPException(status_code=404, detail="Job not found")

            tpl = con.execute(
                "SELECT job_template_id FROM job_templates WHERE job_template_id=? AND is_active=TRUE",
                [int(jt_id)],
            ).fetchone()
            if not tpl:
                raise HTTPException(status_code=400, detail="Invalid job_template_id")

            con.execute(
                "UPDATE jobs SET job_template_id=? WHERE job_id=?",
                [int(jt_id), int(job_id)],
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update job template: {e}")

    return {"ok": True, "job_id": int(job_id), "job_template_id": int(jt_id)}


@app.get("/jobs/{job_id}/sites")
def job_sites(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    with get_conn() as con:
        row = con.execute(
            "SELECT client_db_id FROM jobs WHERE job_id=?",
            [int(job_id)],
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    client_db_id = int(row[0])
    df = list_sites(client_db_id)

    sites: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        for _, r in df.iterrows():
            sites.append(
                {
                    "site_id": int(r.get("site_id")) if r.get("site_id") is not None else None,
                    "site_name": r.get("site_name"),
                    "location": r.get("location"),
                    "is_registered_office": bool(r.get("is_registered_office")) if r.get("is_registered_office") is not None else False,
                }
            )

    return {"job_id": int(job_id), "client_db_id": client_db_id, "sites": sites}


@app.get("/datasets")
def list_datasets(_user: dict[str, str] = Depends(_current_user)):
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT dataset_id, name, source, analysis_type, country, region,
                       currency, year, version
                FROM datasets
                ORDER BY dataset_id DESC
                """
            ).df()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/datasets failed: {e}")

    items: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        for _, r in df.iterrows():
            items.append(
                {
                    "dataset_id": int(r.get("dataset_id")),
                    "name": r.get("name"),
                    "source": r.get("source"),
                    "analysis_type": r.get("analysis_type"),
                    "country": r.get("country"),
                    "region": r.get("region"),
                    "currency": r.get("currency"),
                    "year": (int(r.get("year")) if r.get("year") is not None else None),
                    "version": r.get("version"),
                }
            )

    return {"items": items}


@app.get("/jobs/{job_id}/scope-config")
def get_job_scope_config(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    try:
        with get_conn() as con:
            exists_job = con.execute("SELECT 1 FROM jobs WHERE job_id=?", [int(job_id)]).fetchone()
            if not exists_job:
                raise HTTPException(status_code=404, detail="Job not found")

            df = con.execute(
                """
                SELECT scope, include_scope, dataset_id, factor_method
                FROM job_scope_config
                WHERE job_id=?
                ORDER BY scope
                """,
                [int(job_id)],
            ).df()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load scope config: {e}")

    items: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        for _, r in df.iterrows():
            items.append(
                {
                    "scope": r.get("scope"),
                    "include_scope": bool(r.get("include_scope")) if r.get("include_scope") is not None else True,
                    "dataset_id": (int(r.get("dataset_id")) if r.get("dataset_id") is not None and str(r.get("dataset_id")) != "nan" else None),
                    "factor_method": r.get("factor_method"),
                }
            )

    return {"job_id": int(job_id), "items": items}


@app.put("/jobs/{job_id}/scope-config")
def update_job_scope_config(
    job_id: int,
    payload: dict[str, object] = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise HTTPException(status_code=400, detail="items must be a list")

    allowed_scopes = {"Scope 1", "Scope 2", "Scope 3"}
    updates: list[tuple[str, int | None, bool | None, str | None]] = []
    for it in raw_items:
        if not isinstance(it, dict):
            continue
        scope = str(it.get("scope") or "").strip()
        if scope not in allowed_scopes:
            continue

        ds_raw = it.get("dataset_id")
        dsid: int | None
        if ds_raw is None or str(ds_raw).strip() == "" or str(ds_raw).strip().lower() in ("none", "null"):
            dsid = None
        else:
            try:
                dsid = int(ds_raw)
            except Exception:
                raise HTTPException(status_code=400, detail=f"Invalid dataset_id for {scope}")

        inc_raw = it.get("include_scope")
        include_scope: bool | None
        if inc_raw is None:
            include_scope = None
        else:
            include_scope = bool(inc_raw)

        fm_raw = it.get("factor_method")
        factor_method: str | None = str(fm_raw).strip() if fm_raw is not None and str(fm_raw).strip() else None
        updates.append((scope, dsid, include_scope, factor_method))

    if not updates:
        raise HTTPException(status_code=400, detail="No valid scope config items")

    try:
        with get_conn() as con:
            exists_job = con.execute("SELECT 1 FROM jobs WHERE job_id=?", [int(job_id)]).fetchone()
            if not exists_job:
                raise HTTPException(status_code=404, detail="Job not found")

            # Ensure rows exist
            for scope in allowed_scopes:
                con.execute(
                    """
                    INSERT INTO job_scope_config (job_id, scope, include_scope, dataset_id, factor_method)
                    VALUES (?, ?, TRUE, NULL, NULL)
                    ON CONFLICT (job_id, scope) DO NOTHING
                    """,
                    [int(job_id), scope],
                )

            for scope, dsid, include_scope, factor_method in updates:
                if include_scope is None and factor_method is None:
                    con.execute(
                        "UPDATE job_scope_config SET dataset_id=? WHERE job_id=? AND scope=?",
                        [dsid, int(job_id), scope],
                    )
                else:
                    con.execute(
                        """
                        UPDATE job_scope_config
                        SET dataset_id=?,
                            include_scope=COALESCE(?, include_scope),
                            factor_method=COALESCE(?, factor_method)
                        WHERE job_id=? AND scope=?
                        """,
                        [dsid, include_scope, factor_method, int(job_id), scope],
                    )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update scope config: {e}")

    return {"ok": True, "job_id": int(job_id)}


@app.post("/jobs/{job_id}/excel-import")
def job_excel_import(
    job_id: int,
    payload: dict[str, object] = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    site_id_raw = payload.get("site_id")
    rows_ready = payload.get("rows_ready")

    if site_id_raw is None:
        raise HTTPException(status_code=400, detail="site_id is required")
    try:
        site_id = int(site_id_raw)
    except Exception:
        raise HTTPException(status_code=400, detail="site_id must be an integer")

    if not isinstance(rows_ready, list):
        raise HTTPException(status_code=400, detail="rows_ready must be a list")
    if not rows_ready:
        raise HTTPException(status_code=400, detail="rows_ready is empty")

    inserted = 0
    updated = 0

    try:
        with get_conn() as con:
            job_row = con.execute("SELECT client_db_id FROM jobs WHERE job_id=?", [int(job_id)]).fetchone()
            if not job_row:
                raise HTTPException(status_code=404, detail="Job not found")
            client_db_id = int(job_row[0])

            site_ok = con.execute(
                "SELECT 1 FROM client_sites WHERE site_id=? AND client_db_id=?",
                [int(site_id), int(client_db_id)],
            ).fetchone()
            if not site_ok:
                raise HTTPException(status_code=400, detail="site_id does not belong to this job's client")

            for r in rows_ready:
                if not isinstance(r, dict):
                    continue

                scope = str(r.get("scope") or "").strip()
                original_id = str(r.get("original_id") or "").strip()
                if not scope or not original_id:
                    continue

                dataset_id = r.get("dataset_id")
                factor_db_id = r.get("db_id")
                if dataset_id is None or factor_db_id is None:
                    continue

                qty = r.get("qty")
                uom = r.get("uom")
                factor = r.get("factor")
                ghg_unit = r.get("ghg_unit")
                calc_tco2e = r.get("calc_tco2e")

                level_1 = r.get("level_1")
                level_2 = r.get("level_2")
                level_3 = r.get("level_3")
                level_4 = r.get("level_4")
                column_text = r.get("column_text")

                exists = con.execute(
                    """
                    SELECT row_id
                    FROM job_scope_rows
                    WHERE job_id=? AND site_id=? AND scope=? AND original_id=?
                    LIMIT 1
                    """,
                    [int(job_id), int(site_id), str(scope), str(original_id)],
                ).fetchone()

                if exists:
                    con.execute(
                        """
                        UPDATE job_scope_rows
                        SET enabled=TRUE,
                            dataset_id=?,
                            factor_db_id=?,
                            qty=?,
                            uom=?,
                            factor=?,
                            ghg_unit=?,
                            calc_tco2e=?,
                            level_1=?,
                            level_2=?,
                            level_3=?,
                            level_4=?,
                            column_text=?,
                            updated_at=NOW()
                        WHERE row_id=?
                        """,
                        [
                            int(dataset_id),
                            int(factor_db_id),
                            float(qty) if qty is not None else None,
                            (str(uom).strip() if uom is not None else None),
                            float(factor) if factor is not None else None,
                            (str(ghg_unit).strip() if ghg_unit is not None else None),
                            float(calc_tco2e) if calc_tco2e is not None else None,
                            (str(level_1).strip() if level_1 is not None else None),
                            (str(level_2).strip() if level_2 is not None else None),
                            (str(level_3).strip() if level_3 is not None else None),
                            (str(level_4).strip() if level_4 is not None else None),
                            (str(column_text).strip() if column_text is not None else None),
                            int(exists[0]),
                        ],
                    )
                    updated += 1
                else:
                    con.execute(
                        """
                        INSERT INTO job_scope_rows
                          (job_id, site_id, scope, dataset_id, factor_db_id, original_id,
                           level_1, level_2, level_3, level_4, column_text,
                           report_label, notes, enabled,
                           qty, uom, factor, ghg_unit,
                           calc_tco2e, override_tco2e, override_reason,
                           created_at, updated_at)
                        VALUES
                          (?, ?, ?, ?, ?, ?,
                           ?, ?, ?, ?, ?,
                           NULL, NULL, TRUE,
                           ?, ?, ?, ?,
                           ?, NULL, NULL,
                           NOW(), NOW())
                        """,
                        [
                            int(job_id),
                            int(site_id),
                            str(scope),
                            int(dataset_id),
                            int(factor_db_id),
                            str(original_id),
                            (str(level_1).strip() if level_1 is not None else None),
                            (str(level_2).strip() if level_2 is not None else None),
                            (str(level_3).strip() if level_3 is not None else None),
                            (str(level_4).strip() if level_4 is not None else None),
                            (str(column_text).strip() if column_text is not None else None),
                            float(qty) if qty is not None else None,
                            (str(uom).strip() if uom is not None else None),
                            float(factor) if factor is not None else None,
                            (str(ghg_unit).strip() if ghg_unit is not None else None),
                            float(calc_tco2e) if calc_tco2e is not None else None,
                        ],
                    )
                    inserted += 1
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import rows: {e}")

    return {"ok": True, "job_id": int(job_id), "site_id": int(site_id), "inserted": int(inserted), "updated": int(updated)}


@app.get("/jobs/{job_id}/excel-template")
def job_excel_template(
    job_id: int,
    site: str = Query(..., min_length=1),
    include_prev_year: bool = Query(True),
    template_format: str = Query("single", regex="^(single|multi)$"),
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        if template_format == "single":
            from nzi_pages.generate_single_sheet_template import generate_single_sheet_template
            
            # Get job details for metadata
            with get_conn() as con:
                job_row = con.execute(
                    "SELECT job_number, title, reporting_year FROM jobs WHERE job_id = ?",
                    [job_id]
                ).fetchone()
                
                client_row = con.execute(
                    """
                    SELECT c.client_name 
                    FROM clients c
                    JOIN jobs j ON j.client_db_id = c.client_db_id
                    WHERE j.job_id = ?
                    """,
                    [job_id]
                ).fetchone()
            
            job_number = job_row[0] if job_row else ""
            client_name = client_row[0] if client_row else ""
            
            data, filename = generate_single_sheet_template(
                job_id=int(job_id),
                client_name=client_name,
                site_name=site,
                job_number=job_number,
                report_from="",
                report_to="",
                include_custom_factors=True
            )
        else:
            # Legacy multi-sheet template
            paths = _job_template_paths(int(job_id))
            os.environ["NZI_EXCEL_TEMPLATE_PATH"] = str(paths.get("excel_template_path") or "")
            data, filename = build_excel_template_bytes(
                job_id=int(job_id),
                selected_site=str(site),
                include_prev_year=bool(include_prev_year),
            )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build template: {e}")

    headers = {"Content-Disposition": f"attachment; filename=\"{filename}\""}
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@app.post("/jobs/{job_id}/excel-upload")
async def job_excel_upload(
    job_id: int,
    file: UploadFile = File(...),
    _user: dict[str, str] = Depends(_current_user),
):
    from api.parse_single_sheet_upload import is_single_sheet_format, parse_single_sheet_upload
    
    paths = _job_template_paths(int(job_id))
    filename = (file.filename or "").strip()
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    errors: list[str] = []
    warnings: list[str] = []
    details: dict[str, object] = {
        "filename": filename,
        "size_bytes": int(len(raw)),
        "job_id": int(job_id),
        "job_excel_template_path": paths.get("excel_template_path"),
    }

    try:
        wb = load_workbook(io.BytesIO(raw), data_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid xlsx file: {e}")

    details["sheets"] = list(wb.sheetnames)
    
    # Detect format and route to appropriate parser
    if is_single_sheet_format(wb):
        details["template_format"] = "single-sheet"
        
        # Get dataset configuration
        ds_map: dict[str, int] = {}
        try:
            with get_conn() as con:
                df_scopes = con.execute(
                    "SELECT scope, dataset_id FROM job_scope_config WHERE job_id=?",
                    [int(job_id)],
                ).df()
            if df_scopes is not None and (not df_scopes.empty):
                for _, rr in df_scopes.iterrows():
                    scope = str(rr.get("scope") or "").strip()
                    dsid = rr.get("dataset_id")
                    if scope and dsid is not None and str(dsid) != "nan":
                        ds_map[scope] = int(dsid)
        except Exception as e:
            warnings.append(f"Could not read job_scope_config: {e}")
        
        details["datasets_by_scope"] = ds_map
        
        # Parse single-sheet format
        rows_ready, parse_errors, parse_warnings, parse_details = parse_single_sheet_upload(
            raw, int(job_id), ds_map
        )
        
        errors.extend(parse_errors)
        warnings.extend(parse_warnings)
        details.update(parse_details)
        
        details["rows_ready_count"] = len(rows_ready)
        
        if rows_ready:
            details["rows_ready"] = rows_ready[:10]  # Preview first 10
        
        return {
            "ok": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "details": details,
            "rows_ready": rows_ready if len(errors) == 0 else []
        }
    
    # Otherwise, use legacy multi-sheet parser
    details["template_format"] = "multi-sheet"

    def _norm_scope(sheet_name: str) -> str | None:
        s = (sheet_name or "").strip().lower()
        if "scope 1" in s:
            return "Scope 1"
        if "scope 2" in s:
            return "Scope 2"
        if "scope 3" in s:
            return "Scope 3"
        return None

    scopes_present: set[str] = set()
    for name in wb.sheetnames:
        sn = _norm_scope(name)
        if sn:
            scopes_present.add(sn)

    for s in ["Scope 1", "Scope 2", "Scope 3"]:
        if s not in scopes_present:
            errors.append(f"Missing required scope sheets for: {s}")

    # Basic marker validation against any scope sheet
    for sheet_name in wb.sheetnames:
        scope_name = _norm_scope(sheet_name)
        if scope_name is None:
            continue
        ws = wb[sheet_name]
        a1 = (ws["A1"].value or "")
        a2 = (ws["A2"].value or "")
        if "Site Name" not in str(a1):
            warnings.append(f"{sheet_name}: A1 is not 'Site Name:' marker")
        if "Data Files" not in str(a2):
            warnings.append(f"{sheet_name}: A2 is not 'Data Files:' marker")

    # Optional: core sheet if present
    if "Core Data" not in wb.sheetnames:
        warnings.append("Core Data sheet not found (template may be older)")

    def _find_table_header_row(ws):
        for r in range(1, 60):
            values = [ws.cell(row=r, column=c).value for c in range(1, 80)]
            norm = [str(x).strip().lower() if x is not None else "" for x in values]
            if "id" in norm and "qty" in norm:
                idx = {}
                for name in ("id", "qty", "apply"):
                    if name in norm:
                        idx[name] = norm.index(name) + 1
                return r, idx
        return None, None

    def _to_tco2e(qty: float, factor: float, ghg_unit: str | None) -> float:
        ghg = (str(ghg_unit or "kgCO2e").replace(" ", "").lower())
        emissions = float(qty) * float(factor)
        if ghg.startswith("kg"):
            return emissions / 1000.0
        return emissions

    def _factor_lookup_by_original_ids(dataset_id: int, scope_name: str, original_ids: list[str]) -> pd.DataFrame:
        original_ids = [str(x).strip() for x in (original_ids or []) if x is not None and str(x).strip()]
        if not original_ids:
            return pd.DataFrame()

        with get_conn() as con:
            if db_backend() == "postgres":
                sql = """
                    SELECT db_id, original_id, level_1, level_2, level_3, level_4,
                           column_text, uom, ghg_unit, factor
                    FROM factor_lookup
                    WHERE dataset_id=%s AND scope=%s AND original_id = ANY(%s)
                """
                return con.execute(sql, [int(dataset_id), str(scope_name), original_ids]).df()

            ph = ",".join(["?"] * len(original_ids))
            sql = f"""
                SELECT db_id, original_id, level_1, level_2, level_3, level_4,
                       column_text, uom, ghg_unit, factor
                FROM factor_lookup
                WHERE dataset_id=? AND scope=? AND original_id IN ({ph})
            """
            return con.execute(sql, [int(dataset_id), str(scope_name)] + original_ids).df()

    parsed_rows: list[dict[str, object]] = []
    for ws in wb.worksheets:
        scope_name = _norm_scope(ws.title)
        if scope_name is None:
            continue

        header_row, idx = _find_table_header_row(ws)
        if header_row is None or idx is None:
            continue

        id_col = idx.get("id")
        qty_col = idx.get("qty")
        apply_col = idx.get("apply")
        if not id_col or not qty_col:
            continue

        for r in range(header_row + 1, ws.max_row + 1):
            oid = ws.cell(row=r, column=id_col).value
            if oid is None or str(oid).strip() == "":
                continue

            qv = ws.cell(row=r, column=qty_col).value
            av = ws.cell(row=r, column=apply_col).value if apply_col else None

            if apply_col and av is not None:
                try:
                    if float(av) != 1.0:
                        continue
                except Exception:
                    if str(av).strip() not in ("1", "true", "True", "YES", "Yes"):
                        continue

            try:
                qty_val = float(qv) if qv is not None and str(qv).strip() != "" else None
            except Exception:
                qty_val = None

            if qty_val is None:
                continue

            parsed_rows.append({"scope": scope_name, "original_id": str(oid).strip(), "qty": qty_val})

    details["parsed_row_count"] = int(len(parsed_rows))
    if not parsed_rows:
        errors.append("No rows found to import. Ensure you have filled 'Qty' and set 'Apply' to 1 where applicable.")

    ds_map: dict[str, int] = {}
    try:
        with get_conn() as con:
            df_scopes = con.execute(
                """
                SELECT scope, dataset_id
                FROM job_scope_config
                WHERE job_id=?
                """,
                [int(job_id)],
            ).df()
        if df_scopes is not None and (not df_scopes.empty):
            for _, rr in df_scopes.iterrows():
                scope = str(rr.get("scope") or "").strip()
                dsid = rr.get("dataset_id")
                if scope and dsid is not None and str(dsid) != "nan":
                    ds_map[scope] = int(dsid)
    except Exception as e:
        warnings.append(f"Could not read job_scope_config: {e}")

    details["datasets_by_scope"] = ds_map

    rows_ready: list[dict[str, object]] = []
    missing_ids: dict[str, list[str]] = {}

    for scope_name in ["Scope 1", "Scope 2", "Scope 3"]:
        scope_rows = [r for r in parsed_rows if r.get("scope") == scope_name]
        if not scope_rows:
            continue

        dsid = ds_map.get(scope_name)
        if dsid is None:
            errors.append(f"{scope_name}: no dataset selected in Job Folder → Data Collection.")
            continue

        ids = [str(r.get("original_id") or "").strip() for r in scope_rows]
        fdf = _factor_lookup_by_original_ids(int(dsid), scope_name, ids)
        if fdf is None or fdf.empty:
            errors.append(f"{scope_name}: none of the uploaded IDs matched factor_lookup for dataset {int(dsid)}.")
            continue

        factor_by_id: dict[str, dict[str, object]] = {}
        for _, fr in fdf.iterrows():
            oid = str(fr.get("original_id") or "").strip()
            if not oid:
                continue
            factor_by_id[oid] = {
                "db_id": int(fr.get("db_id")) if fr.get("db_id") is not None and str(fr.get("db_id")) != "nan" else None,
                "original_id": oid,
                "level_1": fr.get("level_1"),
                "level_2": fr.get("level_2"),
                "level_3": fr.get("level_3"),
                "level_4": fr.get("level_4"),
                "column_text": fr.get("column_text"),
                "uom": fr.get("uom"),
                "ghg_unit": fr.get("ghg_unit"),
                "factor": float(fr.get("factor")) if fr.get("factor") is not None and str(fr.get("factor")) != "nan" else None,
            }

        missing = [oid for oid in ids if oid not in factor_by_id]
        if missing:
            missing_ids[scope_name] = missing[:200]
            errors.append(f"{scope_name}: {len(missing)} IDs were not found in the selected dataset.")

        for r in scope_rows:
            oid = str(r.get("original_id") or "").strip()
            qty_val = r.get("qty")
            if oid not in factor_by_id:
                continue
            f = factor_by_id[oid]
            if f.get("factor") is None:
                errors.append(f"{scope_name}: factor missing for ID {oid}.")
                continue

            calc = _to_tco2e(float(qty_val), float(f.get("factor")), f.get("ghg_unit"))
            rows_ready.append(
                {
                    "scope": scope_name,
                    "dataset_id": int(dsid),
                    "db_id": f.get("db_id"),
                    "original_id": oid,
                    "qty": float(qty_val),
                    "uom": f.get("uom"),
                    "ghg_unit": f.get("ghg_unit"),
                    "factor": f.get("factor"),
                    "calc_tco2e": float(calc),
                    "level_1": f.get("level_1"),
                    "level_2": f.get("level_2"),
                    "level_3": f.get("level_3"),
                    "level_4": f.get("level_4"),
                    "column_text": f.get("column_text"),
                }
            )

    details["rows_ready_count"] = int(len(rows_ready))

    ok = len(errors) == 0
    return {
        "ok": ok,
        "errors": errors,
        "warnings": warnings,
        "details": details,
        "missing_ids": missing_ids,
        "rows_ready": rows_ready,
    }


@app.post("/clients")
def create_client(body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    """Create a new client."""
    try:
        client_name = body.get("client_name", "").strip()
        if not client_name:
            raise HTTPException(status_code=400, detail="client_name is required")
        
        with get_conn() as con:
            row = con.execute(
                """
                INSERT INTO clients (
                    client_name, industry, description_long, website, year_end_month,
                    company_reg, headquarters, addr_line1, addr_line2, addr_city,
                    addr_region, addr_postcode, addr_country, logo_url, portfolio,
                    crm_owner, status, net_zero_year, benchmark_year,
                    target_s1_year, target_s1_pct, target_s2_year, target_s2_pct,
                    target_s3_year, target_s3_pct
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING db_id
                """,
                [
                    client_name,
                    body.get("industry"),
                    body.get("description_long"),
                    body.get("website"),
                    body.get("year_end_month"),
                    body.get("company_reg"),
                    body.get("headquarters"),
                    body.get("addr_line1"),
                    body.get("addr_line2"),
                    body.get("addr_city"),
                    body.get("addr_region"),
                    body.get("addr_postcode"),
                    body.get("addr_country"),
                    body.get("logo_url"),
                    body.get("portfolio"),
                    body.get("crm_owner"),
                    body.get("status", "Active"),
                    body.get("net_zero_year"),
                    body.get("benchmark_year"),
                    body.get("target_s1_year"),
                    body.get("target_s1_pct"),
                    body.get("target_s2_year"),
                    body.get("target_s2_pct"),
                    body.get("target_s3_year"),
                    body.get("target_s3_pct"),
                ],
            ).fetchone()
            
            return {"ok": True, "client_db_id": int(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create client: {e}")


@app.get("/clients")
def list_clients(
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _user: dict[str, str] = Depends(_current_user),
):
    query = (q or "").strip()

    where_sql = ""
    params: list[object] = []
    if query:
        if db_backend() == "postgres":
            where_sql = "WHERE (c.client_name ILIKE %s OR c.industry ILIKE %s)"
            like = f"%{query}%"
            params.extend([like, like])
        else:
            where_sql = "WHERE (lower(coalesce(c.client_name,'')) LIKE %s OR lower(coalesce(c.industry,'')) LIKE %s)"
            like = f"%{query.lower()}%"
            params.extend([like, like])

    try:
        with get_conn() as con:
            total_row = con.execute(
                f"""
                SELECT COUNT(*)
                FROM clients c
                {where_sql}
                """,
                params,
            ).fetchone()

            rows = (
                con.execute(
                    f"""
                    SELECT c.db_id as client_db_id,
                           c.client_name,
                           c.industry,
                           c.status,
                           c.crm_owner
                    FROM clients c
                    {where_sql}
                    ORDER BY c.db_id DESC
                    LIMIT %s OFFSET %s
                    """,
                    [*params, int(limit), int(offset)],
                )
                .df()
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/clients failed: {e}")

    items: list[dict[str, object]] = []
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            items.append(
                {
                    "client_db_id": int(r.get("client_db_id")),
                    "client_name": r.get("client_name"),
                    "industry": r.get("industry"),
                    "status": r.get("status"),
                    "crm_owner": r.get("crm_owner"),
                }
            )

    total = int(total_row[0] if total_row else 0)
    return {"items": items, "limit": int(limit), "offset": int(offset), "total": total}


@app.get("/clients/{client_db_id}")
def get_client(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    with get_conn() as con:
        row = con.execute(
            """
            SELECT c.db_id, c.client_name, c.industry, c.description_long, c.status, 
                   c.website, c.year_end_month, c.company_reg, c.headquarters,
                   c.addr_line1, c.addr_line2, c.addr_city, c.addr_region, 
                   c.addr_postcode, c.addr_country, c.logo_url, c.crm_owner,
                   c.net_zero_year, c.interim_year, c.interim_s1_pct, c.interim_s2_pct,
                   c.interim_s3_pct, c.portfolio, c.benchmark_year
            FROM clients c
            WHERE c.db_id=?
            """,
            [int(client_db_id)],
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Client not found")

    return {
        "client_db_id": int(row[0]),
        "client_name": row[1],
        "industry": row[2],
        "description_long": row[3],
        "status": row[4],
        "website": row[5],
        "year_end_month": row[6],
        "company_reg": row[7],
        "headquarters": row[8],
        "addr_line1": row[9],
        "addr_line2": row[10],
        "addr_city": row[11],
        "addr_region": row[12],
        "addr_postcode": row[13],
        "addr_country": row[14],
        "logo_url": row[15],
        "crm_owner": row[16],
        "net_zero_year": (int(row[17]) if row[17] is not None else None),
        "interim_year": (int(row[18]) if row[18] is not None else None),
        "interim_s1_pct": (int(row[19]) if row[19] is not None else None),
        "interim_s2_pct": (int(row[20]) if row[20] is not None else None),
        "interim_s3_pct": (int(row[21]) if row[21] is not None else None),
        "portfolio": row[22],
        "benchmark_year": (int(row[23]) if row[23] is not None else None),
    }


@app.patch("/clients/{client_db_id}")
def update_client(
    client_db_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update client information."""
    try:
        with get_conn() as con:
            # Check client exists
            exists = con.execute("SELECT 1 FROM clients WHERE db_id = ?", [int(client_db_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Client not found")
            
            # Build update query dynamically based on provided fields
            updates = []
            params = []
            
            field_mapping = {
                "client_name": "client_name",
                "industry": "industry",
                "description_long": "description_long",
                "website": "website",
                "year_end_month": "year_end_month",
                "company_reg": "company_reg",
                "headquarters": "headquarters",
                "addr_line1": "addr_line1",
                "addr_line2": "addr_line2",
                "addr_city": "addr_city",
                "addr_region": "addr_region",
                "addr_postcode": "addr_postcode",
                "addr_country": "addr_country",
                "logo_url": "logo_url",
                "crm_owner": "crm_owner",
                "status": "status",
                "net_zero_year": "net_zero_year",
                "interim_year": "interim_year",
                "interim_s1_pct": "interim_s1_pct",
                "interim_s2_pct": "interim_s2_pct",
                "interim_s3_pct": "interim_s3_pct",
                "portfolio": "portfolio",
                "benchmark_year": "benchmark_year",
            }
            
            for field_name, col_name in field_mapping.items():
                if field_name in body:
                    updates.append(f"{col_name} = ?")
                    params.append(body[field_name])
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(int(client_db_id))
            query = f"UPDATE clients SET {', '.join(updates)} WHERE db_id = ?"
            
            con.execute(query, params)
            
            return {"ok": True, "message": "Client updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


@app.get("/clients/{client_db_id}/sites")
def client_sites(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    df = list_sites(int(client_db_id))
    sites: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        for _, r in df.iterrows():
            sites.append(
                {
                    "site_name": r.get("site_name"),
                    "location": r.get("location"),
                    "is_registered_office": bool(r.get("is_registered_office")) if r.get("is_registered_office") is not None else False,
                }
            )
    return {"client_db_id": int(client_db_id), "sites": sites}


@app.get("/clients/{client_db_id}/jobs")
def client_jobs(
    client_db_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _user: dict[str, str] = Depends(_current_user),
):
    with get_conn() as con:
        total_row = con.execute(
            "SELECT COUNT(*) FROM jobs WHERE client_db_id=?",
            [int(client_db_id)],
        ).fetchone()

        rows = (
            con.execute(
                """
                SELECT job_id, job_number, title, reporting_year, status
                FROM jobs
                WHERE client_db_id=?
                ORDER BY job_id DESC
                LIMIT ? OFFSET ?
                """,
                [int(client_db_id), int(limit), int(offset)],
            )
            .df()
        )

    items: list[dict[str, object]] = []
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            items.append(
                {
                    "job_id": int(r.get("job_id")),
                    "job_number": r.get("job_number"),
                    "title": r.get("title"),
                    "reporting_year": (int(r.get("reporting_year")) if r.get("reporting_year") is not None else None),
                    "status": r.get("status"),
                }
            )

    total = int(total_row[0] if total_row else 0)
    return {"client_db_id": int(client_db_id), "items": items, "limit": int(limit), "offset": int(offset), "total": total}
