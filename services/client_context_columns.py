"""
Runtime migration: adds context/compliance columns to the clients table.
These columns store structured metadata that feeds the AI profile generator.
"""

from __future__ import annotations

_DONE = False


def ensure_client_context_columns(con) -> None:
    global _DONE
    if _DONE:
        return
    statements = [
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent_company TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS group_structure TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS reporting_frameworks TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS certifications TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS primary_scope3_categories TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_manager VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS data_frequency VARCHAR DEFAULT 'annual'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral VARCHAR",
    ]
    for sql in statements:
        try:
            con.execute(sql)
        except Exception:
            pass
    _DONE = True
