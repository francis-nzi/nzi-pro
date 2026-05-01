from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.auth_routes as auth_routes


def test_registration_routes_are_exposed():
    paths = {getattr(route, "path", "") for route in auth_routes.router.routes}

    assert "/auth/register" in paths
    assert "/auth/register/verify" in paths
    assert "/auth/register/resend-verification" in paths
