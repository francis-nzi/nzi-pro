from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from api.permissions import assert_job_access, assert_permission
from core.database import get_conn

router = APIRouter(tags=["job-line-items"])

_schema_seeded: bool = False


def _ensure_table(con) -> None:
    global _schema_seeded
    if _schema_seeded:
        return
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS job_line_items (
              line_item_id BIGSERIAL PRIMARY KEY,
              job_id INTEGER NOT NULL,
              item_id INTEGER,
              item_name VARCHAR(255) NOT NULL,
              item_code VARCHAR(100),
              description TEXT,
              category VARCHAR(100),
              quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
              estimated_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
              unit VARCHAR(50) DEFAULT 'day',
              unit_sell NUMERIC(12,2) DEFAULT 0,
              sell_currency VARCHAR(10) DEFAULT 'GBP',
              vat_rate NUMERIC(5,2) DEFAULT 20.00,
              vat_rate_id INTEGER,
              notes TEXT,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_by VARCHAR,
              created_at TIMESTAMP NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
        con.execute("CREATE INDEX IF NOT EXISTS ix_job_line_items_job ON job_line_items (job_id, sort_order)")
        # Migrate: add description column if not present (idempotent)
        try:
            con.execute("ALTER TABLE job_line_items ADD COLUMN IF NOT EXISTS description TEXT")
        except Exception:
            pass
        _schema_seeded = True
    except Exception as _e:
        import sys
        print(f"[warn] job_line_items schema: {_e}", file=sys.stderr)


def _safe_float(v, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        f = float(v)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


def _safe_int(v, default: int | None = None) -> int | None:
    if v is None:
        return default
    try:
        f = float(v)
        return default if (math.isnan(f) or math.isinf(f)) else int(f)
    except (TypeError, ValueError):
        return default


def _serialize(row: dict[str, Any]) -> dict[str, Any]:
    qty = _safe_float(row.get("quantity"), 1.0)
    hrs = _safe_float(row.get("estimated_hours"), 0.0)
    return {
        "line_item_id": _safe_int(row.get("line_item_id")) or 0,
        "job_id": _safe_int(row.get("job_id")) or 0,
        "item_id": _safe_int(row.get("item_id")),
        "item_name": str(row.get("item_name") or ""),
        "item_code": str(row.get("item_code") or ""),
        "description": str(row.get("description") or ""),
        "category": str(row.get("category") or ""),
        "quantity": qty,
        "estimated_hours": hrs,
        "total_hours": round(qty * hrs, 2),
        "unit": str(row.get("unit") or "day"),
        "unit_sell": _safe_float(row.get("unit_sell"), 0.0),
        "sell_currency": str(row.get("sell_currency") or "GBP"),
        "vat_rate": _safe_float(row.get("vat_rate"), 20.0),
        "vat_rate_id": _safe_int(row.get("vat_rate_id")),
        "notes": str(row.get("notes") or ""),
        "sort_order": _safe_int(row.get("sort_order")) or 0,
        "created_by": str(row.get("created_by") or ""),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
    }


def _budget_summary(con, job_id: int) -> dict[str, Any]:
    """Return budgeted hours (from line items) and logged hours (from time_logs)."""
    budget_row = con.execute(
        "SELECT COALESCE(SUM(quantity * estimated_hours), 0) FROM job_line_items WHERE job_id = %s",
        [job_id],
    ).fetchone()
    budgeted = _safe_float(budget_row[0] if budget_row else 0)

    try:
        logged_row = con.execute(
            "SELECT COALESCE(SUM(minutes), 0) FROM time_logs WHERE job_id = %s",
            [job_id],
        ).fetchone()
        logged = _safe_float(logged_row[0] if logged_row else 0) / 60.0
    except Exception:
        logged = 0.0

    variance = round(budgeted - logged, 2)
    over_budget = logged > budgeted and budgeted > 0
    pct_used = round((logged / budgeted * 100), 1) if budgeted > 0 else None

    return {
        "budgeted_hours": round(budgeted, 2),
        "logged_hours": round(logged, 2),
        "variance_hours": variance,
        "pct_used": pct_used,
        "over_budget": over_budget,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}/line-items")
def list_job_line_items(job_id: int, _user: dict = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    try:
        with get_conn() as con:
            _ensure_table(con)
            assert_job_access(_user, int(job_id))
            df = con.execute(
                """
                SELECT line_item_id, job_id, item_id, item_name, item_code, description, category,
                       quantity, estimated_hours, unit, unit_sell, sell_currency,
                       vat_rate, vat_rate_id, notes, sort_order, created_by, created_at, updated_at
                FROM job_line_items
                WHERE job_id = %s
                ORDER BY sort_order, line_item_id
                """,
                [int(job_id)],
            ).df()
            items = []
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    items.append(_serialize(row.to_dict()))
            summary = _budget_summary(con, int(job_id))
        return {"items": items, "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load job line items: {e}")


@router.post("/jobs/{job_id}/line-items")
def create_job_line_item(job_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    item_name = str(body.get("item_name") or "").strip()
    if not item_name:
        raise HTTPException(status_code=400, detail="item_name is required")
    try:
        actor = str(_user.get("email") or _user.get("user_id") or "system")
        with get_conn() as con:
            _ensure_table(con)
            assert_job_access(_user, int(job_id))
            row = con.execute(
                """
                INSERT INTO job_line_items (
                  job_id, item_id, item_name, item_code, description, category,
                  quantity, estimated_hours, unit, unit_sell, sell_currency,
                  vat_rate, vat_rate_id, notes, sort_order, created_by, created_at, updated_at
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                RETURNING line_item_id
                """,
                [
                    int(job_id),
                    _safe_int(body.get("item_id")),
                    item_name,
                    str(body.get("item_code") or "").strip() or None,
                    str(body.get("description") or "").strip() or None,
                    str(body.get("category") or "").strip() or None,
                    float(body.get("quantity") or 1),
                    float(body.get("estimated_hours") or 0),
                    str(body.get("unit") or "day"),
                    float(body.get("unit_sell") or 0),
                    str(body.get("sell_currency") or "GBP"),
                    float(body.get("vat_rate") or 20),
                    _safe_int(body.get("vat_rate_id")),
                    str(body.get("notes") or "").strip() or None,
                    int(body.get("sort_order") or 0),
                    actor,
                ],
            ).fetchone()
            line_item_id = int(row[0])
            df = con.execute(
                "SELECT * FROM job_line_items WHERE line_item_id = %s", [line_item_id]
            ).df()
            item = _serialize(df.iloc[0].to_dict()) if df is not None and not df.empty else {"line_item_id": line_item_id}
            summary = _budget_summary(con, int(job_id))
        return {"item": item, "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create job line item: {e}")


@router.patch("/jobs/{job_id}/line-items/{line_item_id}")
def update_job_line_item(
    job_id: int, line_item_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)
):
    assert_permission(_user, "jobs.edit")
    try:
        with get_conn() as con:
            _ensure_table(con)
            assert_job_access(_user, int(job_id))
            exists = con.execute(
                "SELECT 1 FROM job_line_items WHERE line_item_id = %s AND job_id = %s",
                [int(line_item_id), int(job_id)],
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Line item not found")

            updates: list[str] = []
            params: list[Any] = []
            field_map = {
                "item_name": lambda v: str(v or "").strip(),
                "item_code": lambda v: str(v or "").strip() or None,
                "description": lambda v: str(v or "").strip() or None,
                "category": lambda v: str(v or "").strip() or None,
                "quantity": lambda v: float(v or 1),
                "estimated_hours": lambda v: float(v or 0),
                "unit": lambda v: str(v or "day"),
                "unit_sell": lambda v: float(v or 0),
                "sell_currency": lambda v: str(v or "GBP"),
                "vat_rate": lambda v: float(v or 20),
                "notes": lambda v: str(v or "").strip() or None,
                "sort_order": lambda v: int(v or 0),
            }
            for field, coerce in field_map.items():
                if field in body:
                    updates.append(f"{field} = %s")
                    params.append(coerce(body[field]))
            if "vat_rate_id" in body:
                updates.append("vat_rate_id = %s")
                params.append(_safe_int(body["vat_rate_id"]))
            if "item_id" in body:
                updates.append("item_id = %s")
                params.append(_safe_int(body["item_id"]))

            if not updates:
                return {"ok": True, "message": "Nothing to update"}

            updates.append("updated_at = NOW()")
            params.extend([int(line_item_id), int(job_id)])
            con.execute(
                f"UPDATE job_line_items SET {', '.join(updates)} WHERE line_item_id = %s AND job_id = %s",
                params,
            )
            df = con.execute(
                "SELECT * FROM job_line_items WHERE line_item_id = %s", [int(line_item_id)]
            ).df()
            item = _serialize(df.iloc[0].to_dict()) if df is not None and not df.empty else {"line_item_id": line_item_id}
            summary = _budget_summary(con, int(job_id))
        return {"item": item, "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update job line item: {e}")


@router.delete("/jobs/{job_id}/line-items/{line_item_id}")
def delete_job_line_item(job_id: int, line_item_id: int, _user: dict = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    try:
        with get_conn() as con:
            _ensure_table(con)
            assert_job_access(_user, int(job_id))
            con.execute(
                "DELETE FROM job_line_items WHERE line_item_id = %s AND job_id = %s",
                [int(line_item_id), int(job_id)],
            )
            summary = _budget_summary(con, int(job_id))
        return {"ok": True, "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete job line item: {e}")


@router.post("/jobs/{job_id}/line-items/apply-template")
def apply_template_to_job(job_id: int, body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    """Copy job_type_items template onto this job's line items.

    By default clears existing items first. Pass {"replace": false} to append.
    """
    assert_permission(_user, "jobs.edit")
    replace = bool(body.get("replace", True))
    try:
        actor = str(_user.get("email") or _user.get("user_id") or "system")
        with get_conn() as con:
            _ensure_table(con)
            assert_job_access(_user, int(job_id))

            job_row = con.execute(
                "SELECT job_type_id FROM jobs WHERE job_id = %s", [int(job_id)]
            ).fetchone()
            if not job_row or job_row[0] is None:
                raise HTTPException(status_code=400, detail="Job has no job type assigned")
            job_type_id = int(job_row[0])

            template_df = con.execute(
                """
                SELECT jti.item_id, jti.quantity, jti.sort_order,
                       ji.item_name, ji.item_code, ji.description, ji.category, ji.unit,
                       ji.estimated_hours, ji.sell_amount, ji.sell_currency,
                       ji.vat_rate, ji.vat_rate_id
                FROM job_type_items jti
                JOIN job_items ji ON ji.item_id = jti.item_id
                WHERE jti.job_type_id = %s
                ORDER BY jti.sort_order, ji.item_name
                """,
                [job_type_id],
            ).df()

            if template_df is None or template_df.empty:
                raise HTTPException(
                    status_code=404,
                    detail="No template items found for this job type. Add items in Admin → Job Type Templates first.",
                )

            if replace:
                con.execute("DELETE FROM job_line_items WHERE job_id = %s", [int(job_id)])

            for _, trow in template_df.iterrows():
                con.execute(
                    """
                    INSERT INTO job_line_items (
                      job_id, item_id, item_name, item_code, description, category,
                      quantity, estimated_hours, unit, unit_sell, sell_currency,
                      vat_rate, vat_rate_id, sort_order, created_by, created_at, updated_at
                    )
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                    """,
                    [
                        int(job_id),
                        _safe_int(trow.get("item_id")),
                        str(trow.get("item_name") or ""),
                        str(trow.get("item_code") or "").strip() or None,
                        str(trow.get("description") or "").strip() or None,
                        str(trow.get("category") or "").strip() or None,
                        _safe_float(trow.get("quantity"), 1.0),
                        _safe_float(trow.get("estimated_hours"), 0.0),
                        str(trow.get("unit") or "day"),
                        _safe_float(trow.get("sell_amount"), 0.0),
                        str(trow.get("sell_currency") or "GBP"),
                        _safe_float(trow.get("vat_rate"), 20.0),
                        _safe_int(trow.get("vat_rate_id")),
                        _safe_int(trow.get("sort_order")) or 0,
                        actor,
                    ],
                )

            df = con.execute(
                "SELECT * FROM job_line_items WHERE job_id = %s ORDER BY sort_order, line_item_id",
                [int(job_id)],
            ).df()
            items = [_serialize(r.to_dict()) for _, r in df.iterrows()] if df is not None and not df.empty else []
            summary = _budget_summary(con, int(job_id))
        return {"ok": True, "items_created": len(items), "items": items, "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to apply template: {e}")


@router.post("/jobs/{job_id}/line-items/create-invoice")
def create_invoice_from_line_items(
    job_id: int, body: dict = Body(default={}), _user: dict = Depends(_current_user)
):
    """Create a draft invoice pre-populated with this job's line items."""
    assert_permission(_user, "invoices.create")
    try:
        from datetime import date, timedelta
        with get_conn() as con:
            _ensure_table(con)
            assert_job_access(_user, int(job_id))

            job_row = con.execute(
                "SELECT client_db_id, job_number, title FROM jobs WHERE job_id = %s", [int(job_id)]
            ).fetchone()
            if not job_row:
                raise HTTPException(status_code=404, detail="Job not found")
            client_db_id = int(job_row[0]) if job_row[0] is not None else None
            if not client_db_id:
                raise HTTPException(status_code=400, detail="Job has no client assigned")

            items_df = con.execute(
                """
                SELECT line_item_id, item_id, item_name, item_code, category,
                       quantity, estimated_hours, unit, unit_sell, sell_currency,
                       vat_rate, vat_rate_id, notes, sort_order
                FROM job_line_items
                WHERE job_id = %s
                ORDER BY sort_order, line_item_id
                """,
                [int(job_id)],
            ).df()

            if items_df is None or items_df.empty:
                raise HTTPException(status_code=400, detail="No line items on this job — add items first")

            invoice_date = str(body.get("invoice_date") or date.today().isoformat())
            due_date_val = str(body.get("due_date") or (date.today() + timedelta(days=30)).isoformat())
            currency = str(body.get("currency") or "GBP")

            subtotal = 0.0
            total_vat = 0.0
            for _, r in items_df.iterrows():
                qty = _safe_float(r.get("quantity"), 1.0)
                unit_sell = _safe_float(r.get("unit_sell"), 0.0)
                vat_pct = _safe_float(r.get("vat_rate"), 20.0)
                line_ex = round(qty * unit_sell, 2)
                subtotal += line_ex
                total_vat += round(line_ex * vat_pct / 100, 2)

            total = round(subtotal + total_vat, 2)

            try:
                org_id = _user.get("org_id")
            except Exception:
                org_id = None

            inv_row = con.execute(
                """
                INSERT INTO invoices (client_db_id, job_id, invoice_date, due_date, currency_code,
                                      subtotal, vat, total, status, notes, org_id, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'Draft',%s,%s,NOW(),NOW())
                RETURNING invoice_id
                """,
                [
                    client_db_id,
                    int(job_id),
                    invoice_date,
                    due_date_val,
                    currency,
                    round(subtotal, 2),
                    round(total_vat, 2),
                    total,
                    str(body.get("notes") or f"Invoice for {job_row[1]} – {job_row[2]}").strip(),
                    org_id,
                ],
            ).fetchone()
            invoice_id = int(inv_row[0])

            for idx, (_, r) in enumerate(items_df.iterrows()):
                qty = _safe_float(r.get("quantity"), 1.0)
                unit_sell = _safe_float(r.get("unit_sell"), 0.0)
                vat_pct = _safe_float(r.get("vat_rate"), 20.0)
                con.execute(
                    """
                    INSERT INTO invoice_lines (
                      invoice_id, sort_order, item_id, description, unit, qty,
                      unit_price_ex_vat, amount_ex_vat, vat_rate_id, vat_rate_pct, notes, org_id
                    )
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    [
                        invoice_id,
                        idx,
                        _safe_int(r.get("item_id")),
                        str(r.get("item_name") or ""),
                        str(r.get("unit") or "day"),
                        qty,
                        unit_sell,
                        round(qty * unit_sell, 2),
                        _safe_int(r.get("vat_rate_id")),
                        vat_pct,
                        str(r.get("notes") or "").strip() or None,
                        org_id,
                    ],
                )

        return {
            "ok": True,
            "invoice_id": invoice_id,
            "lines_created": len(items_df),
            "subtotal": round(subtotal, 2),
            "vat": round(total_vat, 2),
            "total": total,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create invoice: {e}")
