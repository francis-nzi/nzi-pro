from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from api.permissions import assert_client_access, assert_permission
from core.database import get_conn
from services.lca_component_tree import (
    ensure_lca_hierarchy_schema,
    resolved_mass_kg,
    would_create_cycle,
)
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
            ensure_lca_hierarchy_schema(con)
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
                # astype(object) first -- plain .where() is a no-op on any
                # column pandas inferred as float64 (all-NULL optional text
                # columns commonly do), leaving NaN and breaking JSON encoding.
                df = df.astype(object).where(df.notna(), None)
                component_ids = [int(v) for v in df["component_id"].tolist()]
                child_counts: dict[int, int] = {}
                if component_ids:
                    count_rows = con.execute(
                        """
                        SELECT parent_component_id, COUNT(*) FROM lca_component_children
                        WHERE parent_component_id = ANY(%s) GROUP BY parent_component_id
                        """,
                        [component_ids],
                    ).fetchall()
                    child_counts = {int(r[0]): int(r[1]) for r in count_rows}
                for _, r in df.iterrows():
                    item = _row_to_dict(tuple(r[c] for c in [
                        "component_id", "client_db_id", "component_code", "description", "material_category_id",
                        "default_unit_mass", "default_unit", "origin_country", "supplier_name", "supplier_contact",
                        "notes", "archived", "created_by", "created_at", "updated_by", "updated_at",
                    ]))
                    child_count = child_counts.get(item["component_id"], 0)
                    item["is_assembly"] = child_count > 0
                    item["child_count"] = child_count
                    item["resolved_mass_kg"] = resolved_mass_kg(con, item["component_id"]) if child_count > 0 else None
                    items.append(item)
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


# ---------------------------------------------------------------------------
# Assembly children -- a component with rows here is a composite/assembly
# rather than a leaf material. See services/lca_component_tree.py and
# LCA_ASSEMBLY_HIERARCHY_SCOPE.md.
# ---------------------------------------------------------------------------

_CHILD_SELECT_COLS = """
    child_link_id, parent_component_id, child_component_id, line_label, material_category_id,
    quantity, unit, origin_country, mapped_factor_source, factor_value, factor_unit,
    data_quality, is_gap_filled, sort_order, notes
"""


def _child_row_to_dict(row: tuple, child_is_assembly: bool) -> dict[str, Any]:
    return {
        "child_link_id": int(row[0]),
        "parent_component_id": int(row[1]),
        "child_component_id": None if _is_missing(row[2]) else int(row[2]),
        "line_label": row[3],
        "material_category_id": None if _is_missing(row[4]) else int(row[4]),
        "quantity": safe_float(row[5]),
        "unit": row[6],
        "origin_country": row[7],
        "mapped_factor_source": row[8],
        "factor_value": None if _is_missing(row[9]) else safe_float(row[9]),
        "factor_unit": row[10],
        "data_quality": row[11],
        "is_gap_filled": bool(row[12]),
        "sort_order": int(row[13]) if not _is_missing(row[13]) else 0,
        "notes": row[14],
        "child_is_assembly": child_is_assembly,
    }


def _component_owned_by_client(con, client_db_id: int, component_id: int) -> bool:
    row = con.execute(
        "SELECT 1 FROM lca_components WHERE component_id = %s AND client_db_id = %s",
        [int(component_id), int(client_db_id)],
    ).fetchone()
    return bool(row)


@router.get("/clients/{client_db_id}/lca-components/{component_id}/children")
def list_lca_component_children(
    client_db_id: int, component_id: int, _user: dict[str, str] = Depends(_current_user)
):
    assert_permission(_user, "jobs.view")
    assert_client_access(_user, int(client_db_id))
    try:
        with get_conn() as con:
            ensure_lca_hierarchy_schema(con)
            if not _component_owned_by_client(con, int(client_db_id), int(component_id)):
                raise HTTPException(status_code=404, detail="Component not found")
            df = con.execute(
                f"""
                SELECT {_CHILD_SELECT_COLS}
                FROM lca_component_children
                WHERE parent_component_id = %s
                ORDER BY sort_order, child_link_id
                """,
                [int(component_id)],
            ).df()
            items = []
            if df is not None and not df.empty:
                df = df.astype(object).where(df.notna(), None)
                for _, r in df.iterrows():
                    child_id = r.get("child_component_id")
                    is_assembly = has_children(con, int(child_id)) if child_id is not None and not _is_missing(child_id) else False
                    items.append(_child_row_to_dict(tuple(r[c] for c in [
                        "child_link_id", "parent_component_id", "child_component_id", "line_label",
                        "material_category_id", "quantity", "unit", "origin_country", "mapped_factor_source",
                        "factor_value", "factor_unit", "data_quality", "is_gap_filled", "sort_order", "notes",
                    ]), is_assembly))
            return {
                "component_id": int(component_id),
                "items": items,
                "resolved_mass_kg": resolved_mass_kg(con, int(component_id)),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list component children: {e}")


@router.post("/clients/{client_db_id}/lca-components/{component_id}/children")
def add_lca_component_child(
    client_db_id: int, component_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)
):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    try:
        with get_conn(autocommit=False) as con:
            ensure_lca_hierarchy_schema(con)
            if not _component_owned_by_client(con, int(client_db_id), int(component_id)):
                raise HTTPException(status_code=404, detail="Component not found")

            child_component_id = body.get("child_component_id")
            child_component_id = int(child_component_id) if str(child_component_id or "").strip().isdigit() else None
            if child_component_id is not None:
                if would_create_cycle(con, int(component_id), child_component_id):
                    raise HTTPException(
                        status_code=400,
                        detail="That component already (directly or indirectly) contains this assembly -- adding it here would create a circular reference.",
                    )

            line_label = str(body.get("line_label") or "").strip()
            if not line_label and child_component_id is not None:
                desc_row = con.execute(
                    "SELECT description FROM lca_components WHERE component_id = %s", [child_component_id]
                ).fetchone()
                line_label = str(desc_row[0]) if desc_row and desc_row[0] else ""
            if not line_label:
                raise HTTPException(status_code=400, detail="line_label is required (or pick a library component)")

            sort_row = con.execute(
                "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lca_component_children WHERE parent_component_id = %s",
                [int(component_id)],
            ).fetchone()
            next_sort = int(sort_row[0]) if sort_row else 1

            row = con.execute(
                """
                INSERT INTO lca_component_children (
                  parent_component_id, child_component_id, line_label, material_category_id, quantity, unit,
                  origin_country, factor_value, factor_unit, mapped_factor_source, data_quality, sort_order,
                  notes, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING child_link_id
                """,
                [
                    int(component_id),
                    child_component_id,
                    line_label,
                    int(body.get("material_category_id")) if str(body.get("material_category_id") or "").strip().isdigit() else None,
                    safe_float(body.get("quantity"), 0.0),
                    str(body.get("unit") or "kg").strip(),
                    str(body.get("origin_country") or "").strip() or None,
                    safe_float(body.get("factor_value")) if body.get("factor_value") not in (None, "") else None,
                    str(body.get("factor_unit") or "kgCO2e/kg").strip(),
                    "manual" if body.get("factor_value") not in (None, "") else None,
                    str(body.get("data_quality") or "secondary").strip(),
                    next_sort,
                    str(body.get("notes") or "").strip() or None,
                    _actor(_user), _actor(_user),
                ],
            ).fetchone()
            return {"ok": True, "child_link_id": int(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add component child: {e}")


@router.patch("/clients/{client_db_id}/lca-components/{component_id}/children/{child_link_id}")
def update_lca_component_child(
    client_db_id: int,
    component_id: int,
    child_link_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    try:
        with get_conn(autocommit=False) as con:
            ensure_lca_hierarchy_schema(con)
            if not _component_owned_by_client(con, int(client_db_id), int(component_id)):
                raise HTTPException(status_code=404, detail="Component not found")
            existing = con.execute(
                "SELECT child_link_id FROM lca_component_children WHERE child_link_id = %s AND parent_component_id = %s",
                [int(child_link_id), int(component_id)],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Component child not found")

            updates: list[str] = []
            params: list[Any] = []
            if "child_component_id" in body:
                raw = body.get("child_component_id")
                new_child_id = int(raw) if str(raw or "").strip().isdigit() else None
                if new_child_id is not None and would_create_cycle(con, int(component_id), new_child_id):
                    raise HTTPException(
                        status_code=400,
                        detail="That component already (directly or indirectly) contains this assembly -- adding it here would create a circular reference.",
                    )
                updates.append("child_component_id = %s")
                params.append(new_child_id)
            for field in ("line_label", "unit", "origin_country", "factor_unit", "data_quality", "notes"):
                if field not in body:
                    continue
                updates.append(f"{field} = %s")
                val = str(body.get(field) or "").strip()
                params.append(val or None)
            if "material_category_id" in body:
                updates.append("material_category_id = %s")
                raw = str(body.get("material_category_id") or "").strip()
                params.append(int(raw) if raw.isdigit() else None)
            if "quantity" in body:
                updates.append("quantity = %s")
                params.append(safe_float(body.get("quantity"), 0.0))
            if "factor_value" in body:
                updates.append("factor_value = %s")
                raw = body.get("factor_value")
                params.append(safe_float(raw) if raw not in (None, "") else None)
                updates.append("mapped_factor_source = %s")
                params.append("manual" if raw not in (None, "") else None)
            if "sort_order" in body:
                updates.append("sort_order = %s")
                params.append(int(safe_float(body.get("sort_order"), 0)))
            if not updates:
                return {"ok": True}
            updates.extend(["updated_at = NOW()", "updated_by = %s"])
            params.append(_actor(_user))
            params.extend([int(child_link_id), int(component_id)])
            con.execute(
                f"UPDATE lca_component_children SET {', '.join(updates)} WHERE child_link_id = %s AND parent_component_id = %s",
                params,
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update component child: {e}")


@router.delete("/clients/{client_db_id}/lca-components/{component_id}/children/{child_link_id}")
def delete_lca_component_child(
    client_db_id: int,
    component_id: int,
    child_link_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    try:
        with get_conn(autocommit=False) as con:
            ensure_lca_hierarchy_schema(con)
            if not _component_owned_by_client(con, int(client_db_id), int(component_id)):
                raise HTTPException(status_code=404, detail="Component not found")
            con.execute(
                "DELETE FROM lca_component_children WHERE child_link_id = %s AND parent_component_id = %s",
                [int(child_link_id), int(component_id)],
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete component child: {e}")
