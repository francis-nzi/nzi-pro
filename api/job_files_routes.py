"""
Job Files API Routes
Handles file uploads and management for jobs (client documents and generated reports).
"""

import io
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from core.database import get_conn
from api.auth import _current_user

router = APIRouter()

# Configure upload directory
UPLOAD_DIR = Path("uploads/job_files")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _save_uploaded_file(file: UploadFile, job_id: int) -> tuple[str, int, str]:
    """Save an uploaded file and return (file_path, file_size, mime_type)."""
    # Read file contents
    contents = file.file.read()
    file_size = len(contents)
    
    # Determine mime type from filename
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    mime_types = {
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".csv": "text/csv",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".zip": "application/zip",
    }
    mime_type = mime_types.get(ext, "application/octet-stream")
    
    # Create safe filename
    safe_name = f"{job_id}_{filename}"
    file_path = UPLOAD_DIR / safe_name
    
    # Write file
    with open(file_path, "wb") as f:
        f.write(contents)
    
    return str(file_path), file_size, mime_type


@router.get("/jobs/{job_id}/files")
def list_job_files(
    job_id: int,
    file_type: Optional[str] = Query(None, description="Filter by file_type: 'client_provided' or 'generated_report'"),
    row_id: Optional[int] = Query(None, description="Filter by linked row_id"),
    _user: dict[str, str] = Depends(_current_user)
):
    """List all files for a job."""
    try:
        with get_conn() as con:
            # Verify job exists
            job_exists = con.execute(
                "SELECT 1 FROM jobs WHERE job_id = %s",
                [int(job_id)]
            ).fetchone()
            
            if not job_exists:
                raise HTTPException(status_code=404, detail="Job not found")
            
            # Build query
            query = """
                SELECT file_id, job_id, row_id, file_type, file_name, file_path, 
                       file_size, mime_type, description, uploaded_by, uploaded_at
                FROM job_files
                WHERE job_id = %s
            """
            params = [int(job_id)]
            
            if file_type:
                query += " AND file_type = %s"
                params.append(file_type)
            
            if row_id is not None:
                query += " AND row_id = %s"
                params.append(row_id)
            
            query += " ORDER BY uploaded_at DESC"
            
            df = con.execute(query, params).df()
            
        files = []
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                files.append({
                    "file_id": int(row["file_id"]),
                    "job_id": int(row["job_id"]),
                    "row_id": int(row["row_id"]) if row["row_id"] is not None else None,
                    "file_type": row["file_type"],
                    "file_name": row["file_name"],
                    "file_path": row["file_path"],
                    "file_size": int(row["file_size"]) if row["file_size"] is not None else None,
                    "mime_type": row["mime_type"],
                    "description": row["description"],
                    "uploaded_by": row["uploaded_by"],
                    "uploaded_at": str(row["uploaded_at"]) if row["uploaded_at"] else None,
                })
        
        return {"job_id": int(job_id), "files": files}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list files: {e}")


@router.post("/jobs/{job_id}/files")
async def upload_job_file(
    job_id: int,
    file: UploadFile = File(...),
    file_type: str = Query("client_provided", description="File type: 'client_provided' or 'generated_report'"),
    row_id: Optional[int] = Query(None, description="Link to job_scope_rows row_id"),
    description: str = Query("", description="File description"),
    _user: dict[str, str] = Depends(_current_user)
):
    """Upload a file for a job."""
    try:
        # Validate file_type
        if file_type not in ["client_provided", "generated_report"]:
            raise HTTPException(status_code=400, detail="file_type must be 'client_provided' or 'generated_report'")
        
        # Validate job exists
        with get_conn() as con:
            job_exists = con.execute(
                "SELECT 1 FROM jobs WHERE job_id = %s",
                [int(job_id)]
            ).fetchone()
            
            if not job_exists:
                raise HTTPException(status_code=404, detail="Job not found")
            
            # If row_id provided, verify it belongs to this job
            if row_id is not None:
                row_exists = con.execute(
                    "SELECT 1 FROM job_scope_rows WHERE row_id = %s AND job_id = %s",
                    [int(row_id), int(job_id)]
                ).fetchone()
                
                if not row_exists:
                    raise HTTPException(status_code=400, detail="row_id does not belong to this job")
        
        # Save file
        file_path, file_size, mime_type = _save_uploaded_file(file, int(job_id))
        
        # Save to database
        with get_conn() as con:
            result = con.execute(
                """
                INSERT INTO job_files 
                (job_id, row_id, file_type, file_name, file_path, file_size, mime_type, description, uploaded_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING file_id
                """,
                [
                    int(job_id),
                    row_id,
                    file_type,
                    file.filename or "unknown",
                    file_path,
                    file_size,
                    mime_type,
                    description,
                    _user.get("email", "unknown")
                ]
            ).fetchone()
            
            file_id = int(result[0])
        
        return {
            "ok": True,
            "file_id": file_id,
            "file_name": file.filename,
            "file_type": file_type,
            "row_id": row_id,
            "message": "File uploaded successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {e}")


@router.patch("/jobs/{job_id}/files/{file_id}")
def update_job_file(
    job_id: int,
    file_id: int,
    row_id: Optional[int] = Body(None),
    description: Optional[str] = Body(None),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update file metadata (link to row_id, update description)."""
    try:
        with get_conn() as con:
            # Verify file exists and belongs to job
            file_exists = con.execute(
                "SELECT 1 FROM job_files WHERE file_id = %s AND job_id = %s",
                [int(file_id), int(job_id)]
            ).fetchone()
            
            if not file_exists:
                raise HTTPException(status_code=404, detail="File not found")
            
            # If row_id provided, verify it belongs to this job
            if row_id is not None:
                row_exists = con.execute(
                    "SELECT 1 FROM job_scope_rows WHERE row_id = %s AND job_id = %s",
                    [int(row_id), int(job_id)]
                ).fetchone()
                
                if not row_exists:
                    raise HTTPException(status_code=400, detail="row_id does not belong to this job")
            
            # Build update query
            updates = []
            params = []
            
            if row_id is not None:
                updates.append("row_id = %s")
                params.append(int(row_id))
            
            if description is not None:
                updates.append("description = %s")
                params.append(description)
            
            if not updates:
                return {"ok": True, "message": "No changes to update"}
            
            params.extend([int(file_id), int(job_id)])
            query = f"UPDATE job_files SET {', '.join(updates)} WHERE file_id = %s AND job_id = %s"
            
            con.execute(query, params)
        
        return {"ok": True, "message": "File updated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update file: {e}")


@router.delete("/jobs/{job_id}/files/{file_id}")
def delete_job_file(
    job_id: int,
    file_id: int,
    _user: dict[str, str] = Depends(_current_user)
):
    """Delete a file."""
    try:
        with get_conn() as con:
            # Get file path
            file_row = con.execute(
                "SELECT file_path FROM job_files WHERE file_id = %s AND job_id = %s",
                [int(file_id), int(job_id)]
            ).fetchone()
            
            if not file_row:
                raise HTTPException(status_code=404, detail="File not found")
            
            file_path = file_row[0]
            
            # Delete from database
            con.execute(
                "DELETE FROM job_files WHERE file_id = %s AND job_id = %s",
                [int(file_id), int(job_id)]
            )
            
            # Delete physical file if exists
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception:
                    pass  # Best effort
        
        return {"ok": True, "message": "File deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {e}")


@router.get("/jobs/{job_id}/files/{file_id}/download")
def download_job_file(
    job_id: int,
    file_id: int,
    _user: dict[str, str] = Depends(_current_user)
):
    """Download a file."""
    from fastapi.responses import FileResponse
    
    try:
        with get_conn() as con:
            file_row = con.execute(
                "SELECT file_name, file_path FROM job_files WHERE file_id = %s AND job_id = %s",
                [int(file_id), int(job_id)]
            ).fetchone()
            
            if not file_row:
                raise HTTPException(status_code=404, detail="File not found")
            
            file_name = file_row[0]
            file_path = file_row[1]
            
            if not file_path or not os.path.exists(file_path):
                raise HTTPException(status_code=404, detail="File not found on disk")
        
        return FileResponse(
            path=file_path,
            filename=file_name,
            media_type="application/octet-stream"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download file: {e}")
