# Production Tenancy Smoke Runbook

Use this after a deploy to confirm the live multi-tenant system is healthy.

## Purpose

Confirm that:
- org selection is correct
- refresh preserves the selected org
- client and job data stay isolated by org
- admin and diagnostics pages still work
- there is no login redirect loop or 403 burst

## What You Need

- Two orgs with different data
- At least one admin user for each org
- A private/incognito browser window

## Run It In This Order

### 1. Login

- Sign in as an org admin.
- Confirm the app opens once and does not bounce back to login.
- Confirm the org in the header matches the account.
- Confirm `Admin` appears in the top nav if the user should see it.

Pass:
- No redirect loop
- Correct org shown

### 2. Switch Org

- Open the org switcher.
- Switch to the second org.
- Refresh the page.
- Confirm the same org remains selected.

Pass:
- Switch works
- Refresh does not revert the org

### 3. Check Client Isolation

- Open a client in Org A.
- Confirm the dashboard loads.
- Open a client in Org B.
- Confirm the content differs and belongs to Org B.

Pass:
- No cross-org client data
- Dashboard shows the right org’s data

### 4. Check Jobs and Emissions

- Open a client job in Org A.
- Confirm the job list and job detail emissions match.
- Open a client job in Org B.
- Confirm the same behavior there.

Pass:
- Job pages load
- Emissions values look consistent

### 5. Check Admin and Support

- Open the organisations admin page.
- Open the archive or import/export page if relevant.
- Open the support diagnostics page.

Pass:
- Pages load without 403 loops
- Diagnostics show the expected user and org

## Stop Conditions

Stop immediately if you see:
- repeated login/app redirects
- 403s on pages you should be able to open
- empty dashboard data for a client that should have data
- data from the wrong org
- org selection resetting after refresh

## Capture Evidence

For each pass, note:
- org name
- user name
- page URL
- screenshot
- console or network errors, if any

## Done

Treat the deploy as smoke-tested when:
- both orgs are isolated correctly
- refresh keeps the chosen org
- client, job, admin, and support pages open normally
- there are no auth loops or cross-org leaks

## Automated Check

Run the CI-friendly smoke test with:

```powershell
python -m pytest tests/test_tenancy_smoke.py -q
```

What it covers:
- org listing and switching
- support diagnostics
- client dashboard totals for two orgs
- client jobs totals for two orgs
- cross-org isolation in the happy path
