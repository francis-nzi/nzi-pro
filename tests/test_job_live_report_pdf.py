from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.job_live_report_routes as job_live_report_routes


class _FakePage:
    def __init__(self):
        self.calls: list[tuple[str, object]] = []

    def wait_for_function(self, script: str, timeout: int | None = None):
        self.calls.append((script, timeout))


def test_wait_for_widget_pngs_ready_waits_on_report_ready_flag():
    page = _FakePage()

    job_live_report_routes._wait_for_widget_pngs_ready(page, timeout_ms=12345)

    assert page.calls
    script, timeout = page.calls[0]
    assert "data-widget-pngs-ready" in script
    assert timeout == 12345
