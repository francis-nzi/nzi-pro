from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

import api.admin_routes as admin_routes


def test_user_limit_error_returns_structured_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        admin_routes,
        "_organisation_usage_info",
        lambda _con, org_id: {
            "org_id": org_id,
            "plan": "growth",
            "plan_status": "active",
            "archived": False,
            "max_users": 2,
            "max_clients": 10,
            "active_members": 2,
            "pending_invites": 1,
            "active_clients": 4,
        },
    )

    with pytest.raises(HTTPException) as exc_info:
        admin_routes._require_org_capacity(object(), "org-123", additional_users=1)

    assert exc_info.value.status_code == 403
    detail = exc_info.value.detail
    assert detail["reason"] == "user_limit"
    assert detail["limit_type"] == "users"
    assert detail["limit_value"] == 2
    assert detail["current_value"] == 2
    assert detail["org_id"] == "org-123"


def test_client_limit_error_returns_structured_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        admin_routes,
        "_organisation_usage_info",
        lambda _con, org_id: {
            "org_id": org_id,
            "plan": "growth",
            "plan_status": "active",
            "archived": False,
            "max_users": 12,
            "max_clients": 3,
            "active_members": 2,
            "pending_invites": 0,
            "active_clients": 3,
        },
    )

    with pytest.raises(HTTPException) as exc_info:
        admin_routes._require_org_capacity(object(), "org-123", additional_clients=1)

    assert exc_info.value.status_code == 403
    detail = exc_info.value.detail
    assert detail["reason"] == "client_limit"
    assert detail["limit_type"] == "clients"
    assert detail["limit_value"] == 3
    assert detail["current_value"] == 3
    assert detail["org_id"] == "org-123"


def test_inactive_plan_error_returns_structured_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        admin_routes,
        "_organisation_usage_info",
        lambda _con, org_id: {
            "org_id": org_id,
            "plan": "growth",
            "plan_status": "paused",
            "archived": False,
            "max_users": 12,
            "max_clients": 30,
            "active_members": 2,
            "pending_invites": 0,
            "active_clients": 4,
        },
    )

    with pytest.raises(HTTPException) as exc_info:
        admin_routes._require_org_plan_active(object(), "org-123")

    assert exc_info.value.status_code == 403
    detail = exc_info.value.detail
    assert detail["reason"] == "inactive_plan"
    assert detail["org_id"] == "org-123"
    assert detail["plan_status"] == "paused"
