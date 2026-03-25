import os
import subprocess
import sys
from pathlib import Path
from threading import Lock

_BROWSER_LOCK = Lock()
_BROWSER_ROOT: str | None = None


def _candidate_browser_roots() -> list[Path]:
    roots: list[Path] = []

    explicit = str(os.getenv("PLAYWRIGHT_BROWSERS_PATH") or "").strip()
    if explicit and explicit != "0":
        roots.append(Path(explicit))

    wfm_raw = str(os.getenv("WFM_RAW_DATA_DIR") or "").strip()
    if wfm_raw:
        try:
            roots.append(Path(wfm_raw).resolve().parent / "playwright-browsers")
        except Exception:
            pass

    roots.append(Path("/var/data/nzi-pro-api/playwright-browsers"))
    roots.append(Path("/tmp/nzi-playwright-browsers"))

    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root)
        if key in seen:
            continue
        seen.add(key)
        unique.append(root)
    return unique


def _root_has_browser(root: Path) -> bool:
    if not root.exists():
        return False
    try:
        for pattern in ("**/chrome-headless-shell", "**/chrome", "**/chrome.exe"):
            if any(path.is_file() for path in root.glob(pattern)):
                return True
    except Exception:
        return False
    return False


def ensure_playwright_browser() -> str:
    global _BROWSER_ROOT

    with _BROWSER_LOCK:
        if _BROWSER_ROOT and _root_has_browser(Path(_BROWSER_ROOT)):
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = _BROWSER_ROOT
            return _BROWSER_ROOT

        roots = _candidate_browser_roots()
        for root in roots:
            if _root_has_browser(root):
                _BROWSER_ROOT = str(root)
                os.environ["PLAYWRIGHT_BROWSERS_PATH"] = _BROWSER_ROOT
                return _BROWSER_ROOT

        last_error: Exception | None = None
        for root in roots:
            try:
                root.mkdir(parents=True, exist_ok=True)
                env = os.environ.copy()
                env["PLAYWRIGHT_BROWSERS_PATH"] = str(root)
                subprocess.run(
                    [sys.executable, "-m", "playwright", "install", "chromium"],
                    check=True,
                    capture_output=True,
                    text=True,
                    env=env,
                )
                if _root_has_browser(root):
                    _BROWSER_ROOT = str(root)
                    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = _BROWSER_ROOT
                    return _BROWSER_ROOT
            except Exception as exc:
                last_error = exc

        if last_error:
            raise RuntimeError(f"Unable to provision Playwright Chromium: {last_error}") from last_error
        raise RuntimeError("Unable to provision Playwright Chromium.")
