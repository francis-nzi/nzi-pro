from __future__ import annotations

from fastapi import Depends, HTTPException

from api.auth import _current_user
from services.permissions import ADMIN_ACCESS_PERMISSION, user_can_access_client, user_can_access_job, user_has_permission

__all__ = ["ADMIN_ACCESS_PERMISSION", "assert_client_access", "assert_job_access", "assert_permission", "require_permission"]


def require_permission(permission_key: str):
    def _dependency(user: dict = Depends(_current_user)) -> dict:
        if user_has_permission(user, permission_key):
            return user
        raise HTTPException(status_code=403, detail=f"Missing permission: {permission_key}")

    return _dependency


def assert_permission(user: dict | None, permission_key: str) -> None:
    if user_has_permission(user, permission_key):
        return
    raise HTTPException(status_code=403, detail=f"Missing permission: {permission_key}")


def assert_client_access(user: dict | None, client_db_id: int) -> None:
    if user_can_access_client(user, client_db_id):
        return
    raise HTTPException(status_code=403, detail="You do not have access to this client")


def assert_job_access(user: dict | None, job_id: int) -> None:
    if user_can_access_job(user, job_id):
        return
    raise HTTPException(status_code=403, detail="You do not have access to this job")
