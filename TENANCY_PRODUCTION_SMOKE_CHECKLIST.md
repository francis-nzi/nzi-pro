# Production Tenancy Smoke Test Checklist

Use this checklist after a deploy to confirm the live multi-tenant system is behaving correctly.

## Goal

Verify that:
- each org sees only its own data
- org switching works
- auth does not loop
- the main tenant workflows still function end to end

## Test Data

Use two real orgs and at least two users:
- Org A: your primary org
- Org B: a separate org with different clients/jobs
- User A: owner/admin on Org A
- User B: member/admin on Org B

## Before You Start

- Confirm the latest deploy is live.
- Open a private/incognito window.
- Make sure browser cache is disabled for the test, if possible.
- Keep a second tab open for the admin screens.

## Smoke Steps

### 1. Login and org resolution

- Sign in as User A.
- Confirm the top nav shows the correct current org.
- Confirm there is no redirect loop between login and the app.
- Confirm Admin is visible in the top nav if the user should see it.

Pass criteria:
- The app loads once and stays on the target page.
- The org shown in the header matches the account you used.

### 2. Org switch

- Open the org switcher.
- Switch from Org A to Org B.
- Confirm the visible org changes.
- Refresh the page.
- Confirm the org stays on Org B after refresh.

Pass criteria:
- Switching works without logout.
- Refresh does not revert to the previous org.

### 3. Client isolation

- Open a client that belongs to Org A.
- Confirm the client dashboard loads.
- Note the key values shown on the dashboard.
- Switch to Org B.
- Open a client that belongs to Org B.
- Confirm the data differs appropriately.

Pass criteria:
- No Org A client is visible inside Org B.
- No Org B client is visible inside Org A.
- Client data matches the selected org.

### 4. Jobs page

- Open the Jobs area for a client in Org A.
- Confirm the job list loads.
- Open a job detail page.
- Confirm emissions figures load.
- Compare the list total and job total visually.

Pass criteria:
- Job pages load without errors.
- The job list and job detail totals are consistent.

### 5. Reporting

- Open reporting for a client in Org A.
- Confirm the report page loads.
- Change the reporting year if the selector is present.
- Refresh the page.
- Confirm the selected year or section state persists if the URL supports it.

Pass criteria:
- Reporting loads without blank sections.
- Year selection works.

### 6. PDF queue

- Open the background jobs admin page.
- Confirm the queue summary loads.
- If there is a failed or canceled job, try the replay action only on a safe test item.

Pass criteria:
- Queue counts render.
- No tenant mismatch appears in the queue data.

### 7. Support diagnostics

- Open the support diagnostics page.
- Confirm the current user and org are shown.
- Confirm the database/session context looks correct.

Pass criteria:
- Diagnostics match the org you selected.
- No unexpected null or fallback org is shown.

### 8. Admin screens

- Open the organisations admin page.
- Confirm the current org and membership data load.
- Open archive, import/export, and billing-related admin pages if available.

Pass criteria:
- Admin pages open without 403 loops.
- The data shown belongs to the current org.

## Quick Failure Signals

Stop and investigate immediately if you see:
- repeated redirects between login and the app
- empty dashboards for an org that should have data
- cross-org data appearing in any list or chart
- 403s on pages you should be able to open
- the org selector resetting after refresh

## Suggested Evidence To Capture

For each pass, capture:
- the org name
- the user name
- the page URL
- a screenshot of the page
- any console or network errors

## Exit Criteria

You can treat the deployment as smoke-tested if:
- both orgs are isolated correctly
- refresh preserves the selected org
- the key client and job pages load
- admin and diagnostics pages work
- no auth loops or 403 bursts appear

