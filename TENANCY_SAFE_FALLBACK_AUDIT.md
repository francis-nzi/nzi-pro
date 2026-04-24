# Safe Fallback Audit

This note documents fallback paths that remain on purpose after the tenancy hardening work.

The goal of this audit is to distinguish:
- **safe product fallbacks**: UI or provider resilience that does not weaken tenant or auth isolation
- **legacy compatibility bridges**: browser cookie, `X-User`, or other session shortcuts that should not remain in normal runtime paths

## Removed Compatibility Bridges

The following identity bridges were removed or neutralized in stage 4:
- Browser identity cookie forwarding
- `X-User` / `X-User-Email` request forwarding from the frontend
- Cookie-based session propagation through the Next proxy route
- Browser-side user identifier fallback in auth helpers

## Intentionally Kept Safe Fallbacks

These are kept because they improve resilience without bypassing tenant isolation:

- **Report workspace draft loading**
  - Files: `api/job_report_routes.py`, `api/report_template_routes.py`
  - Behavior: returns a minimal or empty payload if legacy report draft data is malformed or missing
  - Reason: prevents a broken legacy record from taking down the whole report screen

- **Client dashboard and notes resilience**
  - Files: `api/client_dashboard_routes.py`, `api/client_notes_routes.py`
  - Behavior: best-effort rendering when old rows or partial data are encountered
  - Reason: keeps a single malformed row from breaking the client page

- **Business development provider fallback**
  - Files: `api/business_development_routes.py`, `api/feedback_routes.py`
  - Behavior: provider fallbacks return empty results or alternate suggestions when a primary provider is unavailable
  - Reason: product continuity when a third-party API fails or returns no rows

- **Databank suggestions fallback**
  - File: `api/databank_routes.py`
  - Behavior: returns local fallback suggestions when the primary suggestion source is unavailable
  - Reason: keeps search and suggestion UX usable offline or under provider failure

- **PDF export fallback**
  - File: `frontend/src/components/LiveDataPDFExport.tsx`
  - Behavior: falls back from WebSocket to polling
  - Reason: keeps export progress visible if live sockets are unavailable

- **Suspense loading placeholders**
  - Files: `frontend/src/app/*`, `frontend/src/components/*`
  - Behavior: loading skeletons and placeholders during async renders
  - Reason: standard UI loading states, not data fallbacks

- **Legacy import workflows**
  - Files: `api/admin_routes.py`, `frontend/src/app/admin/import-export/page.tsx`
  - Behavior: explicit legacy annual import and cleanup paths remain available
  - Reason: these are migration tools, not runtime auth or tenant compatibility bridges

## Notes

- The remaining fallback paths above are acceptable because they do **not** change the active org, user identity, or access scope.
- Any new fallback introduced in auth, tenancy, or permissions should be treated as a release-blocking change unless it is explicitly a migration-only path.
