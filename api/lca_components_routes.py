from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from api.permissions import assert_client_access, assert_permission
from core.database import get_conn
from services.lca_engine import safe_float

router = APIRouter(tags=["lca-components"])


def _actor(user: dict[str, str]) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip()


def _is_missing(value: Any) -> bool:
    """Rows come from DataFrame.df(), which upcasts nullable INTEGER/NUMERIC
    columns to float64 -- SQL NULL then arrives as NaN, not None, so a plain
    `is not None` check silently lets it through into int()/float()."""
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _row_to_dict(row: tuple) -> dict[str, Any]:
    return {
        "component_id": int(row[0]),
        "client_db_id": None if _is_missing(row[1]) else int(row[1]),
        "component_code": row[2],
        "description": row[3],
        "material_category_id": None if _is_missing(row[4]) else int(row[4]),
        "default_unit_mass": None if _is_missing(row[5]) else safe_float(row[5]),
        "default_unit": row[6],
        "origin_country": row[7],
        "supplier_name": row[8],
        "supplier_contact": row[9],
        "notes": row[10],
        "archived": bool(row[11]),
        "created_by": row[12],
        "created_at": str(row[13]) if row[13] else None,
        "updated_by": row[14],
        "updated_at": str(row[15]) if row[15] else None,
    }


_SELECT_COLS = """
    component_id, client_db_id, component_code, description, material_category_id,
    default_unit_mass, default_unit, origin_country, supplier_name, supplier_contact,
    notes, archived, created_by, created_at, updated_by, updated_at
"""


@router.get("/clients/{client_db_id}/lca-components")
def list_lca_components(
    client_db_id: int,
    include_archived: bool = Query(False),
    include_global: bool = Query(True),
    search: str = Query(""),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.view")
    assert_client_access(_user, int(client_db_id))
    try:
        with get_conn() as con:
            where = ["(client_db_id = %s" + (" OR client_db_id IS NULL)" if include_global else ")")]
            params: list[Any] = [int(client_db_id)]
            if not include_archived:
                where.append("archived = FALSE")
            search_text = str(search or "").strip().lower()
            if search_text:
                tokens = [t.strip() for t in search_text.split() if t.strip()]
                for token in tokens:
                    pattern = f"%{token}%"
                    where.append(
                        "(LOWER(COALESCE(component_code,'')) LIKE %s OR LOWER(COALESCE(description,'')) LIKE %s "
                        "OR LOWER(COALESCE(supplier_name,'')) LIKE %s OR LOWER(COALESCE(origin_country,'')) LIKE %s)"
                    )
                    params.extend([pattern] * 4)
            df = con.execute(
                f"""
                SELECT {_SELECT_COLS}
                FROM lca_components
                WHERE {' AND '.join(where)}
                ORDER BY description ASC
                """,
                params,
            ).df()
            items = []
            if df is not None and not df.empty:
                df = df.where(df.notna(), None)
                for _, r in df.iterrows():
                    items.append(_row_to_dict(tuple(r[c] for c in [
                        "component_id", "client_db_id", "component_code", "description", "material_category_id",
                        "default_unit_mass", "default_unit", "origin_country", "supplier_name", "supplier_contact",
                        "notes", "archived", "created_by", "created_at", "updated_by", "updated_at",
                    ])))
            return {"client_db_id": int(client_db_id), "items": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list components: {e}")


@router.post("/clients/{client_db_id}/lca-components")
def create_lca_component(client_db_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    description = str(body.get("description") or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="description is required")
    try:
        with get_conn(autocommit=False) as con:
            row = con.execute(
                """
                INSERT INTO lca_components (
                  client_db_id, component_code, description, material_category_id, default_unit_mass,
                  default_unit, origin_country, supplier_name, supplier_contact, notes, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING component_id
                """,
                [
                    int(client_db_id),
                    str(body.get("component_code") or "").strip() or None,
                    description,
                    int(body.get("material_category_id")) if str(body.get("material_category_id") or "").strip().isdigit() else None,
                    safe_float(body.get("default_unit_mass")) if body.get("default_unit_mass") not in (None, "") else None,
                    str(body.get("default_unit") or "kg").strip(),
                    str(body.get("origin_country") or "").strip() or None,
                    str(body.get("supplier_name") or "").strip() or None,
                    str(body.get("supplier_contact") or "").strip() or None,
                    str(body.get("notes") or "").strip() or None,
                    _actor(_user), _actor(_user),
                ],
            ).fetchone()
            return {"ok": True, "component_id": int(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create component: {e}")


@router.patch("/clients/{client_db_id}/lca-components/{component_id}")
def update_lca_component(client_db_id: int, component_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    try:
        with get_conn(autocommit=False) as con:
            existing = con.execute(
                "SELECT component_id FROM lca_components WHERE component_id = %s AND client_db_id = %s",
                [int(component_id), int(client_db_id)],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Component not found")
            updates: list[str] = []
            params: list[Any] = []
            for field in ("component_code", "description", "default_unit", "origin_country", "supplier_name", "supplier_contact", "notes"):
                if field not in body:
                    continue
                updates.append(f"{field} = %s")
                val = str(body.get(field) or "").strip()
                params.append(val or None)
            if "material_category_id" in body:
                updates.append("material_category_id = %s")
                raw = str(body.get("material_category_id") or "").strip()
                params.append(int(raw) if raw.isdigit() else None)
            if "default_unit_mass" in body:
                updates.append("default_unit_mass = %s")
                raw = body.get("default_unit_mass")
                params.append(safe_float(raw) if raw not in (None, "") else None)
            if not updates:
                return {"ok": True}
            updates.extend(["updated_at = NOW()", "updated_by = %s"])
            params.append(_actor(_user))
            params.extend([int(component_id), int(client_db_id)])
            con.execute(
                f"UPDATE lca_components SET {', '.join(updates)} WHERE component_id = %s AND client_db_id = %s",
                params,
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update component: {e}")


@router.patch("/clients/{client_db_id}/lca-components/{component_id}/archive")
def archive_lca_component(client_db_id: int, component_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    archived = bool(body.get("archived", True))
    try:
        with get_conn(autocommit=False) as con:
            existing = con.execute(
                "SELECT component_id FROM lca_components WHERE component_id = %s AND client_db_id = %s",
                [int(component_id), int(client_db_id)],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Component not found")
            con.execute(
                """
                UPDATE lca_components
                SET archived = %s, archived_at = CASE WHEN %s THEN NOW() ELSE NULL END,
                    archived_by = CASE WHEN %s THEN %s ELSE NULL END, updated_at = NOW(), updated_by = %s
                WHERE component_id = %s AND client_db_id = %s
                """,
                [archived, archived, archived, _actor(_user), _actor(_user), int(component_id), int(client_db_id)],
            )
            return {"ok": True, "archived": archived}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update component archive state: {e}")
