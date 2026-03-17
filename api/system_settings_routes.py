import base64
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Body
from fastapi.responses import Response
from pydantic import BaseModel

from core.database import get_conn
from api.auth import _current_user
from services.company_profile import (
    COMPANY_PROFILE_DEFAULTS,
    company_profile_metadata,
    get_company_profile,
)

router = APIRouter(prefix="/system-settings", tags=["system-settings"])

# Resolve upload directory from project root (independent of process cwd)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = PROJECT_ROOT / "frontend" / "public" / "uploads" / "system"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

LOGO_FILE_KEY = "nzi_logo_file"
LOGO_B64_KEY = "nzi_logo_b64"
LOGO_MIME_KEY = "nzi_logo_mime"

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


class BulkUpdateSettingsRequest(BaseModel):
    settings: dict[str, str | None]


def _upsert_setting(
    con,
    *,
    key: str,
    value: str | None,
    updated_by: str,
    setting_type: str = "text",
    description: str | None = None,
) -> None:
    existing = con.execute(
        "SELECT setting_id FROM system_settings WHERE setting_key = %s",
        [key],
    ).fetchone()
    if existing:
        con.execute(
            """
            UPDATE system_settings
            SET setting_value = %s, setting_type = %s, updated_at = CURRENT_TIMESTAMP, updated_by = %s
            WHERE setting_key = %s
            """,
            [value, setting_type, updated_by, key],
        )
        return
    con.execute(
        """
        INSERT INTO system_settings (setting_key, setting_value, setting_type, description, updated_by)
        VALUES (%s, %s, %s, %s, %s)
        """,
        [key, value, setting_type, description, updated_by],
    )

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

@router.get("/profile")
def get_company_profile_settings():
    """Public company profile used for documents and public legal pages."""
    with get_conn() as con:
        profile = get_company_profile(con)
    return {
        "profile": profile,
        "fields": company_profile_metadata(),
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


@router.get("/logo/file")
def get_nzi_logo():
    """Get NZI logo bytes, with DB fallback for redeploy-safe persistence."""
    filename = None
    logo_b64 = None
    mime = None
    with get_conn() as con:
        rows = con.execute(
            """
            SELECT setting_key, setting_value
            FROM system_settings
            WHERE setting_key IN (%s, %s, %s)
            """,
            [LOGO_FILE_KEY, LOGO_B64_KEY, LOGO_MIME_KEY],
        ).fetchall()
        values = {str(r[0] or ""): r[1] for r in rows}
        filename = values.get(LOGO_FILE_KEY)
        logo_b64 = values.get(LOGO_B64_KEY)
        mime = str(values.get(LOGO_MIME_KEY) or "").strip() or "image/png"

    if filename:
        file_path = UPLOAD_DIR / str(filename)
        if file_path.exists():
            return Response(content=file_path.read_bytes(), media_type=mime)

    if logo_b64:
        try:
            decoded = base64.b64decode(str(logo_b64), validate=True)
            if decoded:
                return Response(content=decoded, media_type=mime)
        except Exception:
            pass

    raise HTTPException(status_code=404, detail="NZI logo not found")

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


@router.post("/bulk")
def bulk_update_settings(
    body: BulkUpdateSettingsRequest,
    _user: dict = Depends(_current_user),
):
    """Bulk upsert of global system settings."""
    actor = _user.get("email", "unknown")
    updates = body.settings or {}
    if not isinstance(updates, dict):
        raise HTTPException(status_code=400, detail="settings must be an object")

    with get_conn() as con:
        for key, value in updates.items():
            setting_key = str(key or "").strip()
            if not setting_key:
                continue
            setting_value = None if value is None else str(value)
            description = None
            default_meta = next((item for item in company_profile_metadata() if item["key"] == setting_key), None)
            if default_meta:
                description = default_meta.get("description")
            _upsert_setting(
                con,
                key=setting_key,
                value=setting_value,
                setting_type="text",
                description=description,
                updated_by=actor,
            )
        profile = get_company_profile(con)

    return {"ok": True, "profile": profile}

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

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(raw) > (5 * 1024 * 1024):
        raise HTTPException(status_code=400, detail="Logo exceeds 5MB limit")

    # Save file (best effort for local/dev convenience)
    filename = f"nzi-logo{ext}"
    file_path = UPLOAD_DIR / filename
    try:
        with file_path.open("wb") as buffer:
            buffer.write(raw)
    except Exception:
        pass

    # Update database settings (durable across redeploys)
    actor = _user.get("email", "unknown")
    logo_b64 = base64.b64encode(raw).decode("ascii")
    with get_conn() as con:
        _upsert_setting(
            con,
            key=LOGO_FILE_KEY,
            value=filename,
            setting_type="file",
            description="Net Zero International logo file",
            updated_by=actor,
        )
        _upsert_setting(
            con,
            key=LOGO_B64_KEY,
            value=logo_b64,
            setting_type="text",
            description="Net Zero International logo image bytes (base64)",
            updated_by=actor,
        )
        _upsert_setting(
            con,
            key=LOGO_MIME_KEY,
            value=str(file.content_type or "image/png"),
            setting_type="text",
            description="Net Zero International logo MIME type",
            updated_by=actor,
        )

    return {
        "ok": True,
        "message": "NZI logo uploaded successfully",
        "filename": filename,
        "url": "/system-settings/logo"
    }

@router.delete("/upload/nzi-logo")
def delete_nzi_logo(_user: dict = Depends(_current_user)):
    """Delete NZI logo"""
    with get_conn() as con:
        # Get current filename
        row = con.execute(
            "SELECT setting_value FROM system_settings WHERE setting_key = %s",
            [LOGO_FILE_KEY],
        ).fetchone()
        
        if row and row[0]:
            # Delete file
            file_path = UPLOAD_DIR / row[0]
            if file_path.exists():
                file_path.unlink()
            
            # Delete database record
            con.execute(
                "DELETE FROM system_settings WHERE setting_key IN (%s, %s, %s)",
                [LOGO_FILE_KEY, LOGO_B64_KEY, LOGO_MIME_KEY],
            )
        
        return {"ok": True, "message": "NZI logo deleted successfully"}
