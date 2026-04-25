# Tenant Usage Dashboard Checklist

This ticket creates a single admin view that shows how each organisation is operating in production.

The goal is to help support, billing, and ops answer:

- which orgs are near capacity
- which orgs are active or archived
- which orgs are generating recent activity
- where the system is under load

## Goal

Build a lightweight tenant usage dashboard that exposes the most useful operational signals in one place.

## Scope

The dashboard should surface:

- active users vs limit
- active clients vs limit
- pending invites
- archived vs active organisations
- recent membership changes
- recent background job activity
- recent org-level warnings or errors if available

## Checklist

### 1. Define the data shape

- Choose a compact API response for the dashboard.
- Include enough data to support a table or card grid without additional round trips.
- Reuse existing org usage and entitlement data rather than inventing new counters.

### 2. Reuse existing backend sources

- Pull org usage from the existing organisations list or usage helper.
- Pull membership and invite counts from the existing admin/org routes.
- Pull audit activity from the audit log or recent event history.
- Pull queue health or background job status from the existing job monitor endpoints.

### 3. Add a dedicated admin page

- Create a new page under `frontend/src/app/admin/`.
- Give it a simple operational layout:
  - summary cards at the top
  - an org table underneath
  - optional filters for active/archived/over-limit orgs
- Keep the page fast and easy to scan.

### 4. Add per-org visibility

- Show one row per organisation.
- Include at least:
  - org name
  - plan / subscription state
  - active users
  - user limit
  - active clients
  - client limit
  - pending invites
  - archive status
- Highlight rows that are near or over a limit.

### 5. Add useful drill-down actions

- Link each row to:
  - organisations management
  - billing and entitlements
  - support diagnostics
- Optionally add a detail drawer or side panel for the selected org.

### 6. Make the page useful for support

- Add a quick filter for:
  - active orgs
  - archived orgs
  - over-limit orgs
  - orgs with recent errors
- Add a search box for org name or slug.

### 7. Keep it lightweight

- Avoid loading heavy per-org detail by default.
- Prefer a summary-first view.
- Lazy-load drill-down detail only when a row is selected.

### 8. Add regression coverage

- Add a backend test for the dashboard response shape.
- Add a frontend route/build check if the page is mostly client-side.
- Ensure the dashboard respects tenant scoping and does not leak data across orgs.

### 9. Verify the operator workflow

- Confirm an admin can answer these questions in under a minute:
  - Which orgs are near user/client limits?
  - Which orgs are archived?
  - Which orgs have recent membership activity?
  - Which orgs have recent job failures?

## Acceptance Criteria

- Admins can see organisation health and capacity at a glance.
- The dashboard loads quickly and does not require opening each org individually.
- The page uses existing data sources instead of duplicating logic.
- The view is useful for both support and billing workflows.

## Stop Conditions

Pause before merging if:

- the dashboard requires multiple extra API calls per org on initial load
- the page becomes another copy of the organisations admin screen
- the data shown is not clearly operational
- the view leaks any tenant data between organisations

