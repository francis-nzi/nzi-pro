import json
from fastapi import APIRouter, Depends, Body
from pydantic import BaseModel
from typing import Optional, List
import os
import psycopg2
from psycopg2.extras import RealDictCursor

router = APIRouter(prefix="/custom-fields", tags=["custom_fields"])

def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    return psycopg2.connect(db_url, cursor_factory=RealDictCursor)

def _current_user():
    # Simplified auth - in production, validate JWT/session
    return {"user_id": "system"}

# Models
class CustomFieldDefinition(BaseModel):
    field_name: str
    field_type: str
    field_label: str
    is_required: bool = False
    entity_type: str
    options: Optional[List[dict]] = None
    display_order: int = 0
    default_value: Optional[str] = None

class CustomFieldValue(BaseModel):
    field_id: int
    entity_id: int
    entity_type: str
    field_value: Optional[str] = None

# Routes for field definitions (Admin)
@router.get("/definitions")
def list_field_definitions(
    entity_type: Optional[str] = None,
    _user: dict = Depends(_current_user)
):
    conn = get_db_connection()
    cur = conn.cursor()
    
    if entity_type:
        cur.execute(
            "SELECT * FROM custom_field_definitions WHERE entity_type = %s AND is_active = TRUE ORDER BY display_order",
            (entity_type,)
        )
    else:
        cur.execute("SELECT * FROM custom_field_definitions WHERE is_active = TRUE ORDER BY display_order")
    
    results = cur.fetchall()
    cur.close()
    conn.close()
    return {"items": results}

@router.post("/definitions")
def create_field_definition(
    field: CustomFieldDefinition,
    _user: dict = Depends(_current_user)
):
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute(
        """INSERT INTO custom_field_definitions 
           (field_name, field_type, field_label, is_required, entity_type, options, display_order, default_value)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
           RETURNING field_id""",
        (field.field_name, field.field_type, field.field_label, field.is_required,
         field.entity_type, json.dumps(field.options) if field.options else None, field.display_order, field.default_value)
    )
    
    field_id = cur.fetchone()["field_id"]
    conn.commit()
    cur.close()
    conn.close()
    
    return {"field_id": field_id, "message": "Field definition created"}

@router.patch("/definitions/{field_id}")
def update_field_definition(
    field_id: int,
    field: CustomFieldDefinition,
    _user: dict = Depends(_current_user)
):
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute(
        """UPDATE custom_field_definitions SET 
           field_name = %s, field_type = %s, field_label = %s, is_required = %s,
           entity_type = %s, options = %s, display_order = %s, default_value = %s, updated_at = NOW()
           WHERE field_id = %s""",
        (field.field_name, field.field_type, field.field_label, field.is_required,
         field.entity_type, json.dumps(field.options) if field.options else None, field.display_order, field.default_value, field_id)
    )
    
    conn.commit()
    cur.close()
    conn.close()
    
    return {"message": "Field definition updated"}

@router.delete("/definitions/{field_id}")
def delete_field_definition(
    field_id: int,
    _user: dict = Depends(_current_user)
):
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Soft delete - just mark as inactive
    cur.execute("UPDATE custom_field_definitions SET is_active = FALSE WHERE field_id = %s", (field_id,))
    
    conn.commit()
    cur.close()
    conn.close()
    
    return {"message": "Field definition deleted"}

# Routes for field values (per entity)
@router.get("/values/{entity_type}/{entity_id}")
def get_entity_custom_fields(
    entity_type: str,
    entity_id: int,
    _user: dict = Depends(_current_user)
):
    """Get all custom field values for a specific entity"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute(
        """SELECT d.field_id, d.field_name, d.field_type, d.field_label, d.is_required, 
                  d.options, d.default_value, v.field_value
           FROM custom_field_definitions d
           LEFT JOIN custom_field_values v ON d.field_id = v.field_id AND v.entity_id = %s AND v.entity_type = %s
           WHERE d.entity_type = %s AND d.is_active = TRUE
           ORDER BY d.display_order""",
        (entity_id, entity_type, entity_type)
    )
    
    results = cur.fetchall()
    cur.close()
    conn.close()
    return {"items": results}

@router.post("/values")
def save_custom_field_values(
    values: List[CustomFieldValue],
    _user: dict = Depends(_current_user)
):
    """Save/update custom field values for an entity"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    for value in values:
        cur.execute(
            """INSERT INTO custom_field_values (field_id, entity_id, entity_type, field_value, updated_at)
               VALUES (%s, %s, %s, %s, NOW())
               ON CONFLICT (field_id, entity_id, entity_type) 
               DO UPDATE SET field_value = EXCLUDED.field_value, updated_at = NOW()""",
            (value.field_id, value.entity_id, value.entity_type, value.field_value)
        )
    
    conn.commit()
    cur.close()
    conn.close()
    
    return {"message": "Custom field values saved"}
