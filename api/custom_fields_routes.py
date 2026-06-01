import json
from fastapi import APIRouter, Depends, Body
from pydantic import BaseModel
from typing import Optional, List
import os
import psycopg2
from psycopg2.extras import RealDictCursor

router = APIRouter(prefix="/custom-fields", tags=["custom_fields"])

DEFAULT_CUSTOM_FIELDS = [
    {
        "field_name": "referral",
        "field_type": "dropdown",
        "field_label": "Referral",
        "is_required": False,
        "entity_type": "client",
        "options": [
            {"label": "David Hawes", "value": "david_hawes"},
            {"label": "Chris Williams", "value": "chris_williams"},
        ],
        "display_order": 0,
        "default_value": "",
    },
    {
        "field_name": "parent-client",
        "field_type": "dropdown",
        "field_label": "Parent Client",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 0,
        "default_value": "",
    },
    {
        "field_name": "accelerator",
        "field_type": "dropdown",
        "field_label": "Accelerator",
        "is_required": False,
        "entity_type": "job",
        "options": [
            {"label": "Pilot", "value": "pilot"},
            {"label": "National 1", "value": "national_1"},
            {"label": "SOSE 1", "value": "sose_1"},
            {"label": "EA 1", "value": "ea_1"},
            {"label": "EA 2", "value": "ea_2"},
            {"label": "EA 3", "value": "ea_3"},
            {"label": "EA 4", "value": "ea_4"},
            {"label": "EA 5", "value": "ea_5"},
            {"label": "IR 1", "value": "ir_1"},
            {"label": "NA 1", "value": "na_1"},
            {"label": "Grangemouth 1", "value": "grangemouth_1"},
            {"label": "Midlothian 1", "value": "midlothian_1"},
            {"label": "Year 2", "value": "year_2"},
            {"label": "Year 3", "value": "year_3"},
            {"label": "Year 4", "value": "year_4"},
            {"label": "Year 5", "value": "year_5"},
            {"label": "Grangemouth 2", "value": "grangemouth_2"},
            {"label": "FOCN 1", "value": "focn_1"},
            {"label": "ROLL 1", "value": "roll_1"},
            {"label": "ROLL 2", "value": "roll_2"},
            {"label": "ROLL 3", "value": "roll_3"},
            {"label": "DRY 1", "value": "dry_1"},
            {"label": "NA 2", "value": "na_2"},
            {"label": "FPL 1", "value": "fpl_1"},
            {"label": "OPENREG", "value": "openreg"},
        ],
        "display_order": 0,
        "default_value": "",
    },
    {
        "field_name": "multi-year-contract-end-date",
        "field_type": "date",
        "field_label": "Multi-Year Contract End Date",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 0,
        "default_value": "",
    },
    {
        "field_name": "notch-expiry-date",
        "field_type": "date",
        "field_label": "notch Expiry Date",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 0,
        "default_value": "",
    },
    {
        "field_name": "nzn-direct-debit",
        "field_type": "checkbox",
        "field_label": "NZN Direct Debit",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 0,
        "default_value": "",
    },
    {
        "field_name": "multi_year_contract",
        "field_type": "checkbox",
        "field_label": "Multi-Year Contract",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 1,
        "default_value": None,
    },
    {
        "field_name": "training_place_included",
        "field_type": "checkbox",
        "field_label": "Training Place Included",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 2,
        "default_value": None,
    },
    {
        "field_name": "free_training_place",
        "field_type": "checkbox",
        "field_label": "Free Training Place",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 3,
        "default_value": None,
    },
    {
        "field_name": "date_training_completed",
        "field_type": "date",
        "field_label": "Date Training Completed",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 4,
        "default_value": None,
    },
    {
        "field_name": "training_course_name",
        "field_type": "text",
        "field_label": "Training Course / Product",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 5,
        "default_value": None,
    },
    {
        "field_name": "training_delivery_mode",
        "field_type": "dropdown",
        "field_label": "Training Delivery Mode",
        "is_required": False,
        "entity_type": "job",
        "options": [
            {"label": "In person", "value": "in_person"},
            {"label": "Online", "value": "online"},
            {"label": "Hybrid", "value": "hybrid"},
        ],
        "display_order": 6,
        "default_value": None,
    },
    {
        "field_name": "consultancy_service_focus",
        "field_type": "text",
        "field_label": "Consultancy Service Focus",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 7,
        "default_value": None,
    },
    {
        "field_name": "lca_product_system_name",
        "field_type": "text",
        "field_label": "LCA Product / System Name",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 8,
        "default_value": None,
    },
    {
        "field_name": "pcf_product_name",
        "field_type": "text",
        "field_label": "PCF Product Name",
        "is_required": False,
        "entity_type": "job",
        "options": None,
        "display_order": 9,
        "default_value": None,
    },
]

def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    return psycopg2.connect(db_url, cursor_factory=RealDictCursor)

def _current_user():
    # Simplified auth - in production, validate JWT/session
    return {"user_id": "system"}


def _ensure_default_custom_fields(conn) -> None:
    cur = conn.cursor()
    try:
        for field in DEFAULT_CUSTOM_FIELDS:
            cur.execute(
                """
                INSERT INTO custom_field_definitions
                    (field_name, field_type, field_label, is_required, entity_type, options, display_order, default_value, is_active)
                SELECT %s, %s, %s, %s, %s, %s, %s, %s, TRUE
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM custom_field_definitions
                    WHERE entity_type = %s
                      AND lower(field_name) = lower(%s)
                      AND is_active = TRUE
                )
                """,
                (
                    field["field_name"],
                    field["field_type"],
                    field["field_label"],
                    field["is_required"],
                    field["entity_type"],
                    json.dumps(field["options"]) if field["options"] else None,
                    field["display_order"],
                    field["default_value"],
                    field["entity_type"],
                    field["field_name"],
                ),
            )
        conn.commit()
    finally:
        cur.close()

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
    _ensure_default_custom_fields(conn)
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
