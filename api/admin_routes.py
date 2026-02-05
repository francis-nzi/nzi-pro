"""
Admin API routes for team, lookups, datasets, and system management.
"""

from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File
from core.database import get_conn, db_backend
import pandas as pd
import io

router = APIRouter(prefix="/admin", tags=["admin"])


def _current_user(x_user: str | None = None):
    """Placeholder for auth - replace with real auth later."""
    return {"user": x_user or "admin"}


# =========================
# TEAM MANAGEMENT
# =========================

@router.get("/users")
def list_users(_user: dict = Depends(_current_user)):
    """List all users."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT user_id, full_name, email, role, status
                FROM users
                ORDER BY status DESC, role, full_name
                """
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "user_id": str(r.get("user_id") or ""),
                    "full_name": str(r.get("full_name") or ""),
                    "email": str(r.get("email") or ""),
                    "role": str(r.get("role") or "ReadOnly"),
                    "status": str(r.get("status") or "Active"),
                })
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list users: {e}")


@router.get("/roles")
def list_roles(_user: dict = Depends(_current_user)):
    """List all roles."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT role_name, is_active
                FROM roles_lookup
                ORDER BY role_name
                """
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "role_name": str(r.get("role_name") or ""),
                    "is_active": bool(r.get("is_active", True)),
                })
        else:
            # Default roles if table is empty
            items = [
                {"role_name": "Admin", "is_active": True},
                {"role_name": "Consultant", "is_active": True},
                {"role_name": "ReadOnly", "is_active": True},
                {"role_name": "CRM", "is_active": True},
                {"role_name": "QA", "is_active": True},
                {"role_name": "Support", "is_active": True},
            ]
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list roles: {e}")


@router.post("/users")
def create_or_update_user(body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Create or update a user (upsert by email)."""
    try:
        email = body.get("email", "").strip().lower()
        full_name = body.get("full_name", "").strip()
        role = body.get("role", "ReadOnly")
        status = body.get("status", "Active")
        
        if not email or not full_name:
            raise HTTPException(status_code=400, detail="Email and full name are required")
        
        with get_conn() as con:
            con.execute(
                """
                INSERT INTO users (user_id, full_name, role, email, status)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (email) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    role = EXCLUDED.role,
                    status = EXCLUDED.status,
                    user_id = EXCLUDED.user_id
                """,
                [email, full_name, role, email, status],
            )
        
        return {"ok": True, "message": "User saved successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save user: {e}")


@router.patch("/users/{email}")
def update_user(email: str, body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Update a user's details."""
    try:
        with get_conn() as con:
            updates = []
            params = []
            
            if "full_name" in body:
                updates.append("full_name = %s")
                params.append(body["full_name"])
            if "role" in body:
                updates.append("role = %s")
                params.append(body["role"])
            if "status" in body:
                updates.append("status = %s")
                params.append(body["status"])
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(email.lower())
            query = f"UPDATE users SET {', '.join(updates)} WHERE email = %s"
            
            con.execute(query, params)
        
        return {"ok": True, "message": "User updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update user: {e}")


# =========================
# DATASETS & FACTORS
# =========================

@router.get("/datasets")
def list_datasets(_user: dict = Depends(_current_user)):
    """List all datasets."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT dataset_id, name, source, analysis_type, country, region,
                       currency, year, version, valid_from, valid_to
                FROM datasets
                ORDER BY year DESC, name
                """
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "dataset_id": int(r.get("dataset_id")),
                    "name": str(r.get("name") or ""),
                    "source": str(r.get("source") or ""),
                    "analysis_type": str(r.get("analysis_type") or ""),
                    "country": str(r.get("country") or ""),
                    "region": str(r.get("region") or ""),
                    "currency": str(r.get("currency") or ""),
                    "year": int(r.get("year")) if r.get("year") else None,
                    "version": str(r.get("version") or ""),
                    "valid_from": str(r.get("valid_from")) if r.get("valid_from") else None,
                    "valid_to": str(r.get("valid_to")) if r.get("valid_to") else None,
                })
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list datasets: {e}")


@router.post("/datasets")
def create_dataset(body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Create a new dataset."""
    try:
        name = body.get("name", "").strip()
        source = body.get("source", "").strip()
        
        if not name or not source:
            raise HTTPException(status_code=400, detail="Name and source are required")
        
        with get_conn() as con:
            row = con.execute(
                """
                INSERT INTO datasets
                (name, source, analysis_type, country, region, currency, year, version, license, notes, valid_from, valid_to)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING dataset_id
                """,
                [
                    name,
                    source,
                    body.get("analysis_type", "Activity"),
                    body.get("country", "UK"),
                    body.get("region"),
                    body.get("currency", "GBP"),
                    body.get("year"),
                    body.get("version"),
                    body.get("license"),
                    body.get("notes"),
                    body.get("valid_from"),
                    body.get("valid_to"),
                ],
            ).fetchone()
            
            dataset_id = int(row[0])
        
        return {"ok": True, "dataset_id": dataset_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create dataset: {e}")


@router.get("/factors")
def search_factors(
    q: str = "",
    dataset_id: int | None = None,
    limit: int = 100,
    _user: dict = Depends(_current_user)
):
    """Search conversion factors."""
    try:
        with get_conn() as con:
            if dataset_id:
                df = con.execute(
                    """
                    SELECT fl.db_id, d.name AS dataset, d.analysis_type, d.country,
                           fl.year, fl.scope, fl.level_1, fl.level_2, fl.level_3, fl.level_4,
                           fl.column_text, fl.uom, fl.ghg_unit, fl.factor, fl.report_label
                    FROM factor_lookup fl
                    LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                    WHERE fl.dataset_id = %s AND fl.column_text ILIKE %s
                    ORDER BY fl.year DESC, fl.column_text
                    LIMIT %s
                    """,
                    [dataset_id, f"%{q}%", limit],
                ).df()
            else:
                df = con.execute(
                    """
                    SELECT fl.db_id, d.name AS dataset, d.analysis_type, d.country,
                           fl.year, fl.scope, fl.level_1, fl.level_2, fl.level_3, fl.level_4,
                           fl.column_text, fl.uom, fl.ghg_unit, fl.factor, fl.report_label
                    FROM factor_lookup fl
                    LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                    WHERE fl.column_text ILIKE %s
                    ORDER BY fl.year DESC, fl.column_text
                    LIMIT %s
                    """,
                    [f"%{q}%", limit],
                ).df()
        
        items = []
        if df is not None and not df.empty:
            items = df.to_dict(orient="records")
        
        return {"items": items, "count": len(items)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search factors: {e}")


# =========================
# LOOKUPS MANAGEMENT
# =========================

@router.get("/lookups/{table_name}")
def list_lookup_items(table_name: str, _user: dict = Depends(_current_user)):
    """List items from a lookup table."""
    # Whitelist allowed tables for security
    allowed_tables = [
        "job_types", "job_statuses_lookup", "vat_rates_lookup",
        "payment_terms_lookup", "time_subjects", "portfolios_lookup",
        "industries_lookup"
    ]
    
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")
    
    try:
        with get_conn() as con:
            # Different tables might have different sort columns
            if table_name == "job_statuses_lookup":
                df = con.execute(f"SELECT * FROM {table_name} ORDER BY sort_order, name").df()
            else:
                # Try to order by name, fallback to no ordering if column doesn't exist
                try:
                    df = con.execute(f"SELECT * FROM {table_name} ORDER BY name").df()
                except Exception:
                    df = con.execute(f"SELECT * FROM {table_name}").df()
        
        items = []
        if df is not None and not df.empty:
            # Replace NaN with None for proper JSON serialization
            import numpy as np
            df = df.replace({np.nan: None})
            items = df.to_dict(orient="records")
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list {table_name}: {e}")


@router.post("/lookups/{table_name}")
def create_lookup_item(
    table_name: str,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Create a new lookup item."""
    allowed_tables = [
        "job_types", "job_statuses_lookup", "vat_rates_lookup",
        "payment_terms_lookup", "time_subjects", "portfolios_lookup",
        "industries_lookup"
    ]
    
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")
    
    try:
        name = body.get("name", "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        
        with get_conn() as con:
            # This is simplified - you'd need table-specific logic for different schemas
            if table_name == "vat_rates_lookup":
                con.execute(
                    """
                    INSERT INTO vat_rates_lookup (name, rate_pct, is_default, is_active)
                    VALUES (%s, %s, %s, %s)
                    """,
                    [name, body.get("rate_pct", 0), body.get("is_default", False), body.get("is_active", True)],
                )
            else:
                # Generic insert for simple lookup tables
                con.execute(
                    f"INSERT INTO {table_name} (name, is_active) VALUES (%s, %s)",
                    [name, body.get("is_active", True)],
                )
        
        return {"ok": True, "message": "Item created successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create item: {e}")


@router.patch("/lookups/{table_name}/{item_id}")
def update_lookup_item(
    table_name: str,
    item_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Update a lookup item (typically to archive/deactivate it)."""
    allowed_tables = [
        "job_types", "job_statuses_lookup", "vat_rates_lookup",
        "payment_terms_lookup", "time_subjects", "portfolios_lookup",
        "industries_lookup"
    ]
    
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")
    
    # Map table names to their ID columns
    id_col_map = {
        "job_types": "job_type_id",
        "job_statuses_lookup": "status_id",
        "vat_rates_lookup": "vat_rate_id",
        "payment_terms_lookup": "term_id",
        "time_subjects": "subject_id",
        "portfolios_lookup": "portfolio_id",
        "industries_lookup": "industry_id",
    }
    
    id_col = id_col_map.get(table_name)
    if not id_col:
        raise HTTPException(status_code=400, detail="Unknown table")
    
    try:
        with get_conn() as con:
            # Build update query
            updates = []
            params = []
            
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(body["is_active"])
            
            if "name" in body:
                updates.append("name = %s")
                params.append(body["name"])
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(int(item_id))
            query = f"UPDATE {table_name} SET {', '.join(updates)} WHERE {id_col} = %s"
            
            con.execute(query, params)
        
        return {"ok": True, "message": "Item updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update item: {e}")


# =========================
# ARCHIVED CLIENTS
# =========================

@router.get("/archived-clients")
def list_archived_clients(q: str = "", _user: dict = Depends(_current_user)):
    """List archived clients."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT db_id, client_name, industry, status
                FROM clients
                WHERE status = 'Archived' AND client_name ILIKE %s
                ORDER BY client_name
                LIMIT 100
                """,
                [f"%{q}%"],
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "db_id": int(r.get("db_id")),
                    "client_name": str(r.get("client_name") or ""),
                    "industry": str(r.get("industry") or ""),
                    "status": str(r.get("status") or ""),
                })
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list archived clients: {e}")


@router.patch("/archived-clients/{client_id}/reactivate")
def reactivate_client(client_id: int, _user: dict = Depends(_current_user)):
    """Reactivate an archived client."""
    try:
        with get_conn() as con:
            con.execute(
                "UPDATE clients SET status = 'Active' WHERE db_id = %s",
                [int(client_id)],
            )
        
        return {"ok": True, "message": "Client reactivated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reactivate client: {e}")
