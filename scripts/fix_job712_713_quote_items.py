"""One-off: fix jobs 712 and 713, whose Job Items came from the generic
job_type_items template instead of the quote actually accepted to create
them (see api/job_management_routes.py create_job() -- the "Accept &
Create Job" flow existed since 2026-08-13 but never wired quote_lines into
job creation until this fix). These are the only two jobs created via that
flow to date.

Does NOT touch invoices/invoice_lines for these jobs -- those were already
verified correct (sourced from the quote independently) and already sent
to the client.
"""
from __future__ import annotations

from api.job_line_items_routes import _safe_float, _safe_int
from core.database import get_conn

# (job_id, job_number) -> matched by job_number against quotes.job_number,
# since quote_id wasn't backfillable any other way for jobs created before
# the jobs.quote_id column existed.
_JOBS_TO_FIX = [713, 712]


def main() -> None:
    with get_conn(autocommit=False) as con:
        for job_id in _JOBS_TO_FIX:
            job = con.execute("SELECT job_number, quote_id FROM jobs WHERE job_id = %s", [job_id]).fetchone()
            if not job:
                print(f"job {job_id}: not found -- skipped")
                continue
            job_number, existing_quote_id = job

            quote = con.execute(
                "SELECT quote_id, quote_number FROM quotes WHERE job_number = %s", [job_number]
            ).fetchone()
            if not quote:
                print(f"job {job_id} ({job_number}): no matching quote found -- skipped")
                continue
            quote_id, quote_number = quote

            old_items = con.execute(
                "SELECT line_item_id, item_name, quantity, estimated_hours, unit_sell FROM job_line_items WHERE job_id = %s",
                [job_id],
            ).fetchall()
            print(f"job {job_id} ({job_number}) <- quote {quote_id} ({quote_number}): removing {len(old_items)} existing line(s):")
            for old in old_items:
                print(f"  was: {old}")

            con.execute("DELETE FROM job_line_items WHERE job_id = %s", [job_id])

            new_lines = con.execute(
                """
                SELECT ql.item_id, ql.qty AS quantity, ql.sort_order,
                       COALESCE(ji.item_name, ql.description) AS item_name,
                       ji.item_code,
                       ql.description,
                       COALESCE(ql.category, ji.category) AS category,
                       COALESCE(ql.unit, ji.unit) AS unit,
                       ji.estimated_hours,
                       ql.unit_price_ex_vat AS sell_amount,
                       ji.sell_currency,
                       ql.vat_rate_pct AS vat_rate,
                       ql.vat_rate_id,
                       ql.notes
                FROM quote_lines ql
                LEFT JOIN job_items ji ON ji.item_id = ql.item_id
                WHERE ql.quote_id = %s AND ql.is_selected IS NOT FALSE
                ORDER BY ql.sort_order, ql.line_id
                """,
                [quote_id],
            ).df()

            actor_email = "system@netzero.international"
            for _, row in new_lines.iterrows():
                con.execute(
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
                        job_id,
                        _safe_int(row.get("item_id")),
                        str(row.get("item_name") or ""),
                        str(row.get("item_code") or "").strip() or None,
                        str(row.get("description") or "").strip() or None,
                        str(row.get("category") or "").strip() or None,
                        _safe_float(row.get("quantity"), 1.0),
                        _safe_float(row.get("estimated_hours"), 0.0),
                        str(row.get("unit") or "day"),
                        _safe_float(row.get("sell_amount"), 0.0),
                        str(row.get("sell_currency") or "GBP"),
                        _safe_float(row.get("vat_rate"), 20.0),
                        _safe_int(row.get("vat_rate_id")),
                        str(row.get("notes") or "").strip() or None,
                        _safe_int(row.get("sort_order")) or 0,
                        actor_email,
                    ],
                ).fetchone()
                print(f"  now:  item_id={row.get('item_id')} qty={row.get('quantity')} hrs={row.get('estimated_hours')} sell={row.get('sell_amount')}")

            if existing_quote_id != quote_id:
                con.execute("UPDATE jobs SET quote_id = %s WHERE job_id = %s", [quote_id, job_id])
                print(f"  backfilled jobs.quote_id = {quote_id}")


if __name__ == "__main__":
    main()
