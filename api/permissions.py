from __future__ import annotations

from fastapi import Depends, HTTPException

from api.auth import _current_user
from services.permissions import user_has_permission


def require_permission(permission_key: str):
    def _dependency(user: dict = Depends(_current_user)) -> dict:
        if user_has_permission(user, permission_key):
            return user
        raise HTTPException(status_code=403, detail=f"Missing permission: {permission_key}")

    return _dependency
