# Tenancy Stage 3 Tracker

Use this file as the living checklist for the next phase of multi-tenant architecture:

- stage 1 = safe tenant isolation, org-aware APIs, RLS, and legacy compatibility
- stage 2 = tenant-native product features, roles, billing, lifecycle, and cleanup
- stage 3 = enterprise readiness, governance, monetisation, and long-term operability

## Status Legend

- `Not started`
- `In progress`
- `Blocked`
- `Complete`

## Tracker

| ID | Ticket | Priority | Status | Owner | Due date | Dependencies | Evidence |
|---|---|---|---|---|---|---|---|
| S3-1 | Finalise tenant role hierarchy and delegated admin model | P0 | Complete | You | 2026-07-24 | S2-2, S2-3 | `Files: api/admin_routes.py, frontend/src/app/admin/organisations/page.tsx, tests/test_org_roles.py, tests/test_stage2_regressions.py; tests: python -m pytest tests/test_org_roles.py tests/test_stage2_regressions.py tests/test_org_lifecycle.py tests/test_auth_routes.py, python -m pytest tests/test_main_tenancy.py tests/test_permissions.py tests/test_business_development_limits.py tests/test_pdf_tenancy.py tests/test_tenant_observability.py, npm run build; notes: owner/admin/billing/member/consultant capabilities are now explicit, and only owners can transfer ownership` |
| S3-2 | Add subscription and entitlement source of truth | P0 | Complete | You | 2026-07-31 | S2-4 | `Files: api/admin_routes.py, frontend/src/app/admin/organisations/page.tsx, tests/test_org_entitlements.py, tests/test_org_roles.py, tests/test_stage2_regressions.py, tests/test_org_lifecycle.py, tests/test_tenant_observability.py, tests/test_main_tenancy.py, tests/test_business_development_limits.py; tests: python -m pytest tests/test_main_tenancy.py tests/test_permissions.py tests/test_business_development_limits.py tests/test_pdf_tenancy.py tests/test_tenant_observability.py tests/test_stage2_regressions.py tests/test_org_entitlements.py tests/test_org_roles.py tests/test_org_lifecycle.py tests/test_auth_routes.py, python -m py_compile api/admin_routes.py tests/test_org_entitlements.py tests/test_main_tenancy.py tests/test_business_development_limits.py tests/test_stage2_regressions.py tests/test_tenant_observability.py tests/test_org_roles.py tests/test_org_lifecycle.py tests/test_auth_routes.py, npm run build; notes: organisation_entitlements is now the source of truth for plan, status, and limits, with organisations backfilled and the admin UI showing entitlement state` |
| S3-3 | Enforce plan limits in all tenant-scoped product flows | P0 | Complete | You | 2026-07-31 | S3-2 | `Files: api/admin_routes.py, api/main.py, api/quotes_routes.py, api/business_development_routes.py, tests/test_stage3_limits.py; tests: python -m pytest tests/test_stage3_limits.py tests/test_main_tenancy.py tests/test_business_development_limits.py tests/test_stage2_regressions.py tests/test_tenant_observability.py tests/test_org_entitlements.py tests/test_org_roles.py tests/test_org_lifecycle.py tests/test_auth_routes.py, python -m pytest tests/test_main_tenancy.py tests/test_permissions.py tests/test_business_development_limits.py tests/test_pdf_tenancy.py tests/test_tenant_observability.py tests/test_stage2_regressions.py tests/test_org_entitlements.py tests/test_org_roles.py tests/test_org_lifecycle.py tests/test_auth_routes.py, python -m py_compile api/admin_routes.py api/main.py api/quotes_routes.py api/business_development_routes.py tests/test_stage3_limits.py, npm run build; notes: active/trial entitlement gating now applies to job, quote, invoice, and job-from-opportunity creation paths` |
| S3-4 | Add org billing, invoices, and payment lifecycle | P1 | Complete | You | 2026-08-07 | S3-2, S3-3 | `Files: api/admin_routes.py, frontend/src/app/admin/organisations/page.tsx, tests/test_org_billing.py; tests: python -m pytest tests/test_org_billing.py tests/test_org_lifecycle.py tests/test_org_entitlements.py tests/test_org_roles.py tests/test_stage3_limits.py tests/test_stage2_regressions.py tests/test_tenant_observability.py tests/test_auth_routes.py; notes: organisation_billing_invoices and organisation_billing_events now provide the org billing ledger, with invoice, payment, and lifecycle event history visible from the admin organisations screen` |
| S3-5 | Expand audit trails and exportable tenant activity logs | P1 | Complete | You | 2026-08-07 | S2-6 | `Files: services/audit_log.py, api/admin_routes.py, frontend/src/app/admin/audit-log/page.tsx, tests/test_audit_export.py; tests: python -m pytest tests/test_audit_export.py tests/test_org_billing.py tests/test_org_lifecycle.py tests/test_org_entitlements.py tests/test_org_roles.py tests/test_stage3_limits.py tests/test_stage2_regressions.py tests/test_tenant_observability.py tests/test_auth_routes.py, npm run build; notes: audit_log now stores org_id, the admin audit log can filter and export by organisation, and CSV exports include tenant context` |
| S3-6 | Make every async worker carry immutable org context | P1 | Complete | You | 2026-08-14 | S2-5, S2-8 | `Files: services/tenancy.py, services/pdf_generation_tasks.py, api/admin_routes.py, api/client_dashboard_routes.py, tests/test_pdf_tenancy.py, tests/test_worker_org_context.py; tests: python -m py_compile services/tenancy.py services/pdf_generation_tasks.py api/admin_routes.py api/client_dashboard_routes.py tests/test_pdf_tenancy.py tests/test_worker_org_context.py, python -m pytest tests/test_worker_org_context.py tests/test_pdf_tenancy.py tests/test_auth_routes.py tests/test_main_tenancy.py tests/test_tenant_observability.py tests/test_org_roles.py tests/test_org_entitlements.py tests/test_org_lifecycle.py tests/test_org_billing.py tests/test_stage2_regressions.py tests/test_stage3_limits.py tests/test_audit_export.py; notes: worker and threadpool entry points now bind the org context explicitly and restore the previous context after execution` |
| S3-7 | Add org switching, support, and delegated access UX polish | P1 | Complete | You | 2026-08-14 | S2-7, S3-1 | `Files: api/auth_routes.py, frontend/src/components/MainNav.tsx, frontend/src/app/support/page.tsx, tests/test_auth_routes.py; tests: python -m py_compile api/auth_routes.py tests/test_auth_routes.py, python -m pytest tests/test_auth_routes.py tests/test_stage2_regressions.py tests/test_worker_org_context.py tests/test_pdf_tenancy.py, npm run build; notes: /auth/me now includes current-org role context, the help page shows current org and delegated-access guidance, and the org switch / management surfaces are clearer in the top nav and support area` |
| S3-8 | Add tenant-admin and billing regression coverage | P1 | Complete | You | 2026-08-21 | S3-1, S3-2, S3-3, S3-4, S3-5, S3-6, S3-7 | `Files: tests/test_stage3_regressions.py; tests: python -m pytest tests/test_stage3_regressions.py tests/test_auth_routes.py tests/test_org_billing.py tests/test_org_lifecycle.py, python -m pytest tests/test_main_tenancy.py tests/test_permissions.py tests/test_business_development_limits.py tests/test_pdf_tenancy.py tests/test_tenant_observability.py tests/test_org_entitlements.py tests/test_org_roles.py tests/test_stage2_regressions.py tests/test_stage3_limits.py tests/test_audit_export.py tests/test_worker_org_context.py; notes: stage 3 tenant-admin regression coverage now protects role-bearing current-org summaries, org switching audit flow, and billing ledger scoping` |
| S3-9 | Remove remaining legacy operational fallback paths | P2 | Complete | You | 2026-08-21 | S3-1, S3-6, S3-8 | `Files: api/main.py, api/admin_routes.py, api/business_development_routes.py, services/tenancy.py, tests/test_stage3_regressions.py; tests: python -m pytest tests/test_stage3_regressions.py tests/test_auth_routes.py tests/test_org_billing.py tests/test_org_lifecycle.py, python -m pytest tests/test_main_tenancy.py tests/test_permissions.py tests/test_business_development_limits.py tests/test_pdf_tenancy.py tests/test_tenant_observability.py tests/test_org_entitlements.py tests/test_org_roles.py tests/test_stage2_regressions.py tests/test_stage3_limits.py tests/test_audit_export.py tests/test_worker_org_context.py; notes: removed the remaining default-org runtime backfill helper and replaced lookup seeding with explicit current-org context` |

## Suggested Order

1. S3-1: tenant role hierarchy and delegated admin model
2. S3-2: subscription and entitlement source of truth
3. S3-3: plan limits in product flows
4. S3-4: org billing and invoices
5. S3-5: audit trails and activity logs
6. S3-6: immutable org context in async work
7. S3-7: org switching and support UX
8. S3-8: regression coverage
9. S3-9: remove legacy fallback paths

## Update Rule

When we agree a ticket is finished, update its `Status` to `Complete` and add a short note in `Evidence`, such as:

- file(s) changed
- tests run
- any remaining caveats

## Evidence Format

Use a short, consistent evidence note so the tracker stays easy to scan.

Recommended format:

`Files: <file(s)>; tests: <test(s)>; notes: <brief caveat or confirmation>`

## Ownership Note

The `Owner` column is set to you for the time being. Once you’re comfortable with how the pieces fit together, we can split out implementation owners or add a separate `Implementation Owner` column without disturbing the tracker structure.

You are the business owner for the stage 3 tenancy work for now, and we can delegate specific implementation roles later when you decide how you want the team structured.
