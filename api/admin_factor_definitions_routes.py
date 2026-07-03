from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from api.permissions import ADMIN_ACCESS_PERMISSION, require_permission
from core.database import get_conn

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)

_EDITABLE_FIELDS = {
    "category", "level_1", "level_2", "level_3", "level_4",
    "report_label", "scope", "uom", "ghg_unit", "source", "region", "method",
}


@router.get("/factor-definitions")
def list_factor_definitions(
    q: str = Query(""),
    scope: str = Query(""),
    source: str = Query(""),
    archived: str = Query("false"),  # "false" | "true" | "all"
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    with get_conn() as con:
        conditions: list[str] = []
        params: list[Any] = []

        if q:
            like = f"%{q.lower()}%"
            conditions.append(
                "(LOWER(COALESCE(efd.report_label,'')) LIKE %s"
                " OR LOWER(COALESCE(efd.category,'')) LIKE %s"
                " OR LOWER(COALESCE(efd.level_1,'')) LIKE %s"
                " OR LOWER(COALESCE(efd.level_2,'')) LIKE %s"
                " OR LOWER(COALESCE(efd.source,'')) LIKE %s)"
            )
            params.extend([like, like, like, like, like])

        if scope:
            conditions.append("efd.scope = %s")
            params.append(scope)

        if source:
            conditions.append("efd.source = %s")
            params.append(source)

        if archived == "true":
            conditions.append("efd.archived = TRUE")
        elif archived != "all":
            conditions.append("efd.archived = FALSE")

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        total_row = con.execute(
            f"SELECT COUNT(*) FROM emission_factor_definitions efd {where}",
            params,
        ).fetchone()
        total = int(total_row[0] or 0)

        offset = (page - 1) * per_page
        rows = con.execute(
            f"""
            SELECT
                efd.factor_id,
                efd.scope,
                efd.category,
                efd.level_1,
                efd.level_2,
                efd.level_3,
                efd.level_4,
                efd.uom,
                efd.ghg_unit,
                efd.report_label,
                efd.source,
                efd.region,
                efd.method,
                efd.archived,
                efd.archived_at,
                COUNT(efyv.factor_year_value_id) AS year_value_count
            FROM emission_factor_definitions efd
            LEFT JOIN emission_factor_year_values efyv ON efyv.factor_id = efd.factor_id
            {where}
            GROUP BY efd.factor_id
            ORDER BY efd.factor_id
            LIMIT %s OFFSET %s
            """,
            params + [per_page, offset],
        ).fetchall()

        cols = [
            "factor_id", "scope", "category", "level_1", "level_2", "level_3", "level_4",
            "uom", "ghg_unit", "report_label", "source", "region", "method",
            "archived", "archived_at", "year_value_count",
        ]
        items = []
        for r in rows:
            item = dict(zip(cols, r))
            if item.get("archived_at"):
                item["archived_at"] = str(item["archived_at"])
            item["year_value_count"] = int(item["year_value_count"] or 0)
            items.append(item)

        scopes = [
            r[0]
            for r in con.execute(
                "SELECT DISTINCT scope FROM emission_factor_definitions WHERE scope IS NOT NULL ORDER BY scope"
            ).fetchall()
        ]
        sources = [
            r[0]
            for r in con.execute(
                "SELECT DISTINCT source FROM emission_factor_definitions"
                " WHERE source IS NOT NULL AND TRIM(source) != '' ORDER BY source"
            ).fetchall()
        ]

        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": max(1, (total + per_page - 1) // per_page),
            "scopes": scopes,
            "sources": sources,
        }


@router.patch("/factor-definitions/{factor_id}")
def update_factor_definition(
    factor_id: int,
    body: dict = Body(...),
) -> dict[str, Any]:
    updates = {k: (v or None) for k, v in body.items() if k in _EDITABLE_FIELDS}
    if not updates:
        raise HTTPException(400, "No valid fields to update")

    with get_conn() as con:
        if not con.execute(
            "SELECT 1 FROM emission_factor_definitions WHERE factor_id = %s", [factor_id]
        ).fetchone():
            raise HTTPException(404, "Factor definition not found")

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        con.execute(
            f"UPDATE emission_factor_definitions SET {set_clause} WHERE factor_id = %s",
            list(updates.values()) + [factor_id],
        )

    return {"ok": True, "updated": sorted(updates.keys())}


@router.post("/factor-definitions/{factor_id}/archive")
def toggle_archive_factor_definition(
    factor_id: int,
    body: dict = Body(default={}),
) -> dict[str, Any]:
    archive = bool(body.get("archived", True))

    with get_conn() as con:
        if not con.execute(
            "SELECT 1 FROM emission_factor_definitions WHERE factor_id = %s", [factor_id]
        ).fetchone():
            raise HTTPException(404, "Factor definition not found")

        if archive:
            con.execute(
                "UPDATE emission_factor_definitions SET archived = TRUE, archived_at = NOW() WHERE factor_id = %s",
                [factor_id],
            )
        else:
            con.execute(
                "UPDATE emission_factor_definitions SET archived = FALSE, archived_at = NULL WHERE factor_id = %s",
                [factor_id],
            )

    return {"ok": True, "archived": archive}
