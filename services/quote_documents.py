from __future__ import annotations

import io
from typing import Any

import pandas as pd

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

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


def _currency_symbol(code: str | None) -> str:
    c = str(code or "GBP").strip().upper()
    if c == "GBP":
        return "£"
    if c == "USD":
        return "$"
    if c == "EUR":
        return "€"
    return ""


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


def _get_contact_email(contact_id: int | None) -> str:
    if contact_id is None:
        return ""
    try:
        with get_conn() as con:
            df = con.execute(
                "SELECT email FROM client_contacts WHERE contact_id=?", [int(contact_id)]
            ).df()
        if df is not None and not df.empty:
            return str(df.iloc[0]["email"] or "")
    except Exception:
        pass
    return ""


def render_quote_pdf_bytes(quote_id: int) -> bytes:
    q = get_quote(int(quote_id))
    if not q:
        raise ValueError("Quote not found")

    client_id = int(q.get("client_db_id"))
    client = get_client(client_id)

    totals = compute_totals(q.get("lines"))
    currency_code = str(q.get("currency_code") or "GBP").strip().upper()
    symbol = _currency_symbol(currency_code)

    quote_no = f"Q{int(quote_id):06d}"
    quote_date = _fmt_ddmmyyyy(q.get("quote_date"))
    valid_to = _fmt_ddmmyyyy(q.get("valid_to"))
    contact_id = q.get("contact_id")
    contact_name = _get_contact_name(contact_id)
    contact_email = _get_contact_email(contact_id)
    notes = str(q.get("notes") or "").strip()

    lines_df = q.get("lines")
    line_rows = []
    option_rows = []
    if lines_df is not None and not getattr(lines_df, "empty", True):
        for _, r in lines_df.iterrows():
            lt = str(r.get("line_type") or "Line").strip().lower()
            desc = str(r.get("description") or "").strip()
            qty = float(r.get("qty") or 0)
            rate = float(r.get("unit_price_ex_vat") or 0)
            amt = qty * rate
            row = [desc, f"{qty:g}", f"{symbol}{rate:,.2f}", f"{symbol}{amt:,.2f}"]
            if lt == "option":
                option_rows.append(row)
            else:
                line_rows.append(row)

    styles = getSampleStyleSheet()
    normal = styles["Normal"]
    heading = styles["Heading2"]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=quote_no,
    )

    story = []
    story.append(Paragraph("Quote", styles["Title"]))
    story.append(Spacer(1, 4 * mm))

    header_left = (
        f"<b>{str(getattr(client, 'client_name', '') or '').strip()}</b><br/>{_client_billing_address(client).replace(chr(10), '<br/>')}"
    )
    header_right_lines = [
        f"<b>Quote</b>: {quote_no}",
        f"<b>Date</b>: {quote_date}",
        f"<b>Valid to</b>: {valid_to}",
    ]
    if contact_name:
        header_right_lines.append(f"<b>Contact</b>: {contact_name}")
    if contact_email:
        header_right_lines.append(f"<b>Email</b>: {contact_email}")
    header_right = "<br/>".join(header_right_lines)

    header_tbl = Table(
        [[Paragraph(header_left, normal), Paragraph(header_right, normal)]],
        colWidths=[110 * mm, 60 * mm],
    )
    header_tbl.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(header_tbl)
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Lines", heading))
    if not line_rows:
        story.append(Paragraph("(No lines)", normal))
    else:
        tbl_data = [["Description", "Qty", "Unit price", "Amount"]] + line_rows
        t = Table(tbl_data, colWidths=[95 * mm, 15 * mm, 30 * mm, 30 * mm])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ALIGN", (1, 1), (1, -1), "RIGHT"),
                    ("ALIGN", (2, 1), (3, -1), "RIGHT"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(t)

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("Options", heading))
    if not option_rows:
        story.append(Paragraph("(No options)", normal))
    else:
        opt_data = [["Description", "Qty", "Unit price", "Amount"]] + option_rows
        ot = Table(opt_data, colWidths=[95 * mm, 15 * mm, 30 * mm, 30 * mm])
        ot.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ALIGN", (1, 1), (1, -1), "RIGHT"),
                    ("ALIGN", (2, 1), (3, -1), "RIGHT"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(ot)

    story.append(Spacer(1, 8 * mm))

    totals_tbl = Table(
        [
            ["Sub-total", f"{symbol}{float(totals.subtotal_ex_vat):,.2f}"],
            ["VAT", f"{symbol}{float(totals.vat_total):,.2f}"],
            ["Total", f"{symbol}{float(totals.total_inc_vat):,.2f}"],
        ],
        colWidths=[30 * mm, 35 * mm],
    )
    totals_tbl.setStyle(
        TableStyle(
            [
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f3f4f6")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(totals_tbl)

    if notes:
        story.append(Spacer(1, 10 * mm))
        story.append(Paragraph("Notes", heading))
        story.append(Paragraph(notes.replace("\n", "<br/>"), normal))

    doc.build(story)
    return buf.getvalue()
