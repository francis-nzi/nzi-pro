"""LCA Supplier Library -- a global (not client-scoped), geocoded register of
suppliers, their locations, and the components they supply. Lets an A2/A4/C2
transport leg's origin be picked from an already-geocoded supplier location
instead of retyped and re-geocoded every time (see api/lca_routes.py
create_transport_leg/update_transport_leg, which accept an optional
origin_supplier_location_id for this). See sql_migrations/0062_lca_supplier_
library.sql for the schema and design rationale.

Any staff member can add/edit entries here (no approval gate) -- same
permission model as lca_components (api/lca_components_routes.py):
jobs.view to read, jobs.edit to write. This is real-world reference data
(supplier addresses, what they make), not curated emission-factor data.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from api.permissions import assert_permission
from core.database import get_conn

router = APIRouter(tags=["lca-suppliers"])


def _actor(user: dict[str, str]) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip()


def _is_missing(value: Any) -> bool:
    """Rows come from DataFrame.df(), which upcasts nullable INTEGER/NUMERIC
    columns to float64 -- SQL NULL then arrives as NaN, not None."""
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _df_records(con, sql: str, params: list[Any]) -> list[dict[str, Any]]:
    df = con.execute(sql, params).df()
    if df is None or df.empty:
        return []
    df = df.astype(object).where(df.notna(), None)
    return df.to_dict("records")


# ---------------------------------------------------------------------------
# Suppliers
# ---------------------------------------------------------------------------

@router.get("/lca/suppliers")
def list_lca_suppliers(
    q: str = Query(""),
    include_inactive: bool = Query(False),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.view")
    try:
        with get_conn() as con:
            where = ["1=1"] if include_inactive else ["is_active = TRUE"]
            params: list[Any] = []
            search_text = str(q or "").strip()
            if search_text:
                where.append("LOWER(supplier_name) LIKE %s")
                params.append(f"%{search_text.lower()}%")
            items = _df_records(
                con,
                f"""
                SELECT supplier_id, supplier_name, website, notes, is_active, created_at, updated_at
                FROM lca_suppliers
                WHERE {' AND '.join(where)}
                ORDER BY supplier_name ASC
                """,
                params,
            )
            return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list suppliers: {e}")


@router.post("/lca/suppliers")
def create_lca_supplier(body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    supplier_name = str(body.get("supplier_name") or "").strip()
    if not supplier_name:
        raise HTTPException(status_code=400, detail="supplier_name is required")
    try:
        with get_conn(autocommit=False) as con:
            duplicate = con.execute(
                "SELECT supplier_id FROM lca_suppliers WHERE LOWER(supplier_name) = LOWER(%s)",
                [supplier_name],
            ).fetchone()
            if duplicate:
                raise HTTPException(status_code=400, detail="A supplier with this name already exists")
            row = con.execute(
                """
                INSERT INTO lca_suppliers (supplier_name, website, notes, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING supplier_id
                """,
                [
                    supplier_name,
                    str(body.get("website") or "").strip() or None,
                    str(body.get("notes") or "").strip() or None,
                    _actor(_user), _actor(_user),
                ],
            ).fetchone()
            return {"ok": True, "supplier_id": int(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create supplier: {e}")


@router.patch("/lca/suppliers/{supplier_id}")
def update_lca_supplier(supplier_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    try:
        with get_conn(autocommit=False) as con:
            existing = con.execute("SELECT supplier_id FROM lca_suppliers WHERE supplier_id = %s", [int(supplier_id)]).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Supplier not found")

            updates: list[str] = []
            params: list[Any] = []
            if "supplier_name" in body:
                new_name = str(body.get("supplier_name") or "").strip()
                if not new_name:
                    raise HTTPException(status_code=400, detail="supplier_name cannot be blank")
                duplicate = con.execute(
                    "SELECT supplier_id FROM lca_suppliers WHERE LOWER(supplier_name) = LOWER(%s) AND supplier_id <> %s",
                    [new_name, int(supplier_id)],
                ).fetchone()
                if duplicate:
                    raise HTTPException(status_code=400, detail="A supplier with this name already exists")
                updates.append("supplier_name = %s")
                params.append(new_name)
            for field in ("website", "notes"):
                if field not in body:
                    continue
                updates.append(f"{field} = %s")
                params.append(str(body.get(field) or "").strip() or None)
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(bool(body.get("is_active")))
            if not updates:
                return {"ok": True}
            updates.extend(["updated_at = NOW()", "updated_by = %s"])
            params.append(_actor(_user))
            params.append(int(supplier_id))
            con.execute(f"UPDATE lca_suppliers SET {', '.join(updates)} WHERE supplier_id = %s", params)
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update supplier: {e}")


@router.delete("/lca/suppliers/{supplier_id}")
def deactivate_lca_supplier(supplier_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Soft delete -- keeps historical transport legs' provenance FK intact."""
    assert_permission(_user, "jobs.edit")
    try:
        with get_conn(autocommit=False) as con:
            existing = con.execute("SELECT supplier_id FROM lca_suppliers WHERE supplier_id = %s", [int(supplier_id)]).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Supplier not found")
            con.execute(
                "UPDATE lca_suppliers SET is_active = FALSE, updated_at = NOW(), updated_by = %s WHERE supplier_id = %s",
                [_actor(_user), int(supplier_id)],
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to deactivate supplier: {e}")


# ---------------------------------------------------------------------------
# Locations
# ---------------------------------------------------------------------------

def _supplier_exists(con, supplier_id: int) -> bool:
    return bool(con.execute("SELECT 1 FROM lca_suppliers WHERE supplier_id = %s", [int(supplier_id)]).fetchone())


@router.get("/lca/suppliers/{supplier_id}/locations")
def list_supplier_locations(supplier_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    try:
        with get_conn() as con:
            if not _supplier_exists(con, int(supplier_id)):
                raise HTTPException(status_code=404, detail="Supplier not found")
            items = _df_records(
                con,
                """
                SELECT location_id, supplier_id, location_label, address, latitude, longitude,
                       geocode_source, geocode_precision, geocoded_at, is_active
                FROM lca_supplier_locations
                WHERE supplier_id = %s AND is_active = TRUE
                ORDER BY location_label ASC
                """,
                [int(supplier_id)],
            )
            return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list supplier locations: {e}")


@router.post("/lca/suppliers/{supplier_id}/locations")
def create_supplier_location(supplier_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    """Geocodes the address on save via Nominatim (services/geocoding.py) --
    an explicit, staff-triggered single action, same as geocode_client_sites
    in api/client_management_routes.py. Saves even if geocoding fails (a
    location shouldn't be unsaveable just because Nominatim can't parse it);
    lat/lon are simply left null until a later edit/re-geocode succeeds."""
    from services.geocoding import geocode_location_detailed

    assert_permission(_user, "jobs.edit")
    location_label = str(body.get("location_label") or "").strip()
    address = str(body.get("address") or "").strip()
    if not location_label or not address:
        raise HTTPException(status_code=400, detail="location_label and address are required")
    try:
        with get_conn(autocommit=False) as con:
            if not _supplier_exists(con, int(supplier_id)):
                raise HTTPException(status_code=404, detail="Supplier not found")

            hit, _failure_reason = geocode_location_detailed(address)
            row = con.execute(
                """
                INSERT INTO lca_supplier_locations (
                  supplier_id, location_label, address, latitude, longitude,
                  geocode_source, geocode_precision, geocoded_at, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING location_id
                """,
                [
                    int(supplier_id), location_label, address,
                    hit["latitude"] if hit else None,
                    hit["longitude"] if hit else None,
                    "nominatim" if hit else None,
                    hit["precision"] if hit else None,
                    datetime.now(timezone.utc) if hit else None,
                    _actor(_user), _actor(_user),
                ],
            ).fetchone()
            return {"ok": True, "location_id": int(row[0]), "geocoded": bool(hit)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create supplier location: {e}")


@router.patch("/lca/suppliers/{supplier_id}/locations/{location_id}")
def update_supplier_location(
    supplier_id: int, location_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)
):
    """If `address` changes, re-geocodes -- same explicit-action constraint
    as creation."""
    from services.geocoding import geocode_location_detailed

    assert_permission(_user, "jobs.edit")
    try:
        with get_conn(autocommit=False) as con:
            existing = con.execute(
                "SELECT address FROM lca_supplier_locations WHERE location_id = %s AND supplier_id = %s",
                [int(location_id), int(supplier_id)],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Supplier location not found")

            updates: list[str] = []
            params: list[Any] = []
            if "location_label" in body:
                label = str(body.get("location_label") or "").strip()
                if not label:
                    raise HTTPException(status_code=400, detail="location_label cannot be blank")
                updates.append("location_label = %s")
                params.append(label)
            if "address" in body:
                new_address = str(body.get("address") or "").strip()
                if not new_address:
                    raise HTTPException(status_code=400, detail="address cannot be blank")
                if new_address != existing[0]:
                    hit, _failure_reason = geocode_location_detailed(new_address)
                    updates.extend(["address = %s", "latitude = %s", "longitude = %s", "geocode_source = %s", "geocode_precision = %s", "geocoded_at = NOW()"])
                    params.extend([
                        new_address,
                        hit["latitude"] if hit else None,
                        hit["longitude"] if hit else None,
                        "nominatim" if hit else None,
                        hit["precision"] if hit else None,
                    ])
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(bool(body.get("is_active")))
            if not updates:
                return {"ok": True}
            updates.extend(["updated_at = NOW()", "updated_by = %s"])
            params.append(_actor(_user))
            params.extend([int(location_id), int(supplier_id)])
            con.execute(
                f"UPDATE lca_supplier_locations SET {', '.join(updates)} WHERE location_id = %s AND supplier_id = %s",
                params,
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update supplier location: {e}")


@router.delete("/lca/suppliers/{supplier_id}/locations/{location_id}")
def deactivate_supplier_location(supplier_id: int, location_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    try:
        with get_conn(autocommit=False) as con:
            existing = con.execute(
                "SELECT location_id FROM lca_supplier_locations WHERE location_id = %s AND supplier_id = %s",
                [int(location_id), int(supplier_id)],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Supplier location not found")
            con.execute(
                "UPDATE lca_supplier_locations SET is_active = FALSE, updated_at = NOW(), updated_by = %s WHERE location_id = %s",
                [_actor(_user), int(location_id)],
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to deactivate supplier location: {e}")


# ---------------------------------------------------------------------------
# Components supplied
# ---------------------------------------------------------------------------

@router.get("/lca/suppliers/{supplier_id}/components")
def list_supplier_components(supplier_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    try:
        with get_conn() as con:
            if not _supplier_exists(con, int(supplier_id)):
                raise HTTPException(status_code=404, detail="Supplier not found")
            items = _df_records(
                con,
                """
                SELECT component_link_id, supplier_id, component_description, material_category_id, notes
                FROM lca_supplier_components
                WHERE supplier_id = %s
                ORDER BY component_description ASC
                """,
                [int(supplier_id)],
            )
            return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list supplier components: {e}")


@router.post("/lca/suppliers/{supplier_id}/components")
def create_supplier_component(supplier_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    component_description = str(body.get("component_description") or "").strip()
    if not component_description:
        raise HTTPException(status_code=400, detail="component_description is required")
    try:
        with get_conn(autocommit=False) as con:
            if not _supplier_exists(con, int(supplier_id)):
                raise HTTPException(status_code=404, detail="Supplier not found")
            row = con.execute(
                """
                INSERT INTO lca_supplier_components (supplier_id, component_description, material_category_id, notes, created_by)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING component_link_id
                """,
                [
                    int(supplier_id), component_description,
                    int(body.get("material_category_id")) if str(body.get("material_category_id") or "").strip().isdigit() else None,
                    str(body.get("notes") or "").strip() or None,
                    _actor(_user),
                ],
            ).fetchone()
            return {"ok": True, "component_link_id": int(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add supplier component: {e}")


@router.patch("/lca/suppliers/{supplier_id}/components/{component_link_id}")
def update_supplier_component(
    supplier_id: int, component_link_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)
):
    assert_permission(_user, "jobs.edit")
    try:
        with get_conn(autocommit=False) as con:
            existing = con.execute(
                "SELECT component_link_id FROM lca_supplier_components WHERE component_link_id = %s AND supplier_id = %s",
                [int(component_link_id), int(supplier_id)],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Supplier component not found")
            updates: list[str] = []
            params: list[Any] = []
            if "component_description" in body:
                desc = str(body.get("component_description") or "").strip()
                if not desc:
                    raise HTTPException(status_code=400, detail="component_description cannot be blank")
                updates.append("component_description = %s")
                params.append(desc)
            if "notes" in body:
                updates.append("notes = %s")
                params.append(str(body.get("notes") or "").strip() or None)
            if "material_category_id" in body:
                raw = str(body.get("material_category_id") or "").strip()
                updates.append("material_category_id = %s")
                params.append(int(raw) if raw.isdigit() else None)
            if not updates:
                return {"ok": True}
            params.extend([int(component_link_id), int(supplier_id)])
            con.execute(
                f"UPDATE lca_supplier_components SET {', '.join(updates)} WHERE component_link_id = %s AND supplier_id = %s",
                params,
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update supplier component: {e}")


@router.delete("/lca/suppliers/{supplier_id}/components/{component_link_id}")
def delete_supplier_component(supplier_id: int, component_link_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    try:
        with get_conn(autocommit=False) as con:
            con.execute(
                "DELETE FROM lca_supplier_components WHERE component_link_id = %s AND supplier_id = %s",
                [int(component_link_id), int(supplier_id)],
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete supplier component: {e}")


# ---------------------------------------------------------------------------
# Search -- powers both the "who supplies X" component lookup and the
# transport-leg origin picker.
# ---------------------------------------------------------------------------

@router.get("/lca/suppliers/search")
def search_lca_suppliers(q: str = Query(..., min_length=1), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    try:
        with get_conn() as con:
            pattern = f"%{q.strip().lower()}%"
            supplier_ids_by_name = con.execute(
                "SELECT supplier_id FROM lca_suppliers WHERE is_active = TRUE AND LOWER(supplier_name) LIKE %s",
                [pattern],
            ).fetchall()
            supplier_ids_by_component = con.execute(
                """
                SELECT DISTINCT sc.supplier_id
                FROM lca_supplier_components sc
                JOIN lca_suppliers s ON s.supplier_id = sc.supplier_id
                WHERE s.is_active = TRUE AND LOWER(sc.component_description) LIKE %s
                """,
                [pattern],
            ).fetchall()
            supplier_ids = sorted({int(r[0]) for r in (supplier_ids_by_name or []) + (supplier_ids_by_component or [])})
            if not supplier_ids:
                return {"items": []}

            suppliers = _df_records(
                con,
                "SELECT supplier_id, supplier_name, website FROM lca_suppliers WHERE supplier_id = ANY(%s) ORDER BY supplier_name ASC",
                [supplier_ids],
            )
            locations = _df_records(
                con,
                """
                SELECT location_id, supplier_id, location_label, address, latitude, longitude, geocode_precision
                FROM lca_supplier_locations
                WHERE supplier_id = ANY(%s) AND is_active = TRUE
                ORDER BY location_label ASC
                """,
                [supplier_ids],
            )
            matched_components = _df_records(
                con,
                """
                SELECT component_link_id, supplier_id, component_description
                FROM lca_supplier_components
                WHERE supplier_id = ANY(%s) AND LOWER(component_description) LIKE %s
                ORDER BY component_description ASC
                """,
                [supplier_ids, pattern],
            )

            locations_by_supplier: dict[int, list[dict[str, Any]]] = {}
            for loc in locations:
                locations_by_supplier.setdefault(int(loc["supplier_id"]), []).append(loc)
            components_by_supplier: dict[int, list[dict[str, Any]]] = {}
            for comp in matched_components:
                components_by_supplier.setdefault(int(comp["supplier_id"]), []).append(comp)

            items = []
            for supplier in suppliers:
                sid = int(supplier["supplier_id"])
                items.append({
                    **supplier,
                    "locations": locations_by_supplier.get(sid, []),
                    "matched_components": components_by_supplier.get(sid, []),
                })
            return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search suppliers: {e}")
