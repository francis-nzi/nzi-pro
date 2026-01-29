from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import pandas as pd

from core.database import db_backend, get_conn, next_id


@dataclass
class QuoteTotals:
    subtotal_ex_vat: float
    vat_total: float
    total_inc_vat: float


def _today() -> date:
    return date.today()


def _default_valid_to(d: date | None) -> date:
    base = d or _today()
    return base + timedelta(days=30)


def list_quotes(client_db_id: int) -> pd.DataFrame:
    with get_conn() as con:
        return con.execute(
            """
            SELECT quote_id, quote_date, valid_to, status, salesperson
            FROM quotes
            WHERE client_db_id=?
            ORDER BY quote_id DESC
            """,
            [int(client_db_id)],
        ).df()


def get_quote(quote_id: int) -> dict[str, Any] | None:
    with get_conn() as con:
        qdf = con.execute("SELECT * FROM quotes WHERE quote_id=?", [int(quote_id)]).df()
        if qdf.empty:
            return None
        quote = qdf.iloc[0].to_dict()
        ldf = con.execute(
            """
            SELECT line_id, quote_id, line_type, sort_order, job_type_id, description,
                   qty, unit_price_ex_vat, vat_rate_id, is_selected
            FROM quote_lines
            WHERE quote_id=?
            ORDER BY sort_order, line_id
            """,
            [int(quote_id)],
        ).df()
        quote["lines"] = ldf
        return quote


def create_quote(
    client_db_id: int,
    contact_id: int | None,
    quote_date: date | None,
    valid_to: date | None,
    salesperson: str | None,
    payment_term_id: int | None,
    currency_code: str | None,
    description: str | None,
    notes: str | None,
) -> int:
    backend = db_backend()
    qd = quote_date or _today()
    vt = valid_to or _default_valid_to(qd)

    with get_conn() as con:
        if backend == "postgres":
            row = con.execute(
                """
                INSERT INTO quotes
                  (client_db_id, contact_id, quote_date, valid_to, salesperson, payment_term_id,
                   currency_code, description, notes, status)
                VALUES
                  (?,?,?,?,?,?,?,?,?,'Draft')
                RETURNING quote_id
                """,
                [
                    int(client_db_id),
                    int(contact_id) if contact_id is not None else None,
                    qd,
                    vt,
                    (salesperson or "").strip() or None,
                    int(payment_term_id) if payment_term_id is not None else None,
                    (currency_code or "GBP").strip().upper(),
                    (description or "").strip() or None,
                    (notes or "").strip() or None,
                ],
            ).fetchone()
            return int(row[0])

        qid = next_id("quotes", "quote_id")
        con.execute(
            """
            INSERT INTO quotes
              (quote_id, client_db_id, contact_id, quote_date, valid_to, salesperson, payment_term_id,
               currency_code, description, notes, status, created_at, updated_at)
            VALUES
              (?,?,?,?,?,?,?,?,?,?,'Draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            [
                int(qid),
                int(client_db_id),
                int(contact_id) if contact_id is not None else None,
                qd,
                vt,
                (salesperson or "").strip() or None,
                int(payment_term_id) if payment_term_id is not None else None,
                (currency_code or "GBP").strip().upper(),
                (description or "").strip() or None,
                (notes or "").strip() or None,
            ],
        )
        return int(qid)


def update_quote(quote_id: int, updates: dict[str, Any]) -> None:
    allowed = {
        "contact_id",
        "quote_date",
        "valid_to",
        "salesperson",
        "payment_term_id",
        "currency_code",
        "description",
        "notes",
        "status",
        "revision_of_quote_id",
    }
    cols = [k for k in (updates or {}).keys() if k in allowed]
    if not cols:
        return

    sets = ", ".join([f"{c}=?" for c in cols])
    vals = [updates.get(c) for c in cols]
    vals.append(int(quote_id))

    with get_conn() as con:
        con.execute(f"UPDATE quotes SET {sets}, updated_at=CURRENT_TIMESTAMP WHERE quote_id=?", vals)


def replace_quote_lines(quote_id: int, lines: list[dict[str, Any]]) -> None:
    backend = db_backend()
    with get_conn() as con:
        con.execute("DELETE FROM quote_lines WHERE quote_id=?", [int(quote_id)])

        for idx, ln in enumerate(lines or [], start=1):
            line_type = (ln.get("line_type") or "Line").strip() or "Line"
            job_type_id = ln.get("job_type_id")
            desc = (ln.get("description") or "").strip() or None
            qty = float(ln.get("qty") or 0)
            unit_price = float(ln.get("unit_price_ex_vat") or 0)
            vat_rate_id = ln.get("vat_rate_id")
            is_selected = bool(ln.get("is_selected") if ln.get("is_selected") is not None else True)

            if backend == "postgres":
                con.execute(
                    """
                    INSERT INTO quote_lines
                      (quote_id, line_type, sort_order, job_type_id, description, qty, unit_price_ex_vat, vat_rate_id, is_selected)
                    VALUES
                      (?,?,?,?,?,?,?,?,?)
                    """,
                    [
                        int(quote_id),
                        str(line_type),
                        int(idx),
                        int(job_type_id) if job_type_id is not None else None,
                        desc,
                        qty,
                        unit_price,
                        int(vat_rate_id) if vat_rate_id is not None else None,
                        bool(is_selected),
                    ],
                )
            else:
                line_id = next_id("quote_lines", "line_id")
                con.execute(
                    """
                    INSERT INTO quote_lines
                      (line_id, quote_id, line_type, sort_order, job_type_id, description, qty, unit_price_ex_vat, vat_rate_id, is_selected)
                    VALUES
                      (?,?,?,?,?,?,?,?,?,?)
                    """,
                    [
                        int(line_id),
                        int(quote_id),
                        str(line_type),
                        int(idx),
                        int(job_type_id) if job_type_id is not None else None,
                        desc,
                        qty,
                        unit_price,
                        int(vat_rate_id) if vat_rate_id is not None else None,
                        bool(is_selected),
                    ],
                )


def compute_totals(lines_df: pd.DataFrame) -> QuoteTotals:
    if lines_df is None or getattr(lines_df, "empty", True):
        return QuoteTotals(0.0, 0.0, 0.0)

    def _f(x) -> float:
        try:
            if x is None:
                return 0.0
            if pd.isna(x):
                return 0.0
        except Exception:
            pass
        try:
            return float(x)
        except Exception:
            return 0.0

    with get_conn() as con:
        vdf = con.execute(
            """
            SELECT vat_rate_id, rate_pct
            FROM vat_rates_lookup
            """
        ).df()

    vat_pct = {}
    if vdf is not None and not vdf.empty:
        for _, r in vdf.iterrows():
            try:
                vat_pct[int(r["vat_rate_id"])] = float(r["rate_pct"] or 0)
            except Exception:
                continue

    subtotal = 0.0
    vat_total = 0.0

    for _, r in lines_df.iterrows():
        lt = str(r.get("line_type") or "Line").strip() or "Line"
        selected = bool(r.get("is_selected") if r.get("is_selected") is not None else True)
        if lt.lower() == "option" and not selected:
            continue

        qty = _f(r.get("qty"))
        unit_price = _f(r.get("unit_price_ex_vat"))
        line_sub = qty * unit_price
        subtotal += line_sub

        vid = r.get("vat_rate_id")
        try:
            vpct = vat_pct.get(int(vid), 0.0) if vid is not None else 0.0
        except Exception:
            vpct = 0.0
        vat_total += line_sub * (vpct / 100.0)

    total = subtotal + vat_total
    return QuoteTotals(subtotal, vat_total, total)


def revise_quote(source_quote_id: int) -> int:
    src = get_quote(int(source_quote_id))
    if not src:
        raise ValueError("Source quote not found")

    new_id = create_quote(
        client_db_id=int(src.get("client_db_id")),
        contact_id=int(src.get("contact_id")) if src.get("contact_id") is not None else None,
        quote_date=src.get("quote_date"),
        valid_to=src.get("valid_to"),
        salesperson=src.get("salesperson"),
        payment_term_id=int(src.get("payment_term_id")) if src.get("payment_term_id") is not None else None,
        currency_code=src.get("currency_code"),
        description=src.get("description"),
        notes=src.get("notes"),
    )

    update_quote(int(new_id), {"revision_of_quote_id": int(source_quote_id), "status": "Draft"})

    ldf = src.get("lines")
    lines = []
    if ldf is not None and not ldf.empty:
        for _, r in ldf.iterrows():
            lines.append(
                {
                    "line_type": r.get("line_type"),
                    "job_type_id": r.get("job_type_id"),
                    "description": r.get("description"),
                    "qty": r.get("qty"),
                    "unit_price_ex_vat": r.get("unit_price_ex_vat"),
                    "vat_rate_id": r.get("vat_rate_id"),
                    "is_selected": r.get("is_selected"),
                }
            )
    replace_quote_lines(int(new_id), lines)
    update_quote(int(source_quote_id), {"status": "Revised"})
    return int(new_id)


def accept_quote_create_job(quote_id: int) -> int:
    q = get_quote(int(quote_id))
    if not q:
        raise ValueError("Quote not found")

    backend = db_backend()

    qd = q.get("quote_date") or _today()
    try:
        qd = pd.to_datetime(qd).date()
    except Exception:
        qd = _today()

    start = qd
    due = start + timedelta(days=90)
    reporting_year = start.year

    title = (q.get("description") or "").strip() or f"Quote {int(quote_id)}"

    with get_conn() as con:
        if backend == "postgres":
            row = con.execute(
                """
                INSERT INTO jobs
                  (client_db_id, job_type, job_number, title, reporting_year, status, start_date, due_date)
                VALUES
                  (?,?,?,?,?,?,?,?)
                RETURNING job_id
                """,
                [
                    int(q.get("client_db_id")),
                    "Quote",
                    "PENDING",
                    title,
                    int(reporting_year),
                    "Open",
                    start,
                    due,
                ],
            ).fetchone()
            job_id = int(row[0])
        else:
            job_id = next_id("jobs", "job_id")
            con.execute(
                """
                INSERT INTO jobs
                  (job_id, client_db_id, job_type, job_number, title, reporting_year, status, start_date, due_date, created_at)
                VALUES
                  (?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)
                """,
                [
                    int(job_id),
                    int(q.get("client_db_id")),
                    "Quote",
                    "PENDING",
                    title,
                    int(reporting_year),
                    "Open",
                    start,
                    due,
                ],
            )

        job_number = f"NZI-{int(reporting_year)}-{int(job_id):04d}"
        con.execute("UPDATE jobs SET job_number=? WHERE job_id=?", [job_number, int(job_id)])

    update_quote(int(quote_id), {"status": "Accepted"})
    return int(job_id)
