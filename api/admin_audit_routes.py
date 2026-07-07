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

AUTH_EVENT_ACTIONS = (
    "login_success",
    "login_failed",
    "login_mfa_challenge_issued",
    "mfa_verification_success",
    "mfa_verification_failed",
    "logout",
)


def _optional_int_param(value: object | None) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except Exception:
        return None


def _apply_event_group_filter(where_parts: list[str], params: list[object], event_group: str | None) -> None:
    group = str(event_group or "").strip().lower()
    if not group or group == "all":
        return
    if group == "auth":
        placeholders = ", ".join(["%s"] * len(AUTH_EVENT_ACTIONS))
        where_parts.append(
            f"(LOWER(COALESCE(entity_type, '')) = 'auth_session' OR LOWER(COALESCE(action, '')) IN ({placeholders}))"
        )
        params.extend(list(AUTH_EVENT_ACTIONS))


@router.get("/audit-log")
def get_audit_log(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    org_id: str | None = Query(None),
    event_group: str | None = Query(None),
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
            _apply_event_group_filter(where_parts, params, event_group)

            if org_id:
                where_parts.append("LOWER(COALESCE(a.org_id, '')) = LOWER(%s)")
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
                    a.audit_id, a.created_at, a.org_id, o.name AS org_name, a.actor_user_id, a.actor_email, a.actor_name,
                    a.action, a.entity_type, a.entity_id, a.client_id, c.client_name AS client_name, a.job_id, j.job_number AS job_number,
                    a.page, a.section, a.container, a.route, a.method,
                    a.before_json, a.after_json, a.diff_json, a.metadata_json,
                    a.ip_address, a.user_agent
                FROM audit_log a
                LEFT JOIN organisations o ON o.org_id::text = a.org_id
                LEFT JOIN clients c ON c.db_id = a.client_id
                LEFT JOIN jobs j ON j.job_id = a.job_id
                {where_sql}
                ORDER BY a.created_at DESC, a.audit_id DESC
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
                    "org_name": row[3],
                    "actor_user_id": row[4],
                    "actor_email": row[5],
                    "actor_name": row[6],
                    "action": row[7],
                    "entity_type": row[8],
                    "entity_id": row[9],
                    "client_id": row[10],
                    "client_name": row[11],
                    "job_id": row[12],
                    "job_number": row[13],
                    "page": row[14],
                    "section": row[15],
                    "container": row[16],
                    "route": row[17],
                    "method": row[18],
                    "before": parse_json_text(row[19]),
                    "after": parse_json_text(row[20]),
                    "diff": parse_json_text(row[21]),
                    "metadata": parse_json_text(row[22]),
                    "ip_address": row[23],
                    "user_agent": row[24],
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
    event_group: str | None = Query(None),
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
            _apply_event_group_filter(where_parts, params, event_group)

            if org_id:
                where_parts.append("LOWER(COALESCE(a.org_id, '')) = LOWER(%s)")
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
                    a.audit_id, a.created_at, a.org_id, o.name AS org_name, a.actor_user_id, a.actor_email, a.actor_name,
                    a.action, a.entity_type, a.entity_id, a.client_id, c.client_name AS client_name, a.job_id, j.job_number AS job_number,
                    a.page, a.section, a.container, a.route, a.method,
                    a.before_json, a.after_json, a.diff_json, a.metadata_json,
                    a.ip_address, a.user_agent
                FROM audit_log a
                LEFT JOIN organisations o ON o.org_id::text = a.org_id
                LEFT JOIN clients c ON c.db_id = a.client_id
                LEFT JOIN jobs j ON j.job_id = a.job_id
                {where_sql}
                ORDER BY a.created_at DESC, a.audit_id DESC
                """,
                params,
            ).fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "audit_id",
            "created_at",
            "org_name",
            "org_id",
            "actor_user_id",
            "actor_email",
            "actor_name",
            "action",
            "entity_type",
            "entity_id",
            "client_name",
            "client_id",
            "job_number",
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
                row[22],
                row[23],
                row[24],
            ])

        filename = "audit_log.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export audit log: {e}")

