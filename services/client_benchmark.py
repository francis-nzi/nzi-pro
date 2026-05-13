from __future__ import annotations

from typing import Any


CLIENT_BENCHMARK_COLUMNS = (
    "benchmark_scope_1_tco2e",
    "benchmark_scope_2_tco2e",
    "benchmark_scope_3_tco2e",
    "benchmark_total_tco2e",
)


def ensure_client_benchmark_columns(con) -> None:
    """Ensure client benchmark emissions columns exist."""
    statements = [
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_period_start DATE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_period_end DATE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_scope_1_tco2e DOUBLE PRECISION",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_scope_2_tco2e DOUBLE PRECISION",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_scope_3_tco2e DOUBLE PRECISION",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_total_tco2e DOUBLE PRECISION",
    ]
    for statement in statements:
        con.execute(statement)


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if hasattr(value, "__float__"):
            return float(value)
    except Exception:
        return None
    try:
        return float(value)
    except Exception:
        return None


def get_client_benchmark_metrics(con, client_db_id: int) -> dict[str, Any] | None:
    """Return benchmark emissions captured directly on the client record."""
    row = con.execute(
        """
        SELECT
            benchmark_year,
            benchmark_scope_1_tco2e,
            benchmark_scope_2_tco2e,
            benchmark_scope_3_tco2e,
            benchmark_total_tco2e
        FROM clients
        WHERE db_id = ?
        """,
        [int(client_db_id)],
    ).fetchone()

    if not row:
        return None

    benchmark_year = int(row[0]) if row[0] is not None else None
    scope1 = _as_float(row[1])
    scope2 = _as_float(row[2])
    scope3 = _as_float(row[3])
    total = _as_float(row[4])

    if all(value is None for value in (scope1, scope2, scope3, total)):
        return None

    if total is None:
        total = sum(value for value in (scope1, scope2, scope3) if value is not None)

    return {
        "benchmark_year": benchmark_year,
        "scope1": scope1,
        "scope2": scope2,
        "scope3": scope3,
        "total": total,
        "source": "client",
    }
