"""
Milestone Template API Routes
Manages milestone templates and their items
"""

from fastapi import APIRouter, HTTPException, Depends, Body
from core.database import get_conn
from api.auth import _current_user

router = APIRouter()


@router.get("/milestone-templates")
def list_milestone_templates(_user: dict[str, str] = Depends(_current_user)):
    """Get all milestone templates with their items"""
    try:
        with get_conn() as con:
            templates = con.execute(
                """
                SELECT template_id, template_name, description, is_active, is_default
                FROM milestone_templates
                ORDER BY is_default DESC, template_name
                """
            ).df()
            
            if templates.empty:
                return {"templates": []}
            
            result = []
            for _, template in templates.iterrows():
                items = con.execute(
                    """
                    SELECT item_id, milestone_name, days_offset, sort_order
                    FROM milestone_template_items
                    WHERE template_id = %s
                    ORDER BY sort_order, item_id
                    """,
                    [int(template['template_id'])]
                ).df()
                
                result.append({
                    "template_id": int(template['template_id']),
                    "template_name": template['template_name'],
                    "description": template['description'],
                    "is_active": bool(template['is_active']),
                    "is_default": bool(template['is_default']),
                    "items": [
                        {
                            "item_id": int(item['item_id']),
                            "milestone_name": item['milestone_name'],
                            "days_offset": int(item['days_offset']),
                            "sort_order": int(item['sort_order'])
                        }
                        for _, item in items.iterrows()
                    ] if not items.empty else []
                })
            
            return {"templates": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch templates: {e}")


@router.post("/milestone-templates")
def create_milestone_template(
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Create a new milestone template with items"""
    try:
        template_name = body.get("template_name")
        description = body.get("description", "")
        items = body.get("items", [])
        
        if not template_name:
            raise HTTPException(status_code=400, detail="template_name is required")
        
        with get_conn() as con:
            # Create template
            result = con.execute(
                """
                INSERT INTO milestone_templates (template_name, description, is_active, is_default)
                VALUES (%s, %s, TRUE, FALSE)
                RETURNING template_id
                """,
                [template_name, description]
            ).fetchone()
            
            template_id = result[0]
            
            # Create items
            for item in items:
                con.execute(
                    """
                    INSERT INTO milestone_template_items (template_id, milestone_name, days_offset, sort_order)
                    VALUES (%s, %s, %s, %s)
                    """,
                    [template_id, item['milestone_name'], item['days_offset'], item.get('sort_order', 0)]
                )
            
            return {"ok": True, "template_id": template_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create template: {e}")


@router.patch("/milestone-templates/{template_id}")
def update_milestone_template(
    template_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update a milestone template"""
    try:
        with get_conn() as con:
            # Check if template exists
            exists = con.execute(
                "SELECT 1 FROM milestone_templates WHERE template_id = %s",
                [template_id]
            ).fetchone()
            
            if not exists:
                raise HTTPException(status_code=404, detail="Template not found")
            
            updates = []
            params = []
            
            if "template_name" in body:
                updates.append("template_name = %s")
                params.append(body["template_name"])
            
            if "description" in body:
                updates.append("description = %s")
                params.append(body["description"])
            
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(body["is_active"])
            
            if updates:
                updates.append("updated_at = NOW()")
                params.append(template_id)
                query = f"UPDATE milestone_templates SET {', '.join(updates)} WHERE template_id = %s"
                con.execute(query, params)
            
            # Update items if provided
            if "items" in body:
                # Delete existing items
                con.execute(
                    "DELETE FROM milestone_template_items WHERE template_id = %s",
                    [template_id]
                )
                
                # Insert new items
                for item in body["items"]:
                    con.execute(
                        """
                        INSERT INTO milestone_template_items (template_id, milestone_name, days_offset, sort_order)
                        VALUES (%s, %s, %s, %s)
                        """,
                        [template_id, item['milestone_name'], item['days_offset'], item.get('sort_order', 0)]
                    )
            
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update template: {e}")


@router.delete("/milestone-templates/{template_id}")
def delete_milestone_template(
    template_id: int,
    _user: dict[str, str] = Depends(_current_user)
):
    """Delete a milestone template"""
    try:
        with get_conn() as con:
            # Check if it's the default template
            is_default = con.execute(
                "SELECT is_default FROM milestone_templates WHERE template_id = %s",
                [template_id]
            ).fetchone()
            
            if not is_default:
                raise HTTPException(status_code=404, detail="Template not found")
            
            if is_default[0]:
                raise HTTPException(status_code=400, detail="Cannot delete default template")
            
            # Check if any jobs are using this template
            jobs_using = con.execute(
                "SELECT COUNT(*) FROM jobs WHERE milestone_template_id = %s",
                [template_id]
            ).fetchone()
            
            if jobs_using and jobs_using[0] > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot delete template: {jobs_using[0]} job(s) are using it"
                )
            
            con.execute(
                "DELETE FROM milestone_templates WHERE template_id = %s",
                [template_id]
            )
            
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete template: {e}")
