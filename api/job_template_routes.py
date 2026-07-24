from __future__ import annotations

import io
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse

from api.auth import _current_user
from api.job_template_helpers import (
    _job_template_assignment_audit_snapshot,
    _job_template_paths,
    _resolve_job_template_file_path,
    _seeded_job_template_fallbacks,
)
from core.database import get_conn
from services.audit_log import record_audit_event
from services.virus_scan import VirusScanError, scan_bytes

router = APIRouter()
@router.get("/job-templates")
def list_job_templates(
    include_archived: bool = Query(False),
    _user: dict[str, str] = Depends(_current_user),
):
    if not isinstance(include_archived, bool):
        include_archived = bool(getattr(include_archived, "default", False))
    try:
        with get_conn() as con:
            where_clause = "" if include_archived else "WHERE COALESCE(archived, FALSE) = FALSE"
            df = con.execute(
                f"""
                SELECT job_template_id, template_key, template_name,
                       template_type, file_path, excel_template_path, crp_template_path,
                       is_active, COALESCE(archived, FALSE) AS archived, archived_at, archived_by,
                       created_at, created_by,
                       original_filename,
                       CASE WHEN file_content IS NOT NULL THEN TRUE ELSE FALSE END AS has_db_content
                FROM job_templates
                {where_clause}
                ORDER BY template_type, template_key
                """
            ).df()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/job-templates failed: {e}")

    items: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        import numpy as np
        df = df.replace({np.nan: None})
        for _, row in df.iterrows():
            # Prefer original_filename (uploaded name) over path-derived name
            original_filename = row.get("original_filename")
            file_name = str(original_filename).strip() if original_filename else None
            if not file_name:
                for candidate in (
                    row.get("file_path"),
                    row.get("excel_template_path"),
                    row.get("crp_template_path"),
                ):
                    if candidate:
                        try:
                            file_name = Path(str(candidate)).name
                        except Exception:
                            file_name = str(candidate)
                        if file_name:
                            break
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
                    "archived": bool(row["archived"]) if row.get("archived") is not None else False,
                    "archived_at": row.get("archived_at"),
                    "archived_by": row.get("archived_by"),
                    "created_at": row.get("created_at"),
                    "created_by": row.get("created_by"),
                    "file_name": file_name,
                    "has_db_content": bool(row.get("has_db_content")),
                }
            )

    return {"items": items}


@router.get("/job-templates/{template_id}/download")
def download_job_template(template_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Download the template file for a job template."""
    import io
    from pathlib import Path

    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT
                    template_key,
                    template_name,
                    template_type,
                    file_path,
                    excel_template_path,
                    crp_template_path,
                    file_content,
                    original_filename
                FROM job_templates
                WHERE job_template_id = %s
                """,
                [int(template_id)],
            ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Template not found")

        template_key = str(row[0] or f"template_{template_id}")
        template_name = str(row[1] or "").strip()
        template_type = str(row[2] or "").strip().lower()
        file_content = row[6]
        original_filename = str(row[7] or "").strip() if row[7] else None

        # Serve from DB content if available (survives deploys)
        if file_content:
            content_bytes = bytes(file_content) if not isinstance(file_content, bytes) else file_content
            download_name = original_filename or f"{template_key}.xlsx"
            suffix = Path(download_name).suffix or (".xlsx" if template_type == "dataset" else ".docx")
            if not Path(download_name).suffix:
                download_name += suffix
            from fastapi.responses import StreamingResponse
            return StreamingResponse(
                io.BytesIO(content_bytes),
                media_type="application/octet-stream",
                headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
            )

        # Fall back to disk (seeded files committed to repo)
        candidate_paths = [row[3], row[4], row[5], *[str(p) for p in _seeded_job_template_fallbacks(template_key, template_type)]]
        file_path = None
        for candidate in candidate_paths:
            file_path = _resolve_job_template_file_path(candidate)
            if file_path is not None:
                break
        if file_path is None:
            raise HTTPException(status_code=404, detail="Template file not found")

        suffix = file_path.suffix or (".xlsx" if template_type == "dataset" else ".docx")
        preferred_name = template_name or template_key
        safe_name = "".join(ch if ch.isalnum() or ch in ("-", "_", " ") else "_" for ch in preferred_name).strip()
        download_name = f"{safe_name or template_key}{suffix}"

        return FileResponse(
            path=str(file_path),
            filename=download_name,
            media_type="application/octet-stream",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Template download failed: {e}")


@router.post("/job-templates")
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

        contents = await file.read()
        original_filename = file.filename or f"{template_key}.xlsx"
        try:
            scan_bytes(contents, filename=original_filename)
        except VirusScanError as e:
            raise HTTPException(status_code=400, detail=str(e))

        with get_conn() as con:
            # Check if template_key already exists
            exists = con.execute(
                "SELECT 1 FROM job_templates WHERE template_key = %s",
                [template_key]
            ).fetchone()

            if exists:
                raise HTTPException(status_code=400, detail="Template key already exists")

            creator = _user.get("email") or _user.get("name") or "system"
            row = con.execute(
                """
                INSERT INTO job_templates
                (template_key, template_name, template_type, file_path, file_content, original_filename, is_active, created_by, archived)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FALSE)
                RETURNING job_template_id
                """,
                [
                    template_key,
                    template_name or None,
                    template_type,
                    original_filename,
                    contents,
                    original_filename,
                    is_active.lower() == "true",
                    creator,
                ]
            ).fetchone()

            return {"ok": True, "job_template_id": int(row[0]), "file_path": original_filename}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Create failed: {e}")


@router.patch("/job-templates/{template_id}")
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
            template_row = con.execute(
                """
                SELECT
                    template_key,
                    template_type,
                    file_path,
                    excel_template_path,
                    crp_template_path
                FROM job_templates
                WHERE job_template_id = %s
                """,
                [int(template_id)]
            ).fetchone()
            
            if not template_row:
                raise HTTPException(status_code=404, detail="Template not found")

            current_template_key = str(template_row[0] or "").strip()
            current_template_type = str(template_row[1] or "").strip().lower()
            current_file_path = template_row[2]
            current_excel_path = template_row[3]
            current_crp_path = template_row[4]
            
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
                active_value = is_active.lower() == "true"
                updates.append("is_active = %s")
                params.append(active_value)
                if active_value:
                    updates.extend([
                        "archived = FALSE",
                        "archived_at = NULL",
                        "archived_by = NULL",
                    ])
                else:
                    updates.extend([
                        "archived = TRUE",
                        "archived_at = NOW()",
                        "archived_by = %s",
                    ])
                    params.append(_user.get("email") or _user.get("name") or "system")
            
            # Handle file upload if provided
            if file and file.filename:
                contents = await file.read()
                try:
                    scan_bytes(contents, filename=file.filename)
                except VirusScanError as e:
                    raise HTTPException(status_code=400, detail=str(e))
                original_filename = file.filename
                updates.append("file_path = %s")
                params.append(original_filename)
                updates.append("file_content = %s")
                params.append(contents)
                updates.append("original_filename = %s")
                params.append(original_filename)
            
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


@router.patch("/job-templates/{template_id}/archive")
def archive_job_template(
    template_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Archive or unarchive a job template."""
    try:
        with get_conn() as con:
            # Check template exists
            exists = con.execute(
                "SELECT 1 FROM job_templates WHERE job_template_id = %s",
                [int(template_id)]
            ).fetchone()
            
            if not exists:
                raise HTTPException(status_code=404, detail="Template not found")
            
            archived = body.get("archived", True)
            user_name = _user.get("email") or _user.get("name") or "system"
            
            if archived:
                con.execute(
                    """
                    UPDATE job_templates 
                    SET is_active = FALSE, archived = %s, archived_at = NOW(), archived_by = %s
                    WHERE job_template_id = %s
                    """,
                    [True, user_name, int(template_id)]
                )
            else:
                con.execute(
                    """
                    UPDATE job_templates 
                    SET is_active = TRUE, archived = %s, archived_at = NULL, archived_by = NULL
                    WHERE job_template_id = %s
                    """,
                    [False, int(template_id)]
                )
            
            return {"ok": True, "message": "Template archived successfully" if archived else "Template restored successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Archive failed: {e}")


@router.put("/jobs/{job_id}/job-template")
def update_job_template_assignment(
    request: Request,
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
            before = _job_template_assignment_audit_snapshot(con, int(job_id))
            exists_job = con.execute("SELECT 1 FROM jobs WHERE job_id=?", [int(job_id)]).fetchone()
            if not exists_job:
                raise HTTPException(status_code=404, detail="Job not found")

            tpl = con.execute(
                "SELECT job_template_id, template_name, template_key FROM job_templates WHERE job_template_id=? AND is_active=TRUE",
                [int(jt_id)],
            ).fetchone()
            if not tpl:
                raise HTTPException(status_code=400, detail="Invalid job_template_id")

            con.execute(
                "UPDATE jobs SET job_template_id=? WHERE job_id=?",
                [int(jt_id), int(job_id)],
            )
            after = _job_template_assignment_audit_snapshot(con, int(job_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="job_template_assignment",
                entity_id=int(job_id),
                job_id=int(job_id),
                before=before,
                after=after,
                metadata={
                    "job_template_id": int(jt_id),
                    "template_name": str(tpl[1]) if tpl[1] is not None else None,
                    "template_key": str(tpl[2]) if tpl[2] is not None else None,
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update job template: {e}")

    return {"ok": True, "job_id": int(job_id), "job_template_id": int(jt_id)}


