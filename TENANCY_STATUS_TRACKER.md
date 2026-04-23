# Tenancy Status Tracker

Use this file as the living checklist for multi-tenant SaaS readiness.

## Status Legend

- `Not started`
- `In progress`
- `Blocked`
- `Complete`

## Tracker

| ID | Ticket | Priority | Status | Owner | Due date | Dependencies | Evidence |
|---|---|---|---|---|---|---|---|
| T1 | Make org resolution strict | P0 | Complete | Backend | 2026-04-24 |  | `pytest tests/test_tenancy.py` passed; strict org fallback removed from runtime path |
| T2 | Harden org-aware permission checks | P0 | Complete | Backend | 2026-04-28 | T1 | `pytest tests/test_permissions.py` passed; access now requires matching org context |
| T3 | Remove fail-open paths in main app | P0 | Complete | Backend | 2026-04-30 | T1, T2 | `pytest tests/test_main_tenancy.py` passed; main client routes now fail closed on missing org context |
| T4 | Audit tenant-scoped schema coverage | P0 | Complete | Platform | 2026-05-05 |  | `Files: api/job_report_routes.py, api/report_template_routes.py, core/migrations.py, sql_migrations/0037_job_report_tenant_columns.sql, tests/test_report_tenancy.py; tests: pytest tests/test_report_tenancy.py and pytest tests/test_tenancy.py tests/test_permissions.py tests/test_main_tenancy.py tests/test_report_tenancy.py passed; report schema now carries org_id through version, draft, variable, and assignment paths` |
| T5 | Add tenant-aware RLS policies | P0 | Complete | Platform | 2026-05-08 | T4 | `Files: services/tenancy.py, api/auth.py, core/database.py, sql_migrations/0038_tenant_rls_org_policies.sql, tests/test_tenant_session_context.py; tests: pytest tests/test_tenant_session_context.py tests/test_report_tenancy.py and pytest tests/test_tenancy.py tests/test_permissions.py tests/test_main_tenancy.py tests/test_report_tenancy.py tests/test_tenant_session_context.py passed; app now stamps app.current_org_id into the DB session and tenant-aware RLS policies gate org-scoped tables` |
| T6 | Force RLS where needed | P0 | Complete | Platform | 2026-05-11 | T5 | `Files: sql_migrations/0039_force_rls_org_scoped_tables.sql, tests/test_rls_migration.py; tests: pytest tests/test_rls_migration.py tests/test_tenant_session_context.py tests/test_report_tenancy.py and pytest tests/test_tenancy.py tests/test_permissions.py tests/test_main_tenancy.py tests/test_report_tenancy.py tests/test_tenant_session_context.py tests/test_rls_migration.py passed; org-scoped tables now get FORCE ROW LEVEL SECURITY` |
| T7 | Add cross-tenant regression tests | P0 | Complete | QA | 2026-05-15 | T1, T2, T4, T5 | `Files: tests/test_cross_tenant_regression.py; tests: pytest tests/test_cross_tenant_regression.py and pytest tests/test_tenancy.py tests/test_permissions.py tests/test_main_tenancy.py tests/test_report_tenancy.py tests/test_tenant_session_context.py tests/test_rls_migration.py tests/test_cross_tenant_regression.py passed; quote, time, and org-scoped lookup paths now have collision-focused regression coverage` |
| T8 | Add org lifecycle APIs | P1 | Complete | Backend | 2026-05-20 | T1, T2, T4 | `Files: api/admin_routes.py, core/migrations.py, sql_migrations/0034_tenancy_bootstrap.sql, sql_migrations/0040_organisation_memberships.sql, tests/test_org_lifecycle.py; tests: pytest tests/test_org_lifecycle.py and pytest tests/test_tenancy.py tests/test_permissions.py tests/test_main_tenancy.py tests/test_report_tenancy.py tests/test_tenant_session_context.py tests/test_rls_migration.py tests/test_cross_tenant_regression.py tests/test_org_lifecycle.py passed; org CRUD, invite, accept, switch, and membership tracking are now API-backed` |
| T9 | Add organisation admin UI | P1 | Complete | Frontend | 2026-05-27 | T8 | `Files: frontend/src/app/admin/organisations/page.tsx, frontend/src/app/admin/page.tsx, frontend/src/components/MainNav.tsx; tests: npm run build in frontend passed; organisations page now supports create, edit, invite, switch, and current-org visibility` |
| T10 | Make background jobs tenant-safe | P1 | Complete | Backend | 2026-05-21 | T1, T2, T4 | `Files: api/pdf_generation_routes.py, api/job_report_routes.py, services/pdf_generation_queue.py, services/pdf_generation_tasks.py, tests/test_pdf_tenancy.py; tests: python -m pytest tests/test_pdf_tenancy.py and python -m pytest tests/test_tenancy.py tests/test_permissions.py tests/test_main_tenancy.py tests/test_report_tenancy.py tests/test_tenant_session_context.py tests/test_rls_migration.py tests/test_cross_tenant_regression.py tests/test_org_lifecycle.py passed; PDF queue and worker now require and propagate org context end to end` |
| T11 | Remove legacy runtime fallback branches | P2 | Complete | Backend | 2026-05-22 | T7 | `Files: services/tenancy.py, api/main.py, api/business_development_routes.py, tests/test_tenancy.py, tests/test_main_tenancy.py; tests: python -m pytest tests/test_tenancy.py tests/test_main_tenancy.py and python -m pytest tests/test_tenancy.py tests/test_permissions.py tests/test_main_tenancy.py tests/test_report_tenancy.py tests/test_tenant_session_context.py tests/test_rls_migration.py tests/test_cross_tenant_regression.py tests/test_org_lifecycle.py tests/test_pdf_tenancy.py passed; legacy runtime fallback branches are removed from normal request and leadgen paths` |
| T12 | Add tenant observability | P2 | Complete | Platform | 2026-05-29 | T1, T2, T8, T10 | `Files: services/tenancy.py, api/admin_routes.py, tests/test_tenant_observability.py; tests: python -m pytest tests/test_tenant_observability.py tests/test_tenancy.py tests/test_main_tenancy.py and python -m pytest tests/test_tenancy.py tests/test_permissions.py tests/test_main_tenancy.py tests/test_report_tenancy.py tests/test_tenant_session_context.py tests/test_rls_migration.py tests/test_cross_tenant_regression.py tests/test_org_lifecycle.py tests/test_pdf_tenancy.py tests/test_tenant_observability.py passed; org lifecycle actions now emit audit events and tenant resolution failures log warnings` |

## Launch Gate

All of the following must be true before we mark the platform as true multi-tenant SaaS ready:

- Cross-tenant access is blocked in app code and at the database layer.
- Every tenant-scoped table has `org_id` and the expected indexes.
- Org creation, invites, switching, and limits work in the UI.
- Cross-tenant regression tests pass.
- Background jobs always run with explicit org context.
- Legacy fallback is removed from the normal runtime path.

## Update Rule

When we agree a ticket is finished, update its `Status` to `Complete` and add a short note with the evidence, such as:

- file(s) changed
- tests run
- any remaining caveats

If you want a consistent evidence format, use one of these:

- `PR #123 merged; pytest passed; smoke test clean`
- `Files: api/main.py, services/permissions.py; tests: tenant_access tests`
- `Schema verified in production; migration 0034 applied; no console errors`
