from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import report_template_routes as rtr


class _StatusCon:
    """Minimal connection stub returning one job status."""

    def __init__(self, status, fail=False):
        self.status = status
        self.fail = fail
        self.queries = 0

    def execute(self, sql, params=None):
        self.queries += 1
        if self.fail:
            raise RuntimeError("connection lost")
        status = self.status
        return type("R", (), {"fetchone": staticmethod(lambda: None if status is _MISSING else (status,))})()


_MISSING = object()
STORED = {"energy_emissions_tco2e": 3.7699}


def test_closed_statuses_freeze():
    for status in (
        "Closed",
        "Completed",
        "Job Closed - All Reports, Invoices and Support Completed",
        # Matching is case- and whitespace-insensitive.
        "  closed  ",
        "COMPLETED",
    ):
        assert rtr._job_report_metadata_frozen(_StatusCon(status), 1, STORED) is True, status


def test_active_statuses_do_not_freeze():
    for status in ("Open", "Data Gathering Phase", "Reporting Phase", "Awaiting Client Input", ""):
        assert rtr._job_report_metadata_frozen(_StatusCon(status), 1, STORED) is False, status


def test_job_with_no_stored_metadata_is_never_frozen():
    """Nothing to preserve, and leaving it permanently blank would be worse."""
    con = _StatusCon("Closed")

    assert rtr._job_report_metadata_frozen(con, 1, None) is False
    assert rtr._job_report_metadata_frozen(con, 1, {}) is False
    # Short-circuits before querying the job at all.
    assert con.queries == 0


def test_unknown_or_unreadable_status_does_not_freeze():
    assert rtr._job_report_metadata_frozen(_StatusCon(_MISSING), 1, STORED) is False
    assert rtr._job_report_metadata_frozen(_StatusCon(None), 1, STORED) is False
    # A failed lookup must not silently freeze a live job's figures.
    assert rtr._job_report_metadata_frozen(_StatusCon("Closed", fail=True), 1, STORED) is False
