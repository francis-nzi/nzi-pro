from datetime import datetime, timezone
import base64
import io
import json
import os
import re
import secrets
import string
import tempfile
import zipfile
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from threading import Lock

from api.auth import _current_user
from api.permissions import require_permission
from core.database import get_conn
from services.permissions import ADMIN_ACCESS_PERMISSION
from api.admin_routes import _ensure_legacy_cleanup_schema
from api.admin_legacy_helpers import _resolve_job_reference

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)

# =========================
# LEGACY IMPORT / WFM
# =========================

@router.post("/import-export/legacy/preview")
async def legacy_annual_preview(
    job_id: str = Form(...),
    file: UploadFile = File(...),
    _user: dict = Depends(_current_user),
):
    try:
        if not file.filename or not str(file.filename).lower().endswith(".xlsx"):
            raise HTTPException(status_code=400, detail="Only .xlsx files are supported")
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty upload")
        with get_conn() as con:
            resolved_job_id, resolved_job_number = _resolve_job_reference(con, job_id)
        parsed = parse_legacy_annual_workbook(raw)
        return {
            "ok": True,
            "job_id": int(resolved_job_id),
            "job_number": resolved_job_number,
            "filename": str(file.filename),
            "summary": parsed.get("summary") or {},
            "warnings": parsed.get("warnings") or [],
            "rows_ready": parsed.get("rows_ready") or [],
            "rows_unresolved": parsed.get("rows_unresolved") or [],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview legacy annual upload: {e}")


@router.post("/import-export/legacy/commit")
def legacy_annual_commit(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    try:
        job_id_raw = body.get("job_id")
        site_id_raw = body.get("site_id")
        rows = body.get("rows_ready")
        if job_id_raw is None:
            raise HTTPException(status_code=400, detail="job_id is required")
        with get_conn() as con:
            job_id, _job_number = _resolve_job_reference(con, job_id_raw)
        site_id = None
        if site_id_raw is not None and str(site_id_raw).strip() != "":
            try:
                site_id = int(site_id_raw)
            except Exception:
                raise HTTPException(status_code=400, detail="site_id must be an integer")
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=400, detail="rows_ready must be a non-empty list")
        return commit_legacy_rows(job_id=job_id, site_id=site_id, rows=rows)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to commit legacy annual upload: {e}")


@router.post("/import-export/legacy/clear")
def legacy_annual_clear(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    try:
        job_id_raw = body.get("job_id")
        site_id_raw = body.get("site_id")
        if job_id_raw is None:
            raise HTTPException(status_code=400, detail="job_id is required")

        with get_conn() as con:
            _ensure_legacy_cleanup_schema(con)
            job_id, job_number = _resolve_job_reference(con, job_id_raw)

            site_id = None
            if site_id_raw is not None and str(site_id_raw).strip() != "":
                try:
                    site_id = int(site_id_raw)
                except Exception:
                    raise HTTPException(status_code=400, detail="site_id must be an integer")

            where_clause = "WHERE job_id=%s AND data_source='Legacy Annual Upload' AND enabled=TRUE"
            params: list[object] = [int(job_id)]
            if site_id is not None:
                where_clause += " AND site_id=%s"
                params.append(int(site_id))

            affected_site_rows = con.execute(
                f"""
                SELECT DISTINCT site_id
                FROM job_scope_rows
                {where_clause}
                ORDER BY site_id
                """,
                params,
            ).fetchall()
            affected_site_ids = [int(r[0]) for r in affected_site_rows if r and r[0] is not None]

            count_row = con.execute(
                f"""
                SELECT COUNT(*)
                FROM job_scope_rows
                {where_clause}
                """,
                params,
            ).fetchone()
            disabled_rows = int(count_row[0] or 0) if count_row else 0

            con.execute(
                f"""
                UPDATE job_scope_rows
                SET enabled=FALSE, updated_at=NOW()
                {where_clause}
                """,
                params,
            )

        return {
            "ok": True,
            "job_id": int(job_id),
            "job_number": job_number,
            "site_id": int(site_id) if site_id is not None else None,
            "disabled_rows": disabled_rows,
            "affected_site_ids": affected_site_ids,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear legacy annual rows: {e}")


@router.post("/import-export/legacy/resolve")
def legacy_annual_resolve(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    try:
        rows_ready = body.get("rows_ready") or []
        rows_unresolved = body.get("rows_unresolved") or []
        manual_entries = body.get("manual_lookup") or []
        if not isinstance(rows_ready, list) or not isinstance(rows_unresolved, list):
            raise HTTPException(status_code=400, detail="rows_ready and rows_unresolved must be lists")

        manual_lookup: dict[str, str] = {}
        if isinstance(manual_entries, list):
            for it in manual_entries:
                if not isinstance(it, dict):
                    continue
                lk = str(it.get("lookup_key") or "").strip()
                oid = str(it.get("original_id") or "").strip()
                if lk and oid:
                    manual_lookup[lk] = oid

        return resolve_unresolved_rows(
            rows_ready=rows_ready,
            rows_unresolved=rows_unresolved,
            manual_lookup=manual_lookup,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resolve legacy annual rows: {e}")


@router.get("/import-export/attributes/template")
def download_attribute_override_template(_user: dict = Depends(_current_user)):
    try:
        payload = build_override_template_workbook()
        return StreamingResponse(
            io.BytesIO(payload),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="attribute_override_template.xlsx"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build attribute override template: {e}")


@router.get("/import-export/attributes/guide")
def download_attribute_override_guide(_user: dict = Depends(_current_user)):
    try:
        guide_path = Path(__file__).resolve().parents[1] / "ATTRIBUTE_OVERRIDE_CHEATSHEET.docx"
        if not guide_path.exists():
            raise HTTPException(status_code=404, detail="Attribute override guide not found")
        return StreamingResponse(
            io.BytesIO(guide_path.read_bytes()),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": 'attachment; filename="ATTRIBUTE_OVERRIDE_CHEATSHEET.docx"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download attribute override guide: {e}")


@router.post("/import-export/attributes/preview")
async def preview_attribute_overrides(
    file: UploadFile = File(...),
    _user: dict = Depends(_current_user),
):
    try:
        if not file.filename or not str(file.filename).lower().endswith(".xlsx"):
            raise HTTPException(status_code=400, detail="Only .xlsx files are supported")
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty upload")
        return parse_override_workbook(raw, filename=str(file.filename))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview attribute override workbook: {e}")


@router.post("/import-export/attributes/commit")
def commit_attribute_overrides(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    try:
        rows = body.get("rows_ready")
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=400, detail="rows_ready must be a non-empty list")
        actor = str(_user.get("email") or _user.get("user_id") or "unknown").strip()
        return commit_override_rows(rows=rows, actor=actor)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to commit attribute overrides: {e}")


@router.get("/import-export/wfm/summary")
def wfm_import_summary(_user: dict = Depends(_current_user)):
    try:
        raw_dir = _wfm_raw_dir()
        raw_data_available = raw_dir.exists()

        files: list[dict] = []
        total_size = 0
        if raw_data_available:
            for p in sorted(raw_dir.glob("*.csv")):
                size = int(p.stat().st_size)
                total_size += size
                row_count = 0
                try:
                    row_count = max(sum(1 for _ in p.open("r", encoding="utf-8", errors="ignore")) - 1, 0)
                except Exception:
                    row_count = 0
                files.append({"name": p.name, "size_bytes": size, "rows": row_count})

        preview_clients = []
        clients_path = raw_dir / "clients.csv"
        if raw_data_available and clients_path.exists():
            cdf = pd.read_csv(clients_path, dtype=str, keep_default_na=False, na_filter=False)
            for _, r in cdf.head(15).iterrows():
                preview_clients.append(
                    {"wfm_client_id": str(r.get("Id") or "").strip(), "name": str(r.get("Name") or "").strip()}
                )

        imported_counts = {"clients": 0, "contacts": 0, "jobs": 0}
        with get_conn() as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS wfm_import_map (
                  entity_type VARCHAR NOT NULL,
                  wfm_id VARCHAR NOT NULL,
                  nzi_id INTEGER NOT NULL,
                  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (entity_type, wfm_id)
                )
                """
            )
            rows = con.execute(
                """
                SELECT entity_type, COUNT(*) AS cnt
                FROM wfm_import_map
                GROUP BY entity_type
                """
            ).fetchall()
            for entity_type, cnt in rows:
                key = str(entity_type or "").strip().lower()
                if key in imported_counts:
                    imported_counts[key] = int(cnt or 0)

        return {
            "ok": True,
            "folder": str(raw_dir),
            "raw_data_available": bool(raw_data_available),
            "file_count": len(files),
            "total_size_bytes": total_size,
            "files": files,
            "preview_clients": preview_clients,
            "imported_counts": imported_counts,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load WFM summary: {e}")


def _sanitize_wfm_upload_name(name: str) -> str:
    base = Path(str(name or "").strip()).name
    if not base:
        raise HTTPException(status_code=400, detail="Uploaded WFM file is missing a filename")
    if base.startswith("."):
        raise HTTPException(status_code=400, detail=f"Unsupported WFM filename: {base}")
    return base


@router.post("/import-export/wfm/source-files")
async def upload_wfm_source_files(
    files: list[UploadFile] = File(...),
    replace_existing: bool = Form(True),
    _user: dict = Depends(_current_user),
):
    try:
        raw_dir = _wfm_raw_dir()
        raw_dir.mkdir(parents=True, exist_ok=True)

        if replace_existing:
            for existing in raw_dir.glob("*.csv"):
                try:
                    existing.unlink()
                except Exception:
                    pass

        saved_files: list[str] = []
        rejected_files: list[str] = []

        for upload in files:
            original_name = _sanitize_wfm_upload_name(upload.filename or "")
            lower_name = original_name.lower()
            payload = await upload.read()
            if not payload:
                rejected_files.append(f"{original_name}: empty file")
                continue

            if lower_name.endswith(".zip"):
                try:
                    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                        for member in zf.infolist():
                            if member.is_dir():
                                continue
                            member_name = _sanitize_wfm_upload_name(member.filename)
                            if not member_name.lower().endswith(".csv"):
                                continue
                            target = raw_dir / member_name
                            target.write_bytes(zf.read(member))
                            saved_files.append(member_name)
                except zipfile.BadZipFile:
                    rejected_files.append(f"{original_name}: invalid zip archive")
                continue

            if not lower_name.endswith(".csv"):
                rejected_files.append(f"{original_name}: only .csv or .zip files are supported")
                continue

            target = raw_dir / original_name
            target.write_bytes(payload)
            saved_files.append(original_name)

        if not saved_files:
            detail = "No WFM source files were saved"
            if rejected_files:
                detail = f"{detail}. Rejected: {'; '.join(rejected_files)}"
            raise HTTPException(status_code=400, detail=detail)

        files_summary: list[dict[str, int | str]] = []
        total_size = 0
        for p in sorted(raw_dir.glob("*.csv")):
            size = int(p.stat().st_size)
            total_size += size
            row_count = 0
            try:
                row_count = max(sum(1 for _ in p.open("r", encoding="utf-8", errors="ignore")) - 1, 0)
            except Exception:
                row_count = 0
            files_summary.append({"name": p.name, "size_bytes": size, "rows": row_count})

        return {
            "ok": True,
            "saved_files": sorted(set(saved_files)),
            "rejected_files": rejected_files,
            "file_count": len(files_summary),
            "total_size_bytes": total_size,
            "files": files_summary,
            "folder": str(raw_dir),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload WFM source files: {e}")


def _ensure_wfm_mapping_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS wfm_field_catalog (
          id BIGSERIAL PRIMARY KEY,
          file_name VARCHAR NOT NULL,
          field_name VARCHAR NOT NULL,
          source_entity VARCHAR,
          sample_values TEXT,
          non_empty_count INTEGER DEFAULT 0,
          distinct_count INTEGER DEFAULT 0,
          suggested_entity VARCHAR,
          suggested_target VARCHAR,
          suggestion_score NUMERIC,
          suggestion_reason TEXT,
          suggested_candidates_json TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(file_name, field_name)
        )
        """
    )
    con.execute("ALTER TABLE wfm_field_catalog ADD COLUMN IF NOT EXISTS suggestion_score NUMERIC")
    con.execute("ALTER TABLE wfm_field_catalog ADD COLUMN IF NOT EXISTS suggestion_reason TEXT")
    con.execute("ALTER TABLE wfm_field_catalog ADD COLUMN IF NOT EXISTS suggested_candidates_json TEXT")
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS wfm_field_mappings (
          id BIGSERIAL PRIMARY KEY,
          source_entity VARCHAR NOT NULL,
          source_field VARCHAR NOT NULL,
          target_entity VARCHAR NOT NULL,
          target_field VARCHAR NOT NULL,
          priority INTEGER NOT NULL DEFAULT 100,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(source_entity, source_field, target_entity, target_field)
        )
        """
    )


def _default_wfm_targets():
    from wfm_import.wfm_import_routine import WFM_CLIENT_FIELD_CANDIDATES, WFM_JOB_FIELD_CANDIDATES

    return {
        "job": WFM_JOB_FIELD_CANDIDATES,
        "client": WFM_CLIENT_FIELD_CANDIDATES,
    }


WFM_RECOMMENDED_MAPPING_FILES = {
    "custom_fields.csv",
    "job_custom_field_values.csv",
    "client_custom_field_values.csv",
}


def _wfm_raw_dir() -> Path:
    """Resolve WFM raw_data directory from env override or project default.

    This keeps Render/local deployments resilient when the raw_data folder is not
    present in the repository artifact yet.
    """
    env_path = str(os.getenv("WFM_RAW_DATA_DIR") or "").strip()
    if env_path:
        env_dir = Path(env_path)
        try:
            env_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return env_dir

    candidates: list[Path] = []
    project_default = Path(__file__).resolve().parents[1] / "wfm_import" / "raw_data"
    candidates.append(project_default)
    candidates.append(Path.cwd() / "wfm_import" / "raw_data")

    for c in candidates:
        try:
            if c.exists():
                return c
        except Exception:
            continue

    # Last resort: create project default so routes don't fail purely on missing dir.
    try:
        project_default.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return project_default


def _normalize_tokens(value: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", str(value or "").lower()) if t]


def _score_field_mapping(field_name: str, source_entity: str, target_entity: str, target_field: str, candidates: list[str]) -> tuple[float, str]:
    lname = str(field_name or "").strip().lower()
    if not lname:
        return 0.0, "empty field"
    lcompact = re.sub(r"[^a-z0-9]", "", lname)
    best = 0.0
    reason = "low confidence"
    for cand in candidates:
        cl = str(cand or "").strip().lower()
        if not cl:
            continue
        ccompact = re.sub(r"[^a-z0-9]", "", cl)
        if lname == cl or lcompact == ccompact:
            score = 100.0
            local_reason = f"exact match to '{cand}'"
        elif cl in lname or lname in cl:
            score = 88.0
            local_reason = f"substring match with '{cand}'"
        else:
            lt = set(_normalize_tokens(lname))
            ct = set(_normalize_tokens(cl))
            overlap = len(lt & ct)
            union = max(len(lt | ct), 1)
            jacc = overlap / union
            score = jacc * 60.0
            local_reason = f"token similarity to '{cand}' ({overlap} overlap)"

        # Scope-special boosts
        if score > 0 and (("scope 1" in lname and "scope_1" in target_field) or ("scope 2" in lname and "scope_2" in target_field) or ("scope 3" in lname and "scope_3" in target_field)):
            score += 8.0
            local_reason += " + scope match"
        if score > 0 and source_entity and target_entity and source_entity == target_entity:
            score += 4.0
            local_reason += " + entity match"

        if score > best:
            best = score
            reason = local_reason

    return min(best, 100.0), reason


def _load_mapping_overrides_from_db(con) -> dict[str, dict[str, list[str]]]:
    _ensure_wfm_mapping_tables(con)
    rows = con.execute(
        """
        SELECT source_entity, source_field, target_entity, target_field, priority
        FROM wfm_field_mappings
        WHERE is_active = TRUE
        ORDER BY target_entity, target_field, priority, source_field
        """
    ).fetchall()
    out: dict[str, dict[str, list[str]]] = {}
    for source_entity, source_field, target_entity, target_field, _priority in rows:
        te = str(target_entity or "").strip().lower()
        tf = str(target_field or "").strip()
        sf = str(source_field or "").strip()
        if not te or not tf or not sf:
            continue
        out.setdefault(te, {}).setdefault(tf, []).append(sf)
    return out


def _merged_wfm_mapping_summary(con=None) -> dict[str, dict[str, list[str]]]:
    defaults = _default_wfm_targets()
    merged: dict[str, dict[str, list[str]]] = {
        "job": {str(k): list(v or []) for k, v in defaults.get("job", {}).items()},
        "client": {str(k): list(v or []) for k, v in defaults.get("client", {}).items()},
    }

    owns_conn = con is None
    if owns_conn:
        with get_conn() as local_con:
            overrides = _load_mapping_overrides_from_db(local_con)
    else:
        overrides = _load_mapping_overrides_from_db(con)

    for entity, targets in overrides.items():
        et = str(entity or "").strip().lower()
        if et not in {"job", "client"}:
            continue
        for target_field, source_fields in (targets or {}).items():
            tf = str(target_field or "").strip()
            if not tf:
                continue
            cleaned_sources = [str(sf or "").strip() for sf in source_fields or [] if str(sf or "").strip()]
            merged.setdefault(et, {})[tf] = cleaned_sources

    for entity in ("job", "client"):
        merged[entity] = dict(sorted(merged.get(entity, {}).items(), key=lambda item: item[0]))

    return merged


@router.get("/import-export/wfm/mapping")
def wfm_mapping_summary(_user: dict = Depends(_current_user)):
    try:
        raw_dir = _wfm_raw_dir()
        custom_fields_path = raw_dir / "custom_fields.csv"
        jobs_path = raw_dir / "jobs.csv"
        job_custom_values_path = raw_dir / "job_custom_field_values.csv"
        with get_conn() as con:
            merged_mappings = _merged_wfm_mapping_summary(con)
        if not custom_fields_path.exists():
            return {
                "ok": True,
                "raw_data_available": bool(raw_dir.exists()),
                "mappings": merged_mappings,
                "source_fields": {
                    "job_custom_field_names": [],
                    "client_custom_field_names": [],
                },
                "sample_job_custom_values": {},
            }

        cdf = pd.read_csv(custom_fields_path, dtype=str, keep_default_na=False, na_filter=False)
        for col in cdf.columns:
            cdf[col] = cdf[col].astype(str).str.strip()
        usage_job = cdf[cdf.get("Usage - Job", "").str.contains("1", regex=False, na=False)]["Name"].dropna().astype(str).tolist()
        usage_client = cdf[cdf.get("Usage - Client", "").str.contains("1", regex=False, na=False)]["Name"].dropna().astype(str).tolist()

        sample_job_fields = {}
        if jobs_path.exists() and job_custom_values_path.exists():
            jdf = pd.read_csv(jobs_path, dtype=str, keep_default_na=False, na_filter=False)
            vdf = pd.read_csv(job_custom_values_path, dtype=str, keep_default_na=False, na_filter=False)
            for col in jdf.columns:
                jdf[col] = jdf[col].astype(str).str.strip()
            for col in vdf.columns:
                vdf[col] = vdf[col].astype(str).str.strip()
            # Pick one representative job that has custom values.
            job_id = None
            if not jdf.empty and "Id" in jdf.columns:
                row = jdf.iloc[0]
                job_id = str(row.get("Id") or "").strip()
                job_no = str(row.get("Job No") or "").strip()
                sample_job_fields["_sample_job_number"] = job_no
            if job_id:
                vdf = vdf[vdf["Job ID"] == job_id]
                if not vdf.empty:
                    id_to_name = {str(r.get("Id")): str(r.get("Name")) for _, r in cdf.iterrows()}
                    for _, vr in vdf.iterrows():
                        name = id_to_name.get(str(vr.get("Custom Field Id") or "").strip(), "")
                        if not name:
                            continue
                        val = str(vr.get("Value") or "").strip()
                        if val.startswith('="') and val.endswith('"'):
                            val = val[2:-1].strip()
                        sample_job_fields[name] = val

        return {
            "ok": True,
            "raw_data_available": bool(raw_dir.exists()),
            "mappings": merged_mappings,
            "source_fields": {
                "job_custom_field_names": sorted(set(usage_job)),
                "client_custom_field_names": sorted(set(usage_client)),
            },
            "sample_job_custom_values": sample_job_fields,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load WFM mapping summary: {e}")


@router.post("/import-export/wfm/scan")
def scan_wfm_fields(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        defaults = _default_wfm_targets()
        raw_dir = _wfm_raw_dir()
        if not raw_dir.exists():
            raise HTTPException(status_code=404, detail=f"WFM raw_data folder not found: {raw_dir}")
        include_all = bool((body or {}).get("include_all", False))
        min_suggest_score = float((body or {}).get("min_suggest_score", 70))

        suggestions: list[dict] = []
        with get_conn() as con:
            _ensure_wfm_mapping_tables(con)
            for p in sorted(raw_dir.glob("*.csv")):
                if not include_all and p.name not in WFM_RECOMMENDED_MAPPING_FILES:
                    continue
                df = pd.read_csv(p, dtype=str, keep_default_na=False, na_filter=False)
                # Special case: custom_fields.csv should catalog actual custom field definitions,
                # not the metadata column names (e.g. "Dropdown List Options").
                if p.name.lower() == "custom_fields.csv":
                    for col in df.columns:
                        df[col] = df[col].astype(str).str.strip()

                    for _, fr in df.iterrows():
                        field_name = str(fr.get("Name") or "").strip()
                        if not field_name:
                            continue
                        usage_job = str(fr.get("Usage - Job") or "").strip()
                        usage_client = str(fr.get("Usage - Client") or "").strip()
                        source_entity = ""
                        if "1" in usage_client and "1" not in usage_job:
                            source_entity = "client"
                        elif "1" in usage_job and "1" not in usage_client:
                            source_entity = "job"
                        elif "1" in usage_job and "1" in usage_client:
                            source_entity = "job"

                        sample_values = str(fr.get("Dropdown List Options") or "").strip()
                        if sample_values:
                            sample_values = sample_values[:400]

                        suggested_entity = None
                        suggested_target = None
                        best_score = -1.0
                        best_reason = ""
                        ranked: list[dict[str, Any]] = []
                        for entity, target_map in defaults.items():
                            for target, candidates in target_map.items():
                                score, reason = _score_field_mapping(field_name, source_entity, entity, target, candidates)
                                ranked.append({"target_entity": entity, "target_field": target, "score": score, "reason": reason})
                                if score > best_score:
                                    best_score = score
                                    best_reason = reason
                                    suggested_entity = entity
                                    suggested_target = target
                        ranked = sorted(ranked, key=lambda x: float(x.get("score") or 0), reverse=True)[:3]
                        if best_score < min_suggest_score:
                            suggested_entity = None
                            suggested_target = None
                            best_reason = "below confidence threshold"

                        con.execute(
                            """
                            INSERT INTO wfm_field_catalog (
                              file_name, field_name, source_entity, sample_values, non_empty_count, distinct_count,
                              suggested_entity, suggested_target, suggestion_score, suggestion_reason, suggested_candidates_json, updated_at
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                            ON CONFLICT (file_name, field_name) DO UPDATE SET
                              source_entity = EXCLUDED.source_entity,
                              sample_values = EXCLUDED.sample_values,
                              non_empty_count = EXCLUDED.non_empty_count,
                              distinct_count = EXCLUDED.distinct_count,
                              suggested_entity = EXCLUDED.suggested_entity,
                              suggested_target = EXCLUDED.suggested_target,
                              suggestion_score = EXCLUDED.suggestion_score,
                              suggestion_reason = EXCLUDED.suggestion_reason,
                              suggested_candidates_json = EXCLUDED.suggested_candidates_json,
                              updated_at = NOW()
                            """,
                            [
                                p.name,
                                field_name,
                                source_entity or None,
                                sample_values or None,
                                1,
                                1,
                                suggested_entity,
                                suggested_target,
                                float(best_score if best_score >= 0 else 0),
                                best_reason or None,
                                json.dumps(ranked),
                            ],
                        )
                        suggestions.append(
                            {
                                "file_name": p.name,
                                "field_name": field_name,
                                "source_entity": source_entity,
                                "suggested_entity": suggested_entity,
                                "suggested_target": suggested_target,
                            }
                        )
                    continue

                for col in df.columns:
                    series = df[col].astype(str).str.strip()
                    series = series.map(lambda s: s[2:-1].strip() if s.startswith('="') and s.endswith('"') else s)
                    non_empty = series[series != ""]
                    distinct_count = int(non_empty.nunique()) if len(non_empty) else 0
                    sample_values = " | ".join(non_empty.head(3).tolist())
                    source_entity = "job" if "job" in p.name.lower() else ("client" if "client" in p.name.lower() else "")

                    lname = str(col).strip().lower()
                    suggested_entity = None
                    suggested_target = None
                    best_score = -1.0
                    best_reason = ""
                    ranked: list[dict[str, Any]] = []
                    for entity, target_map in defaults.items():
                        for target, candidates in target_map.items():
                            score, reason = _score_field_mapping(str(col), source_entity, entity, target, candidates)
                            ranked.append({"target_entity": entity, "target_field": target, "score": score, "reason": reason})
                            if score > best_score:
                                best_score = score
                                best_reason = reason
                                suggested_entity = entity
                                suggested_target = target
                    ranked = sorted(ranked, key=lambda x: float(x.get("score") or 0), reverse=True)[:3]
                    if best_score < min_suggest_score:
                        suggested_entity = None
                        suggested_target = None
                        best_reason = "below confidence threshold"

                    con.execute(
                        """
                        INSERT INTO wfm_field_catalog (
                          file_name, field_name, source_entity, sample_values, non_empty_count, distinct_count,
                          suggested_entity, suggested_target, suggestion_score, suggestion_reason, suggested_candidates_json, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT (file_name, field_name) DO UPDATE SET
                          source_entity = EXCLUDED.source_entity,
                          sample_values = EXCLUDED.sample_values,
                          non_empty_count = EXCLUDED.non_empty_count,
                          distinct_count = EXCLUDED.distinct_count,
                          suggested_entity = EXCLUDED.suggested_entity,
                          suggested_target = EXCLUDED.suggested_target,
                          suggestion_score = EXCLUDED.suggestion_score,
                          suggestion_reason = EXCLUDED.suggestion_reason,
                          suggested_candidates_json = EXCLUDED.suggested_candidates_json,
                          updated_at = NOW()
                        """,
                        [
                            p.name,
                            str(col),
                            source_entity or None,
                            sample_values or None,
                            int(len(non_empty)),
                            distinct_count,
                            suggested_entity,
                            suggested_target,
                            float(best_score if best_score >= 0 else 0),
                            best_reason or None,
                            json.dumps(ranked),
                        ],
                    )
                    suggestions.append(
                        {
                            "file_name": p.name,
                            "field_name": str(col),
                            "source_entity": source_entity,
                            "suggested_entity": suggested_entity,
                            "suggested_target": suggested_target,
                        }
                    )

        return {"ok": True, "scanned_fields": len(suggestions), "include_all": include_all}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to scan WFM fields: {e}")


@router.get("/import-export/wfm/catalog")
def wfm_catalog(
    q: str | None = None,
    file_name: str | None = None,
    mapped_only: bool = False,
    recommended_only: bool = True,
    _user: dict = Depends(_current_user),
):
    try:
        with get_conn() as con:
            _ensure_wfm_mapping_tables(con)
            sql = """
                SELECT
                  c.file_name, c.field_name, c.source_entity, c.sample_values, c.non_empty_count, c.distinct_count,
                  c.suggested_entity, c.suggested_target, c.suggestion_score, c.suggestion_reason, c.suggested_candidates_json,
                  m.source_entity, m.target_entity, m.target_field, m.priority, m.is_active, m.notes
                FROM wfm_field_catalog c
                LEFT JOIN LATERAL (
                  SELECT mm.source_entity, mm.target_entity, mm.target_field, mm.priority, mm.is_active, mm.notes
                  FROM wfm_field_mappings mm
                  WHERE lower(COALESCE(mm.source_field,'')) = lower(COALESCE(c.field_name,''))
                    AND (
                      lower(COALESCE(c.source_entity, c.suggested_entity, '')) = ''
                      OR lower(COALESCE(mm.source_entity,'')) = lower(COALESCE(c.source_entity, c.suggested_entity,''))
                    )
                  ORDER BY mm.is_active DESC, mm.updated_at DESC, mm.priority ASC
                  LIMIT 1
                ) m ON TRUE
                WHERE 1=1
            """
            params: list[Any] = []
            if q:
                sql += " AND (lower(c.field_name) LIKE %s OR lower(c.file_name) LIKE %s OR lower(COALESCE(c.sample_values,'')) LIKE %s)"
                qq = f"%{str(q).strip().lower()}%"
                params.extend([qq, qq, qq])
            if file_name:
                sql += " AND c.file_name = %s"
                params.append(str(file_name).strip())
            elif recommended_only:
                rec_files = sorted(WFM_RECOMMENDED_MAPPING_FILES)
                placeholders = ",".join(["%s"] * len(rec_files))
                sql += f" AND c.file_name IN ({placeholders})"
                params.extend(rec_files)
            if mapped_only:
                sql += " AND m.target_field IS NOT NULL"
            sql += " ORDER BY c.file_name, c.field_name"
            rows = con.execute(sql, params).fetchall()

            items = []
            for r in rows:
                items.append(
                    {
                        "file_name": r[0],
                        "field_name": r[1],
                        "source_entity": (r[2] or r[6] or None),
                        "sample_values": r[3],
                        "non_empty_count": int(r[4] or 0),
                        "distinct_count": int(r[5] or 0),
                        "suggested_entity": r[6],
                        "suggested_target": r[7],
                        "suggestion_score": float(r[8] or 0),
                        "suggestion_reason": r[9],
                        "suggested_candidates": json.loads(r[10]) if r[10] else [],
                        "source_entity": (r[11] or r[2] or r[6] or None),
                        "target_entity": r[12],
                        "target_field": r[13],
                        "priority": int(r[14] or 100) if r[14] is not None else 100,
                        "is_active": bool(r[15]) if r[15] is not None else False,
                        "notes": r[16],
                    }
                )
            return {"ok": True, "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load WFM catalog: {e}")


@router.post("/import-export/wfm/mappings/upsert")
def upsert_wfm_mapping(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        source_entity = str(body.get("source_entity") or "").strip().lower()
        source_field = str(body.get("source_field") or "").strip()
        target_entity = str(body.get("target_entity") or "").strip().lower()
        target_field = str(body.get("target_field") or "").strip()
        priority = int(body.get("priority") or 100)
        is_active = bool(body.get("is_active", True))
        exclusive = bool(body.get("exclusive", True))
        notes = str(body.get("notes") or "").strip() or None
        if not source_entity or not source_field or not target_entity or not target_field:
            raise HTTPException(status_code=400, detail="source_entity, source_field, target_entity, target_field are required")

        with get_conn() as con:
            _ensure_wfm_mapping_tables(con)
            con.execute(
                """
                INSERT INTO wfm_field_mappings (
                  source_entity, source_field, target_entity, target_field, priority, is_active, notes, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (source_entity, source_field, target_entity, target_field) DO UPDATE SET
                  priority = EXCLUDED.priority,
                  is_active = EXCLUDED.is_active,
                  notes = EXCLUDED.notes,
                  updated_at = NOW()
                """,
                [source_entity, source_field, target_entity, target_field, int(priority), bool(is_active), notes],
            )
            # Keep a single effective mapping per source field unless explicitly disabled.
            # This prevents stale earlier mappings from overriding the latest admin choice.
            if exclusive:
                con.execute(
                    """
                    UPDATE wfm_field_mappings
                    SET is_active = FALSE, updated_at = NOW()
                    WHERE lower(COALESCE(source_entity,'')) = lower(%s)
                      AND lower(COALESCE(source_field,'')) = lower(%s)
                      AND NOT (
                        lower(COALESCE(target_entity,'')) = lower(%s)
                        AND lower(COALESCE(target_field,'')) = lower(%s)
                      )
                    """,
                    [source_entity, source_field, target_entity, target_field],
                )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upsert WFM mapping: {e}")


@router.post("/import-export/wfm/mappings/map-suggested")
def map_suggested_wfm_fields(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        min_score = float(body.get("min_score") or 70)
        only_unmapped = bool(body.get("only_unmapped", True))
        recommended_only = bool(body.get("recommended_only", True))
        applied = 0
        skipped = 0
        with get_conn() as con:
            _ensure_wfm_mapping_tables(con)
            sql = """
                SELECT c.source_entity, c.field_name, c.suggested_entity, c.suggested_target, COALESCE(c.suggestion_score, 0),
                       m.id
                FROM wfm_field_catalog c
                LEFT JOIN wfm_field_mappings m
                  ON lower(COALESCE(m.source_entity,'')) = lower(COALESCE(c.source_entity, c.suggested_entity,''))
                 AND lower(COALESCE(m.source_field,'')) = lower(COALESCE(c.field_name,''))
                 AND m.is_active = TRUE
                WHERE c.suggested_entity IS NOT NULL
                  AND c.suggested_target IS NOT NULL
            """
            params: list[Any] = []
            if recommended_only:
                rec_files = sorted(WFM_RECOMMENDED_MAPPING_FILES)
                ph = ",".join(["%s"] * len(rec_files))
                sql += f" AND c.file_name IN ({ph})"
                params.extend(rec_files)
            sql += " ORDER BY c.file_name, c.field_name"
            rows = con.execute(sql, params).fetchall()
            for source_entity, source_field, suggested_entity, suggested_target, score, existing_id in rows:
                if float(score or 0) < min_score:
                    skipped += 1
                    continue
                if only_unmapped and existing_id is not None:
                    skipped += 1
                    continue
                src_entity = str(source_entity or suggested_entity or "").strip().lower()
                if not src_entity:
                    skipped += 1
                    continue
                con.execute(
                    """
                    INSERT INTO wfm_field_mappings (
                      source_entity, source_field, target_entity, target_field, priority, is_active, notes, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, TRUE, %s, NOW())
                    ON CONFLICT (source_entity, source_field, target_entity, target_field) DO UPDATE SET
                      is_active = TRUE,
                      updated_at = NOW()
                    """,
                    [
                        src_entity,
                        str(source_field or "").strip(),
                        str(suggested_entity or "").strip().lower(),
                        str(suggested_target or "").strip(),
                        10,
                        "Auto-mapped from suggestion",
                    ],
                )
                applied += 1
        return {
            "ok": True,
            "applied": applied,
            "skipped": skipped,
            "min_score": min_score,
            "recommended_only": recommended_only,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to map suggested fields: {e}")


@router.post("/import-export/wfm/mappings/preview-impact")
def preview_wfm_mapping_impact(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        from wfm_import.wfm_import_routine import (
            WfmImporter,
            _setup_logger,
            _clean,
            _parse_date,
            _to_bool,
            _to_float,
            WFM_CLIENT_FIELD_CANDIDATES,
            WFM_JOB_FIELD_CANDIDATES,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WFM importer unavailable: {e}")

    try:
        raw_dir = _wfm_raw_dir()
        required_files = [
            "jobs.csv",
            "job_custom_field_values.csv",
            "client_custom_field_values.csv",
            "custom_fields.csv",
            "clients.csv",
            "client_addresses.csv",
            "contacts.csv",
            "client_contact.csv",
            "staff.csv",
        ]
        missing = [name for name in required_files if not (raw_dir / name).exists()]
        if missing:
            raise HTTPException(status_code=404, detail=f"Required WFM files missing in raw_data: {', '.join(missing)}")

        job_numbers_raw = body.get("job_numbers") or []
        client_ids_raw = body.get("client_ids") or []
        client_names_raw = body.get("client_names") or []
        if isinstance(job_numbers_raw, str):
            job_numbers = [x.strip() for x in job_numbers_raw.split(",") if x.strip()]
        else:
            job_numbers = [str(x).strip() for x in job_numbers_raw if str(x).strip()]
        if isinstance(client_ids_raw, str):
            client_ids = [x.strip() for x in client_ids_raw.split(",") if x.strip()]
        else:
            client_ids = [str(x).strip() for x in client_ids_raw if str(x).strip()]
        if isinstance(client_names_raw, str):
            client_names = [x.strip() for x in client_names_raw.split(",") if x.strip()]
        else:
            client_names = [str(x).strip() for x in client_names_raw if str(x).strip()]

        with get_conn() as con:
            mapping_overrides = _load_mapping_overrides_from_db(con)

        importer = WfmImporter(
            dry_run=True,
            max_clients=None,
            client_ids=client_ids,
            client_names=client_names,
            job_numbers=job_numbers,
            mapping_overrides=mapping_overrides,
            logger=_setup_logger(),
        )
        importer.load()
        importer.pick_clients()

        selected_jobs = importer.data["jobs.csv"].copy()
        selected_clients = importer.data["clients.csv"].copy()

        impacts: dict[str, dict[str, dict[str, list[str] | int]]] = {"job": {}, "client": {}}

        def _pick_with_source(value_map: dict[str, str], candidates: list[str]) -> tuple[str, str]:
            if not value_map:
                return "", ""
            for candidate in candidates:
                value = _clean(value_map.get(str(candidate or "").strip().lower()))
                if value:
                    return value, str(candidate or "").strip()
            return "", ""

        def _sample_text(value) -> str:
            if isinstance(value, bool):
                return "true" if value else "false"
            if value is None:
                return ""
            if isinstance(value, float):
                if pd.isna(value):
                    return ""
                if value.is_integer():
                    return str(int(value))
                return f"{value:g}"
            return str(value).strip()

        def _record_impact(entity: str, target_field: str, value, source_label: str) -> None:
            sample = _sample_text(value)
            if not sample:
                return
            bucket = impacts[entity].setdefault(target_field, {"count": 0, "samples": [], "source_fields": []})
            bucket["count"] = int(bucket["count"]) + 1
            if source_label:
                existing_sources = {str(x).lower() for x in bucket["source_fields"]}
                if source_label.lower() not in existing_sources:
                    bucket["source_fields"].append(source_label)
            if sample not in bucket["samples"] and len(bucket["samples"]) < 5:
                bucket["samples"].append(sample)

        client_builtin_targets = set(WFM_CLIENT_FIELD_CANDIDATES.keys())
        job_builtin_targets = set(WFM_JOB_FIELD_CANDIDATES.keys())

        for _, row in selected_clients.iterrows():
            wfm_client_id = _clean(row.get("Id"))
            client_custom = importer.client_custom_values.get(wfm_client_id, {})

            company_reg_custom, company_reg_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "company_reg", WFM_CLIENT_FIELD_CANDIDATES["company_reg"]),
            )
            company_reg = company_reg_custom or _clean(row.get("Company Number"))
            if not company_reg_source and company_reg:
                company_reg_source = "clients.csv::Company Number"
            _record_impact("client", "company_reg", company_reg, company_reg_source)

            sic_code, sic_code_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "sic_code", WFM_CLIENT_FIELD_CANDIDATES["sic_code"]),
            )
            _record_impact("client", "sic_code", sic_code, sic_code_source)

            year_end = _parse_date(row.get("Year End Date"))
            year_end_month = year_end[5:7] if year_end else ""
            year_end_source = "clients.csv::Year End Date" if year_end_month else ""
            custom_year_end_raw, custom_year_end_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "year_end_month", WFM_CLIENT_FIELD_CANDIDATES["year_end_month"]),
            )
            custom_year_end = _parse_date(custom_year_end_raw)
            if custom_year_end:
                year_end_month = custom_year_end[5:7]
                year_end_source = custom_year_end_source
            _record_impact("client", "year_end_month", year_end_month, year_end_source)

            industry, industry_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "industry", WFM_CLIENT_FIELD_CANDIDATES["industry"]),
            )
            _record_impact("client", "industry", industry, industry_source)

            benchmark_period_start_raw, benchmark_period_start_source = _pick_with_source(
                client_custom,
                importer._candidates(
                    "client",
                    "benchmark_period_start",
                    WFM_CLIENT_FIELD_CANDIDATES["benchmark_period_start"],
                ),
            )
            _record_impact(
                "client",
                "benchmark_period_start",
                _parse_date(benchmark_period_start_raw),
                benchmark_period_start_source,
            )

            benchmark_period_end_raw, benchmark_period_end_source = _pick_with_source(
                client_custom,
                importer._candidates(
                    "client",
                    "benchmark_period_end",
                    WFM_CLIENT_FIELD_CANDIDATES["benchmark_period_end"],
                ),
            )
            _record_impact(
                "client",
                "benchmark_period_end",
                _parse_date(benchmark_period_end_raw),
                benchmark_period_end_source,
            )

            currency, currency_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "currency", WFM_CLIENT_FIELD_CANDIDATES["currency"]),
            )
            _record_impact("client", "currency", currency, currency_source)

            description_long, description_long_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "description_long", WFM_CLIENT_FIELD_CANDIDATES["description_long"]),
            )
            _record_impact("client", "description_long", description_long, description_long_source)

            client_turnover_raw, client_turnover_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "turnover", WFM_CLIENT_FIELD_CANDIDATES["turnover"]),
            )
            _record_impact("client", "turnover", _to_float(client_turnover_raw), client_turnover_source)

            for target_field in importer._mapped_custom_targets("client", client_builtin_targets):
                dynamic_value, dynamic_source = _pick_with_source(
                    client_custom,
                    importer._candidates("client", target_field, [target_field]),
                )
                _record_impact("client", target_field, dynamic_value, dynamic_source)

        for _, row in selected_jobs.iterrows():
            wfm_job_id = _clean(row.get("Id"))
            wfm_client_id = _clean(row.get("Client"))
            job_custom = importer.job_custom_values.get(wfm_job_id, {})
            client_custom = importer.client_custom_values.get(wfm_client_id, {})

            start_date = _parse_date(row.get("Start Date (DD/MM/YYYY)"))
            due_date = _parse_date(row.get("Due Date (DD/MM/YYYY)"))

            report_from_raw, report_from_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "report_from", WFM_JOB_FIELD_CANDIDATES["report_from"]),
            )
            report_from = _parse_date(report_from_raw) or start_date
            if not report_from_source and report_from:
                report_from_source = "jobs.csv::Start Date (DD/MM/YYYY)"
            _record_impact("job", "report_from", report_from, report_from_source)

            report_to_raw, report_to_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "report_to", WFM_JOB_FIELD_CANDIDATES["report_to"]),
            )
            report_to = _parse_date(report_to_raw) or due_date
            if not report_to_source and report_to:
                report_to_source = "jobs.csv::Due Date (DD/MM/YYYY)"
            _record_impact("job", "report_to", report_to, report_to_source)

            crm_name_raw, crm_name_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "crm_name", WFM_JOB_FIELD_CANDIDATES["crm_name"]),
            )
            crm_name = _clean(crm_name_raw) or importer.staff_name_by_id.get(_clean(row.get("Job Manager"))) or ""
            if not crm_name_source and crm_name:
                crm_name_source = "jobs.csv::Job Manager (via staff.csv)"
            _record_impact("job", "crm_name", crm_name, crm_name_source)

            is_benchmark_raw, is_benchmark_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "is_benchmark", WFM_JOB_FIELD_CANDIDATES["is_benchmark"]),
            )
            _record_impact("job", "is_benchmark", _to_bool(is_benchmark_raw), is_benchmark_source)

            is_renewal_raw, is_renewal_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "is_renewal", WFM_JOB_FIELD_CANDIDATES["is_renewal"]),
            )
            _record_impact("job", "is_renewal", _to_bool(is_renewal_raw), is_renewal_source)

            data_collection_due_raw, data_collection_due_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "data_collection_due", WFM_JOB_FIELD_CANDIDATES["data_collection_due"]),
            )
            _record_impact("job", "data_collection_due", _parse_date(data_collection_due_raw), data_collection_due_source)

            first_draft_due_raw, first_draft_due_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "first_draft_due", WFM_JOB_FIELD_CANDIDATES["first_draft_due"]),
            )
            _record_impact("job", "first_draft_due", _parse_date(first_draft_due_raw), first_draft_due_source)

            final_report_due_raw, final_report_due_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "final_report_due", WFM_JOB_FIELD_CANDIDATES["final_report_due"]),
            )
            _record_impact("job", "final_report_due", _parse_date(final_report_due_raw), final_report_due_source)

            scope_1_raw, scope_1_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "scope_1_tco2e", WFM_JOB_FIELD_CANDIDATES["scope_1_tco2e"]),
            )
            _record_impact("job", "scope_1_tco2e", _to_float(scope_1_raw), scope_1_source)

            scope_2_raw, scope_2_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "scope_2_tco2e", WFM_JOB_FIELD_CANDIDATES["scope_2_tco2e"]),
            )
            _record_impact("job", "scope_2_tco2e", _to_float(scope_2_raw), scope_2_source)

            scope_3_raw, scope_3_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "scope_3_tco2e", WFM_JOB_FIELD_CANDIDATES["scope_3_tco2e"]),
            )
            _record_impact("job", "scope_3_tco2e", _to_float(scope_3_raw), scope_3_source)

            employees_raw, employees_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "employees", WFM_JOB_FIELD_CANDIDATES["employees"]),
            )
            _record_impact("job", "employees", _to_float(employees_raw), employees_source)

            turnover_raw, turnover_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "turnover", WFM_JOB_FIELD_CANDIDATES["turnover"]),
            )
            turnover_value = _to_float(turnover_raw)
            if turnover_value is None:
                client_turnover_raw, client_turnover_source = _pick_with_source(
                    client_custom,
                    importer._candidates("client", "turnover", WFM_CLIENT_FIELD_CANDIDATES["turnover"]),
                )
                turnover_value = _to_float(client_turnover_raw)
                if turnover_value is not None:
                    turnover_source = f"client custom::{client_turnover_source}" if client_turnover_source else ""
            _record_impact("job", "turnover", turnover_value, turnover_source)

            for target_field in importer._mapped_custom_targets("job", job_builtin_targets):
                dynamic_value, dynamic_source = _pick_with_source(
                    job_custom,
                    importer._candidates("job", target_field, [target_field]),
                )
                _record_impact("job", target_field, dynamic_value, dynamic_source)

        direct = {
            "job.crm_name <- jobs.csv::Job Manager (via staff.csv)": {
                "count": int(
                    len(
                        selected_jobs[
                            selected_jobs["Job Manager"].astype(str).str.strip().isin(importer.staff_name_by_id.keys())
                        ]
                    )
                ),
                "samples": selected_jobs[
                    selected_jobs["Job Manager"].astype(str).str.strip().isin(importer.staff_name_by_id.keys())
                ]["Job No"].head(5).tolist(),
            },
            "job.report_from/report_to <- jobs.csv::Start Date / Due Date": {
                "count": int(
                    len(
                        selected_jobs[
                            selected_jobs["Start Date (DD/MM/YYYY)"].astype(str).str.strip().ne("")
                            | selected_jobs["Due Date (DD/MM/YYYY)"].astype(str).str.strip().ne("")
                        ]
                    )
                ),
                "samples": selected_jobs[
                    selected_jobs["Start Date (DD/MM/YYYY)"].astype(str).str.strip().ne("")
                    | selected_jobs["Due Date (DD/MM/YYYY)"].astype(str).str.strip().ne("")
                ]["Job No"].head(5).tolist(),
            },
        }

        return {
            "ok": True,
            "coverage_note": "Counts reflect unique selected jobs or clients with a resolved value after importer fallback rules.",
            "selection": {
                "jobs": int(len(selected_jobs)),
                "clients": int(len(selected_clients)),
                "job_numbers": selected_jobs["Job No"].head(20).tolist(),
            },
            "impacts": impacts,
            "direct_mappings": direct,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview mapping impact: {e}")


def _build_wfm_client_field_backfill_preview(con, *, target_field: str, overwrite_existing: bool) -> dict:
    try:
        from wfm_import.wfm_import_routine import (
            _clean,
            _parse_date,
            WFM_CLIENT_FIELD_CANDIDATES,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WFM importer unavailable: {e}")

    field_key = str(target_field or "").strip()
    field_configs: dict[str, dict] = {
        "industry": {
            "label": "Industry",
            "target_column": "industry",
            "required_files": ["clients.csv", "custom_fields.csv", "client_custom_field_values.csv"],
            "default_candidates": WFM_CLIENT_FIELD_CANDIDATES.get("industry")
            or ["Industry", "Sector", "Business Sector", "Company Sector"],
            "needs_lookup_values": True,
        },
        "crm_owner": {
            "label": "Client Manager",
            "target_column": "crm_owner",
            "required_files": ["clients.csv", "staff.csv"],
            "default_candidates": ["Client Manager", "Account Manager", "CRM Owner", "Job Manager"],
            "direct_column": "Client Manager",
            "uses_staff_lookup": True,
        },
        "year_end_month": {
            "label": "Financial Year End Month",
            "target_column": "year_end_month",
            "required_files": ["clients.csv"],
            "default_candidates": WFM_CLIENT_FIELD_CANDIDATES.get("year_end_month") or ["Financial Year End", "Year End Date"],
            "direct_column": "Year End Date",
            "transform": "month_from_date",
        },
        "benchmark_period_start": {
            "label": "Benchmark Period Start",
            "target_column": "benchmark_period_start",
            "required_files": ["clients.csv", "custom_fields.csv", "client_custom_field_values.csv"],
            "default_candidates": WFM_CLIENT_FIELD_CANDIDATES.get("benchmark_period_start")
            or ["Benchmark Date From", "Benchmark Period Start"],
            "transform": "date",
        },
        "benchmark_period_end": {
            "label": "Benchmark Period End",
            "target_column": "benchmark_period_end",
            "required_files": ["clients.csv", "custom_fields.csv", "client_custom_field_values.csv"],
            "default_candidates": WFM_CLIENT_FIELD_CANDIDATES.get("benchmark_period_end")
            or ["Benchmark Date To", "Benchmark Period End"],
            "transform": "date",
        },
    }
    config = field_configs.get(field_key)
    if not config:
        raise HTTPException(status_code=400, detail=f"Unsupported client backfill field: {field_key}")

    raw_dir = _wfm_raw_dir()
    required_files = list(config.get("required_files") or [])
    missing = [name for name in required_files if not (raw_dir / name).exists()]
    if missing:
        raise HTTPException(status_code=404, detail=f"Required WFM files missing in raw_data: {', '.join(missing)}")

    mapping_overrides = _load_mapping_overrides_from_db(con)
    client_mapping_overrides = mapping_overrides.get("client", {}) if isinstance(mapping_overrides, dict) else {}
    if not isinstance(client_mapping_overrides, dict):
        client_mapping_overrides = {}
    default_industry_candidates = WFM_CLIENT_FIELD_CANDIDATES.get("industry") or [
        "Industry",
        "Sector",
        "Business Sector",
        "Company Sector",
    ]
    candidate_fields: list[str] = []
    default_candidates = list(config.get("default_candidates") or default_industry_candidates)
    for value in [*(client_mapping_overrides.get(field_key, []) or []), *default_candidates]:
        cleaned = _clean(value)
        if cleaned and cleaned.lower() not in {item.lower() for item in candidate_fields}:
            candidate_fields.append(cleaned)

    def _read_wfm_csv(name: str) -> pd.DataFrame:
        path = raw_dir / name
        df = pd.read_csv(path, dtype=str, keep_default_na=False, na_filter=False)
        for col in df.columns:
            df[col] = df[col].map(_clean)
        return df

    clients_df = _read_wfm_csv("clients.csv")
    custom_fields_df = _read_wfm_csv("custom_fields.csv") if (raw_dir / "custom_fields.csv").exists() else pd.DataFrame()
    client_custom_values_df = (
        _read_wfm_csv("client_custom_field_values.csv")
        if (raw_dir / "client_custom_field_values.csv").exists()
        else pd.DataFrame()
    )
    staff_df = _read_wfm_csv("staff.csv") if (raw_dir / "staff.csv").exists() else pd.DataFrame()

    field_name_by_id: dict[str, str] = {}
    for _, row in custom_fields_df.iterrows():
        field_id = _clean(row.get("Id"))
        field_name = _clean(row.get("Name"))
        if field_id and field_name:
            field_name_by_id[field_id] = field_name

    client_custom_values: dict[str, dict[str, str]] = {}
    for _, row in client_custom_values_df.iterrows():
        client_id = _clean(row.get("Client ID"))
        field_id = _clean(row.get("Custom Field Id"))
        field_value = _clean(row.get("Value"))
        if not client_id or not field_id:
            continue
        field_name = field_name_by_id.get(field_id, field_id)
        client_custom_values.setdefault(client_id, {})[field_name.lower()] = field_value

    staff_name_by_id: dict[str, str] = {}
    for _, row in staff_df.iterrows():
        staff_id = _clean(row.get("Id"))
        if not staff_id:
            continue
        staff_name = " ".join([part for part in [_clean(row.get("First Name")), _clean(row.get("Last Name"))] if part]).strip()
        staff_name_by_id[staff_id] = staff_name or _clean(row.get("Email")) or staff_id

    def _pick_field_value(value_map: dict[str, str], candidates: list[str]) -> str:
        if not value_map:
            return ""
        for name in candidates:
            value = _clean(value_map.get(str(name or "").strip().lower()))
            if value:
                return value
        return ""

    def _transform_value(raw_value: str) -> str:
        value = _clean(raw_value)
        transform = str(config.get("transform") or "").strip().lower()
        if not value:
            return ""
        if config.get("uses_staff_lookup"):
            return _clean(staff_name_by_id.get(value) or value)
        if transform == "date":
            return _clean(_parse_date(value))
        if transform == "month_from_date":
            parsed = _clean(_parse_date(value))
            return parsed[5:7] if len(parsed) >= 7 else ""
        return value

    client_columns = {
        str(row[0] or "").strip().lower()
        for row in con.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'clients'
            """
        ).fetchall()
    }
    target_column = str(config.get("target_column") or field_key).strip()
    if target_column.lower() not in client_columns:
        raise HTTPException(status_code=400, detail=f"Client field not available in this environment: {target_column}")

    if clients_df is None or clients_df.empty:
        return {
            "ok": True,
            "target_field": field_key,
            "target_label": str(config.get("label") or field_key),
            "summary": {
                "total_wfm_clients": 0,
                "clients_with_wfm_value": 0,
                "matched_by_map": 0,
                "matched_by_name": 0,
                "ready_updates": 0,
                "fill_updates": 0,
                "replace_updates": 0,
                "unchanged": 0,
                "missing_wfm_value": 0,
                "unmatched_clients": 0,
                "ambiguous_name_matches": 0,
                "missing_lookup_values": 0,
            },
            "rows_ready": [],
            "rows_unmatched": [],
            "rows_unchanged": [],
        }

    map_rows = con.execute(
        """
        SELECT wfm_id, nzi_id
        FROM wfm_import_map
        WHERE entity_type = 'client'
        """
    ).fetchall()
    client_map = {str(row[0] or "").strip(): int(row[1]) for row in map_rows if row and row[0] and row[1] is not None}

    client_rows = con.execute(
        f"""
        SELECT db_id, client_name, {target_column}
        FROM clients
        """
    ).fetchall()
    clients_by_id: dict[int, dict] = {}
    clients_by_name: dict[str, list[dict]] = {}
    for db_id, client_name, existing_value in client_rows:
        item = {
            "db_id": int(db_id),
            "client_name": str(client_name or "").strip(),
            "existing_value": str(existing_value or "").strip(),
        }
        clients_by_id[item["db_id"]] = item
        name_key = item["client_name"].lower()
        if name_key:
            clients_by_name.setdefault(name_key, []).append(item)

    lookup_value_names: set[str] = set()
    has_industries_lookup = bool(
        con.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'industries_lookup'
            LIMIT 1
            """
        ).fetchone()
    )
    if config.get("needs_lookup_values") and has_industries_lookup:
        try:
            lookup_rows = con.execute("SELECT name FROM industries_lookup WHERE name IS NOT NULL").fetchall()
            lookup_value_names = {str(row[0] or "").strip().lower() for row in lookup_rows if str(row[0] or "").strip()}
        except Exception:
            lookup_value_names = set()

    rows_ready: list[dict] = []
    rows_unmatched: list[dict] = []
    rows_unchanged: list[dict] = []
    matched_by_map = 0
    matched_by_name = 0
    missing_wfm_value = 0
    ambiguous_name_matches = 0

    for _, row in clients_df.iterrows():
        wfm_client_id = _clean(row.get("Id"))
        client_name = _clean(row.get("Name"))
        client_custom = client_custom_values.get(wfm_client_id, {})
        direct_value = _transform_value(_clean(row.get(str(config.get("direct_column") or ""))))
        custom_value = _transform_value(_pick_field_value(client_custom, candidate_fields))
        wfm_value = custom_value or direct_value

        if not wfm_value:
            missing_wfm_value += 1
            continue

        matched = None
        match_method = ""
        if wfm_client_id in client_map:
            matched = clients_by_id.get(client_map[wfm_client_id])
            if matched:
                match_method = "wfm_import_map"
                matched_by_map += 1

        if matched is None and client_name:
            name_matches = clients_by_name.get(client_name.lower(), [])
            if len(name_matches) == 1:
                matched = name_matches[0]
                match_method = "client_name"
                matched_by_name += 1
            elif len(name_matches) > 1:
                ambiguous_name_matches += 1
                rows_unmatched.append(
                    {
                        "wfm_client_id": wfm_client_id,
                        "client_name": client_name,
                        "wfm_value": wfm_value,
                        "reason": f"Ambiguous client name match ({len(name_matches)} matches)",
                    }
                )
                continue

        if matched is None:
            rows_unmatched.append(
                {
                    "wfm_client_id": wfm_client_id,
                    "client_name": client_name,
                    "wfm_value": wfm_value,
                    "reason": "No NZI client match found",
                }
            )
            continue

        existing_value = str(matched.get("existing_value") or "").strip()
        same_value = existing_value.lower() == wfm_value.lower() if existing_value else False
        if same_value:
            rows_unchanged.append(
                {
                    "nzi_client_id": matched.get("db_id"),
                    "client_name": matched.get("client_name"),
                    "existing_value": existing_value,
                    "wfm_value": wfm_value,
                    "match_method": match_method,
                    "reason": f"Already matches WFM {config.get('label')}",
                }
            )
            continue

        if existing_value and not overwrite_existing:
            rows_unchanged.append(
                {
                    "nzi_client_id": matched.get("db_id"),
                    "client_name": matched.get("client_name"),
                    "existing_value": existing_value,
                    "wfm_value": wfm_value,
                    "match_method": match_method,
                    "reason": "Existing value kept",
                }
            )
            continue

        rows_ready.append(
            {
                "nzi_client_id": matched.get("db_id"),
                "wfm_client_id": wfm_client_id,
                "client_name": matched.get("client_name") or client_name,
                "existing_value": existing_value or None,
                "wfm_value": wfm_value,
                "match_method": match_method,
                "action": "replace" if existing_value else "fill",
            }
        )

    missing_lookup_values = sorted(
        {
            str(row.get("wfm_value") or "").strip()
            for row in rows_ready
            if str(row.get("wfm_value") or "").strip()
            and str(row.get("wfm_value") or "").strip().lower() not in lookup_value_names
        }
    ) if config.get("needs_lookup_values") else []

    return {
        "ok": True,
        "target_field": field_key,
        "target_label": str(config.get("label") or field_key),
        "target_column": target_column,
        "summary": {
            "total_wfm_clients": int(len(clients_df)),
            "clients_with_wfm_value": int(len(clients_df) - missing_wfm_value),
            "matched_by_map": int(matched_by_map),
            "matched_by_name": int(matched_by_name),
            "ready_updates": int(len(rows_ready)),
            "fill_updates": int(sum(1 for row in rows_ready if row.get("action") == "fill")),
            "replace_updates": int(sum(1 for row in rows_ready if row.get("action") == "replace")),
            "unchanged": int(len(rows_unchanged)),
            "missing_wfm_value": int(missing_wfm_value),
            "unmatched_clients": int(len(rows_unmatched)),
            "ambiguous_name_matches": int(ambiguous_name_matches),
            "missing_lookup_values": int(len(missing_lookup_values)),
        },
        "rows_ready": rows_ready,
        "rows_unmatched": rows_unmatched,
        "rows_unchanged": rows_unchanged,
        "missing_lookup_values": missing_lookup_values,
        "overwrite_existing": bool(overwrite_existing),
    }


@router.post("/import-export/wfm/client-fields/backfill")
@router.post("/import-export/wfm/client-industries/backfill")
def backfill_wfm_client_fields(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        target_field = str(body.get("target_field") or "industry").strip()
        preview_only = bool(body.get("preview_only", True))
        overwrite_existing = bool(body.get("overwrite_existing", True))
        actor = str(_user.get("email") or _user.get("user_id") or "unknown").strip()

        with get_conn() as con:
            preview = _build_wfm_client_field_backfill_preview(
                con,
                target_field=target_field,
                overwrite_existing=overwrite_existing,
            )

            if preview_only:
                return {
                    **preview,
                    "preview_only": True,
                    "applied_updates": 0,
                    "lookup_rows_inserted": 0,
                }

            rows_ready = preview.get("rows_ready") or []
            applied_updates = 0
            lookup_rows_inserted = 0

            if target_field == "industry" and preview.get("missing_lookup_values"):
                for industry_name in preview["missing_lookup_values"]:
                    try:
                        con.execute(
                            """
                            INSERT INTO industries_lookup (name, is_active)
                            SELECT %s, TRUE
                            WHERE NOT EXISTS (
                                SELECT 1 FROM industries_lookup WHERE lower(name) = lower(%s)
                            )
                            """,
                            [industry_name, industry_name],
                        )
                        lookup_rows_inserted += 1
                    except Exception:
                        # Keep backfill resilient if lookup table or unique rules differ.
                        pass

            for row in rows_ready:
                target_column = str(preview.get("target_column") or target_field).strip()
                con.execute(
                    f"UPDATE clients SET {target_column} = %s WHERE db_id = %s",
                    [row.get("wfm_value"), int(row["nzi_client_id"])],
                )
                applied_updates += 1
                try:
                    con.execute(
                        """
                        INSERT INTO wfm_import_audit (mode, entity_type, wfm_id, nzi_id, action, message)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        [
                            "import",
                            "client",
                            row.get("wfm_client_id"),
                            int(row["nzi_client_id"]),
                            "update_client_field",
                            f"Backfilled client field '{target_field}' to '{row.get('wfm_value')}' by {actor}",
                        ],
                    )
                except Exception:
                    pass

            return {
                **preview,
                "preview_only": False,
                "applied_updates": int(applied_updates),
                "lookup_rows_inserted": int(lookup_rows_inserted),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to backfill WFM client field '{target_field}': {e}")


@router.get("/import-export/wfm/mapping-targets")
def wfm_mapping_targets(_user: dict = Depends(_current_user)):
    try:
        defaults = _default_wfm_targets()
        job_targets = set(defaults.get("job", {}).keys())
        client_targets = set(defaults.get("client", {}).keys())

        # Include active Admin custom fields so they are selectable as mapping targets.
        with get_conn() as con:
            try:
                rows = con.execute(
                    """
                    SELECT entity_type, field_name
                    FROM custom_field_definitions
                    WHERE is_active = TRUE
                      AND entity_type IN ('job', 'client')
                      AND field_name IS NOT NULL
                    ORDER BY entity_type, display_order, field_name
                    """
                ).fetchall()
                for entity_type, field_name in rows:
                    et = str(entity_type or "").strip().lower()
                    fn = str(field_name or "").strip()
                    if not fn:
                        continue
                    if et == "job":
                        job_targets.add(fn)
                    elif et == "client":
                        client_targets.add(fn)
            except Exception:
                # Keep endpoint resilient if custom field tables are not present in a local environment.
                pass

        return {
            "ok": True,
            "targets": {
                "job": sorted(list(job_targets)),
                "client": sorted(list(client_targets)),
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load mapping targets: {e}")


@router.post("/import-export/wfm/run")
def run_wfm_import(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        from wfm_import.wfm_import_routine import WfmImporter, _setup_logger
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WFM importer unavailable: {e}")

    try:
        mode = str(body.get("mode") or "dry-run").strip().lower()
        do_import = mode == "import"
        max_clients_raw = body.get("max_clients")
        max_clients = int(max_clients_raw) if str(max_clients_raw or "").strip().isdigit() else None

        raw_client_ids = body.get("client_ids") or []
        raw_client_names = body.get("client_names") or []
        raw_job_numbers = body.get("job_numbers") or []

        if isinstance(raw_client_ids, str):
            client_ids = [x.strip() for x in raw_client_ids.split(",") if x.strip()]
        else:
            client_ids = [str(x).strip() for x in raw_client_ids if str(x).strip()]

        if isinstance(raw_client_names, str):
            client_names = [x.strip() for x in raw_client_names.split(",") if x.strip()]
        else:
            client_names = [str(x).strip() for x in raw_client_names if str(x).strip()]
        if isinstance(raw_job_numbers, str):
            job_numbers = [x.strip() for x in raw_job_numbers.split(",") if x.strip()]
        else:
            job_numbers = [str(x).strip() for x in raw_job_numbers if str(x).strip()]

        with get_conn() as con:
            mapping_overrides = _load_mapping_overrides_from_db(con)

        importer = WfmImporter(
            dry_run=not do_import,
            max_clients=max_clients,
            client_ids=client_ids,
            client_names=client_names,
            job_numbers=job_numbers,
            mapping_overrides=mapping_overrides,
            logger=_setup_logger(),
        )
        rc = importer.run()
        selected = []
        cdf = importer.data.get("clients.csv")
        if cdf is not None and not cdf.empty:
            for _, r in cdf.iterrows():
                selected.append(
                    {"wfm_client_id": str(r.get("Id") or "").strip(), "name": str(r.get("Name") or "").strip()}
                )

        s = importer.stats
        return {
            "ok": rc == 0,
            "mode": "import" if do_import else "dry-run",
            "selected_clients": selected,
            "stats": {
                "clients": {"processed": s.clients_processed, "inserted": s.clients_inserted, "updated": s.clients_updated},
                "contacts": {"processed": s.contacts_processed, "inserted": s.contacts_inserted, "updated": s.contacts_updated},
                "jobs": {"processed": s.jobs_processed, "inserted": s.jobs_inserted, "updated": s.jobs_updated},
                "warnings": s.warnings,
                "errors": s.errors,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run WFM import: {e}")


@router.get("/import-export/wfm/export-imported")
def export_wfm_imported(_user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            # Ensure support tables exist
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS wfm_import_map (
                  entity_type VARCHAR NOT NULL,
                  wfm_id VARCHAR NOT NULL,
                  nzi_id INTEGER NOT NULL,
                  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (entity_type, wfm_id)
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS wfm_import_audit (
                  id BIGSERIAL PRIMARY KEY,
                  run_at TIMESTAMP NOT NULL DEFAULT NOW(),
                  mode VARCHAR NOT NULL,
                  entity_type VARCHAR NOT NULL,
                  wfm_id VARCHAR,
                  nzi_id INTEGER,
                  action VARCHAR NOT NULL,
                  message TEXT
                )
                """
            )

            map_df = con.execute("SELECT * FROM wfm_import_map ORDER BY entity_type, wfm_id").df()
            audit_df = con.execute("SELECT * FROM wfm_import_audit ORDER BY id DESC LIMIT 20000").df()
            clients_df = con.execute(
                """
                SELECT c.*, m.wfm_id AS wfm_client_id
                FROM clients c
                JOIN wfm_import_map m ON m.entity_type = 'client' AND m.nzi_id = c.db_id
                ORDER BY c.db_id
                """
            ).df()
            contacts_df = con.execute(
                """
                SELECT cc.*, m.wfm_id AS wfm_contact_id
                FROM client_contacts cc
                JOIN wfm_import_map m ON m.entity_type = 'contact' AND m.nzi_id = cc.contact_id
                ORDER BY cc.contact_id
                """
            ).df()
            jobs_df = con.execute(
                """
                SELECT j.*, m.wfm_id AS wfm_job_id
                FROM jobs j
                JOIN wfm_import_map m ON m.entity_type = 'job' AND m.nzi_id = j.job_id
                ORDER BY j.job_id
                """
            ).df()

        buf = io.BytesIO()
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("wfm_import_map.csv", map_df.to_csv(index=False) if map_df is not None else "")
            zf.writestr("wfm_import_audit.csv", audit_df.to_csv(index=False) if audit_df is not None else "")
            zf.writestr("clients_imported.csv", clients_df.to_csv(index=False) if clients_df is not None else "")
            zf.writestr("contacts_imported.csv", contacts_df.to_csv(index=False) if contacts_df is not None else "")
            zf.writestr("jobs_imported.csv", jobs_df.to_csv(index=False) if jobs_df is not None else "")
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="wfm_import_export_{ts}.zip"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export imported WFM data: {e}")
