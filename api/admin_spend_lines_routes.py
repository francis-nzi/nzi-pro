"""Admin Centre — Spend Lines.

A curated, business-friendly list of Purchased Goods & Services categories
(e.g. "IT Consultancy") each linked to a real v_factor_lookup factor, plus a
comma-separated keyword list used by the "Suggest Spend Line" matcher
(services/spend_line_matching.py) to guess a Spend Line from a client's raw
GL/nominal ledger line description. Supplements, rather than replaces, the
existing raw category search everywhere it's already offered.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from api.permissions import ADMIN_ACCESS_PERMISSION, require_permission
from api.spend_data_routes import _factor_by_id, _factor_category_expr, _factor_label_expr
from core.database import get_conn

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)

_PGS_CATEGORY = "Purchased Goods and Services"
_schema_ready = False


def _ensure_spend_lines_schema(con) -> None:
    global _schema_ready
    if _schema_ready:
        return
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS spend_lines (
          spend_line_id SERIAL PRIMARY KEY,
          label VARCHAR NOT NULL,
          keywords VARCHAR,
          factor_db_id INT,
          dataset_id INT,
          original_id VARCHAR,
          scope VARCHAR,
          category VARCHAR,
          report_label VARCHAR,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_spend_lines_active ON spend_lines (is_active)")
    _schema_ready = True


def _spend_line_row_to_dict(row: tuple) -> dict[str, Any]:
    return {
        "spend_line_id": int(row[0]),
        "label": row[1],
        "keywords": row[2],
        "factor_db_id": int(row[3]) if row[3] is not None else None,
        "dataset_id": int(row[4]) if row[4] is not None else None,
        "original_id": row[5],
        "scope": row[6],
        "category": row[7],
        "report_label": row[8],
        "is_active": bool(row[9]),
        "created_at": str(row[10]) if row[10] is not None else None,
        "updated_at": str(row[11]) if row[11] is not None else None,
    }


@router.get("/spend-lines/category-options")
def search_spend_line_category_options(
    q: str = Query("", min_length=0),
    limit: int = Query(30, ge=1, le=100),
    _user: dict = Depends(_current_user),
):
    """Job-independent PG&S category search for the admin Spend Line form's
    category picker -- unlike the CRM/portal factor search endpoints, this
    isn't scoped to a job's active dataset since a Spend Line is a
    org-wide, not job-specific, concept."""
    with get_conn() as con:
        category_expr = _factor_category_expr(con, "f")
        label_expr = _factor_label_expr(con, "f")
        rows = con.execute(
            f"""
            SELECT f.db_id, f.dataset_id, f.original_id, f.scope, {label_expr} AS report_label
            FROM v_factor_lookup f
            LEFT JOIN datasets d ON d.dataset_id = f.dataset_id
            WHERE (d.archived IS NULL OR d.archived = FALSE)
              AND {category_expr} = %s
              AND (%s = '' OR {label_expr} ILIKE %s OR f.original_id ILIKE %s)
            ORDER BY {label_expr}
            LIMIT %s
            """,
            [_PGS_CATEGORY, q, f"%{q}%", f"%{q}%", int(limit)],
        ).fetchall()
    return {
        "items": [
            {"db_id": int(r[0]), "dataset_id": int(r[1]) if r[1] is not None else None, "original_id": r[2], "scope": r[3], "report_label": r[4]}
            for r in rows
        ]
    }


@router.get("/spend-lines")
def list_spend_lines(
    q: str = Query(""),
    include_inactive: bool = Query(False),
    _user: dict = Depends(_current_user),
):
    with get_conn() as con:
        _ensure_spend_lines_schema(con)
        where = ["1=1"]
        params: list[Any] = []
        if not include_inactive:
            where.append("is_active = TRUE")
        if q.strip():
            where.append("(label ILIKE %s OR keywords ILIKE %s)")
            params.extend([f"%{q.strip()}%", f"%{q.strip()}%"])
        rows = con.execute(
            f"""
            SELECT spend_line_id, label, keywords, factor_db_id, dataset_id, original_id,
                   scope, category, report_label, is_active, created_at, updated_at
            FROM spend_lines
            WHERE {" AND ".join(where)}
            ORDER BY label
            """,
            params,
        ).fetchall()
    return {"items": [_spend_line_row_to_dict(r) for r in rows]}


@router.post("/spend-lines")
def create_spend_line(payload: dict = Body(...), _user: dict = Depends(_current_user)):
    label = str(payload.get("label") or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="label is required")
    factor_db_id = payload.get("factor_db_id")
    if not factor_db_id:
        raise HTTPException(status_code=400, detail="factor_db_id is required -- pick a PG&S category to link this Spend Line to")
    keywords = str(payload.get("keywords") or "").strip() or None

    with get_conn() as con:
        _ensure_spend_lines_schema(con)
        factor = _factor_by_id(con, int(factor_db_id))
        if not factor:
            raise HTTPException(status_code=404, detail="Category not found")
        if str(factor.get("category") or "") != _PGS_CATEGORY:
            raise HTTPException(status_code=400, detail="That isn't a Purchased Goods and Services category")

        result = con.execute(
            """
            INSERT INTO spend_lines (label, keywords, factor_db_id, dataset_id, original_id, scope, category, report_label)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING spend_line_id
            """,
            [
                label, keywords, factor.get("db_id"), factor.get("dataset_id"), factor.get("original_id"),
                factor.get("scope"), factor.get("category"), factor.get("report_label"),
            ],
        ).fetchone()

    return {"ok": True, "spend_line_id": int(result[0])}


@router.patch("/spend-lines/{spend_line_id}")
def update_spend_line(spend_line_id: int, payload: dict = Body(...), _user: dict = Depends(_current_user)):
    with get_conn() as con:
        _ensure_spend_lines_schema(con)
        existing = con.execute("SELECT 1 FROM spend_lines WHERE spend_line_id = %s", [int(spend_line_id)]).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Spend Line not found")

        set_clauses: list[str] = []
        params: list[Any] = []
        if "label" in payload:
            label = str(payload.get("label") or "").strip()
            if not label:
                raise HTTPException(status_code=400, detail="label cannot be empty")
            set_clauses.append("label = %s")
            params.append(label)
        if "keywords" in payload:
            set_clauses.append("keywords = %s")
            params.append(str(payload.get("keywords") or "").strip() or None)
        if "is_active" in payload:
            set_clauses.append("is_active = %s")
            params.append(bool(payload.get("is_active")))
        if "factor_db_id" in payload and payload.get("factor_db_id"):
            factor = _factor_by_id(con, int(payload["factor_db_id"]))
            if not factor:
                raise HTTPException(status_code=404, detail="Category not found")
            if str(factor.get("category") or "") != _PGS_CATEGORY:
                raise HTTPException(status_code=400, detail="That isn't a Purchased Goods and Services category")
            set_clauses.extend(["factor_db_id = %s", "dataset_id = %s", "original_id = %s", "scope = %s", "category = %s", "report_label = %s"])
            params.extend([
                factor.get("db_id"), factor.get("dataset_id"), factor.get("original_id"),
                factor.get("scope"), factor.get("category"), factor.get("report_label"),
            ])

        if not set_clauses:
            return {"ok": True, "spend_line_id": spend_line_id}

        set_clauses.append("updated_at = NOW()")
        params.append(int(spend_line_id))
        con.execute(f"UPDATE spend_lines SET {', '.join(set_clauses)} WHERE spend_line_id = %s", params)

    return {"ok": True, "spend_line_id": spend_line_id}


@router.delete("/spend-lines/{spend_line_id}")
def delete_spend_line(spend_line_id: int, _user: dict = Depends(_current_user)):
    with get_conn() as con:
        _ensure_spend_lines_schema(con)
        existing = con.execute("SELECT 1 FROM spend_lines WHERE spend_line_id = %s", [int(spend_line_id)]).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Spend Line not found")
        con.execute("UPDATE spend_lines SET is_active = FALSE, updated_at = NOW() WHERE spend_line_id = %s", [int(spend_line_id)])
    return {"ok": True, "spend_line_id": spend_line_id}
