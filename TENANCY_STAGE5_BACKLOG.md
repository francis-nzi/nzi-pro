# Tenancy Stage 5 Tracker

Use this file as the living checklist for the next maturity phase after platform hardening:

- stage 1 = safe tenant isolation, org-aware APIs, RLS, and legacy compatibility
- stage 2 = tenant-native product features, roles, billing, lifecycle, and cleanup
- stage 3 = enterprise readiness, governance, monetisation, and long-term operability
- stage 4 = platform hardening, auth modernization, and removal of remaining compatibility bridges
- stage 5 = operational scale, support tooling, resilience, and release confidence

## Status Legend

- `Not started`
- `In progress`
- `Blocked`
- `Complete`

## Tracker

| ID | Ticket | Priority | Status | Owner | Due date | Dependencies | Evidence |
|---|---|---|---|---|---|---|---|
| S5-1 | Build tenant support and diagnostics tooling | P0 | Complete | You | 2026-10-02 | S4-4 | Files: api/main.py, frontend/src/app/support/page.tsx, tests/test_support_diagnostics.py; tests: `python -m pytest tests/test_support_diagnostics.py tests/test_auth_routes.py`, `npm run build`; notes: added support diagnostics snapshot with current session, org, and database details. |
| S5-2 | Profile and tune the highest-cost tenant queries | P0 | Complete | You | 2026-10-02 | S4-4 | Files: api/main.py, api/client_dashboard_routes.py, core/migrations.py, tests/test_client_lookup_routes.py, tests/test_cross_tenant_regression.py, tests/test_tenant_query_indexes.py; tests: `python -m pytest tests/test_client_lookup_routes.py tests/test_cross_tenant_regression.py tests/test_tenant_query_indexes.py`, `python -m pytest tests/test_support_diagnostics.py tests/test_auth_routes.py`; notes: simplified tenant org predicates to avoid TRIM/CAST wrappers and added tenant-scoped indexes for client, job, time, and lookup queries. |
| S5-3 | Add data retention, archive, and purge controls | P1 | Complete | You | 2026-10-09 | S5-1 | Files: api/admin_routes.py, frontend/src/app/admin/archive/page.tsx, tests/test_archive_retention.py; tests: `python -m pytest tests/test_archive_retention.py tests/test_org_lifecycle.py tests/test_cross_tenant_regression.py tests/test_client_lookup_routes.py`, `python -m pytest tests/test_support_diagnostics.py tests/test_auth_routes.py`, `npm run build`; notes: added retention summary and purge controls for archived datasets and clients, with retention-day settings and dependency-aware bulk purge safeguards. |
| S5-4 | Add backup, restore, and disaster-recovery checks | P0 | Complete | You | 2026-10-09 | S5-1, S5-2 | Files: api/admin_routes.py, frontend/src/app/admin/import-export/page.tsx, tests/test_disaster_recovery.py; tests: `python -m pytest tests/test_disaster_recovery.py tests/test_org_lifecycle.py tests/test_cross_tenant_regression.py -q`, `npm run build`; notes: added DR backup snapshot capture, restore-check comparison, persisted status metadata, and a UI control panel for generating and validating snapshots. |
| S5-5 | Add background-job monitoring and replay tools | P0 | Complete | You | 2026-10-09 | S5-1, S5-2 | Files: api/admin_routes.py, frontend/src/app/admin/background-jobs/page.tsx, frontend/src/app/admin/page.tsx, tests/test_background_jobs.py; tests: `python -m pytest tests/test_background_jobs.py tests/test_pdf_tenancy.py -q`, `npm run build`; notes: added PDF queue monitoring, registry counts, recent job inspection, and safe replay for failed or canceled jobs. |
| S5-6 | Add API contract tests for key tenant workflows | P0 | Complete | You | 2026-10-16 | S4-5 | Files: tests/test_tenant_api_contracts.py; tests: `python -m pytest tests/test_tenant_api_contracts.py tests/test_org_lifecycle.py tests/test_main_tenancy.py -q`, `npm run build`; notes: added contract coverage for organisation create/invite/accept/switch plus tenant-scoped job and time-log creation response shapes. |
| S5-7 | Improve onboarding and in-app guidance for org users | P1 | Complete | You | 2026-10-16 | S5-1 | Files: frontend/src/app/support/page.tsx, frontend/src/app/admin/organisations/page.tsx; tests: `python -m pytest tests/test_support_diagnostics.py tests/test_org_lifecycle.py -q`, `npm run build`; notes: added a new-organisation checklist and clearer support guidance for switching organisations, inviting teammates, and starting the first client/job. |
| S5-8 | Final technical-debt sweep for scale readiness | P1 | Complete | You | 2026-10-16 | S4-3, S4-4 | Files: core/migrations.py, tests/test_tenant_query_indexes.py; tests: `python -m pytest tests/test_tenant_query_indexes.py tests/test_tenant_api_contracts.py -q`, `python -m pytest tests/test_org_lifecycle.py tests/test_main_tenancy.py -q`; notes: removed the legacy `job_report_variables_legacy_view` compatibility bridge from migrations and locked the migration test to the versioned report variable table path. |

## Suggested Order

1. S5-1: build tenant support and diagnostics tooling
2. S5-2: profile and tune the highest-cost tenant queries
3. S5-4: add backup, restore, and disaster-recovery checks
4. S5-5: add background-job monitoring and replay tools
5. S5-6: add API contract tests for key tenant workflows
6. S5-3: add data retention, archive, and purge controls
7. S5-7: improve onboarding and in-app guidance for org users
8. S5-8: final technical-debt sweep for scale readiness

## Update Rule

When we agree a ticket is finished, update its `Status` to `Complete` and add a short note in `Evidence`, such as:

- file(s) changed
- tests run
- any remaining caveats
