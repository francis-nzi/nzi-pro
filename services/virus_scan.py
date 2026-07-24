"""Malware scanning for user-uploaded files, via a ClamAV daemon (clamd)
reached over TCP.

Every upload endpoint should call scan_bytes() on the raw bytes right
after reading them, before they're written to disk, inserted into a DB
blob column, relayed to OneDrive, or parsed by pandas/openpyxl -- a
malicious file can target the parser itself, not just whatever consumes
its output.

Two distinct failure modes, handled differently on purpose:

- CLAMD_HOST not set at all: scanning was never turned on for this
  environment (local dev, or production before the clamd service is
  provisioned). Uploads are allowed through with a loud warning log --
  this is not a regression, since there was no scanning before this
  module existed either. This is what lets the integration ship safely
  ahead of standing up the actual ClamAV service.
- CLAMD_HOST is set but the daemon can't be reached (down, network
  issue, timeout): scanning was supposed to be active and isn't --
  treated as an anomaly and fails CLOSED (the upload is rejected)
  rather than silently falling back to no protection.
"""
from __future__ import annotations

import io
import logging
import os

logger = logging.getLogger(__name__)

CLAMD_HOST = os.getenv("CLAMD_HOST", "").strip()
CLAMD_PORT = int(os.getenv("CLAMD_PORT", "3310"))
CLAMD_TIMEOUT_SECONDS = float(os.getenv("CLAMD_TIMEOUT_SECONDS", "20"))


class VirusScanError(Exception):
    """Raised when a file is rejected -- either it's infected, or the
    scanner is configured but couldn't be reached (fails closed)."""


def scanning_configured() -> bool:
    return bool(CLAMD_HOST)


def scan_bytes(data: bytes, *, filename: str = "") -> None:
    """Scan `data` for malware. Raises VirusScanError to reject the
    upload; returns None if the file is clean (or scanning isn't
    configured yet -- see module docstring)."""
    if not data:
        return

    if not CLAMD_HOST:
        logger.warning("CLAMD_HOST not set -- skipping virus scan for %r (allowed through)", filename)
        return

    try:
        import clamd
    except ImportError as e:
        raise VirusScanError("File scanning is misconfigured (clamd library not installed).") from e

    try:
        client = clamd.ClamdNetworkSocket(host=CLAMD_HOST, port=CLAMD_PORT, timeout=CLAMD_TIMEOUT_SECONDS)
        result = client.instream(io.BytesIO(data))
    except Exception as e:
        logger.error("Virus scan unreachable for %r: %s", filename, e)
        raise VirusScanError("File scanning is temporarily unavailable -- please try again shortly.") from e

    status, signature = result.get("stream", (None, None))
    if status == "FOUND":
        logger.warning("Virus scan BLOCKED upload %r: %s", filename, signature)
        raise VirusScanError(f"This file was flagged as a security risk ({signature}) and was not uploaded.")
    if status != "OK":
        logger.error("Unexpected virus scan result for %r: %r", filename, result)
        raise VirusScanError("File scanning returned an unexpected result -- please try again shortly.")
