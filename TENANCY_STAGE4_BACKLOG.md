# Tenancy Stage 4 Tracker

Use this file as the living checklist for the next hardening phase after multi-tenant rollout:

- stage 1 = safe tenant isolation, org-aware APIs, RLS, and legacy compatibility
- stage 2 = tenant-native product features, roles, billing, lifecycle, and cleanup
- stage 3 = enterprise readiness, governance, monetisation, and long-term operability
- stage 4 = platform hardening, auth modernization, and removal of remaining compatibility bridges

## Status Legend

- `Not started`
- `In progress`
- `Blocked`
- `Complete`

## Tracker

| ID | Ticket | Priority | Status | Owner | Due date | Dependencies | Evidence |
|---|---|---|---|---|---|---|---|
| S4-1 | Modernise auth to a single primary session model | P0 | Complete | You | 2026-09-04 | S3-7, S3-8, S3-9 | Files: `frontend/src/lib/auth-client.ts`, `frontend/src/components/MainNav.tsx`; tests: `npm run build`; notes: bearer token is now the primary client session path and the displayed user label is sourced from `/auth/me` |
| S4-2 | Remove remaining browser-cookie and X-User compatibility bridges | P0 | Not started | You | 2026-09-04 | S4-1 |  |
| S4-3 | Replace deprecated startup and query patterns with current framework APIs | P1 | Not started | You | 2026-09-11 | S4-1 |  |
| S4-4 | Audit and document remaining safe fallback paths outside tenancy | P1 | Not started | You | 2026-09-11 | S3-9 |  |
| S4-5 | Add regression coverage for strict auth and session flows | P0 | Not started | You | 2026-09-11 | S4-1, S4-2 |  |

## Suggested Order

1. S4-1: modernise auth to a single primary session model
2. S4-2: remove remaining browser-cookie and X-User compatibility bridges
3. S4-5: add strict auth and session regression coverage
4. S4-3: replace deprecated startup and query patterns
5. S4-4: audit and document remaining non-tenancy fallback paths

## Update Rule

When we agree a ticket is finished, update its `Status` to `Complete` and add a short note in `Evidence`, such as:

- file(s) changed
- tests run
- any remaining caveats
