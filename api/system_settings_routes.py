import os
import shutil
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Body
from pydantic import BaseModel

from core.database import get_conn
from api.auth import _current_user

router = APIRouter(prefix="/system-settings", tags=["system-settings"])

# Resolve upload directory from project root (independent of process cwd)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = PROJECT_ROOT / "frontend" / "public" / "uploads" / "system"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

class SystemSetting(BaseModel):
    setting_id: int
    setting_key: str
    setting_value: Optional[str]
    setting_type: str
    description: Optional[str]
    updated_at: Optional[str]
    updated_by: Optional[str]

class UpdateSettingRequest(BaseModel):
    setting_value: str

@router.get("")
def get_all_settings(_user: dict = Depends(_current_user)):
    """Get all system settings"""
    with get_conn() as con:
        rows = con.execute("SELECT * FROM system_settings ORDER BY setting_key").fetchall()
        return {
            "items": [
                {
                    "setting_id": r[0],
                    "setting_key": r[1],
                    "setting_value": r[2],
                    "setting_type": r[3],
                    "description": r[4],
                    "updated_at": r[5].isoformat() if r[5] else None,
                    "updated_by": r[6],
                }
                for r in rows
            ]
        }

@router.get("/{setting_key}")
def get_setting(setting_key: str):
    """Get a specific setting by key (public endpoint for logo filename)"""
    with get_conn() as con:
        row = con.execute(
            "SELECT * FROM system_settings WHERE setting_key = %s",
            [setting_key]
        ).fetchone()
        
        if not row:
            return {"setting_key": setting_key, "setting_value": None}
        
        return {
            "setting_id": row[0],
            "setting_key": row[1],
            "setting_value": row[2],
            "setting_type": row[3],
            "description": row[4],
            "updated_at": row[5].isoformat() if row[5] else None,
            "updated_by": row[6],
        }

@router.post("/{setting_key}")
def update_setting(
    setting_key: str,
    body: UpdateSettingRequest,
    _user: dict = Depends(_current_user)
):
    """Update or create a setting"""
    with get_conn() as con:
        # Check if setting exists
        existing = con.execute(
            "SELECT setting_id FROM system_settings WHERE setting_key = %s",
            [setting_key]
        ).fetchone()
        
        if existing:
            # Update existing
            con.execute(
                """
                UPDATE system_settings 
                SET setting_value = %s, updated_at = CURRENT_TIMESTAMP, updated_by = %s
                WHERE setting_key = %s
                """,
                [body.setting_value, _user.get("email", "unknown"), setting_key]
            )
        else:
            # Create new
            con.execute(
                """
                INSERT INTO system_settings (setting_key, setting_value, updated_by)
                VALUES (%s, %s, %s)
                """,
                [setting_key, body.setting_value, _user.get("email", "unknown")]
            )
        
        return {"ok": True, "message": "Setting updated successfully"}

@router.post("/upload/nzi-logo")
async def upload_nzi_logo(
    file: UploadFile = File(...),
    _user: dict = Depends(_current_user)
):
    """Upload NZI logo"""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Get file extension
    ext = Path(file.filename or "logo.png").suffix
    if not ext:
        ext = ".png"
    
    # Save file
    filename = f"nzi-logo{ext}"
    file_path = UPLOAD_DIR / filename
    
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Update database setting
    with get_conn() as con:
        # Check if setting exists
        existing = con.execute(
            "SELECT setting_id FROM system_settings WHERE setting_key = 'nzi_logo_file'"
        ).fetchone()
        
        if existing:
            con.execute(
                """
                UPDATE system_settings 
                SET setting_value = %s, updated_at = CURRENT_TIMESTAMP, updated_by = %s
                WHERE setting_key = 'nzi_logo_file'
                """,
                [filename, _user.get("email", "unknown")]
            )
        else:
            con.execute(
                """
                INSERT INTO system_settings (setting_key, setting_value, setting_type, description, updated_by)
                VALUES (%s, %s, %s, %s, %s)
                """,
                ["nzi_logo_file", filename, "file", "Net Zero International logo file", _user.get("email", "unknown")]
            )
    
    return {
        "ok": True,
        "message": "NZI logo uploaded successfully",
        "filename": filename,
        "url": f"/uploads/system/{filename}"
    }

@router.delete("/upload/nzi-logo")
def delete_nzi_logo(_user: dict = Depends(_current_user)):
    """Delete NZI logo"""
    with get_conn() as con:
        # Get current filename
        row = con.execute(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'nzi_logo_file'"
        ).fetchone()
        
        if row and row[0]:
            # Delete file
            file_path = UPLOAD_DIR / row[0]
            if file_path.exists():
                file_path.unlink()
            
            # Delete database record
            con.execute("DELETE FROM system_settings WHERE setting_key = 'nzi_logo_file'")
        
        return {"ok": True, "message": "NZI logo deleted successfully"}
