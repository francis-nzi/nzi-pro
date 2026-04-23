# Tenancy Stage 2 Tracker

Use this file as the living checklist for the next phase of multi-tenant architecture:

- stage 1 = safe tenant isolation, org-aware APIs, RLS, and legacy compatibility
- stage 2 = tenant-native product features, roles, billing, lifecycle, and cleanup

## Status Legend

- `Not started`
- `In progress`
- `Blocked`
- `Complete`

## Tracker

| ID | Ticket | Priority | Status | Owner | Due date | Dependencies | Evidence |
|---|---|---|---|---|---|---|---|
| S2-1 | Backfill and normalize remaining legacy tenant data | P0 | Complete | You | 2026-06-05 | Stage 1 complete | `Live DB audit: zero null org_id rows across public org-scoped tables; files: api/quotes_routes.py, sql_migrations/0033_tenant_quote_billing_scaffold.sql, sql_migrations/0041_normalize_quote_billing_org_ids.sql; migration applied; all org_id columns now uuid` |
| S2-2 | Define org membership roles and permission model | P0 | Complete | You | 2026-06-12 | S2-1 | Files: api/admin_routes.py, frontend/src/app/admin/organisations/page.tsx, tests/test_org_lifecycle.py, tests/test_tenant_observability.py; tests: python -m pytest tests/test_org_lifecycle.py tests/test_tenant_observability.py; notes: added org role helpers, members list, and role editor |
| S2-3 | Complete org lifecycle management | P0 | Complete | You | 2026-06-19 | S2-2 | Files: api/admin_routes.py, frontend/src/app/admin/organisations/page.tsx, tests/test_org_lifecycle.py, tests/test_tenant_observability.py; tests: python -m pytest tests/test_org_lifecycle.py tests/test_tenant_observability.py, npm run build; notes: archived/reactivated orgs and ownership transfer now supported |
| S2-4 | Enforce billing plans and usage limits | P1 | Complete | You | 2026-06-26 | S2-2, S2-3 | Files: api/admin_routes.py, api/main.py, api/business_development_routes.py, tests/test_main_tenancy.py, tests/test_business_development_limits.py, tests/test_org_lifecycle.py, tests/test_tenant_observability.py; tests: python -m pytest tests/test_main_tenancy.py tests/test_business_development_limits.py tests/test_org_lifecycle.py tests/test_tenant_observability.py; notes: org user and client ceilings now block invite, accept, client creation, and lead conversion when limits are reached |
| S2-5 | Make every background job explicitly tenant-scoped | P1 | Complete | You | 2026-06-26 | Stage 1 complete | Files: services/pdf_generation_queue.py, services/pdf_generation_tasks.py, api/pdf_generation_routes.py, tests/test_pdf_tenancy.py; tests: python -m pytest tests/test_pdf_tenancy.py tests/test_main_tenancy.py tests/test_business_development_limits.py tests/test_org_lifecycle.py tests/test_tenant_observability.py; notes: PDF generation queue, worker, polling, and cancel flows now require and enforce org_id |
| S2-6 | Expand tenant audit and observability | P1 | Complete | You | 2026-07-03 | S2-3, S2-5 | Files: api/admin_routes.py, services/pdf_generation_queue.py, services/pdf_generation_tasks.py, tests/test_tenant_observability.py, tests/test_pdf_tenancy.py; tests: python -m pytest tests/test_pdf_tenancy.py tests/test_tenant_observability.py tests/test_main_tenancy.py tests/test_business_development_limits.py tests/test_org_lifecycle.py; notes: tenant capacity denials now log warnings and PDF queue/worker logs include org_id on start, success, denial, and cancel paths |
| S2-7 | Improve org switching and current-org UX | P1 | Complete | You | 2026-07-10 | S2-2, S2-3 | Files: api/auth_routes.py, frontend/src/components/MainNav.tsx, tests/test_auth_routes.py; tests: python -m pytest tests/test_auth_routes.py tests/test_tenant_observability.py tests/test_org_lifecycle.py tests/test_main_tenancy.py; notes: top nav now shows current org and admins can switch from the account menu |
| S2-8 | Clean up tenant fallback code paths | P2 | Complete | You | 2026-07-10 | S2-1, S2-2 | Files: services/tenancy.py, services/permissions.py, api/main.py, api/time_routes.py, api/client_dashboard_routes.py, api/quotes_routes.py, api/admin_routes.py, tests/test_tenancy.py, tests/test_permissions.py, tests/test_main_tenancy.py; tests: python -m pytest tests/test_tenancy.py tests/test_permissions.py tests/test_auth_routes.py tests/test_main_tenancy.py tests/test_tenant_observability.py tests/test_org_lifecycle.py, npm run build; notes: removed runtime default-org fallback and allow_fallback opt-ins from tenancy helpers and client-time routes |
| S2-9 | Add stage 2 regression coverage | P1 | Not started | You | 2026-07-17 | S2-2, S2-3, S2-4, S2-5 |  |

## Suggested Order

1. S2-1: data cleanup and normalization
2. S2-2: membership roles and permissions
3. S2-3: org lifecycle completion
4. S2-4: billing and usage limit enforcement
5. S2-5: tenant-aware background processing
6. S2-6: audit and observability
7. S2-7: org switching UX
8. S2-9: regression coverage
9. S2-8: remove any leftover fallback paths

## Update Rule

When we agree a ticket is finished, update its `Status` to `Complete` and add a short note in `Evidence`, such as:

- file(s) changed
- tests run
- any remaining caveats

If you want a consistent evidence format, use one of these:

- `PR #123 merged; pytest passed; smoke test clean`
- `Files: api/main.py, services/permissions.py; tests: tenant_access tests`
- `Schema verified in production; migration 0034 applied; no console errors`

## Evidence Format

Use a short, consistent evidence note so the tracker stays easy to scan.

Recommended format:

`Files: <file(s)>; tests: <test(s)>; notes: <brief caveat or confirmation>`

Examples:

- `Files: api/admin_routes.py, frontend/src/app/admin/organisations/page.tsx; tests: pytest tests/test_org_lifecycle.py, npm run build; notes: org invite flow verified`
- `Files: services/tenancy.py, api/auth.py; tests: pytest tests/test_tenancy.py; notes: strict org resolution confirmed`
- `Schema verified in production; tests: migration smoke checks; notes: no console errors after deploy`

## Ownership Note

The `Owner` column is now set to you for the time being. Once you’re comfortable with how the pieces fit together, we can split out implementation owners or add a separate `Implementation Owner` column without disturbing the tracker structure.

You are the business owner for the stage 2 tenancy work for now, and we can delegate specific implementation roles later when you decide how you want the team structured.
