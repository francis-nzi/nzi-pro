from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from core.database import get_conn
from services.messaging_templates import render_template_text
from services.outbound_email import send_tracked_email

router = APIRouter(tags=["crm-automation"])


def _actor(user: dict) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip()


def _ensure_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS crm_automation_rules (
          rule_id BIGSERIAL PRIMARY KEY,
          rule_name VARCHAR(140) NOT NULL,
          trigger_key VARCHAR(80) NOT NULL,
          scope_type VARCHAR(20) NOT NULL DEFAULT 'global',
          filter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          action_type VARCHAR(40) NOT NULL,
          action_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_crm_auto_rules_trigger ON crm_automation_rules (trigger_key, is_active)")
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS crm_automation_runs (
          run_id BIGSERIAL PRIMARY KEY,
          rule_id BIGINT REFERENCES crm_automation_rules(rule_id) ON DELETE SET NULL,
          trigger_key VARCHAR(80) NOT NULL,
          scope_type VARCHAR(20) NOT NULL,
          client_db_id INTEGER,
          job_id INTEGER,
          mode VARCHAR(20) NOT NULL DEFAULT 'preview',
          status VARCHAR(30) NOT NULL DEFAULT 'completed',
          result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          started_at TIMESTAMP NOT NULL DEFAULT NOW(),
          finished_at TIMESTAMP
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_crm_auto_runs_started ON crm_automation_runs (started_at DESC)")
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS crm_events (
          event_id BIGSERIAL PRIMARY KEY,
          client_db_id INTEGER NOT NULL,
          job_id INTEGER,
          event_type VARCHAR(50) NOT NULL,
          channel VARCHAR(30) NOT NULL,
          direction VARCHAR(20),
          subject TEXT,
          body_text TEXT,
          body_html TEXT,
          status VARCHAR(30) NOT NULL DEFAULT 'logged',
          owner_user_id VARCHAR,
          due_at TIMESTAMP,
          source VARCHAR(50) NOT NULL DEFAULT 'manual',
          source_ref VARCHAR(120),
          payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          is_private BOOLEAN NOT NULL DEFAULT FALSE,
          created_by VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS crm_tasks (
          task_id BIGSERIAL PRIMARY KEY,
          event_id BIGINT REFERENCES crm_events(event_id) ON DELETE SET NULL,
          client_db_id INTEGER NOT NULL,
          job_id INTEGER,
          title VARCHAR(255) NOT NULL,
          details TEXT,
          assignee_user_id VARCHAR,
          priority VARCHAR(20) NOT NULL DEFAULT 'normal',
          sla_due_at TIMESTAMP,
          due_at TIMESTAMP,
          status VARCHAR(30) NOT NULL DEFAULT 'open',
          completed_at TIMESTAMP,
          created_by VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )


def _safe_int(v: Any) -> int | None:
    try:
        if v is None or str(v).strip() == "":
            return None
        return int(v)
    except Exception:
        return None


def _safe_days(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return default


def _milestone_snapshot(con, job_id: int) -> dict[str, str]:
    row = con.execute(
        """
        SELECT
          jp.data_collection_due, jp.data_collection_completed_at,
          jp.first_draft_due, jp.first_draft_completed_at,
          jp.final_report_due, jp.final_report_completed_at
        FROM job_plan jp
        WHERE jp.job_id = %s
        """,
        [int(job_id)],
    ).fetchone()
    if not row:
        return {}

    today = datetime.now(timezone.utc).date()

    def status_for(due_val: Any, done_val: Any) -> str:
        if done_val:
            return "completed"
        if not due_val:
            return "green"
        due = due_val
        try:
            if hasattr(due_val, "date"):
                due = due_val.date()
        except Exception:
            pass
        if not hasattr(due, "year"):
            return "green"
        days = (due - today).days
        if days < -1:
            return "red"
        if days <= 7:
            return "amber"
        return "green"

    return {
        "data_collection": status_for(row[0], row[1]),
        "first_draft": status_for(row[2], row[3]),
        "final_report": status_for(row[4], row[5]),
    }


def _latest_client_response_age_days(con, client_id: int, job_id: int | None = None) -> int | None:
    where = ["client_db_id = %s", "channel = 'email'"]
    params: list[Any] = [int(client_id)]
    if job_id is not None:
        where.append("job_id = %s")
        params.append(int(job_id))

    outbound = con.execute(
        f"SELECT MAX(created_at) FROM crm_events WHERE {' AND '.join(where)} AND lower(direction) = 'outbound'",
        params,
    ).fetchone()
    inbound = con.execute(
        f"SELECT MAX(created_at) FROM crm_events WHERE {' AND '.join(where)} AND lower(direction) = 'inbound'",
        params,
    ).fetchone()

    last_out = outbound[0] if outbound and outbound[0] else None
    if not last_out:
        return None
    last_in = inbound[0] if inbound and inbound[0] else None
    if last_in and last_in >= last_out:
        return 0
    now = datetime.now(timezone.utc)
    try:
        return max(0, (now - last_out).days)
    except Exception:
        return None


def _scope_matches(rule_scope: str, client_id: int | None, job_id: int | None) -> bool:
    scope = str(rule_scope or "global").strip().lower()
    if scope == "global":
        return True
    if scope == "client":
        return client_id is not None
    if scope == "job":
        return job_id is not None
    return False


def _rule_matches(con, rule: dict[str, Any], trigger_key: str, client_id: int | None, job_id: int | None) -> tuple[bool, dict[str, Any]]:
    if str(rule.get("trigger_key") or "").strip().lower() != str(trigger_key or "").strip().lower():
        return (False, {"reason": "trigger_mismatch"})
    if not _scope_matches(str(rule.get("scope_type") or "global"), client_id, job_id):
        return (False, {"reason": "scope_mismatch"})

    flt = rule.get("filter_json") if isinstance(rule.get("filter_json"), dict) else {}
    context: dict[str, Any] = {}

    statuses = flt.get("milestone_status_in") if isinstance(flt, dict) else None
    if statuses is not None:
        if job_id is None:
            return (False, {"reason": "milestone_requires_job"})
        snap = _milestone_snapshot(con, int(job_id))
        context["milestone_status"] = snap
        desired = {str(x).strip().lower() for x in (statuses or []) if str(x).strip()}
        if desired:
            if not any(str(v).lower() in desired for v in snap.values()):
                return (False, {"reason": "milestone_status_not_matched", "snapshot": snap})

    reply_days = _safe_int(flt.get("no_client_reply_days")) if isinstance(flt, dict) else None
    if reply_days is not None and client_id is not None:
        age = _latest_client_response_age_days(con, int(client_id), int(job_id) if job_id is not None else None)
        context["no_client_reply_age_days"] = age
        if age is None or age < int(reply_days):
            return (False, {"reason": "no_reply_window_not_met", "age_days": age})

    return (True, context)


def _render_action_text(value: str, context: dict[str, Any]) -> str:
    payload = dict(context or {})
    if isinstance(payload.get("milestone_status"), dict):
        ms = payload["milestone_status"]
        payload["milestone_status_summary"] = ", ".join([f"{k}:{v}" for k, v in ms.items()])
    return render_template_text(str(value or ""), payload)


def _execute_action(
    con,
    *,
    rule: dict[str, Any],
    context: dict[str, Any],
    mode: str,
    client_id: int | None,
    job_id: int | None,
    actor: str,
) -> dict[str, Any]:
    action_type = str(rule.get("action_type") or "").strip().lower()
    action_json = rule.get("action_json") if isinstance(rule.get("action_json"), dict) else {}
    result: dict[str, Any] = {"action_type": action_type, "mode": mode}

    if action_type == "create_task":
        title = _render_action_text(str(action_json.get("title") or "Automation Task"), context)
        details = _render_action_text(str(action_json.get("details") or ""), context)
        assignee = str(action_json.get("assignee_user_id") or "").strip() or None
        priority = str(action_json.get("priority") or "normal").strip() or "normal"
        due_days = _safe_days(action_json.get("due_in_days"), 3)
        due_at = (datetime.now(timezone.utc) + timedelta(days=due_days)).isoformat()
        result.update({"title": title, "assignee_user_id": assignee, "priority": priority, "due_at": due_at})
        if mode == "send":
            con.execute(
                """
                INSERT INTO crm_tasks (
                  event_id, client_db_id, job_id, title, details, assignee_user_id,
                  priority, due_at, status, created_by, created_at, updated_at
                )
                VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, 'open', %s, NOW(), NOW())
                """,
                [client_id, job_id, title, details or None, assignee, priority, due_at, actor],
            )
        return result

    if action_type == "log_event":
        subject = _render_action_text(str(action_json.get("subject") or "Automation Event"), context)
        body_text = _render_action_text(str(action_json.get("body_text") or ""), context)
        result.update({"subject": subject})
        if mode == "send":
            con.execute(
                """
                INSERT INTO crm_events (
                  client_db_id, job_id, event_type, channel, direction, subject, body_text,
                  status, source, payload_json, created_by, created_at, updated_at
                )
                VALUES (%s, %s, 'system', 'system', 'internal', %s, %s, 'logged', 'automation', %s::jsonb, %s, NOW(), NOW())
                """,
                [client_id, job_id, subject, body_text or None, {"rule_id": rule.get("rule_id")}, actor],
            )
        return result

    if action_type == "send_email":
        to_email = str(action_json.get("to_email") or "").strip()
        subject = _render_action_text(str(action_json.get("subject") or "Automation Email"), context)
        body = _render_action_text(str(action_json.get("body_text") or ""), context)
        result.update({"to_email": to_email, "subject": subject})
        if mode == "send":
            if not to_email:
                raise ValueError("send_email action requires to_email")
            send_res = send_tracked_email(
                con,
                to_email=to_email,
                subject=subject,
                body_text=body,
                created_by=actor,
                template_key=None,
                entity_type="crm_automation_rule",
                entity_id=_safe_int(rule.get("rule_id")),
                job_id=job_id,
                client_db_id=client_id,
                metadata={"trigger": str(rule.get("trigger_key") or ""), "action_type": "send_email"},
                raise_on_error=False,
            )
            if str(send_res.get("status") or "") != "sent":
                raise ValueError(send_res.get("error") or "Failed to send automation email")
            con.execute(
                """
                INSERT INTO crm_events (
                  client_db_id, job_id, event_type, channel, direction, subject, body_text,
                  status, source, payload_json, created_by, created_at, updated_at
                )
                VALUES (%s, %s, 'email', 'email', 'outbound', %s, %s, 'sent', 'automation', %s::jsonb, %s, NOW(), NOW())
                """,
                [client_id, job_id, subject, body, {"rule_id": rule.get("rule_id"), "to_email": to_email}, actor],
            )
        return result

    raise ValueError(f"Unsupported action_type: {action_type}")


@router.get("/automation/rules")
def list_rules(
    trigger_key: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    _user: dict = Depends(_current_user),
):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            where = []
            params: list[Any] = []
            if trigger_key and str(trigger_key).strip():
                where.append("lower(trigger_key) = lower(%s)")
                params.append(str(trigger_key).strip())
            if not include_inactive:
                where.append("is_active = TRUE")
            where_sql = f"WHERE {' AND '.join(where)}" if where else ""
            df = con.execute(
                f"""
                SELECT rule_id, rule_name, trigger_key, scope_type, filter_json, action_type, action_json, is_active, created_by, created_at, updated_at
                FROM crm_automation_rules
                {where_sql}
                ORDER BY is_active DESC, lower(rule_name), rule_id DESC
                """,
                params,
            ).df()
            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                for _, r in df.iterrows():
                    items.append(
                        {
                            "rule_id": int(r.get("rule_id") or 0),
                            "rule_name": str(r.get("rule_name") or ""),
                            "trigger_key": str(r.get("trigger_key") or ""),
                            "scope_type": str(r.get("scope_type") or "global"),
                            "filter_json": r.get("filter_json") if isinstance(r.get("filter_json"), dict) else {},
                            "action_type": str(r.get("action_type") or ""),
                            "action_json": r.get("action_json") if isinstance(r.get("action_json"), dict) else {},
                            "is_active": bool(r.get("is_active") if r.get("is_active") is not None else True),
                            "created_by": str(r.get("created_by") or ""),
                            "created_at": r.get("created_at").isoformat() if r.get("created_at") else None,
                            "updated_at": r.get("updated_at").isoformat() if r.get("updated_at") else None,
                        }
                    )
            return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list automation rules: {e}")


@router.post("/automation/rules")
def create_rule(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        name = str(body.get("rule_name") or "").strip()
        trigger_key = str(body.get("trigger_key") or "").strip()
        action_type = str(body.get("action_type") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="rule_name is required")
        if not trigger_key:
            raise HTTPException(status_code=400, detail="trigger_key is required")
        if not action_type:
            raise HTTPException(status_code=400, detail="action_type is required")

        with get_conn() as con:
            _ensure_tables(con)
            con.execute(
                """
                INSERT INTO crm_automation_rules (
                  rule_name, trigger_key, scope_type, filter_json, action_type, action_json,
                  is_active, created_by, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s, NOW(), NOW())
                """,
                [
                    name,
                    trigger_key,
                    str(body.get("scope_type") or "global"),
                    body.get("filter_json") or {},
                    action_type,
                    body.get("action_json") or {},
                    bool(body.get("is_active", True)),
                    actor,
                ],
            )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create automation rule: {e}")


@router.patch("/automation/rules/{rule_id}")
def update_rule(rule_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            exists = con.execute("SELECT 1 FROM crm_automation_rules WHERE rule_id = %s", [int(rule_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Rule not found")
            updates: list[str] = []
            params: list[Any] = []
            for key in ("rule_name", "trigger_key", "scope_type", "action_type"):
                if key in body:
                    updates.append(f"{key} = %s")
                    params.append(str(body.get(key) or "").strip())
            for key in ("filter_json", "action_json"):
                if key in body:
                    updates.append(f"{key} = %s::jsonb")
                    params.append(body.get(key) or {})
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(bool(body.get("is_active")))
            if not updates:
                return {"ok": True, "message": "No updates"}
            updates.append("updated_at = NOW()")
            params.append(int(rule_id))
            con.execute(f"UPDATE crm_automation_rules SET {', '.join(updates)} WHERE rule_id = %s", params)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update rule: {e}")


@router.get("/automation/runs")
def list_runs(
    trigger_key: str | None = Query(default=None),
    rule_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    _user: dict = Depends(_current_user),
):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            where = []
            params: list[Any] = []
            if trigger_key:
                where.append("lower(trigger_key) = lower(%s)")
                params.append(str(trigger_key).strip())
            if rule_id is not None:
                where.append("rule_id = %s")
                params.append(int(rule_id))
            where_sql = f"WHERE {' AND '.join(where)}" if where else ""
            df = con.execute(
                f"""
                SELECT run_id, rule_id, trigger_key, scope_type, client_db_id, job_id, mode, status, result_json, started_at, finished_at
                FROM crm_automation_runs
                {where_sql}
                ORDER BY run_id DESC
                LIMIT %s OFFSET %s
                """,
                [*params, int(limit), int(offset)],
            ).df()
            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                for _, r in df.iterrows():
                    items.append(
                        {
                            "run_id": int(r.get("run_id") or 0),
                            "rule_id": int(r.get("rule_id")) if r.get("rule_id") is not None else None,
                            "trigger_key": str(r.get("trigger_key") or ""),
                            "scope_type": str(r.get("scope_type") or ""),
                            "client_db_id": int(r.get("client_db_id")) if r.get("client_db_id") is not None else None,
                            "job_id": int(r.get("job_id")) if r.get("job_id") is not None else None,
                            "mode": str(r.get("mode") or ""),
                            "status": str(r.get("status") or ""),
                            "result_json": r.get("result_json") if isinstance(r.get("result_json"), dict) else {},
                            "started_at": r.get("started_at").isoformat() if r.get("started_at") else None,
                            "finished_at": r.get("finished_at").isoformat() if r.get("finished_at") else None,
                        }
                    )
            return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list automation runs: {e}")


@router.post("/automation/test-run")
def test_run(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    actor = _actor(_user)
    trigger_key = str(body.get("trigger_key") or "").strip()
    if not trigger_key:
        raise HTTPException(status_code=400, detail="trigger_key is required")
    mode = str(body.get("mode") or "preview").strip().lower()
    if mode not in ("preview", "send"):
        raise HTTPException(status_code=400, detail="mode must be preview or send")
    client_id = _safe_int(body.get("client_db_id"))
    job_id = _safe_int(body.get("job_id"))

    try:
        with get_conn() as con:
            _ensure_tables(con)
            rules_df = con.execute(
                """
                SELECT rule_id, rule_name, trigger_key, scope_type, filter_json, action_type, action_json, is_active
                FROM crm_automation_rules
                WHERE lower(trigger_key) = lower(%s) AND is_active = TRUE
                ORDER BY rule_id ASC
                """,
                [trigger_key],
            ).df()
            rules = []
            if rules_df is not None and not rules_df.empty:
                for _, r in rules_df.iterrows():
                    rules.append(r.to_dict())

            results: list[dict[str, Any]] = []
            for rule in rules:
                matched, ctx = _rule_matches(con, rule, trigger_key, client_id, job_id)
                if not matched:
                    results.append(
                        {
                            "rule_id": int(rule.get("rule_id") or 0),
                            "rule_name": str(rule.get("rule_name") or ""),
                            "matched": False,
                            "reason": ctx,
                        }
                    )
                    continue
                action_result = _execute_action(
                    con,
                    rule=rule,
                    context={**ctx, "client_db_id": client_id, "job_id": job_id},
                    mode=mode,
                    client_id=client_id,
                    job_id=job_id,
                    actor=actor,
                )
                results.append(
                    {
                        "rule_id": int(rule.get("rule_id") or 0),
                        "rule_name": str(rule.get("rule_name") or ""),
                        "matched": True,
                        "action": action_result,
                    }
                )

            status = "completed"
            con.execute(
                """
                INSERT INTO crm_automation_runs (
                  rule_id, trigger_key, scope_type, client_db_id, job_id, mode, status, result_json, started_at, finished_at
                )
                VALUES (NULL, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW(), NOW())
                """,
                [
                    trigger_key,
                    "job" if job_id is not None else ("client" if client_id is not None else "global"),
                    client_id,
                    job_id,
                    mode,
                    status,
                    {"results": results, "run_by": actor},
                ],
            )

            return {"ok": True, "trigger_key": trigger_key, "mode": mode, "results": results}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute automation test-run: {e}")
