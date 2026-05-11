"""
Admin audit-log routes.
"""

import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from api.auth import _current_user
from api.permissions import require_permission
from core.database import get_conn
from services.audit_log import ensure_audit_log_table, parse_json_text
from services.permissions import ADMIN_ACCESS_PERMISSION

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)


def _optional_int_param(value: object | None) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except Exception:
        return None


@router.get("/audit-log")
def get_audit_log(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    org_id: str | None = Query(None),
    actor_email: str | None = Query(None),
    entity_type: str | None = Query(None),
    action: str | None = Query(None),
    client_id: int | None = Query(None),
    job_id: int | None = Query(None),
    q: str | None = Query(None),
    _user: dict = Depends(_current_user),
    _audit_access: dict = Depends(require_permission("admin.audit.view")),
):
    try:
        client_id_value = _optional_int_param(client_id)
        job_id_value = _optional_int_param(job_id)
        with get_conn() as con:
            ensure_audit_log_table(con)

            where_parts: list[str] = []
            params: list[object] = []

            if org_id:
                where_parts.append("LOWER(COALESCE(org_id, '')) = LOWER(%s)")
                params.append(str(org_id).strip())
            if actor_email:
                where_parts.append("LOWER(COALESCE(actor_email, '')) LIKE LOWER(%s)")
                params.append(f"%{str(actor_email).strip()}%")
            if entity_type:
                where_parts.append("LOWER(COALESCE(entity_type, '')) = LOWER(%s)")
                params.append(str(entity_type).strip())
            if action:
                where_parts.append("LOWER(COALESCE(action, '')) = LOWER(%s)")
                params.append(str(action).strip())
            if client_id_value is not None:
                where_parts.append("client_id = %s")
                params.append(client_id_value)
            if job_id_value is not None:
                where_parts.append("job_id = %s")
                params.append(job_id_value)
            if q:
                where_parts.append(
                    "("
                    "LOWER(COALESCE(actor_name, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(actor_email, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(entity_type, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(action, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(page, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(section, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(container, '')) LIKE LOWER(%s)"
                    ")"
                )
                q_like = f"%{str(q).strip()}%"
                params.extend([q_like, q_like, q_like, q_like, q_like, q_like, q_like])

            where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
            total_row = con.execute(
                f"SELECT COUNT(*) FROM audit_log {where_sql}",
                params,
            ).fetchone()

            rows = con.execute(
                f"""
                SELECT
                    audit_id, created_at, org_id, actor_user_id, actor_email, actor_name,
                    action, entity_type, entity_id, client_id, job_id,
                    page, section, container, route, method,
                    before_json, after_json, diff_json, metadata_json,
                    ip_address, user_agent
                FROM audit_log
                {where_sql}
                ORDER BY created_at DESC, audit_id DESC
                LIMIT %s OFFSET %s
                """,
                [*params, int(limit), int(offset)],
            ).fetchall()

        items: list[dict[str, object]] = []
        for row in rows or []:
            items.append(
                {
                    "audit_id": int(row[0]),
                    "created_at": str(row[1]) if row[1] is not None else None,
                    "org_id": row[2],
                    "actor_user_id": row[3],
                    "actor_email": row[4],
                    "actor_name": row[5],
                    "action": row[6],
                    "entity_type": row[7],
                    "entity_id": row[8],
                    "client_id": row[9],
                    "job_id": row[10],
                    "page": row[11],
                    "section": row[12],
                    "container": row[13],
                    "route": row[14],
                    "method": row[15],
                    "before": parse_json_text(row[16]),
                    "after": parse_json_text(row[17]),
                    "diff": parse_json_text(row[18]),
                    "metadata": parse_json_text(row[19]),
                    "ip_address": row[20],
                    "user_agent": row[21],
                }
            )

        return {
            "items": items,
            "total": int(total_row[0] if total_row else 0),
            "limit": int(limit),
            "offset": int(offset),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch audit log: {e}")


@router.get("/audit-log/export")
def export_audit_log(
    org_id: str | None = Query(None),
    actor_email: str | None = Query(None),
    entity_type: str | None = Query(None),
    action: str | None = Query(None),
    client_id: int | None = Query(None),
    job_id: int | None = Query(None),
    q: str | None = Query(None),
    _user: dict = Depends(_current_user),
    _audit_access: dict = Depends(require_permission("admin.audit.view")),
):
    try:
        import csv
        import io

        client_id_value = _optional_int_param(client_id)
        job_id_value = _optional_int_param(job_id)
        with get_conn() as con:
            ensure_audit_log_table(con)

            where_parts: list[str] = []
            params: list[object] = []

            if org_id:
                where_parts.append("LOWER(COALESCE(org_id, '')) = LOWER(%s)")
                params.append(str(org_id).strip())
            if actor_email:
                where_parts.append("LOWER(COALESCE(actor_email, '')) LIKE LOWER(%s)")
                params.append(f"%{str(actor_email).strip()}%")
            if entity_type:
                where_parts.append("LOWER(COALESCE(entity_type, '')) = LOWER(%s)")
                params.append(str(entity_type).strip())
            if action:
                where_parts.append("LOWER(COALESCE(action, '')) = LOWER(%s)")
                params.append(str(action).strip())
            if client_id_value is not None:
                where_parts.append("client_id = %s")
                params.append(client_id_value)
            if job_id_value is not None:
                where_parts.append("job_id = %s")
                params.append(job_id_value)
            if q:
                where_parts.append(
                    "("
                    "LOWER(COALESCE(actor_name, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(actor_email, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(entity_type, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(action, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(page, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(section, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(container, '')) LIKE LOWER(%s)"
                    ")"
                )
                q_like = f"%{str(q).strip()}%"
                params.extend([q_like, q_like, q_like, q_like, q_like, q_like, q_like])

            where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
            rows = con.execute(
                f"""
                SELECT
                    audit_id, created_at, org_id, actor_user_id, actor_email, actor_name,
                    action, entity_type, entity_id, client_id, job_id,
                    page, section, container, route, method,
                    before_json, after_json, diff_json, metadata_json,
                    ip_address, user_agent
                FROM audit_log
                {where_sql}
                ORDER BY created_at DESC, audit_id DESC
                """,
                params,
            ).fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "audit_id",
            "created_at",
            "org_id",
            "actor_user_id",
            "actor_email",
            "actor_name",
            "action",
            "entity_type",
            "entity_id",
            "client_id",
            "job_id",
            "page",
            "section",
            "container",
            "route",
            "method",
            "before_json",
            "after_json",
            "diff_json",
            "metadata_json",
            "ip_address",
            "user_agent",
        ])
        for row in rows or []:
            writer.writerow([
                row[0],
                row[1],
                row[2],
                row[3],
                row[4],
                row[5],
                row[6],
                row[7],
                row[8],
                row[9],
                row[10],
                row[11],
                row[12],
                row[13],
                row[14],
                row[15],
                row[16],
                row[17],
                row[18],
                row[19],
                row[20],
                row[21],
            ])

        filename = "audit_log.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export audit log: {e}")

