from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.tenancy import (
    clear_current_org_context,
    get_current_org_context,
    run_with_org_context,
    set_current_org_context,
)


def test_run_with_org_context_restores_previous_context():
    clear_current_org_context()
    set_current_org_context("outer-org")

    seen: dict[str, str | None] = {}

    def _inner():
        seen["inside"] = get_current_org_context()
        return "done"

    try:
        result = run_with_org_context(_inner, "inner-org")
        assert result == "done"
        assert seen["inside"] == "inner-org"
        assert get_current_org_context() == "outer-org"
    finally:
        clear_current_org_context()
