"""Shared helpers for the LCA material-categories lookup table.

Split out from api/lca_routes.py so services/lca_bom_template.py can reuse the
same dedupe/resolve logic without a circular import (lca_routes already
imports from lca_bom_template).
"""
from __future__ import annotations

_MATERIAL_CATEGORY_FK_TABLES = ("lca_components", "lca_line_items", "lca_scenario_multipliers", "lca_component_children")
_material_categories_deduped = False


def ensure_material_categories_deduped(con) -> None:
    """One-time cleanup: the seed migration inserted default categories with a
    plain INSERT (no ON CONFLICT), and it ended up applied more than once, so
    every default category exists twice. Repoint any FK references from the
    later duplicate onto the earliest row for that name, delete the duplicate,
    then add a case-insensitive unique index so this can't recur -- including
    from resolve_or_create_material_category below."""
    global _material_categories_deduped
    if _material_categories_deduped:
        return
    dupes = con.execute(
        """
        SELECT category_id, keep_id FROM (
          SELECT category_id,
                 MIN(category_id) OVER (PARTITION BY lower(trim(name))) AS keep_id
          FROM lca_material_categories_lookup
        ) ranked
        WHERE category_id != keep_id
        """
    ).fetchall()
    for dupe_id, keep_id in dupes:
        for table in _MATERIAL_CATEGORY_FK_TABLES:
            con.execute(
                f"UPDATE {table} SET material_category_id = %s WHERE material_category_id = %s",
                [int(keep_id), int(dupe_id)],
            )
        con.execute("DELETE FROM lca_material_categories_lookup WHERE category_id = %s", [int(dupe_id)])
    con.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_lca_material_categories_name ON lca_material_categories_lookup (lower(trim(name)))"
    )
    _material_categories_deduped = True


def resolve_or_create_material_category(con, name: str) -> int | None:
    trimmed = (name or "").strip()
    if not trimmed:
        return None
    existing = con.execute(
        "SELECT category_id FROM lca_material_categories_lookup WHERE lower(trim(name)) = lower(%s)",
        [trimmed],
    ).fetchone()
    if existing:
        return int(existing[0])
    created = con.execute(
        "INSERT INTO lca_material_categories_lookup (name) VALUES (%s) "
        "ON CONFLICT (lower(trim(name))) DO UPDATE SET name = lca_material_categories_lookup.name "
        "RETURNING category_id",
        [trimmed],
    ).fetchone()
    return int(created[0]) if created else None
