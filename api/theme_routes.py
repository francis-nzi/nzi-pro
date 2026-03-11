"""
Theme Settings API Routes
Manages centralized theme colors and settings
"""

from fastapi import APIRouter, HTTPException, Depends, Body
from core.database import get_conn
from api.auth import _current_user

router = APIRouter()


@router.get("/theme-settings")
def get_theme_settings():
    """Get all theme settings (public endpoint for frontend)"""
    try:
        with get_conn() as con:
            settings = con.execute(
                """
                SELECT setting_key, setting_value, setting_type, description
                FROM theme_settings
                ORDER BY setting_key
                """
            ).df()
            
            if settings.empty:
                return {"settings": {}}
            
            result = {}
            for _, row in settings.iterrows():
                result[row['setting_key']] = {
                    "value": row['setting_value'],
                    "type": row['setting_type'],
                    "description": row['description']
                }
            
            return {"settings": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch theme settings: {e}")


@router.patch("/theme-settings")
def update_theme_settings(
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update theme settings (admin only)"""
    try:
        with get_conn() as con:
            for key, value in body.items():
                # Check if setting exists
                exists = con.execute(
                    "SELECT 1 FROM theme_settings WHERE setting_key = %s",
                    [key]
                ).fetchone()
                
                if exists:
                    con.execute(
                        """
                        UPDATE theme_settings
                        SET setting_value = %s, updated_at = NOW()
                        WHERE setting_key = %s
                        """,
                        [value, key]
                    )
                else:
                    # Create new setting
                    con.execute(
                        """
                        INSERT INTO theme_settings (setting_key, setting_value, setting_type)
                        VALUES (%s, %s, 'color')
                        """,
                        [key, value]
                    )
            
            return {"ok": True, "message": "Theme settings updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update theme settings: {e}")


@router.post("/theme-settings/reset")
def reset_theme_settings(_user: dict[str, str] = Depends(_current_user)):
    """Reset theme settings to defaults (admin only)"""
    try:
        with get_conn() as con:
            con.execute(
                """
                UPDATE theme_settings
                SET setting_value = CASE setting_key
                    WHEN 'primary_color' THEN '#F26624'
                    WHEN 'button_color' THEN '#F26624'
                    WHEN 'secondary_color' THEN '#6B7280'
                    ELSE setting_value
                END,
                updated_at = NOW()
                """
            )
            
            return {"ok": True, "message": "Theme settings reset to defaults"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset theme settings: {e}")
