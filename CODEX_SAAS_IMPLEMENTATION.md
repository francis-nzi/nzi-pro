# NZI Pro - SaaS Commercial Readiness: Codex Implementation Brief

## Project Context

You are working on **NZI Pro**, a carbon accounting and sustainability management platform.

**Tech stack:**
- Backend: FastAPI (Python), located in `/api/` and `core/` and `services/`
- Frontend: Next.js 16 (App Router, TypeScript), located in `/frontend/src/`
- Database: PostgreSQL via Supabase (psycopg driver). Migrations run in `core/migrations.py` using `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` patterns.
- Auth: JWT Bearer tokens (`NZI_JWT_SECRET`). Token is stored in cookie `nzi_token`. Frontend proxies all API calls through `/frontend/src/app/api/backend/[...path]/route.ts` -> FastAPI.
- Permissions: `services/permissions.py` - role-based system with roles: SuperAdmin, Admin, Consultant, ReadOnly, CRM, QA, PortalUser.

**Current state:** This is a single-organisation internal tool. It has no multi-tenancy, no billing, no self-service sign-up, and no rate limiting. All of these must be added to make it a commercially viable SaaS product.

**How to run migrations:** Add all new `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements into the `run_migrations()` function in `core/migrations.py`. This function is called on app startup.

**Database connection pattern:**
```python
from core.database import get_conn

with get_conn() as con:
    row = con.execute("SELECT ... FROM ... WHERE ...", [param]).fetchone()
    rows = con.execute("SELECT ...").fetchall()
    con.execute("INSERT INTO ...", [values])
```

All SQL uses `%s` placeholders (psycopg style). Legacy code may use `?` - these are auto-converted by `core/database.py`.

**Existing tables (all currently without org_id):** clients, client_contacts, client_sites, client_notes, xero_connections, xero_contact_links, xero_invoice_links, datasets, custom_factors, custom_factor_year_values, job_custom_factors, factor_lookup, job_types, vat_rates_lookup, job_statuses_lookup, time_subjects, portfolios_lookup, feedback_items, jobs, job_templates, time_logs, lookups, roles_lookup, users, industries_lookup, positions_lookup, processes_lookup, payment_terms_lookup, crp_job_details, job_plan, job_files, job_scope_config, custom_conversion_factors, crp_scope_entries, job_scope_rows, job_emission_groups, job_emission_sources, milestone_templates, milestone_template_items, system_settings.

## Implementation Approach

Treat this as a phased migration instead of a big-bang rewrite:

1. Add the organisation model and auth context first.
2. Backfill legacy data into a default organisation before enforcing org-scoped queries everywhere.
3. Scope the highest-traffic API routes next so the app still works during the transition.
4. Add provisioning, billing, and invitation flows after tenancy is stable.
5. Keep all schema changes additive so the current single-org deployment can keep running.

---

## Implementation Tasks - Work Through These in Order

---

## TASK 1: Multi-Tenancy - Add Organisation Layer

This is the most critical change. Every record in the database must be scoped to an organisation. Without this, all customers share the same data.

### 1.1 Create the `organisations` table

In `core/migrations.py`, inside `run_migrations()`, add:

```sql
CREATE TABLE IF NOT EXISTS organisations (
  org_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE,
  plan VARCHAR DEFAULT 'trial',
  plan_status VARCHAR DEFAULT 'active',
  trial_ends_at TIMESTAMP,
  stripe_customer_id VARCHAR,
  stripe_subscription_id VARCHAR,
  max_users INTEGER DEFAULT 3,
  max_clients INTEGER DEFAULT 10,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

Also create an `organisation_invitations` table:

```sql
CREATE TABLE IF NOT EXISTS organisation_invitations (
  invitation_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES organisations(org_id),
  email VARCHAR NOT NULL,
  role VARCHAR DEFAULT 'Consultant',
  invited_by VARCHAR,
  token VARCHAR UNIQUE NOT NULL,
  accepted_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 1.2 Add `org_id` to all tenant-scoped tables

In `core/migrations.py`, add the following `ALTER TABLE` statements. Use `ADD COLUMN IF NOT EXISTS` so they are safe to re-run:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_scope_config ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_emission_groups ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_emission_sources ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_custom_factors ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_plan ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_files ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_templates ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE crp_job_details ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE crp_scope_entries ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE feedback_items ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE custom_factors ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE custom_factor_year_values ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE custom_conversion_factors ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE milestone_templates ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE milestone_template_items ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE xero_contact_links ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE xero_invoice_links ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE lookups ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE roles_lookup ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE time_subjects ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE portfolios_lookup ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_types ADD COLUMN IF NOT EXISTS org_id UUID;
```

Tables that are **global** and should NOT get `org_id` (system-wide reference data): `factor_lookup`, `vat_rates_lookup`, `job_statuses_lookup`, `industries_lookup`, `positions_lookup`, `processes_lookup`, `payment_terms_lookup`.

### 1.3 Add indexes on org_id for performance

```sql
CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_clients_org_id ON clients(org_id);
CREATE INDEX IF NOT EXISTS idx_jobs_org_id ON jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_job_scope_rows_org_id ON job_scope_rows(org_id);
CREATE INDEX IF NOT EXISTS idx_time_logs_org_id ON time_logs(org_id);
```

### 1.4 Backfill existing data before strict enforcement

Create one default organisation for the legacy deployment and assign any existing tenant-scoped rows that still have `org_id IS NULL` to it.

```sql
INSERT INTO organisations (name, slug, plan, plan_status, max_users, max_clients)
SELECT 'NZI Internal', 'nzi-internal', 'trial', 'active', 999, 999
WHERE NOT EXISTS (
  SELECT 1 FROM organisations WHERE slug = 'nzi-internal'
);
```

Then backfill each tenant-scoped table in batches. Keep the pattern explicit in the migration file so it is easy to audit:

```sql
UPDATE users SET org_id = (SELECT org_id FROM organisations WHERE slug = 'nzi-internal') WHERE org_id IS NULL;
UPDATE clients SET org_id = (SELECT org_id FROM organisations WHERE slug = 'nzi-internal') WHERE org_id IS NULL;
UPDATE client_contacts SET org_id = (SELECT org_id FROM organisations WHERE slug = 'nzi-internal') WHERE org_id IS NULL;
```

Write out all UPDATE statements explicitly in the migration file - do not abbreviate. There should be one UPDATE per table in section 1.2 before any route starts assuming `org_id` is always present.

### 1.5 Add uniqueness rules that are safe per organisation

When a table has tenant-specific unique fields, prefer composite uniqueness over global uniqueness.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email ON users(org_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_org_name_active
ON clients(org_id, client_name)
WHERE status = 'Active';
```

Do not add hard foreign keys to `organisations` until the backfill is complete and the app is reading and writing `org_id` consistently.

### 1.6 Propagate `org_id` into the auth user dict

In `api/auth.py`, the `_current_user()` function returns a user dict. After fetching the user, also fetch their `org_id` from the `users` table and include it in the returned dict:

```python
# After fetching the user, add org_id lookup:
with get_conn() as con:
    org_row = con.execute(
        "SELECT org_id FROM users WHERE user_id = %s LIMIT 1",
        [user["user_id"]]
    ).fetchone()
user["org_id"] = str(org_row[0]) if org_row and org_row[0] else None
```

If a legacy row still has `org_id = NULL`, map it to the default organisation during the migration window rather than treating it as unscoped data.

### 1.7 Create an `org_id` enforcement helper

Create a new file `services/tenancy.py`:

```python
"""Tenant scoping helpers - ensure every query is scoped to the current org."""
from fastapi import HTTPException


def require_org(user: dict) -> str:
    """Extract org_id from the current user dict, raising 403 if missing."""
    org_id = str(user.get("org_id") or "").strip()
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation associated with this account.")
    return org_id


def org_where(org_id: str, alias: str = "") -> tuple[str, list]:
    """Return a SQL WHERE fragment and params list for org scoping.

    Usage:
        org_id = require_org(user)
        clause, params = org_where(org_id)
        con.execute(f"SELECT * FROM clients WHERE {clause}", params)
    """
    prefix = f"{alias}." if alias else ""
    return f"{prefix}org_id = %s", [org_id]
```

### 1.8 Update every API route to scope queries by org_id

For every route in `/api/` that queries tenant-scoped tables, add `org_id = require_org(user)` at the top of the handler and add `AND org_id = %s` to every SELECT/UPDATE/DELETE, and include `org_id` in every INSERT.

Start with the most-used routes in this order:
1. `api/admin_routes.py` - all team, client, and settings queries
2. `api/job_scope_data_routes.py`
3. `api/client_dashboard_routes.py`
4. `api/main_dashboard_routes.py`
5. All remaining routes in `/api/`

**Pattern to follow in each route:**
```python
from services.tenancy import require_org

@router.get("/clients")
async def list_clients(user: dict = Depends(_current_user)):
    org_id = require_org(user)
    with get_conn() as con:
        rows = con.execute(
            "SELECT * FROM clients WHERE org_id = %s AND status != 'Archived' ORDER BY client_name",
            [org_id]
        ).fetchall()
    return rows
```

---

## TASK 2: Subscription & Billing (Stripe)

### 2.1 Install Stripe

Add `stripe` to `requirements.txt`.

### 2.2 Create billing routes

Create a new file `api/billing_routes.py`:

```python
"""Stripe billing routes - checkout, portal, webhook."""

import os
import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, Body
from fastapi.responses import JSONResponse
from api.auth import _current_user
from services.tenancy import require_org
from core.database import get_conn

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

router = APIRouter(prefix="/billing", tags=["billing"])

PLANS = {
    "starter": {
        "name": "Starter",
        "price_id": os.getenv("STRIPE_PRICE_STARTER"),
        "max_users": 3,
        "max_clients": 10,
    },
    "professional": {
        "name": "Professional",
        "price_id": os.getenv("STRIPE_PRICE_PROFESSIONAL"),
        "max_users": 15,
        "max_clients": 50,
    },
    "enterprise": {
        "name": "Enterprise",
        "price_id": os.getenv("STRIPE_PRICE_ENTERPRISE"),
        "max_users": 999,
        "max_clients": 999,
    },
}


@router.post("/checkout")
async def create_checkout(plan: str = Body(..., embed=True), user: dict = Depends(_current_user)):
    org_id = require_org(user)
    if plan not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan.")
    plan_data = PLANS[plan]
    if not plan_data["price_id"]:
        raise HTTPException(status_code=500, detail="Plan price not configured.")

    with get_conn() as con:
        row = con.execute("SELECT stripe_customer_id, name FROM organisations WHERE org_id = %s", [org_id]).fetchone()

    stripe_customer_id = row[0] if row else None
    if not stripe_customer_id:
        # Create the Stripe customer once per organisation, then persist the ID.
        customer = stripe.Customer.create(email=user.get("email"), name=row[1] if row else None)
        stripe_customer_id = customer.id
        with get_conn() as con:
            con.execute("UPDATE organisations SET stripe_customer_id = %s WHERE org_id = %s", [stripe_customer_id, org_id])

    session = stripe.checkout.Session.create(
        customer=stripe_customer_id,
        mode="subscription",
        line_items=[{"price": plan_data["price_id"], "quantity": 1}],
        success_url=f"{os.getenv('FRONTEND_BASE_URL')}/account/settings?billing=success",
        cancel_url=f"{os.getenv('FRONTEND_BASE_URL')}/account/settings?billing=cancelled",
        metadata={"org_id": org_id, "plan": plan},
    )
    return {"url": session.url}


@router.post("/portal")
async def billing_portal(user: dict = Depends(_current_user)):
    org_id = require_org(user)
    with get_conn() as con:
        row = con.execute("SELECT stripe_customer_id FROM organisations WHERE org_id = %s", [org_id]).fetchone()
    if not row or not row[0]:
        raise HTTPException(status_code=400, detail="No billing account found.")
    session = stripe.billing_portal.Session.create(
        customer=row[0],
        return_url=f"{os.getenv('FRONTEND_BASE_URL')}/account/settings",
    )
    return {"url": session.url}


@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, secret)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    data = event["data"]["object"]

    if event["type"] == "checkout.session.completed":
        org_id = data.get("metadata", {}).get("org_id")
        plan = data.get("metadata", {}).get("plan", "starter")
        sub_id = data.get("subscription")
        plan_data = PLANS.get(plan, PLANS["starter"])
        if org_id:
            # Webhook delivery should be idempotent; repeated events should not break state.
            with get_conn() as con:
                con.execute(
                    """UPDATE organisations SET plan = %s, plan_status = 'active',
                       stripe_subscription_id = %s, max_users = %s, max_clients = %s
                       WHERE org_id = %s""",
                    [plan, sub_id, plan_data["max_users"], plan_data["max_clients"], org_id],
                )

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.paused"):
        sub_id = data.get("id")
        with get_conn() as con:
            con.execute(
                "UPDATE organisations SET plan_status = 'cancelled', plan = 'trial' WHERE stripe_subscription_id = %s",
                [sub_id],
            )

    elif event["type"] == "customer.subscription.updated":
        sub_id = data.get("id")
        status = data.get("status")
        with get_conn() as con:
            con.execute(
                "UPDATE organisations SET plan_status = %s WHERE stripe_subscription_id = %s",
                [status, sub_id],
            )

    return {"ok": True}


@router.get("/status")
async def billing_status(user: dict = Depends(_current_user)):
    org_id = require_org(user)
    with get_conn() as con:
        row = con.execute(
            "SELECT plan, plan_status, trial_ends_at, max_users, max_clients FROM organisations WHERE org_id = %s",
            [org_id]
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    return {
        "plan": row[0],
        "plan_status": row[1],
        "trial_ends_at": row[2].isoformat() if row[2] else None,
        "max_users": row[3],
        "max_clients": row[4],
    }
```

### 2.3 Register billing router

In `api/main.py`, import and include the billing router:

```python
from api.billing_routes import router as billing_router
app.include_router(billing_router)
```

### 2.4 Add plan limit enforcement helpers

Create `services/plan_limits.py`:

```python
"""Enforce plan-level usage limits before creating resources."""
from fastapi import HTTPException
from core.database import get_conn


def check_user_limit(org_id: str) -> None:
    with get_conn() as con:
        org_row = con.execute("SELECT max_users FROM organisations WHERE org_id = %s", [org_id]).fetchone()
        count_row = con.execute("SELECT COUNT(*) FROM users WHERE org_id = %s AND LOWER(status) = 'active'", [org_id]).fetchone()
    max_users = org_row[0] if org_row else 3
    current = count_row[0] if count_row else 0
    if current >= max_users:
        raise HTTPException(
            status_code=402,
            detail=f"User limit reached ({max_users} users on your current plan). Please upgrade to add more users."
        )


def check_client_limit(org_id: str) -> None:
    with get_conn() as con:
        org_row = con.execute("SELECT max_clients FROM organisations WHERE org_id = %s", [org_id]).fetchone()
        count_row = con.execute("SELECT COUNT(*) FROM clients WHERE org_id = %s AND status = 'Active'", [org_id]).fetchone()
    max_clients = org_row[0] if org_row else 10
    current = count_row[0] if count_row else 0
    if current >= max_clients:
        raise HTTPException(
            status_code=402,
            detail=f"Client limit reached ({max_clients} clients on your current plan). Please upgrade to add more clients."
        )
```

Call `check_user_limit(org_id)` in the team member creation route in `api/admin_routes.py`.
Call `check_client_limit(org_id)` in the client creation route wherever new clients are created.
If a downgrade would put the organisation over its current limits, block the downgrade or require the customer to reduce usage first.
Use `LOWER(status) = 'active'` in the user count query so the check stays case-insensitive and matches the existing auth pattern in `api/auth.py`.

### 2.5 Add Stripe env vars to `.env.example`

Add these to `.env.example` (placeholder values only - no real credentials):

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PROFESSIONAL=price_...
STRIPE_PRICE_ENTERPRISE=price_...
```

---

## TASK 3: Harden Authentication for Production

### 3.1 Remove the dev login shortcut in production

In `api/auth.py`, the function `_allow_dev_login()` enables header-based bypass when `APP_ENV` is `local`, `dev`, or `development`. That is fine for local testing, but production (`APP_ENV=production`) should accept only validated JWTs.

Update `_current_user()` so that when `_strict_auth_required()` is True:
- If no `Authorization: Bearer <token>` header is present, return 401 immediately.
- If the token is missing, invalid, or expired, return 401.
- Do not fall through to the `X-User` / `X-User-Email` header path.
- Do not use the `nzi_user` cookie as the sole auth mechanism. The `nzi_token` cookie path is fine only if it validates the JWT.

### 3.2 Enforce JWT secret in production startup

In `api/main.py`, add a hard startup check:

```python
import os
if os.getenv("APP_ENV", "").strip().lower() in ("prod", "production"):
    if not os.getenv("NZI_JWT_SECRET", "").strip():
        raise RuntimeError("FATAL: NZI_JWT_SECRET must be set in production.")
    if not os.getenv("STRIPE_SECRET_KEY", "").strip():
        raise RuntimeError("FATAL: STRIPE_SECRET_KEY must be set in production.")
```

### 3.3 Add token expiry enforcement

In `api/auth.py`, when decoding JWT tokens, enforce that the token has not expired by checking the `exp` claim. Tokens should be issued with a 24-hour expiry.

Add a refresh token endpoint at `POST /auth/refresh` that issues a new access token only when the existing token is still valid. Keep the refresh flow stateless for now: validate the current JWT, reissue a new JWT with a new 24-hour expiry, and return it to the frontend.

---
## TASK 4: Self-Service Sign-Up & Organisation Provisioning

### 4.1 Create the registration endpoint

In `api/auth_routes.py`, add `POST /auth/register`.

Request body:
```json
{
  "organisation_name": "Acme Consulting",
  "full_name": "Jane Smith",
  "email": "jane@acme.com",
  "password": "SecurePassword123!"
}
```

Logic:
1. Validate that `email` is not already in the `users` table.
2. Create the organisation and first admin user inside a single transaction.
3. Create a new row in `organisations` with `plan = 'trial'`, `trial_ends_at = NOW() + INTERVAL '14 days'`, `max_users = 3`, `max_clients = 10`.
4. Generate a unique `slug` from the organisation name.
5. Create a new row in `users` with `role = 'Admin'`, `user_type = 'internal'`, `status = 'pending_verification'`, `org_id` set to the new org's UUID, and a hashed password using the same hashing function as the existing password-change flow in `core/auth.py`.
6. Generate an email verification token and store it in a new `email_verifications` table.
7. Send the verification email after the DB commit succeeds.
8. Return `{ "message": "Check your email to verify your account." }`.

Create the `email_verifications` table in `core/migrations.py`:

```sql
CREATE TABLE IF NOT EXISTS email_verifications (
  verification_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  token VARCHAR UNIQUE NOT NULL,
  verified_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 4.2 Create the email verification endpoint

`GET /auth/verify-email?token=<token>`

Logic:
1. Look up the token in `email_verifications`. If expired, already used, or not found, return 400.
2. Set the user's `status = 'active'` and mark `verified_at = NOW()`.
3. Mark the verification row as consumed so the token cannot be reused.
4. Redirect to the frontend login page with `?verified=1`.

### 4.3 Create the sign-up page in the frontend

Create `/frontend/src/app/register/page.tsx` with a sign-up form collecting organisation name, full name, email, and password (with confirmation).

On submit, POST to `/api/backend/auth/register`. On success, show a "Check your email" message and clear the password fields.

Style it consistently with the existing login page at `/frontend/src/app/login/page.tsx`.

### 4.4 Link from the login page

In `/frontend/src/app/login/page.tsx`, add a "Don't have an account? Sign up free" link pointing to `/register`.

---
## TASK 5: Self-Service Team Invitations

### 5.1 Add invitation endpoint

In `api/admin_routes.py`, add `POST /admin/team/invite`.

Request body: `{ "email": "colleague@example.com", "role": "Consultant" }`

Logic:
1. Call `check_user_limit(org_id)` first.
2. Verify the email is not already a user in this org.
3. Generate a secure random token (32 hex chars).
4. Insert into `organisation_invitations` with an expiry window, such as 7 days.
5. Send an invitation email with a link to `{FRONTEND_BASE_URL}/accept-invite?token={token}`.
6. Return `{ "message": "Invitation sent." }`.

### 5.2 Add accept-invitation endpoint

`POST /auth/accept-invite`

Body: `{ "token": "...", "full_name": "John Smith", "password": "..." }`

Logic:
1. Look up the invitation by token. Check it hasn't expired and hasn't been accepted.
2. Create the user in `users` with `org_id`, `role`, `status = 'active'`, and a hashed password using the same hashing function as the existing password-change flow in `core/auth.py`.
3. Mark `accepted_at = NOW()` on the invitation.
4. Return a JWT token so the user is immediately logged in.

### 5.3 Add accept-invite frontend page

Create `/frontend/src/app/accept-invite/page.tsx`. Read the `?token=` param from the URL. Show a form for full name and password. On submit, POST to `/api/backend/auth/accept-invite`.

---
## TASK 6: API Rate Limiting

### 6.1 Install slowapi

Add `slowapi` to `requirements.txt`.

### 6.2 Add rate limiting middleware

In `api/main.py`:

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

Apply limits to sensitive endpoints:
- Login: 10 requests/minute
- Register: 5 requests/minute
- General API: 300 requests/minute per IP

Keep webhook endpoints exempt from the normal authenticated rate limits, but still validate provider signatures.

---
## TASK 7: GDPR Compliance Endpoints

### 7.1 Data export endpoint

Add `GET /admin/org/export` to `api/admin_routes.py` (Admin/SuperAdmin only).

Returns a JSON archive of all data for the current organisation across all tenant-scoped tables. This satisfies the GDPR data portability requirement.

### 7.2 Account deletion endpoint

Add `POST /admin/org/delete` (SuperAdmin only).

Body: `{ "confirm": "DELETE MY ACCOUNT" }`

Logic:
1. Verify the confirmation string matches exactly.
2. Cancel the Stripe subscription if one exists via `stripe.Subscription.cancel(sub_id)`.
3. Delete or anonymise all rows across all tenant-scoped tables where `org_id = %s`.
4. Soft-delete the org record itself (`plan_status = 'deleted'`) for audit trail.
5. Return `{"message": "Account deleted."}`.

---

## TASK 8: Sentry Error Monitoring

### 8.1 Backend

Add `sentry-sdk[fastapi]` to `requirements.txt`.

In `api/main.py`, before the app is created:

```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

sentry_dsn = os.getenv("SENTRY_DSN", "")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.1,
        environment=os.getenv("APP_ENV", "development"),
    )
```

### 8.2 Frontend

Add `@sentry/nextjs` to `/frontend/package.json` dependencies.

Create `/frontend/sentry.client.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
});
```

Create matching `sentry.server.config.ts` and `sentry.edge.config.ts` with the same content.

---

## TASK 9: Health Check Endpoint

Ensure `/health` exists in `api/main.py`:

```python
@app.get("/health", include_in_schema=False)
async def health():
    try:
        with get_conn() as con:
            con.execute("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    status_code = 200 if db_ok else 503
    from fastapi.responses import JSONResponse
    return JSONResponse(
        {"status": "ok" if db_ok else "degraded", "db": "ok" if db_ok else "error"},
        status_code=status_code,
    )
```

---

## TASK 10: Environment Variables - Final `.env.example`

Ensure `.env.example` contains ALL required variables with placeholder values only (no real credentials):

```
# Application
APP_ENV=development
FRONTEND_BASE_URL=http://localhost:3000

# Database
DB_BACKEND=postgres
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Auth
NZI_JWT_SECRET=your-secret-key-here
ENFORCE_JWT_AUTH=false

# Anthropic AI
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-4-6

# Stripe Billing
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PROFESSIONAL=price_...
STRIPE_PRICE_ENTERPRISE=price_...

# Xero Integration
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
XERO_TENANT_ID=
XERO_ORGANISATION_NAME=
XERO_REDIRECT_URI=http://localhost:8000/xero/oauth/callback
XERO_SCOPE=accounting.contacts accounting.invoices

# Email
SENDGRID_API_KEY=
FROM_EMAIL=noreply@yourdomain.com

# Monitoring
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# NZI Settings
NZI_LOGO_URL=
NZI_DEFAULT_YEAR=2026
```

---

## Important Constraints for Codex

- **Do not break existing functionality.** The single-org mode must continue to work during migration. When `org_id` is NULL on existing rows, queries should handle this gracefully.
- **Migrations are additive only.** Never drop columns or tables. Only use `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS`.
- **Follow existing code patterns.** Look at how nearby routes handle DB queries, auth, and errors - match that style exactly.
- **Preserve the existing auth flow.** The JWT cookie (`nzi_token`) and login page at `/login` must continue to work unchanged. Multi-tenancy is added on top, not replacing auth.
- **Test each task independently.** After completing each numbered task, the app should still start and the login flow should still work.
- **The frontend proxy** at `/frontend/src/app/api/backend/[...path]/route.ts` forwards all requests to FastAPI automatically. All new API routes are immediately available to the frontend via `/api/backend/...`.
- **Intensity metrics** are stored as a JSONB column on the `jobs` table (`intensity_metrics`), not in a separate table. Use the existing `GET /jobs/{job_id}/intensity-metrics` endpoint rather than querying a table directly.
- **New large endpoints** should be placed in new route files rather than appended to `api/job_report_routes.py` (which is already 5,000+ lines) to avoid circular import issues.
