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


# ── Pushing spend to emissions: a pushed row is identified by original_id AND
#    site_id, so a site change can't leave the old row behind counting twice ──


class _PushConn:
    """Fake conn for sync_spend_to_scope_data: serves the mapped spend entries
    and captures the deactivation sweep's SQL and params."""

    def __init__(self, entries):
        self._entries = entries
        self.deactivate_sql = ""
        self.deactivate_params = None
        self._result_df = pd.DataFrame([])
        self._fetchone = (1,)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params=None):
        if "FROM job_spend_entries" in sql and "mapped_scope IS NOT NULL" in sql:
            self._result_df = pd.DataFrame(self._entries)
            return self
        if "SET enabled = FALSE" in sql:
            self.deactivate_sql = sql
            self.deactivate_params = params
            self._fetchone = (0,)
            return self
        self._result_df = pd.DataFrame([])
        self._fetchone = (1,)
        return self

    def fetchone(self):
        return self._fetchone

    def df(self):
        return self._result_df


def _push(monkeypatch, entries):
    conn = _PushConn(entries)
    monkeypatch.setattr(spend_data_routes, "get_conn", lambda *_a, **_k: conn)
    monkeypatch.setattr(spend_data_routes, "_ensure_spend_tables", lambda *_a, **_k: None)
    monkeypatch.setattr(spend_data_routes, "_job_client_id", lambda *_a, **_k: 205)
    monkeypatch.setattr(
        spend_data_routes,
        "_factor_by_id",
        lambda _con, db_id: {"factor": 0.1, "scope": "Scope 3", "category": "Energy",
                             "report_label": "x", "dataset_id": 1, "original_id": f"F{db_id}"},
    )
    spend_data_routes.sync_spend_to_scope_data(
        job_id=663, body={"deactivate_missing": True}, _user={"email": "t@x"},
    )
    return conn


def _entry(entry_id, site_id, factor_db_id=38024):
    return {
        "entry_id": entry_id, "amount_net": 100.0, "amount_gross": 120.0,
        "conversion_currency": "GBP", "currency": "GBP", "vat_pct": 20, "notes": None,
        "site_id": site_id, "factor_db_id": factor_db_id, "factor_original_id": "SPEND-SIC-1",
        "dataset_id": 1, "mapped_scope": "Scope 3", "mapped_category": "Energy",
        "mapped_report_label": "Energy", "mapping_confidence": 0.9,
    }


def test_push_deactivation_is_keyed_on_original_id_and_site() -> None:
    import inspect

    source = inspect.getsource(spend_data_routes.sync_spend_to_scope_data)
    assert "(original_id, COALESCE(site_id, -1)) NOT IN" in source, \
        "the sweep must compare the (original_id, site_id) pair, not the id alone"


def test_push_sweep_params_pair_each_id_with_its_site(monkeypatch) -> None:
    # Job 663's shape: every entry arrived through the portal with no site, so
    # the groups are site-less and generate a bare SPEND-F<factor> id -- the
    # same id legacy rows carry alongside a real site_id. The sweep must send
    # -1 as this group's site so those legacy rows fall outside the keep-list
    # and get deactivated instead of double-counting.
    conn = _push(monkeypatch, [_entry(1, None), _entry(2, None)])

    assert "(original_id, COALESCE(site_id, -1)) NOT IN" in conn.deactivate_sql
    # params: job_id, pattern, then (original_id, site) pairs
    assert conn.deactivate_params[0] == 663
    assert conn.deactivate_params[2] == "SPEND-F38024"
    assert conn.deactivate_params[3] == -1


def test_push_sweep_keeps_the_site_when_entries_carry_one(monkeypatch) -> None:
    conn = _push(monkeypatch, [_entry(1, 123)])

    assert conn.deactivate_params[2] == "SPEND-F38024-S123"
    assert conn.deactivate_params[3] == 123
