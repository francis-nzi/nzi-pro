from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage


def _env_truthy(name: str, default: str = "true") -> bool:
    v = str(os.getenv(name, default) or "").strip().lower()
    return v in ("1", "true", "yes", "y", "on")


def send_email_with_attachment(
    *,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    attachment_bytes: bytes,
    attachment_filename: str,
    attachment_mime: str = "application/pdf",
) -> None:
    host = str(os.getenv("SMTP_HOST") or "").strip()
    port = int(os.getenv("SMTP_PORT") or "587")
    user = str(os.getenv("SMTP_USER") or "").strip() or None
    password = str(os.getenv("SMTP_PASS") or "").strip() or None
    from_email = str(os.getenv("SMTP_FROM") or (user or "")).strip()

    if not host:
        raise RuntimeError("SMTP_HOST is not set")
    if not from_email:
        raise RuntimeError("SMTP_FROM (or SMTP_USER) is not set")
    if not to_email:
        raise RuntimeError("Recipient email is blank")

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text or "")
    if body_html and str(body_html).strip():
        msg.add_alternative(str(body_html), subtype="html")

    maintype, subtype = (attachment_mime.split("/", 1) + [""])[:2]
    msg.add_attachment(
        attachment_bytes,
        maintype=maintype or "application",
        subtype=subtype or "octet-stream",
        filename=attachment_filename,
    )

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


def send_plain_email(
    *,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
) -> None:
    host = str(os.getenv("SMTP_HOST") or "").strip()
    port = int(os.getenv("SMTP_PORT") or "587")
    user = str(os.getenv("SMTP_USER") or "").strip() or None
    password = str(os.getenv("SMTP_PASS") or "").strip() or None
    from_email = str(os.getenv("SMTP_FROM") or (user or "")).strip()

    if not host:
        raise RuntimeError("SMTP_HOST is not set")
    if not from_email:
        raise RuntimeError("SMTP_FROM (or SMTP_USER) is not set")
    if not to_email:
        raise RuntimeError("Recipient email is blank")

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text or "")
    if body_html and str(body_html).strip():
        msg.add_alternative(str(body_html), subtype="html")

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
