from __future__ import annotations

import re
from typing import Any


DEFAULT_EMAIL_TEMPLATES: list[dict[str, str]] = [
    {
        "template_key": "team_member_invite",
        "template_name": "Team Member Invite",
        "subject_template": "You have been invited to NZI Pro",
        "body_template": (
            "<p>Hi {{full_name}},</p>"
            "<p>You have been invited to access NZI Pro as <strong>{{role}}</strong>.</p>"
            "<p>Username: <strong>{{email}}</strong><br/>"
            "Temporary password: <strong>{{temporary_password}}</strong><br/>"
            "Invite expires: <strong>{{invite_expires_at}}</strong></p>"
            "<p>Please sign in and change your password immediately.</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "team_member_reinvite",
        "template_name": "Team Member Re-invite",
        "subject_template": "Your NZI Pro access has been refreshed",
        "body_template": (
            "<p>Hi {{full_name}},</p>"
            "<p>Your NZI Pro access has been re-issued.</p>"
            "<p>Username: <strong>{{email}}</strong><br/>"
            "Temporary password: <strong>{{temporary_password}}</strong><br/>"
            "Invite expires: <strong>{{invite_expires_at}}</strong></p>"
            "<p>Please sign in and change your password immediately.</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "team_member_password_reset",
        "template_name": "Team Member Password Reset",
        "subject_template": "Your NZI Pro temporary password",
        "body_template": (
            "<p>Hi {{full_name}},</p>"
            "<p>Your NZI Pro password has been reset.</p>"
            "<p>Username: <strong>{{email}}</strong><br/>"
            "Temporary password: <strong>{{temporary_password}}</strong><br/>"
            "Reset expires: <strong>{{invite_expires_at}}</strong></p>"
            "<p>Please sign in and change your password immediately.</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "forgot_password",
        "template_name": "Forgot Password",
        "subject_template": "NZI Pro temporary password request",
        "body_template": (
            "<p>Hi {{full_name}},</p>"
            "<p>We received a password reset request for your NZI Pro account.</p>"
            "<p>Username: <strong>{{email}}</strong><br/>"
            "Temporary password: <strong>{{temporary_password}}</strong><br/>"
            "Reset expires: <strong>{{invite_expires_at}}</strong></p>"
            "<p>If you did not request this, contact your administrator.</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "registration_verification",
        "template_name": "Registration Verification",
        "subject_template": "Verify your NZI Pro account",
        "body_template": (
            "<p>Hi {{full_name}},</p>"
            "<p>Thanks for registering {{org_name}} with NZI Pro.</p>"
            "<p>Your 14-day trial starts today. Please verify your email address to activate your account:</p>"
            "<p><a href=\"{{verification_url}}\">Verify your NZI Pro account</a></p>"
            "<p>This verification link expires at <strong>{{verification_expires_at}}</strong>.</p>"
            "<p>If the button does not work, copy and paste this link into your browser:</p>"
            "<p>{{verification_url}}</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "quote_send",
        "template_name": "Quote Email",
        "subject_template": "Quote {{quote_number}} from Net Zero International",
        "body_template": (
            "<p>Dear {{attention_name}},</p>"
            "<p>Please find attached Quote <strong>{{quote_number}}</strong> for {{client_name}}.</p>"
            "<p>Valid to: {{valid_to}}</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "invoice_send",
        "template_name": "Invoice Email",
        "subject_template": "Invoice {{invoice_number}} from Net Zero International",
        "body_template": (
            "<p>Dear {{attention_name}},</p>"
            "<p>Please find attached Invoice <strong>{{invoice_number}}</strong> for {{client_name}}.</p>"
            "<p>Due date: {{due_date}}</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "reminder",
        "template_name": "Reminder Email",
        "subject_template": "Reminder: {{job_number}}",
        "body_template": (
            "<p>Dear {{attention_name}},</p>"
            "<p>This is a reminder regarding {{job_number}}.</p>"
            "<p>{{custom_message}}</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "introduction",
        "template_name": "Introduction Email",
        "subject_template": "Introduction - Net Zero International",
        "body_template": (
            "<p>Dear {{attention_name}},</p>"
            "<p>Thank you for your time. We look forward to supporting {{client_name}}.</p>"
            "<p>{{custom_message}}</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "job_start",
        "template_name": "Job Start Email",
        "subject_template": "Job Start: {{job_number}}",
        "body_template": (
            "<p>Dear {{attention_name}},</p>"
            "<p>Your job <strong>{{job_number}}</strong> has now started.</p>"
            "<p>{{custom_message}}</p>"
            "<p>Kind regards,<br/>{{sender_name}}</p>"
        ),
    },
    {
        "template_key": "job_overview_letter_send",
        "template_name": "Job Overview Letter Email",
        "subject_template": "Job Overview Letter - {{job_number}}",
        "body_template": (
            "<p>Dear {{contact_name}},</p>"
            "<p>Please find attached your Job Overview Letter for <strong>{{job_number}}</strong> "
            "for {{client_name}}.</p>"
            "<p>This confirms the reporting period ({{reporting_period_start}} to {{reporting_period_end}}), "
            "the agreed milestones, and your NZI CRM contact.</p>"
            "<p>{{custom_message}}</p>"
            "<p>Kind regards,<br/>{{crm_name}}</p>"
        ),
    },
]


def _strip_html(value: str) -> str:
    text = re.sub(r"<\s*br\s*/?\s*>", "\n", value or "", flags=re.IGNORECASE)
    text = re.sub(r"</\s*p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def ensure_message_template_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS message_templates (
          template_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          template_key VARCHAR NOT NULL UNIQUE,
          template_name VARCHAR,
          channel VARCHAR NOT NULL DEFAULT 'email',
          message_type VARCHAR NOT NULL DEFAULT 'general',
          subject_template TEXT,
          body_template TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_message_templates_key_ci ON message_templates (lower(template_key))")
    for tpl in DEFAULT_EMAIL_TEMPLATES:
        con.execute(
            """
            INSERT INTO message_templates (template_key, template_name, channel, message_type, subject_template, body_template, is_active, created_at, updated_at)
            SELECT %s, %s, 'email', %s, %s, %s, TRUE, NOW(), NOW()
            WHERE NOT EXISTS (
              SELECT 1 FROM message_templates WHERE lower(template_key) = lower(%s)
            )
            """,
            [
                tpl["template_key"],
                tpl["template_name"],
                tpl["template_key"],
                tpl["subject_template"],
                tpl["body_template"],
                tpl["template_key"],
            ],
        )


def ensure_user_settings_columns(con) -> None:
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR")
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_phone VARCHAR")
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_signature_html TEXT")
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR")
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS date_format VARCHAR")
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS locale VARCHAR")
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS default_currency VARCHAR")
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR")
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE")
    con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_digest BOOLEAN DEFAULT FALSE")


def list_templates(con, channel: str = "email") -> list[dict[str, Any]]:
    ensure_message_template_tables(con)
    df = con.execute(
        """
        SELECT template_id, template_key, template_name, channel, message_type,
               subject_template, body_template, is_active, created_at, updated_at
        FROM message_templates
        WHERE channel = %s
        ORDER BY is_active DESC, lower(template_name), lower(template_key)
        """,
        [channel],
    ).df()
    out: list[dict[str, Any]] = []
    if df is None or df.empty:
        return out
    for _, r in df.iterrows():
        out.append(
            {
                "template_id": int(r.get("template_id") or 0),
                "template_key": str(r.get("template_key") or ""),
                "template_name": str(r.get("template_name") or ""),
                "channel": str(r.get("channel") or "email"),
                "message_type": str(r.get("message_type") or "general"),
                "subject_template": str(r.get("subject_template") or ""),
                "body_template": str(r.get("body_template") or ""),
                "is_active": bool(r.get("is_active") if r.get("is_active") is not None else True),
                "created_at": r.get("created_at").isoformat() if r.get("created_at") else None,
                "updated_at": r.get("updated_at").isoformat() if r.get("updated_at") else None,
            }
        )
    return out


def _to_context_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def render_template_text(template: str, context: dict[str, Any]) -> str:
    value = str(template or "")
    for key, raw in (context or {}).items():
        token = "{{" + str(key).strip() + "}}"
        value = value.replace(token, _to_context_value(raw))
    value = re.sub(r"\{\{[^{}]+\}\}", "", value)
    return value


def resolve_template(con, template_key: str) -> dict[str, Any] | None:
    ensure_message_template_tables(con)
    row = con.execute(
        """
        SELECT template_id, template_key, template_name, subject_template, body_template, is_active
        FROM message_templates
        WHERE lower(template_key) = lower(%s) AND channel = 'email'
        LIMIT 1
        """,
        [template_key],
    ).fetchone()
    if not row:
        return None
    return {
        "template_id": int(row[0] or 0),
        "template_key": str(row[1] or ""),
        "template_name": str(row[2] or ""),
        "subject_template": str(row[3] or ""),
        "body_template": str(row[4] or ""),
        "is_active": bool(row[5] if row[5] is not None else True),
    }


def get_user_signature_html(con, identifier: str) -> str:
    ensure_user_settings_columns(con)
    ident = str(identifier or "").strip()
    if not ident:
        return ""
    row = con.execute(
        """
        SELECT COALESCE(email_signature_html, '')
        FROM users
        WHERE lower(email) = lower(%s) OR lower(user_id) = lower(%s)
        LIMIT 1
        """,
        [ident, ident],
    ).fetchone()
    if not row:
        return ""
    return str(row[0] or "").strip()


def build_email_content(
    *,
    con,
    template_key: str,
    context: dict[str, Any],
    fallback_subject: str,
    fallback_body: str,
    sender_identifier: str,
    override_subject: str | None = None,
    override_body: str | None = None,
) -> dict[str, str]:
    tpl = resolve_template(con, template_key)
    subject = render_template_text(tpl["subject_template"], context) if tpl and tpl.get("is_active") else fallback_subject
    body_html = render_template_text(tpl["body_template"], context) if tpl and tpl.get("is_active") else fallback_body

    if override_subject and str(override_subject).strip():
        subject = str(override_subject).strip()
    if override_body and str(override_body).strip():
        body_html = str(override_body).strip()

    signature = get_user_signature_html(con, sender_identifier)
    if signature:
        body_html = f"{body_html}<br/><br/>{signature}"

    body_text = _strip_html(body_html)
    return {
        "subject": subject.strip() or fallback_subject,
        "body_html": body_html,
        "body_text": body_text,
    }
