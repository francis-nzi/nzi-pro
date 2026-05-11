from __future__ import annotations

from core.database import get_conn


def ensure_client_org_columns(con) -> None:
    """Ensure client/org tenancy columns exist."""
    statements = [
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id UUID",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS org_id UUID",
        "ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS org_id UUID",
    ]
    for statement in statements:
        try:
            con.execute(statement)
        except Exception:
            pass

