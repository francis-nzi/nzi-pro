from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.report_actions import (
    DEFAULT_REPORT_ACTION_OPTIONS,
    ensure_report_actions_schema,
)


class _FakeReportActionsConn:
    """In-memory stand-in that captures the subset of SQL the seeder uses."""

    def __init__(self) -> None:
        self.rows: list[dict[str, object]] = []
        self._fetch_value: tuple | None = None

    def execute(self, sql: str, params: list | None = None):
        normalized = " ".join(sql.split()).lower()
        params = params or []
        if normalized.startswith(("create ", "alter ")):
            self._fetch_value = None
        elif "select count(*) from report_action_options" in normalized:
            self._fetch_value = (len(self.rows),)
        elif normalized.startswith("insert into report_action_options"):
            self.rows.append(
                {
                    "action_name": params[0],
                    "description": params[1],
                    "action_term": params[2],
                    "action_category": params[3],
                    "scope_focus": params[4],
                    "sort_order": params[5],
                }
            )
            self._fetch_value = None
        else:
            self._fetch_value = None
        return self

    def fetchone(self):
        return self._fetch_value


def test_ensure_report_actions_schema_seeds_defaults_on_empty_table() -> None:
    con = _FakeReportActionsConn()

    ensure_report_actions_schema(con)

    assert len(con.rows) == len(DEFAULT_REPORT_ACTION_OPTIONS)
    assert {row["action_name"] for row in con.rows} == {
        item["action_name"] for item in DEFAULT_REPORT_ACTION_OPTIONS
    }


def test_ensure_report_actions_schema_does_not_reseed_after_rename() -> None:
    con = _FakeReportActionsConn()
    # Simulate a database where an admin renamed the procurement default and
    # rewrote its description. The original-named row no longer exists.
    con.rows.append(
        {
            "action_name": "Engage suppliers on lower carbon procurement",
            "description": "Updated description by admin.",
            "action_term": "medium",
            "action_category": "Procurement",
            "scope_focus": "Scope 3",
            "sort_order": 90,
        }
    )

    ensure_report_actions_schema(con)

    # The seeder must not re-insert the original "lower-carbon" default just
    # because the user renamed it. Total row count should be unchanged.
    assert len(con.rows) == 1
    assert con.rows[0]["action_name"] == "Engage suppliers on lower carbon procurement"


def test_ensure_report_actions_schema_reseeds_when_table_emptied() -> None:
    con = _FakeReportActionsConn()
    # First run: seeds defaults.
    ensure_report_actions_schema(con)
    seeded = len(con.rows)
    assert seeded == len(DEFAULT_REPORT_ACTION_OPTIONS)

    # Admin clears the table entirely.
    con.rows.clear()

    # Second run: defaults should come back, since the table is empty again.
    ensure_report_actions_schema(con)
    assert len(con.rows) == seeded
