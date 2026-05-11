from __future__ import annotations

from typing import Any

from core.database import db_backend, get_conn
from services.dataset_selector import resolve_dataset_resolution


def _job_scope_config_audit_snapshot(con, job_id: int) -> dict[str, Any]:
    config_rows = con.execute(
        """
        SELECT scope, include_scope, dataset_id, factor_method
        FROM job_scope_config
        WHERE job_id = ?
        ORDER BY scope
        """,
        [int(job_id)],
    ).fetchall()
    additional_rows = con.execute(
        """
        SELECT dataset_id
        FROM job_additional_datasets
        WHERE job_id = ?
        ORDER BY dataset_id
        """,
        [int(job_id)],
    ).fetchall()
    return {
        "job_id": int(job_id),
        "items": [
            {
                "scope": str(row[0]) if row and row[0] is not None else None,
                "include_scope": bool(row[1]) if row and row[1] is not None else None,
                "dataset_id": int(row[2]) if row and row[2] is not None else None,
                "factor_method": str(row[3]) if row and row[3] is not None else None,
            }
            for row in config_rows
        ],
        "additional_dataset_ids": [
            int(row[0]) for row in additional_rows if row and row[0] is not None
        ],
    }


def _load_legacy_scope_dataset_map(job_id: int) -> dict[str, int]:
    ds_map: dict[str, int] = {}
    try:
        with get_conn() as con:
            df_scopes = con.execute(
                """
                SELECT scope, dataset_id
                FROM job_scope_config
                WHERE job_id=?
                """,
                [int(job_id)],
            ).df()
        if df_scopes is not None and (not df_scopes.empty):
            for _, rr in df_scopes.iterrows():
                scope = str(rr.get("scope") or "").strip()
                dsid = rr.get("dataset_id")
                if scope and dsid is not None and str(dsid) != "nan":
                    ds_map[scope] = int(dsid)
    except Exception:
        return {}
    return ds_map


def _ensure_job_additional_datasets_table() -> None:
    try:
        with get_conn() as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS job_additional_datasets (
                    job_id INTEGER NOT NULL,
                    dataset_id INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    PRIMARY KEY (job_id, dataset_id)
                )
                """
            )
    except Exception:
        pass


def _resolve_scope_dataset_map(
    job_id: int,
) -> tuple[dict[str, int], dict[str, Any] | None, list[str]]:
    warnings: list[str] = []
    auto_resolution: dict[str, Any] | None = None
    ds_map: dict[str, int] = {}

    try:
        auto_resolution = resolve_dataset_resolution(int(job_id))
        auto_primary = auto_resolution.get("scope_primary_datasets") or {}
        for scope, dsid in auto_primary.items():
            if dsid is None:
                continue
            ds_map[str(scope)] = int(dsid)
    except Exception as e:
        warnings.append(f"Automatic dataset resolution unavailable: {e}")

    if not ds_map:
        ds_map = _load_legacy_scope_dataset_map(int(job_id))
        if ds_map:
            warnings.append("Using legacy job_scope_config dataset mapping fallback.")

    return ds_map, auto_resolution, warnings


def _ensure_job_original_portfolio_column(con) -> None:
    try:
        con.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_portfolio VARCHAR DEFAULT 'NZI'")
    except Exception:
        pass


def _col_exists(con, table_name: str, col_name: str) -> bool:
    try:
        row = con.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = ? AND column_name = ?
            LIMIT 1
            """,
            [table_name, col_name],
        ).fetchone()
        return bool(row)
    except Exception:
        return False


def _table_exists(con, table_name: str) -> bool:
    try:
        row = con.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ?
            LIMIT 1
            """,
            [table_name],
        ).fetchone()
        return bool(row)
    except Exception:
        return False
