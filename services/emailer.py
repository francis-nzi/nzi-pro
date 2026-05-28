from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage


def _env_truthy(name: str, default: str = "true") -> bool:
    v = str(os.getenv(name, default) or "").strip().lower()
    return v in ("1", "true", "yes", "y", "on")


def _smtp_from() -> str:
    user = str(os.getenv("SMTP_USER") or "").strip() or None
    from_email = str(os.getenv("SMTP_FROM") or (user or "")).strip()
    if not from_email:
        raise RuntimeError("SMTP_FROM (or SMTP_USER) is not set")
    return from_email


def _build_message(
    *,
    from_addr: str,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    reply_to: str | None = None,
    from_name: str | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = f'"{from_name}" <{from_addr}>' if from_name and str(from_name).strip() else from_addr
    msg["To"] = to_email
    msg["Subject"] = subject
    if reply_to and str(reply_to).strip():
        msg["Reply-To"] = str(reply_to).strip()
    clean_cc = [e.strip() for e in (cc or []) if str(e or "").strip()]
    clean_bcc = [e.strip() for e in (bcc or []) if str(e or "").strip()]
    if clean_cc:
        msg["Cc"] = ", ".join(clean_cc)
    if clean_bcc:
        # send_message() reads Bcc for recipients then strips the header before sending
        msg["Bcc"] = ", ".join(clean_bcc)
    msg.set_content(body_text or "")
    if body_html and str(body_html).strip():
        msg.add_alternative(str(body_html), subtype="html")
    return msg


def _smtp_send(msg: EmailMessage) -> None:
    host = str(os.getenv("SMTP_HOST") or "").strip()
    port = int(os.getenv("SMTP_PORT") or "587")
    user = str(os.getenv("SMTP_USER") or "").strip() or None
    password = str(os.getenv("SMTP_PASS") or "").strip() or None
    if not host:
        raise RuntimeError("SMTP_HOST is not set")
    use_tls = _env_truthy("SMTP_TLS", "true")
    if use_tls:
        with smtplib.SMTP(host, port) as s:
            s.ehlo()
            s.starttls()
            s.ehlo()
            if user and password:
                s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port) as s:
            if user and password:
                s.login(user, password)
            s.send_message(msg)


def send_email_with_attachment(
    *,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    reply_to: str | None = None,
    from_name: str | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    attachment_bytes: bytes,
    attachment_filename: str,
    attachment_mime: str = "application/pdf",
) -> None:
    if not to_email:
        raise RuntimeError("Recipient email is blank")
    from_addr = _smtp_from()
    msg = _build_message(
        from_addr=from_addr,
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        reply_to=reply_to,
        from_name=from_name,
        cc=cc,
        bcc=bcc,
    )
    maintype, subtype = (attachment_mime.split("/", 1) + [""])[:2]
    msg.add_attachment(
        attachment_bytes,
        maintype=maintype or "application",
        subtype=subtype or "octet-stream",
        filename=attachment_filename,
    )
    _smtp_send(msg)


def send_plain_email(
    *,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    reply_to: str | None = None,
    from_name: str | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
) -> None:
    if not to_email:
        raise RuntimeError("Recipient email is blank")
    from_addr = _smtp_from()
    msg = _build_message(
        from_addr=from_addr,
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        reply_to=reply_to,
        from_name=from_name,
        cc=cc,
        bcc=bcc,
    )
    _smtp_send(msg)
