from __future__ import annotations

from pathlib import Path
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.portal_spend_routes as portal_spend_routes  # noqa: E402


class _SiteConn:
    """Fake conn for _resolve_portal_site_id: says whether the site is owned."""

    def __init__(self, owned: bool):
        self._owned = owned
        self.params = None

    def execute(self, sql, params=None):
        self.params = params
        return self

    def fetchone(self):
        return (1,) if self._owned else None


def _resolve(raw, *, owned=True, user=None):
    return portal_spend_routes._resolve_portal_site_id(
        _SiteConn(owned), user if user is not None else {}, 205, raw
    )


def test_unset_site_stays_none() -> None:
    assert _resolve(None) is None
    assert _resolve("") is None
    assert _resolve("   ") is None


def test_a_picked_site_is_returned_as_an_int() -> None:
    assert _resolve("168") == 168
    assert _resolve(168) == 168


def test_a_site_belonging_to_another_client_is_refused() -> None:
    with pytest.raises(HTTPException) as exc:
        _resolve("999", owned=False)
    assert exc.value.status_code == 400


def test_a_non_numeric_site_is_refused() -> None:
    with pytest.raises(HTTPException) as exc:
        _resolve("head office")
    assert exc.value.status_code == 400


def test_a_site_outside_the_users_scope_is_refused() -> None:
    # Portal users can be restricted to a subset of their client's sites.
    with pytest.raises(HTTPException) as exc:
        _resolve("168", user={"site_ids": [163, 164]})
    assert exc.value.status_code == 403


def test_a_site_inside_the_users_scope_is_allowed() -> None:
    assert _resolve("168", user={"site_ids": [163, 168]}) == 168


def test_the_upload_and_manual_paths_no_longer_hardcode_a_null_site() -> None:
    import inspect

    for fn in (portal_spend_routes.portal_spend_upload_commit,):
        assert "site_id=None" not in inspect.getsource(fn), \
            "portal spend submissions must carry the site the client picked"
