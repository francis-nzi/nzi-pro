import os
from pathlib import Path
from threading import Lock

import kaleido

_BROWSER_LOCK = Lock()
_BROWSER_PATH: str | None = None


def _candidate_browser_roots() -> list[Path]:
    roots: list[Path] = []

    explicit = str(os.getenv("KALEIDO_BROWSER_DIR") or "").strip()
    if explicit:
        roots.append(Path(explicit))

    wfm_raw = str(os.getenv("WFM_RAW_DATA_DIR") or "").strip()
    if wfm_raw:
        try:
            roots.append(Path(wfm_raw).resolve().parent / "kaleido-browser")
        except Exception:
            pass

    roots.append(Path("/var/data/nzi-pro-api/kaleido-browser"))
    roots.append(Path("/tmp/nzi-kaleido-browser"))

    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root)
        if key in seen:
            continue
        seen.add(key)
        unique.append(root)
    return unique


def _find_existing_browser(root: Path) -> str | None:
    if not root.exists():
        return None

    for candidate_name in ("chrome.exe", "chrome", "Google Chrome for Testing"):
        try:
            for candidate in root.rglob(candidate_name):
                if candidate.is_file():
                    return str(candidate)
        except Exception:
            continue
    return None


def ensure_kaleido_browser() -> str:
    global _BROWSER_PATH

    with _BROWSER_LOCK:
        if _BROWSER_PATH and Path(_BROWSER_PATH).exists():
            os.environ["BROWSER_PATH"] = _BROWSER_PATH
            return _BROWSER_PATH

        env_browser_path = str(os.getenv("BROWSER_PATH") or "").strip()
        if env_browser_path and Path(env_browser_path).exists():
            _BROWSER_PATH = env_browser_path
            return env_browser_path

        roots = _candidate_browser_roots()
        for root in roots:
            existing = _find_existing_browser(root)
            if existing:
                os.environ["BROWSER_PATH"] = existing
                _BROWSER_PATH = existing
                return existing

        last_error: Exception | None = None
        for root in roots:
            try:
                root.mkdir(parents=True, exist_ok=True)
                exe_path = kaleido.get_chrome_sync(path=root)
                browser_path = str(exe_path)
                if Path(browser_path).exists():
                    os.environ["BROWSER_PATH"] = browser_path
                    _BROWSER_PATH = browser_path
                    return browser_path
            except Exception as exc:
                last_error = exc

        if last_error:
            raise RuntimeError(f"Unable to provision Chrome for Kaleido: {last_error}") from last_error
        raise RuntimeError("Unable to provision Chrome for Kaleido.")
