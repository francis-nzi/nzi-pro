from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException

router = APIRouter(prefix="/internal/cron", tags=["internal-cron"])


def _check_secret(x_cron_secret: str | None) -> None:
    expected = str(os.getenv("CRON_SECRET") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="CRON_SECRET env var is not set")
    if not x_cron_secret or x_cron_secret.strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid cron secret")


@router.post("/m365-renew")
def cron_m365_renew(x_cron_secret: str | None = Header(default=None)):
    """
    Renew M365 Graph webhook subscriptions expiring within 24 hours.
    Protected by X-Cron-Secret header matching CRON_SECRET env var.
    Call daily via Render cron job or any HTTP scheduler.
    """
    _check_secret(x_cron_secret)
    from api.job_communications_routes import renew_m365_subscriptions_due
    result = renew_m365_subscriptions_due(threshold_hours=24)
    return result
