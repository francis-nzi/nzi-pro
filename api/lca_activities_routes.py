from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from api.permissions import assert_client_access, assert_permission
from core.database import get_conn
from services.lca_engine import safe_float

router = APIRouter(tags=["lca-activities"])


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
        "activity_id": int(row[0]),
        "client_db_id": None if _is_missing(row[1]) else int(row[1]),
        "activity_code": row[2],
        "description": row[3],
        "default_module_code": row[4],
        "default_quantity": None if _is_missing(row[5]) else safe_float(row[5]),
        "default_unit": row[6],
        "notes": row[7],
        "archived": bool(row[8]),
        "created_by": row[9],
        "created_at": str(row[10]) if row[10] else None,
        "updated_by": row[11],
        "updated_at": str(row[12]) if row[12] else None,
    }


_SELECT_COLS = """
    activity_id, client_db_id, activity_code, description, default_module_code,
    default_quantity, default_unit, notes, archived, created_by, created_at, updated_by, updated_at
"""


@router.get("/clients/{client_db_id}/lca-activities")
def list_lca_activities(
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
                        "(LOWER(COALESCE(activity_code,'')) LIKE %s OR LOWER(COALESCE(description,'')) LIKE %s)"
                    )
                    params.extend([pattern] * 2)
            df = con.execute(
                f"""
                SELECT {_SELECT_COLS}
                FROM lca_activities
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
                        "activity_id", "client_db_id", "activity_code", "description", "default_module_code",
                        "default_quantity", "default_unit", "notes", "archived", "created_by", "created_at",
                        "updated_by", "updated_at",
                    ])))
            return {"client_db_id": int(client_db_id), "items": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list activities: {e}")


@router.post("/clients/{client_db_id}/lca-activities")
def create_lca_activity(client_db_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    description = str(body.get("description") or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="description is required")
    try:
        with get_conn(autocommit=False) as con:
            module_code = str(body.get("default_module_code") or "").strip().upper() or None
            if module_code:
                valid = con.execute("SELECT 1 FROM lca_modules_lookup WHERE module_code = %s", [module_code]).fetchone()
                if not valid:
                    raise HTTPException(status_code=400, detail=f"Unknown default_module_code: {module_code}")
            row = con.execute(
                """
                INSERT INTO lca_activities (
                  client_db_id, activity_code, description, default_module_code, default_quantity,
                  default_unit, notes, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING activity_id
                """,
                [
                    int(client_db_id),
                    str(body.get("activity_code") or "").strip() or None,
                    description,
                    module_code,
                    safe_float(body.get("default_quantity")) if body.get("default_quantity") not in (None, "") else None,
                    str(body.get("default_unit") or "unit").strip(),
                    str(body.get("notes") or "").strip() or None,
                    _actor(_user), _actor(_user),
                ],
            ).fetchone()
            return {"ok": True, "activity_id": int(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create activity: {e}")


@router.patch("/clients/{client_db_id}/lca-activities/{activity_id}")
def update_lca_activity(client_db_id: int, activity_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    try:
        with get_conn(autocommit=False) as con:
            existing = con.execute(
                "SELECT activity_id FROM lca_activities WHERE activity_id = %s AND client_db_id = %s",
                [int(activity_id), int(client_db_id)],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Activity not found")
            updates: list[str] = []
            params: list[Any] = []
            for field in ("activity_code", "description", "default_unit", "notes"):
                if field not in body:
                    continue
                updates.append(f"{field} = %s")
                val = str(body.get(field) or "").strip()
                params.append(val or None)
            if "default_module_code" in body:
                module_code = str(body.get("default_module_code") or "").strip().upper() or None
                if module_code:
                    valid = con.execute("SELECT 1 FROM lca_modules_lookup WHERE module_code = %s", [module_code]).fetchone()
                    if not valid:
                        raise HTTPException(status_code=400, detail=f"Unknown default_module_code: {module_code}")
                updates.append("default_module_code = %s")
                params.append(module_code)
            if "default_quantity" in body:
                updates.append("default_quantity = %s")
                raw = body.get("default_quantity")
                params.append(safe_float(raw) if raw not in (None, "") else None)
            if not updates:
                return {"ok": True}
            updates.extend(["updated_at = NOW()", "updated_by = %s"])
            params.append(_actor(_user))
            params.extend([int(activity_id), int(client_db_id)])
            con.execute(
                f"UPDATE lca_activities SET {', '.join(updates)} WHERE activity_id = %s AND client_db_id = %s",
                params,
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update activity: {e}")


@router.patch("/clients/{client_db_id}/lca-activities/{activity_id}/archive")
def archive_lca_activity(client_db_id: int, activity_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    archived = bool(body.get("archived", True))
    try:
        with get_conn(autocommit=False) as con:
            existing = con.execute(
                "SELECT activity_id FROM lca_activities WHERE activity_id = %s AND client_db_id = %s",
                [int(activity_id), int(client_db_id)],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Activity not found")
            con.execute(
                """
                UPDATE lca_activities
                SET archived = %s, archived_at = CASE WHEN %s THEN NOW() ELSE NULL END,
                    archived_by = CASE WHEN %s THEN %s ELSE NULL END, updated_at = NOW(), updated_by = %s
                WHERE activity_id = %s AND client_db_id = %s
                """,
                [archived, archived, archived, _actor(_user), _actor(_user), int(activity_id), int(client_db_id)],
            )
            return {"ok": True, "archived": archived}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update activity archive state: {e}")
