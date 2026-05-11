"""
Admin API routes for organisation lifecycle, membership, and billing.
"""

import json
import logging
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from api.auth import _current_user
from api.permissions import require_permission
from core.database import get_conn
from services.permissions import ADMIN_ACCESS_PERMISSION
from services.audit_log import record_audit_event
from api.org_admin_helpers import (
    _actor_identifier,
    _billing_event_row_to_dict,
    _billing_invoice_row_to_dict,
    _ensure_org_billing_schema,
    _ensure_org_entitlement_schema,
    _ensure_org_lifecycle_schema,
    _invite_expiry,
    _normalize_org_role,
    _org_role_capabilities,
    _organisation_entitlement_info,
    _organisation_row_to_dict,
    _organisation_usage_info,
    _ORG_BILLING_EVENT_TYPES,
    _ORG_BILLING_INVOICE_STATUSES,
    _parse_amount_cents,
    _require_org_capacity,
    _require_org_management_role,
    _require_org_owner_role,
    _require_org_switch_role,
    _slugify_org_name,
)

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)
logger = logging.getLogger(__name__)

# =========================
# ORGANISATION MANAGEMENT
# =========================

@router.get("/organisations")
def list_organisations(include_usage: bool = Query(False), _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            try:
                _ensure_org_lifecycle_schema(con)
            except Exception as exc:
                logger.warning("Organisation lifecycle schema check failed error=%s", exc)
            try:
                _ensure_org_entitlement_schema(con)
            except Exception as exc:
                logger.warning("Organisation entitlement schema check failed error=%s", exc)
            try:
                rows = con.execute(
                    """
                    SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at
                    FROM organisations
                    ORDER BY created_at ASC, name ASC
                    """
                ).fetchall()
            except Exception as exc:
                logger.warning("Organisation list query failed error=%s", exc)
                rows = []
            try:
                member_rows = con.execute(
                    """
                    SELECT org_id, role, is_active, is_owner
                    FROM organisation_memberships
                    WHERE lower(user_id) = lower(%s)
                    """,
                    [str(_user.get("user_id") or "").strip()],
                ).fetchall()
            except Exception as exc:
                logger.warning("Organisation membership query failed user_id=%s error=%s", _user.get("user_id"), exc)
                member_rows = []
            memberships = {
                str(r[0]): {
                    "role": _normalize_org_role(r[1]),
                    "is_active": bool(r[2]) if r[2] is not None else True,
                    "is_owner": bool(r[3]) if r[3] is not None else False,
                    "capabilities": _org_role_capabilities(r[1]),
                }
                for r in member_rows or []
                if r and r[0] is not None
            }
            active_org_id = str(_user.get("org_id") or "").strip() or None
            items = []
            for row in rows or []:
                try:
                    item = _organisation_row_to_dict(row)
                    item["plan"] = str(item.get("plan") or "trial")
                    item["plan_status"] = str(item.get("plan_status") or "active")
                    item["max_users"] = int(item.get("max_users") or 0)
                    item["max_clients"] = int(item.get("max_clients") or 0)
                    item["is_member"] = str(item["org_id"] or "") in memberships
                    item["membership"] = memberships.get(str(item["org_id"] or ""))
                    item["is_active_org"] = item["org_id"] == active_org_id
                    caps = dict(item["membership"].get("capabilities") or {}) if item["membership"] else {}
                    item["role_capabilities"] = caps
                    item["can_manage"] = bool(caps.get("can_manage_members"))
                    item["can_switch"] = bool(caps.get("can_switch"))
                    item["can_transfer_ownership"] = bool(caps.get("can_transfer_ownership"))
                    if include_usage:
                        entitlement = {}
                        usage = {}
                        try:
                            entitlement = _organisation_entitlement_info(con, str(item["org_id"] or "")) or {}
                        except HTTPException as exc:
                            if exc.status_code != 404:
                                logger.warning(
                                    "Organisation entitlement lookup failed org_id=%s status=%s detail=%s",
                                    item.get("org_id"),
                                    exc.status_code,
                                    exc.detail,
                                )
                        except Exception as exc:
                            logger.warning("Organisation entitlement lookup failed org_id=%s error=%s", item.get("org_id"), exc)
                        try:
                            usage = _organisation_usage_info(con, str(item["org_id"] or "")) or {}
                        except HTTPException as exc:
                            if exc.status_code != 404:
                                logger.warning(
                                    "Organisation usage lookup failed org_id=%s status=%s detail=%s",
                                    item.get("org_id"),
                                    exc.status_code,
                                    exc.detail,
                                )
                        except Exception as exc:
                            logger.warning("Organisation usage lookup failed org_id=%s error=%s", item.get("org_id"), exc)
                        item["plan"] = str(entitlement.get("plan") or item.get("plan") or "trial")
                        item["plan_status"] = str(entitlement.get("plan_status") or item.get("plan_status") or "active")
                        item["max_users"] = int(entitlement.get("max_users") or item.get("max_users") or 0)
                        item["max_clients"] = int(entitlement.get("max_clients") or item.get("max_clients") or 0)
                        item["trial_ends_at"] = entitlement.get("trial_ends_at")
                        item["stripe_customer_id"] = entitlement.get("stripe_customer_id")
                        item["stripe_subscription_id"] = entitlement.get("stripe_subscription_id")
                        item["subscription_status"] = entitlement.get("subscription_status")
                        item["current_period_start"] = entitlement.get("current_period_start")
                        item["current_period_end"] = entitlement.get("current_period_end")
                        item["auto_renew"] = entitlement.get("auto_renew")
                        item["entitlement"] = entitlement
                        item["usage"] = usage
                    else:
                        item["entitlement"] = None
                        item["usage"] = None
                    items.append(item)
                except Exception as exc:
                    logger.warning("Organisation row serialisation failed org_row=%s error=%s", row, exc)
                    continue
            current_membership = memberships.get(active_org_id or "")
            current_entitlement = None
            current_usage = None
            if active_org_id:
                try:
                    current_entitlement = _organisation_entitlement_info(con, active_org_id)
                except HTTPException as exc:
                    if exc.status_code != 404:
                        logger.warning(
                            "Current entitlement lookup failed org_id=%s status=%s detail=%s",
                            active_org_id,
                            exc.status_code,
                            exc.detail,
                        )
                except Exception as exc:
                    logger.warning("Current entitlement lookup failed org_id=%s error=%s", active_org_id, exc)
                try:
                    current_usage = _organisation_usage_info(con, active_org_id)
                except HTTPException as exc:
                    if exc.status_code != 404:
                        logger.warning(
                            "Current usage lookup failed org_id=%s status=%s detail=%s",
                            active_org_id,
                            exc.status_code,
                            exc.detail,
                        )
                except Exception as exc:
                    logger.warning("Current usage lookup failed org_id=%s error=%s", active_org_id, exc)
            return {
                "items": items,
                "active_org_id": active_org_id,
                "current_membership": current_membership,
                "current_capabilities": dict((current_membership or {}).get("capabilities") or {}),
                "current_entitlement": current_entitlement,
                "current_usage": current_usage,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list organisations: {e}")


@router.post("/organisations")
def create_organisation(body: dict = Body(...), request: Request = None, _user: dict = Depends(_current_user)):
    try:
        name = str(body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        plan = str(body.get("plan") or "trial").strip() or "trial"
        plan_status = str(body.get("plan_status") or "active").strip() or "active"
        slug = str(body.get("slug") or "").strip().lower() or _slugify_org_name(name)
        max_users = int(body.get("max_users", 3) or 3)
        max_clients = int(body.get("max_clients", 10) or 10)
        actor_user_id = str(_user.get("user_id") or "").strip() or None

        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _ensure_org_entitlement_schema(con)
            existing = con.execute(
                "SELECT 1 FROM organisations WHERE lower(slug) = lower(%s) LIMIT 1",
                [slug],
            ).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail="Organisation slug already exists")
            row = con.execute(
                """
                INSERT INTO organisations (name, slug, plan, plan_status, max_users, max_clients)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at
                """,
                [name, slug, plan, plan_status, max_users, max_clients],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Failed to create organisation")
            con.execute(
                """
                INSERT INTO organisation_entitlements (
                  org_id, plan, plan_status, max_users, max_clients, trial_ends_at,
                  stripe_customer_id, stripe_subscription_id, subscription_status,
                  current_period_start, current_period_end, auto_renew
                )
                VALUES (%s, %s, %s, %s, %s, NULL, NULL, NULL, %s, NULL, NULL, TRUE)
                ON CONFLICT (org_id) DO UPDATE SET
                  plan = EXCLUDED.plan,
                  plan_status = EXCLUDED.plan_status,
                  max_users = EXCLUDED.max_users,
                  max_clients = EXCLUDED.max_clients,
                  subscription_status = EXCLUDED.subscription_status,
                  updated_at = NOW()
                """,
                [row[0], plan, plan_status, max_users, max_clients, plan_status],
            )
            if actor_user_id:
                con.execute(
                    """
                    INSERT INTO organisation_memberships (org_id, user_id, role, is_active, is_owner)
                    VALUES (%s, %s, %s, TRUE, TRUE)
                    ON CONFLICT (org_id, user_id) DO UPDATE SET
                      role = EXCLUDED.role,
                      is_active = TRUE,
                      is_owner = TRUE,
                      updated_at = NOW()
                    """,
                    [row[0], actor_user_id, "Owner"],
                )
                con.execute(
                    "UPDATE users SET org_id = %s WHERE lower(user_id) = lower(%s)",
                    [row[0], actor_user_id],
                )
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="organisation",
                entity_id=row[0],
                metadata={"org_id": str(row[0]), "name": name, "slug": slug, "plan": plan, "plan_status": plan_status},
            )
            logger.info("Organisation created org_id=%s slug=%s actor=%s", row[0], slug, actor_user_id or "unknown")
            return {"ok": True, "organisation": _organisation_row_to_dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create organisation: {e}")


@router.patch("/organisations/{org_id}")
def update_organisation(org_id: str, body: dict = Body(...), request: Request = None, _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _ensure_org_entitlement_schema(con)
            _require_org_management_role(con, _user, org_id)
            _require_org_capacity(con, org_id)
            existing = con.execute(
                "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s",
                [org_id],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Organisation not found")
            usage = _organisation_usage_info(con, org_id)
            updates = []
            entitlement_updates = []
            params: list[object] = []
            entitlement_params: list[object] = []
            for key in ("name", "slug", "plan", "plan_status"):
                if key in body and body.get(key) is not None and str(body.get(key)).strip():
                    updates.append(f"{key} = %s")
                    if key in ("plan", "plan_status"):
                        entitlement_updates.append(f"{key} = %s")
                    value = str(body.get(key)).strip()
                    if key == "slug":
                        value = value.lower()
                    params.append(value)
                    if key in ("plan", "plan_status"):
                        entitlement_params.append(value)
            for key in ("max_users", "max_clients"):
                if key in body and body.get(key) is not None:
                    next_value = int(body.get(key))
                    if key == "max_users" and int(usage.get("active_members") or 0) > next_value:
                        raise HTTPException(status_code=400, detail="max_users cannot be lower than current usage")
                    if key == "max_clients" and int(usage.get("active_clients") or 0) > next_value:
                        raise HTTPException(status_code=400, detail="max_clients cannot be lower than current usage")
                    updates.append(f"{key} = %s")
                    params.append(next_value)
                    entitlement_updates.append(f"{key} = %s")
                    entitlement_params.append(next_value)
            for key in ("trial_ends_at", "stripe_customer_id", "stripe_subscription_id", "subscription_status", "current_period_start", "current_period_end", "auto_renew"):
                if key in body:
                    value = body.get(key)
                    if value is None or (isinstance(value, str) and not value.strip()):
                        continue
                    entitlement_updates.append(f"{key} = %s")
                    entitlement_params.append(value)
            if not updates:
                entitlement = _organisation_entitlement_info(con, org_id)
                return {"ok": True, "organisation": {**_organisation_row_to_dict(existing), "entitlement": entitlement}}
            updates.append("updated_at = NOW()")
            row = con.execute(
                f"""
                UPDATE organisations
                SET {', '.join(updates)}
                WHERE org_id = %s
                RETURNING org_id, name, slug, plan, plan_status, max_users, max_clients, created_at, updated_at
                """,
                [*params, org_id],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Failed to update organisation")
            if entitlement_updates:
                entitlement_updates.append("updated_at = NOW()")
                con.execute(
                    f"""
                    UPDATE organisation_entitlements
                    SET {', '.join(entitlement_updates)}
                    WHERE org_id = %s
                    """,
                    [*entitlement_params, org_id],
                )
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="organisation",
                entity_id=row[0],
                metadata={"org_id": str(row[0]), "updated_fields": list(body.keys())},
            )
            logger.info("Organisation updated org_id=%s actor=%s", row[0], _actor_identifier(_user))
            entitlement = _organisation_entitlement_info(con, org_id)
            return {"ok": True, "organisation": {**_organisation_row_to_dict(row), "entitlement": entitlement}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update organisation: {e}")


@router.post("/organisations/{org_id}/invite")
def invite_user_to_organisation(org_id: str, body: dict = Body(...), request: Request = None, _user: dict = Depends(_current_user)):
    try:
        email = str(body.get("email") or "").strip()
        if not email:
            raise HTTPException(status_code=400, detail="email is required")
        role = _normalize_org_role(body.get("role"), default="Consultant")
        days = int(body.get("days_valid", 7) or 7)
        token = secrets.token_urlsafe(32)
        expires_at = _invite_expiry(days)
        actor = _actor_identifier(_user)

        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _require_org_management_role(con, _user, org_id)
            _require_org_capacity(con, org_id, additional_users=1, count_pending_invites=True)
            org_row = con.execute(
                "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s",
                [org_id],
            ).fetchone()
            if not org_row:
                raise HTTPException(status_code=404, detail="Organisation not found")
            con.execute(
                """
                INSERT INTO organisation_invitations (org_id, email, role, invited_by, token, expires_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                [org_id, email, role, actor, token, expires_at],
            )
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="organisation_invitation",
                entity_id=token,
                metadata={"org_id": org_id, "email": email, "role": role, "expires_at": expires_at.isoformat()},
            )
            logger.info("Organisation invite created org_id=%s email=%s actor=%s", org_id, email, actor)
            return {
                "ok": True,
                "organisation": _organisation_row_to_dict(org_row),
                "invite": {
                    "email": email,
                    "role": role,
                    "token": token,
                    "expires_at": expires_at.isoformat(),
                },
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to invite user to organisation: {e}")


@router.post("/organisation-invitations/{token}/accept")
def accept_organisation_invitation(token: str, request: Request = None, _user: dict = Depends(_current_user)):
    try:
        user_email = str(_user.get("email") or "").strip().lower()
        user_id = str(_user.get("user_id") or "").strip()
        if not user_email or not user_id:
            raise HTTPException(status_code=401, detail="Invalid user")

        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            invite = con.execute(
                """
                SELECT invitation_id, org_id, email, role, accepted_at, expires_at
                FROM organisation_invitations
                WHERE token = %s
                """,
                [token],
            ).fetchone()
            if not invite:
                raise HTTPException(status_code=404, detail="Invitation not found")
            invite_email = str(invite[2] or "").strip().lower()
            if invite_email and invite_email != user_email:
                raise HTTPException(status_code=403, detail="Invitation does not match the current user")
            if invite[4] is not None:
                raise HTTPException(status_code=400, detail="Invitation already accepted")
            invite_expires_at = invite[5]
            if isinstance(invite_expires_at, str):
                try:
                    invite_expires_at = datetime.fromisoformat(invite_expires_at)
                except Exception:
                    invite_expires_at = None
            if invite_expires_at and invite_expires_at < datetime.now(timezone.utc):
                logger.warning("Organisation invitation accepted after expiry token=%s org_id=%s", token, invite[1])

            _require_org_capacity(con, str(invite[1]), additional_users=1)

            con.execute(
                """
                INSERT INTO organisation_memberships (org_id, user_id, role, is_active, is_owner)
                VALUES (%s, %s, %s, TRUE, FALSE)
                ON CONFLICT (org_id, user_id) DO UPDATE SET
                  role = EXCLUDED.role,
                  is_active = TRUE,
                  updated_at = NOW()
                """,
                [invite[1], user_id, _normalize_org_role(invite[3], default="Consultant")],
            )
            con.execute(
                "UPDATE users SET org_id = %s, role = COALESCE(%s, role) WHERE lower(user_id) = lower(%s)",
                [invite[1], _normalize_org_role(invite[3], default="Consultant"), user_id],
            )
            con.execute(
                "UPDATE organisation_invitations SET accepted_at = NOW() WHERE invitation_id = %s",
                [invite[0]],
            )
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="accept",
                entity_type="organisation_membership",
                entity_id=f"{invite[1]}:{user_id}",
                metadata={"org_id": str(invite[1]), "email": user_email, "role": str(invite[3] or "Consultant")},
            )
            logger.info("Organisation invite accepted org_id=%s user_id=%s", invite[1], user_id)
            return {
                "ok": True,
                "org_id": str(invite[1]),
                "email": invite_email,
                "role": str(invite[3] or "Consultant"),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to accept organisation invitation: {e}")


@router.post("/organisations/{org_id}/switch")
def switch_active_organisation(org_id: str, request: Request = None, _user: dict = Depends(_current_user)):
    try:
        user_id = str(_user.get("user_id") or "").strip()
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid user")

        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _require_org_switch_role(con, _user, org_id)
            _require_org_capacity(con, org_id)
            con.execute(
                "UPDATE users SET org_id = %s WHERE lower(user_id) = lower(%s)",
                [org_id, user_id],
            )
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="switch",
                entity_type="organisation_membership",
                entity_id=f"{org_id}:{user_id}",
                metadata={"org_id": org_id, "user_id": user_id},
            )
            logger.info("Active organisation switched org_id=%s user_id=%s", org_id, user_id)
            return {"ok": True, "org_id": org_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to switch organisation: {e}")


@router.get("/organisations/{org_id}/members")
def list_organisation_members(org_id: str, _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _require_org_management_role(con, _user, org_id)
            _require_org_capacity(con, org_id)
            rows = con.execute(
                """
                SELECT m.org_id, m.user_id, COALESCE(u.full_name, '') AS full_name, COALESCE(u.email, '') AS email,
                       m.role, m.is_active, m.is_owner, m.created_at, m.updated_at
                FROM organisation_memberships m
                LEFT JOIN users u ON lower(u.user_id) = lower(m.user_id)
                WHERE m.org_id = %s
                ORDER BY COALESCE(u.full_name, u.email, m.user_id)
                """,
                [org_id],
            ).fetchall()
            items = []
            for row in rows or []:
                items.append(
                    {
                        "org_id": str(row[0]) if row[0] is not None else None,
                        "user_id": str(row[1]) if row[1] is not None else None,
                        "full_name": str(row[2] or ""),
                        "email": str(row[3] or ""),
                        "role": _normalize_org_role(row[4]),
                        "is_active": bool(row[5]) if row[5] is not None else True,
                        "is_owner": bool(row[6]) if row[6] is not None else False,
                        "created_at": str(row[7]) if row[7] else None,
                        "updated_at": str(row[8]) if row[8] else None,
                    }
                )
            return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list organisation members: {e}")


@router.patch("/organisations/{org_id}/members/{member_user_id}")
def update_organisation_member(org_id: str, member_user_id: str, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            role_info = _require_org_management_role(con, _user, org_id)
            membership = con.execute(
                """
                SELECT membership_id, org_id, user_id, role, is_active, is_owner
                FROM organisation_memberships
                WHERE org_id = %s AND lower(user_id) = lower(%s)
                LIMIT 1
                """,
                [org_id, member_user_id],
            ).fetchone()
            if not membership:
                raise HTTPException(status_code=404, detail="Member not found")
            next_role = _normalize_org_role(body.get("role"), default="Member") if "role" in body and body.get("role") is not None else None
            transfer_owner = bool(body.get("is_owner")) or next_role == "Owner"
            if transfer_owner and not bool((role_info.get("capabilities") or {}).get("can_transfer_ownership")):
                raise HTTPException(status_code=403, detail="Organisation owner role required")
            if transfer_owner:
                con.execute(
                    """
                    UPDATE organisation_memberships
                    SET role = CASE WHEN lower(user_id) = lower(%s) THEN 'Owner' ELSE CASE WHEN lower(role) = 'owner' THEN 'Admin' ELSE role END END,
                        is_owner = CASE WHEN lower(user_id) = lower(%s) THEN TRUE ELSE FALSE END,
                        updated_at = NOW()
                    WHERE org_id = %s
                    """,
                    [member_user_id, member_user_id, org_id],
                )
                con.execute(
                    """
                    UPDATE users
                    SET role = CASE WHEN lower(user_id) = lower(%s) THEN 'Owner' ELSE role END,
                        org_id = %s
                    WHERE lower(user_id) = lower(%s)
                    """,
                    [member_user_id, org_id, member_user_id],
                )
                row = con.execute(
                    """
                    SELECT org_id, user_id, role, is_active, is_owner
                    FROM organisation_memberships
                    WHERE org_id = %s AND lower(user_id) = lower(%s)
                    LIMIT 1
                    """,
                    [org_id, member_user_id],
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=500, detail="Failed to update organisation member")
                return {
                    "ok": True,
                    "member": {
                        "org_id": str(row[0]) if row[0] is not None else None,
                        "user_id": str(row[1]) if row[1] is not None else None,
                        "role": _normalize_org_role(row[2]),
                        "is_active": bool(row[3]) if row[3] is not None else True,
                        "is_owner": bool(row[4]) if row[4] is not None else False,
                    },
                }

            updates = []
            params: list[object] = []

            if next_role is not None:
                updates.append("role = %s")
                params.append(next_role)
            if "is_active" in body and body.get("is_active") is not None:
                updates.append("is_active = %s")
                params.append(bool(body.get("is_active")))
            if "is_owner" in body and body.get("is_owner") is not None:
                updates.append("is_owner = %s")
                params.append(bool(body.get("is_owner")))
            if not updates:
                return {
                    "ok": True,
                    "member": {
                        "org_id": str(membership[1]),
                        "user_id": str(membership[2]),
                        "role": _normalize_org_role(membership[3]),
                        "is_active": bool(membership[4]) if membership[4] is not None else True,
                        "is_owner": bool(membership[5]) if membership[5] is not None else False,
                    },
                }

            updates.append("updated_at = NOW()")
            row = con.execute(
                f"""
                UPDATE organisation_memberships
                SET {', '.join(updates)}
                WHERE org_id = %s AND lower(user_id) = lower(%s)
                RETURNING org_id, user_id, role, is_active, is_owner
                """,
                [*params, org_id, member_user_id],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Failed to update organisation member")

            return {
                "ok": True,
                "member": {
                    "org_id": str(row[0]) if row[0] is not None else None,
                    "user_id": str(row[1]) if row[1] is not None else None,
                    "role": _normalize_org_role(row[2]),
                    "is_active": bool(row[3]) if row[3] is not None else True,
                    "is_owner": bool(row[4]) if row[4] is not None else False,
                },
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update organisation member: {e}")


@router.post("/organisations/{org_id}/transfer-ownership")
def transfer_organisation_ownership(
    org_id: str,
    body: dict = Body(...),
    request: Request = None,
    _user: dict = Depends(_current_user),
):
    try:
        member_user_id = str(body.get("member_user_id") or "").strip()
        if not member_user_id:
            raise HTTPException(status_code=400, detail="member_user_id is required")

        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _require_org_owner_role(con, _user, org_id)
            membership = con.execute(
                """
                SELECT membership_id, org_id, user_id, role, is_active, is_owner
                FROM organisation_memberships
                WHERE org_id = %s AND lower(user_id) = lower(%s)
                LIMIT 1
                """,
                [org_id, member_user_id],
            ).fetchone()
            if not membership:
                raise HTTPException(status_code=404, detail="Member not found")
            if membership[4] is None or not bool(membership[4]):
                raise HTTPException(status_code=400, detail="Member must be active before ownership can be transferred")

            con.execute(
                """
                UPDATE organisation_memberships
                SET role = CASE WHEN lower(user_id) = lower(%s) THEN 'Owner' ELSE CASE WHEN lower(role) = 'owner' THEN 'Admin' ELSE role END END,
                    is_owner = CASE WHEN lower(user_id) = lower(%s) THEN TRUE ELSE FALSE END,
                    updated_at = NOW()
                WHERE org_id = %s
                """,
                [member_user_id, member_user_id, org_id],
            )
            con.execute(
                """
                UPDATE users
                SET role = CASE WHEN lower(user_id) = lower(%s) THEN 'Owner' ELSE role END,
                    org_id = %s
                WHERE lower(user_id) = lower(%s)
                """,
                [member_user_id, org_id, member_user_id],
            )
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="transfer",
                entity_type="organisation_membership",
                entity_id=f"{org_id}:{member_user_id}",
                metadata={"org_id": org_id, "member_user_id": member_user_id},
            )
            logger.info("Organisation ownership transferred org_id=%s new_owner=%s", org_id, member_user_id)
            return {"ok": True, "org_id": org_id, "owner_user_id": member_user_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to transfer organisation ownership: {e}")


@router.post("/organisations/{org_id}/archive")
def archive_organisation(
    org_id: str,
    body: dict = Body(...),
    request: Request = None,
    _user: dict = Depends(_current_user),
):
    try:
        archived = bool(body.get("archived", True))
        actor = _actor_identifier(_user)
        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _require_org_management_role(con, _user, org_id)
            existing = con.execute(
                """
                SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at
                FROM organisations
                WHERE org_id = %s
                """,
                [org_id],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Organisation not found")
            row = con.execute(
                """
                UPDATE organisations
                SET archived = %s,
                    archived_at = CASE WHEN %s THEN NOW() ELSE NULL END,
                    archived_by = CASE WHEN %s THEN %s ELSE NULL END,
                    updated_at = NOW()
                WHERE org_id = %s
                RETURNING org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at
                """,
                [archived, archived, archived, actor, org_id],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Failed to update organisation archive state")
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="archive" if archived else "restore",
                entity_type="organisation",
                entity_id=row[0],
                metadata={"org_id": org_id, "archived": archived},
            )
            logger.info("Organisation archive state changed org_id=%s archived=%s actor=%s", org_id, archived, actor)
            return {"ok": True, "organisation": _organisation_row_to_dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to archive organisation: {e}")


@router.get("/organisations/{org_id}/billing")
def list_organisation_billing(org_id: str, _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _ensure_org_entitlement_schema(con)
            _ensure_org_billing_schema(con)
            role_info = _require_org_management_role(con, _user, org_id)
            organisation = con.execute(
                """
                SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at
                FROM organisations
                WHERE org_id = %s
                LIMIT 1
                """,
                [org_id],
            ).fetchone()
            if not organisation:
                raise HTTPException(status_code=404, detail="Organisation not found")
            entitlement = _organisation_entitlement_info(con, org_id)
            usage = _organisation_usage_info(con, org_id)
            invoice_rows = con.execute(
                """
                SELECT billing_invoice_id, org_id, invoice_number, status, amount_cents, currency, description,
                       invoice_date, due_date, paid_at, period_start, period_end, payment_reference,
                       stripe_invoice_id, stripe_payment_intent_id, created_by, created_at, updated_at
                FROM organisation_billing_invoices
                WHERE org_id = %s
                ORDER BY COALESCE(invoice_date, created_at) DESC, created_at DESC
                """,
                [org_id],
            ).fetchall()
            event_rows = con.execute(
                """
                SELECT billing_event_id, org_id, billing_invoice_id, event_type, source, status, amount_cents,
                       currency, reference, notes, payload_json, effective_at, created_by, created_at
                FROM organisation_billing_events
                WHERE org_id = %s
                ORDER BY COALESCE(effective_at, created_at) DESC, created_at DESC
                """,
                [org_id],
            ).fetchall()
            return {
                "organisation": _organisation_row_to_dict(organisation),
                "entitlement": entitlement,
                "usage": usage,
                "billing": {
                    "role": str(role_info.get("role") or "Member"),
                    "capabilities": dict(role_info.get("capabilities") or {}),
                    "invoices": [_billing_invoice_row_to_dict(row) for row in invoice_rows or []],
                    "events": [_billing_event_row_to_dict(row) for row in event_rows or []],
                },
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list organisation billing: {e}")


@router.post("/organisations/{org_id}/billing/invoices")
def create_organisation_billing_invoice(
    org_id: str,
    body: dict = Body(...),
    request: Request = None,
    _user: dict = Depends(_current_user),
):
    try:
        invoice_number = str(body.get("invoice_number") or "").strip()
        if not invoice_number:
            raise HTTPException(status_code=400, detail="invoice_number is required")
        status = str(body.get("status") or "draft").strip().lower() or "draft"
        if status not in _ORG_BILLING_INVOICE_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid invoice status")
        amount_cents = _parse_amount_cents(body.get("amount_cents") if "amount_cents" in body else body.get("amount"))
        currency = str(body.get("currency") or "GBP").strip().upper() or "GBP"
        description = str(body.get("description") or "").strip() or None
        invoice_date = body.get("invoice_date")
        due_date = body.get("due_date")
        paid_at = body.get("paid_at")
        period_start = body.get("period_start")
        period_end = body.get("period_end")
        payment_reference = str(body.get("payment_reference") or "").strip() or None
        stripe_invoice_id = str(body.get("stripe_invoice_id") or "").strip() or None
        stripe_payment_intent_id = str(body.get("stripe_payment_intent_id") or "").strip() or None
        created_by = _actor_identifier(_user)

        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _ensure_org_entitlement_schema(con)
            _ensure_org_billing_schema(con)
            _require_org_management_role(con, _user, org_id)
            invoice_org = con.execute(
                "SELECT org_id FROM organisations WHERE org_id = %s LIMIT 1",
                [org_id],
            ).fetchone()
            if not invoice_org:
                raise HTTPException(status_code=404, detail="Organisation not found")
            existing = con.execute(
                """
                SELECT 1
                FROM organisation_billing_invoices
                WHERE org_id = %s AND lower(invoice_number) = lower(%s)
                LIMIT 1
                """,
                [org_id, invoice_number],
            ).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail="Invoice number already exists for this organisation")
            row = con.execute(
                """
                INSERT INTO organisation_billing_invoices (
                  org_id, invoice_number, status, amount_cents, currency, description,
                  invoice_date, due_date, paid_at, period_start, period_end,
                  payment_reference, stripe_invoice_id, stripe_payment_intent_id, created_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING billing_invoice_id, org_id, invoice_number, status, amount_cents, currency, description,
                          invoice_date, due_date, paid_at, period_start, period_end, payment_reference,
                          stripe_invoice_id, stripe_payment_intent_id, created_by, created_at, updated_at
                """,
                [
                    org_id,
                    invoice_number,
                    status,
                    amount_cents,
                    currency,
                    description,
                    invoice_date,
                    due_date,
                    paid_at,
                    period_start,
                    period_end,
                    payment_reference,
                    stripe_invoice_id,
                    stripe_payment_intent_id,
                    created_by,
                ],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Failed to create billing invoice")
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="organisation_billing_invoice",
                entity_id=str(row[0]),
                metadata={
                    "org_id": org_id,
                    "invoice_number": invoice_number,
                    "status": status,
                    "amount_cents": amount_cents,
                    "currency": currency,
                },
            )
            if status != "draft" or paid_at:
                con.execute(
                    """
                    INSERT INTO organisation_billing_events (
                      org_id, billing_invoice_id, event_type, source, status, amount_cents, currency,
                      reference, notes, payload_json, effective_at, created_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
                    """,
                    [
                        org_id,
                        row[0],
                        "invoice_issued" if status in {"issued", "paid"} else "invoice_created",
                        "manual",
                        "recorded",
                        amount_cents,
                        currency,
                        invoice_number,
                        description,
                        json.dumps(
                            {
                                "status": status,
                                "invoice_number": invoice_number,
                                "payment_reference": payment_reference,
                                "stripe_invoice_id": stripe_invoice_id,
                                "stripe_payment_intent_id": stripe_payment_intent_id,
                            },
                            default=str,
                        ),
                        created_by,
                    ],
                )
            logger.info("Organisation billing invoice created org_id=%s invoice_number=%s actor=%s", org_id, invoice_number, created_by or "unknown")
            return {"ok": True, "invoice": _billing_invoice_row_to_dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create organisation billing invoice: {e}")


@router.patch("/organisations/{org_id}/billing/invoices/{billing_invoice_id}")
def update_organisation_billing_invoice(
    org_id: str,
    billing_invoice_id: str,
    body: dict = Body(...),
    request: Request = None,
    _user: dict = Depends(_current_user),
):
    try:
        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _ensure_org_entitlement_schema(con)
            _ensure_org_billing_schema(con)
            _require_org_management_role(con, _user, org_id)
            invoice = con.execute(
                """
                SELECT billing_invoice_id, org_id, invoice_number, status, amount_cents, currency, description,
                       invoice_date, due_date, paid_at, period_start, period_end, payment_reference,
                       stripe_invoice_id, stripe_payment_intent_id, created_by, created_at, updated_at
                FROM organisation_billing_invoices
                WHERE billing_invoice_id = %s AND org_id = %s
                LIMIT 1
                """,
                [billing_invoice_id, org_id],
            ).fetchone()
            if not invoice:
                raise HTTPException(status_code=404, detail="Billing invoice not found")
            updates: list[str] = []
            params: list[object] = []
            for key in ("invoice_number", "description", "payment_reference", "stripe_invoice_id", "stripe_payment_intent_id"):
                if key in body and body.get(key) is not None:
                    value = str(body.get(key)).strip()
                    updates.append(f"{key} = %s")
                    params.append(value or None)
            if "status" in body and body.get("status") is not None:
                status = str(body.get("status")).strip().lower() or "draft"
                if status not in _ORG_BILLING_INVOICE_STATUSES:
                    raise HTTPException(status_code=400, detail="Invalid invoice status")
                updates.append("status = %s")
                params.append(status)
            if "amount_cents" in body or "amount" in body:
                amount_cents = _parse_amount_cents(body.get("amount_cents") if "amount_cents" in body else body.get("amount"))
                updates.append("amount_cents = %s")
                params.append(amount_cents)
            for key in ("invoice_date", "due_date", "paid_at", "period_start", "period_end"):
                if key in body:
                    value = body.get(key)
                    updates.append(f"{key} = %s")
                    params.append(value)
            if not updates:
                return {"ok": True, "invoice": _billing_invoice_row_to_dict(invoice)}
            updates.append("updated_at = NOW()")
            row = con.execute(
                f"""
                UPDATE organisation_billing_invoices
                SET {', '.join(updates)}
                WHERE billing_invoice_id = %s AND org_id = %s
                RETURNING billing_invoice_id, org_id, invoice_number, status, amount_cents, currency, description,
                          invoice_date, due_date, paid_at, period_start, period_end, payment_reference,
                          stripe_invoice_id, stripe_payment_intent_id, created_by, created_at, updated_at
                """,
                [*params, billing_invoice_id, org_id],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Failed to update billing invoice")
            event_type = "invoice_issued" if str(row[3]).strip().lower() in {"issued", "paid"} else "note"
            if str(body.get("paid_at") or "").strip():
                event_type = "payment_received"
            con.execute(
                """
                INSERT INTO organisation_billing_events (
                  org_id, billing_invoice_id, event_type, source, status, amount_cents, currency,
                  reference, notes, payload_json, effective_at, created_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
                """,
                [
                    org_id,
                    billing_invoice_id,
                    event_type,
                    "manual",
                    "recorded",
                    int(row[4] or 0),
                    str(row[5] or "GBP"),
                    str(row[2] or ""),
                    str(body.get("notes") or body.get("description") or "") or None,
                    json.dumps({"updated_fields": list(body.keys()), "invoice_status": str(row[3] or "draft")}, default=str),
                    _actor_identifier(_user),
                ],
            )
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="organisation_billing_invoice",
                entity_id=str(row[0]),
                metadata={"org_id": org_id, "invoice_number": str(row[2] or ""), "updated_fields": list(body.keys())},
            )
            logger.info("Organisation billing invoice updated org_id=%s invoice_id=%s actor=%s", org_id, billing_invoice_id, _actor_identifier(_user))
            return {"ok": True, "invoice": _billing_invoice_row_to_dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update organisation billing invoice: {e}")


@router.post("/organisations/{org_id}/billing/events")
def create_organisation_billing_event(
    org_id: str,
    body: dict = Body(...),
    request: Request = None,
    _user: dict = Depends(_current_user),
):
    try:
        event_type = str(body.get("event_type") or "note").strip().lower() or "note"
        if event_type not in _ORG_BILLING_EVENT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid billing event type")
        source = str(body.get("source") or "manual").strip() or "manual"
        status = str(body.get("status") or "recorded").strip() or "recorded"
        amount_cents = _parse_amount_cents(body.get("amount_cents") if "amount_cents" in body else body.get("amount"))
        currency = str(body.get("currency") or "GBP").strip().upper() or "GBP"
        reference = str(body.get("reference") or "").strip() or None
        notes = str(body.get("notes") or "").strip() or None
        payload = body.get("payload")
        effective_at = body.get("effective_at")
        billing_invoice_id = str(body.get("billing_invoice_id") or "").strip() or None

        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _ensure_org_entitlement_schema(con)
            _ensure_org_billing_schema(con)
            _require_org_management_role(con, _user, org_id)
            org_row = con.execute(
                "SELECT org_id FROM organisations WHERE org_id = %s LIMIT 1",
                [org_id],
            ).fetchone()
            if not org_row:
                raise HTTPException(status_code=404, detail="Organisation not found")
            if billing_invoice_id:
                invoice_row = con.execute(
                    "SELECT billing_invoice_id FROM organisation_billing_invoices WHERE billing_invoice_id = %s AND org_id = %s LIMIT 1",
                    [billing_invoice_id, org_id],
                ).fetchone()
                if not invoice_row:
                    raise HTTPException(status_code=404, detail="Billing invoice not found")
            event_row = con.execute(
                """
                INSERT INTO organisation_billing_events (
                  org_id, billing_invoice_id, event_type, source, status, amount_cents, currency,
                  reference, notes, payload_json, effective_at, created_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING billing_event_id, org_id, billing_invoice_id, event_type, source, status,
                          amount_cents, currency, reference, notes, payload_json, effective_at, created_by, created_at
                """,
                [
                    org_id,
                    billing_invoice_id,
                    event_type,
                    source,
                    status,
                    amount_cents,
                    currency,
                    reference,
                    notes,
                    json.dumps(payload, default=str) if payload is not None else None,
                    effective_at,
                    _actor_identifier(_user),
                ],
            ).fetchone()
            if not event_row:
                raise HTTPException(status_code=500, detail="Failed to create billing event")
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="organisation_billing_event",
                entity_id=str(event_row[0]),
                metadata={"org_id": org_id, "event_type": event_type, "billing_invoice_id": billing_invoice_id},
            )
            logger.info("Organisation billing event created org_id=%s event_type=%s actor=%s", org_id, event_type, _actor_identifier(_user))
            return {"ok": True, "event": _billing_event_row_to_dict(event_row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create organisation billing event: {e}")


# =========================
# DATASETS & FACTORS
# =========================

