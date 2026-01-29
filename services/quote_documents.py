from __future__ import annotations

import io
import os
import tempfile
from datetime import date
from typing import Any

import pandas as pd

from core.database import get_conn
from models.clients import get_client
from services.quotes import compute_totals, get_quote


def _fmt_ddmmyyyy(d: Any) -> str:
    if d is None:
        return ""
    try:
        return pd.to_datetime(d).date().strftime("%d/%m/%Y")
    except Exception:
        return str(d)


def _fmt_money(amount: Any) -> str:
    try:
        if amount is None or pd.isna(amount):
            return "0.00"
    except Exception:
        pass
    try:
        return f"{float(amount):,.2f}"
    except Exception:
        return "0.00"


def _client_billing_address(client_row) -> str:
    if client_row is None:
        return ""
    parts = [
        str(getattr(client_row, "addr_line1", "") or "").strip(),
        str(getattr(client_row, "addr_line2", "") or "").strip(),
        str(getattr(client_row, "addr_city", "") or "").strip(),
        str(getattr(client_row, "addr_region", "") or "").strip(),
        str(getattr(client_row, "addr_postcode", "") or "").strip(),
        str(getattr(client_row, "addr_country", "") or "").strip(),
    ]
    parts = [p for p in parts if p]
    return "\n".join(parts)


def _get_contact_name(contact_id: int | None) -> str:
    if contact_id is None:
        return ""
    try:
        with get_conn() as con:
            df = con.execute(
                "SELECT full_name FROM client_contacts WHERE contact_id=?", [int(contact_id)]
            ).df()
        if df is not None and not df.empty:
            return str(df.iloc[0]["full_name"] or "")
    except Exception:
        pass
    return ""


def render_quote_docx_bytes(quote_id: int, template_path: str | None = None) -> bytes:
    """Render a quote DOCX from the Word template using MERGEFIELDs.

    Requires `docx-mailmerge`.
    """

    try:
        from mailmerge import MailMerge
    except Exception as e:  # pragma: no cover
        raise RuntimeError(
            "Missing dependency 'docx-mailmerge'. Install it to generate DOCX/PDF quotes."
        ) from e

    q = get_quote(int(quote_id))
    if not q:
        raise ValueError("Quote not found")

    client_id = int(q.get("client_db_id"))
    client = get_client(client_id)

    totals = compute_totals(q.get("lines"))

    quote_date = q.get("quote_date")
    valid_to = q.get("valid_to")

    template = template_path or os.path.join("templates", "NZI Standard Quote.docx")

    contact_name = _get_contact_name(q.get("contact_id"))

    currency_code = str(q.get("currency_code") or "GBP").strip().upper()

    # Build line items (only Line types)
    lines_df = q.get("lines")
    items: list[dict[str, Any]] = []
    options: list[dict[str, Any]] = []

    if lines_df is not None and not getattr(lines_df, "empty", True):
        for _, r in lines_df.iterrows():
            lt = str(r.get("line_type") or "Line").strip().lower()
            rec = {
                "Description": str(r.get("description") or "") or "",
                "Quantity": f"{float(r.get('qty') or 0):g}",
                "Rate": _fmt_money(r.get("unit_price_ex_vat")),
                "Amount": _fmt_money((float(r.get("qty") or 0) * float(r.get("unit_price_ex_vat") or 0))),
                "PreferenceTaxName": "",  # template expects a field; we keep it minimal
            }
            if lt == "option":
                options.append(rec)
            else:
                items.append(rec)

    option_text = ""
    if options:
        option_text = "\n".join([f"- {o.get('Description','')}" for o in options if o.get("Description")])

    with MailMerge(template) as doc:
        # Header fields
        doc.merge(
            Title=str((q.get("description") or "Quote")).strip() or "Quote",
            ClientName=str(getattr(client, "client_name", "") or "").strip(),
            ClientBillingAddress=_client_billing_address(client),
            ContactName=contact_name,
            QuoteNumber=f"No. {int(quote_id)}",
            QuoteDate=_fmt_ddmmyyyy(quote_date),
            QuoteValidDate=_fmt_ddmmyyyy(valid_to),
            QuoteDescription=str((q.get("description") or "")).strip(),
            QuoteSubTotal=_fmt_money(totals.subtotal_ex_vat),
            QuoteTaxTotal=_fmt_money(totals.vat_total),
            QuoteTotal=_fmt_money(totals.total_inc_vat),
            QuoteOptionExplanation=option_text,
            # These are present in template; safe defaults
            PreferenceTaxName="",
            Description="",
            Quantity="",
            Rate="",
            Amount="",
        )

        # Repeating table region: Cost
        if items:
            doc.merge_rows("Description", items)
        else:
            # Keep table but blank first row fields if present
            doc.merge(Description="", Quantity="", Rate="", Amount="", PreferenceTaxName="")

        buf = io.BytesIO()
        doc.write(buf)
        return buf.getvalue()


def convert_docx_bytes_to_pdf_bytes(docx_bytes: bytes) -> bytes:
    """Convert DOCX bytes to PDF bytes on Windows.

    Requires `docx2pdf` and a working MS Word installation.
    """

    try:
        from docx2pdf import convert
    except Exception as e:  # pragma: no cover
        raise RuntimeError(
            "Missing dependency 'docx2pdf'. Install it (and ensure MS Word is installed) to export PDF."
        ) from e

    with tempfile.TemporaryDirectory() as td:
        docx_path = os.path.join(td, "quote.docx")
        pdf_path = os.path.join(td, "quote.pdf")
        with open(docx_path, "wb") as f:
            f.write(docx_bytes)
        convert(docx_path, pdf_path)
        with open(pdf_path, "rb") as f:
            return f.read()
