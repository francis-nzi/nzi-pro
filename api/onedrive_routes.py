import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from api.auth import _current_user

router = APIRouter(prefix="/admin/storage/onedrive", tags=["onedrive"])


def _require_env(name: str) -> str:
    value = str(os.getenv(name) or "").strip()
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing required environment variable: {name}")
    return value


def _graph_base() -> str:
    return "https://graph.microsoft.com/v1.0"


def _drive_base_path() -> str:
    drive_id = str(os.getenv("MS_ONEDRIVE_DRIVE_ID") or "").strip()
    site_id = str(os.getenv("MS_ONEDRIVE_SITE_ID") or "").strip()
    user_id = str(os.getenv("MS_ONEDRIVE_USER_ID") or "").strip()

    if drive_id:
        return f"/drives/{drive_id}"
    if site_id:
        return f"/sites/{site_id}/drive"
    if user_id:
        return f"/users/{user_id}/drive"

    raise HTTPException(
        status_code=500,
        detail="OneDrive target not configured. Set MS_ONEDRIVE_DRIVE_ID or MS_ONEDRIVE_SITE_ID or MS_ONEDRIVE_USER_ID.",
    )


def _onedrive_root_path() -> str:
    # Optional fixed root folder in OneDrive/SharePoint document library.
    raw = str(os.getenv("MS_ONEDRIVE_ROOT_PATH") or "").strip()
    if not raw:
        return ""
    return "/" + raw.strip("/")


def _token_endpoint() -> str:
    tenant_id = _require_env("MS_TENANT_ID")
    return f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"


def _graph_token() -> str:
    client_id = _require_env("MS_CLIENT_ID")
    client_secret = _require_env("MS_CLIENT_SECRET")
    token_url = _token_endpoint()

    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default",
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        token_url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            token = str(payload.get("access_token") or "").strip()
            if not token:
                raise HTTPException(status_code=500, detail="Failed to obtain OneDrive access token")
            return token
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"Token request failed: {e.code} {detail}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token request error: {e}")


def _graph_request(
    method: str,
    path: str,
    token: str,
    body: bytes | None = None,
    content_type: str | None = None,
) -> Any:
    url = f"{_graph_base()}{path}"
    headers = {"Authorization": f"Bearer {token}"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=body, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"Graph API error {e.code}: {detail}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph API request failed: {e}")


def _graph_download(path: str, token: str) -> tuple[bytes, str]:
    url = f"{_graph_base()}{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            content_type = str(resp.headers.get("Content-Type") or "application/octet-stream")
            return resp.read(), content_type
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"Graph download error {e.code}: {detail}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph download failed: {e}")


def _joined_remote_path(path: str | None) -> str:
    root = _onedrive_root_path()
    extra = (path or "").strip()
    extra = "/" + extra.strip("/") if extra else ""
    joined = f"{root}{extra}"
    if not joined:
        return ""
    return "/" + joined.strip("/")


@router.get("/health")
def onedrive_health(_user: dict = Depends(_current_user)):
    token = _graph_token()
    drive_base = _drive_base_path()
    remote_path = _joined_remote_path(None)
    if remote_path:
        target = f"{drive_base}/root:{urllib.parse.quote(remote_path)}"
    else:
        target = f"{drive_base}/root"
    meta = _graph_request("GET", target, token)
    return {
        "ok": True,
        "target": drive_base,
        "root_path": _onedrive_root_path(),
        "resolved_root_name": meta.get("name"),
        "resolved_root_id": meta.get("id"),
    }


@router.get("/list")
def onedrive_list(path: str | None = Query(default=None), _user: dict = Depends(_current_user)):
    token = _graph_token()
    drive_base = _drive_base_path()
    remote_path = _joined_remote_path(path)
    if remote_path:
        encoded = urllib.parse.quote(remote_path)
        target = f"{drive_base}/root:{encoded}:/children"
    else:
        target = f"{drive_base}/root/children"
    payload = _graph_request("GET", target, token)
    items = []
    for raw in payload.get("value", []) or []:
        items.append(
            {
                "id": raw.get("id"),
                "name": raw.get("name"),
                "size": raw.get("size"),
                "is_folder": bool(raw.get("folder")),
                "is_file": bool(raw.get("file")),
                "web_url": raw.get("webUrl"),
                "last_modified": raw.get("lastModifiedDateTime"),
            }
        )
    return {"ok": True, "path": remote_path or "/", "items": items}


@router.post("/upload")
async def onedrive_upload(
    folder: str | None = Query(default=None),
    file: UploadFile = File(...),
    _user: dict = Depends(_current_user),
):
    token = _graph_token()
    drive_base = _drive_base_path()

    filename = str(file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    remote_folder = _joined_remote_path(folder)
    full_path = f"{remote_folder}/{filename}" if remote_folder else f"/{filename}"
    encoded = urllib.parse.quote(full_path)

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Cannot upload empty file")
    if len(content) > 4 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="File too large for simple upload (>4MB). Implement upload sessions for larger files.",
        )

    target = f"{drive_base}/root:{encoded}:/content"
    meta = _graph_request("PUT", target, token, body=content, content_type="application/octet-stream")
    return {
        "ok": True,
        "id": meta.get("id"),
        "name": meta.get("name"),
        "size": meta.get("size"),
        "web_url": meta.get("webUrl"),
    }


@router.get("/download/{item_id}")
def onedrive_download(item_id: str, _user: dict = Depends(_current_user)):
    token = _graph_token()
    drive_base = _drive_base_path()
    safe_id = urllib.parse.quote(str(item_id).strip())
    meta = _graph_request("GET", f"{drive_base}/items/{safe_id}", token)
    name = str(meta.get("name") or "download.bin")
    content, content_type = _graph_download(f"{drive_base}/items/{safe_id}/content", token)

    return StreamingResponse(
        io.BytesIO(content),
        media_type=content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )

