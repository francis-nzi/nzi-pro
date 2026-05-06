from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.spend_data_routes as spend_data_routes


class _SpendConn:
    def __init__(self, rows: list[dict[str, object]] | None = None, columns: set[str] | None = None):
        self._rows = rows or []
        self._columns = columns or set()
        self.queries: list[str] = []
        self._result_df = pd.DataFrame([])

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append(sql)
        if "ALTER TABLE" in sql and "ADD COLUMN IF NOT EXISTS" in sql:
            col = sql.split("ADD COLUMN IF NOT EXISTS", 1)[1].strip().split(" ", 1)[0].strip().strip(",")
            self._columns.add(col)
            return self
        if "SELECT client_db_id FROM jobs WHERE job_id = %s" in sql:
            self._result_df = pd.DataFrame([])
            self._fetchone = (205,)
            return self
        if "FROM job_spend_entries e" in sql:
            required = {
                "entry_id",
                "site_id",
                "source_type",
                "code_type",
                "reference_code",
                "spend_description",
                "currency",
                "conversion_currency",
                "conversion_rate",
                "amount_net",
                "amount_gross",
                "vat_pct",
                "dataset_id",
                "factor_db_id",
                "factor_original_id",
                "mapped_scope",
                "mapped_category",
                "mapped_report_label",
                "mapping_status",
                "mapping_confidence",
                "estimated_emissions_tco2e",
                "notes",
                "created_at",
                "updated_at",
            }
            missing = sorted(required.difference(self._columns))
            assert not missing, f"missing columns: {missing}"
            self._result_df = pd.DataFrame(self._rows)
            return self
        self._fetchone = (1,)
        self._result_df = pd.DataFrame([])
        return self

    def fetchone(self):
        return getattr(self, "_fetchone", (1,))

    def df(self):
        return self._result_df


def test_ensure_spend_tables_backfills_legacy_job_spend_columns(monkeypatch) -> None:
    conn = _SpendConn(columns={"entry_id", "job_id", "site_id", "source_type", "code_type", "spend_description", "is_deleted"})

    spend_data_routes._ensure_spend_tables(conn)

    assert {
        "amount_net",
        "amount_gross",
        "vat_pct",
        "conversion_currency",
        "conversion_rate",
        "dataset_id",
        "factor_db_id",
        "mapped_scope",
        "mapped_category",
        "mapped_report_label",
        "mapping_status",
        "estimated_emissions_tco2e",
        "created_at",
        "updated_at",
    }.issubset(conn._columns)


def test_list_spend_data_handles_legacy_schema_after_backfill(monkeypatch) -> None:
    rows = [
        {
            "entry_id": 1,
            "site_id": 10,
            "site_name": "HQ",
            "source_type": "manual",
            "code_type": "nominal_code",
            "reference_code": "1000",
            "spend_description": "Office supplies",
            "currency": "GBP",
            "conversion_currency": "GBP",
            "conversion_rate": 1,
            "amount_net": 100.0,
            "amount_gross": 120.0,
            "vat_pct": 20.0,
            "dataset_id": None,
            "factor_db_id": None,
            "factor_original_id": None,
            "mapped_scope": None,
            "mapped_category": None,
            "mapped_report_label": None,
            "mapping_status": "unmapped",
            "mapping_confidence": None,
            "factor_ghg_unit": None,
            "estimated_emissions_tco2e": 0.0,
            "notes": None,
            "created_at": pd.Timestamp("2026-01-01"),
            "updated_at": pd.Timestamp("2026-01-02"),
        }
    ]
    conn = _SpendConn(
        rows=rows,
        columns={
            "entry_id",
            "job_id",
            "site_id",
            "source_type",
            "code_type",
            "reference_code",
            "spend_description",
            "currency",
            "is_deleted",
        },
    )

    monkeypatch.setattr(spend_data_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(spend_data_routes, "_job_client_id", lambda *_args, **_kwargs: 205)

    result = spend_data_routes.list_spend_data(664, _user={"user_id": "u1", "org_id": "org-123"})

    assert result["summary"]["count"] == 1
    assert result["items"][0]["amount_net"] == 100.0
