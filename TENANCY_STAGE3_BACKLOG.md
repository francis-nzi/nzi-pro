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
| S3-4 | Add org billing, invoices, and payment lifecycle | P1 | Not started | You | 2026-08-07 | S3-2, S3-3 |  |
| S3-5 | Expand audit trails and exportable tenant activity logs | P1 | Not started | You | 2026-08-07 | S2-6 |  |
| S3-6 | Make every async worker carry immutable org context | P1 | Not started | You | 2026-08-14 | S2-5, S2-8 |  |
| S3-7 | Add org switching, support, and delegated access UX polish | P1 | Not started | You | 2026-08-14 | S2-7, S3-1 |  |
| S3-8 | Add tenant-admin and billing regression coverage | P1 | Not started | You | 2026-08-21 | S3-1, S3-2, S3-3, S3-4, S3-5, S3-6, S3-7 |  |
| S3-9 | Remove remaining legacy operational fallback paths | P2 | Not started | You | 2026-08-21 | S3-1, S3-6, S3-8 |  |

## Suggested Order

1. S3-1: tenant role hierarchy and delegated admin model
2. S3-2: subscription and entitlement source of truth
3. S3-3: plan limits in product flows
4. S3-4: org billing and invoices
5. S3-5: audit trails and activity logs
6. S3-6: immutable org context in async work
7. S3-7: org switching and support UX
8. S3-8: regression coverage
9. S3-9: remove legacy operational fallback paths

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
