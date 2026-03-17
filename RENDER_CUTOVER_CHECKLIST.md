# Render Cutover Checklist

This checklist is for standing up a clean replacement NZI Pro environment on Render, loading fresh business data, validating it, and then cutting over safely.

Use this together with:

- [RESET_ENVIRONMENT_RUNBOOK.md](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/RESET_ENVIRONMENT_RUNBOOK.md)
- [9001_reset_business_data_for_clean_wfm_reload.sql](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/sql_migrations/9001_reset_business_data_for_clean_wfm_reload.sql)

## 1. Pre-cutover Backup

Before creating the replacement environment, take:

- full production database backup / dump
- copy of all Render environment variables for web and API
- list of active domains / DNS settings
- copy of current template files in the repo
- SharePoint / OneDrive storage confirmation for job files
- optional exports of current datasets, clients, jobs, and WFM imports

Record:

- current production web URL
- current production API URL
- current Render Postgres connection details
- current git commit hash in production

## 2. Create the New Render Stack

Create three new resources:

1. new Render Postgres database
2. new API web service
3. new frontend web service

Suggested naming:

- `nzi-pro-db-clean`
- `nzi-pro-api-clean`
- `nzi-pro-web-clean`

Keep the old production stack live and unchanged during this phase.

## 3. Configure the New API Service

Set the same essential environment variables as production, but point database-related values to the new Postgres instance.

Typical API variables to carry over:

- `DATABASE_URL`
- `JWT_SECRET` or equivalent auth secret
- `ENVIRONMENT`
- `CORS_ORIGINS`
- `MS_TENANT_ID`
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `MS_ONEDRIVE_SITE_HOST`
- `MS_ONEDRIVE_SITE_PATH`
- `MS_ONEDRIVE_ROOT_PATH`
- `SMTP_USER`
- `SMTP_PASS`
- any OpenAI / AI provider keys
- any WFM import path settings such as `WFM_RAW_DATA_DIR`

Important:

- confirm the new API service is using the new database
- confirm Microsoft 365 storage variables are present on the API service, not just the frontend

## 4. Configure the New Frontend Service

Carry over the frontend environment variables and point it to the new API URL.

Typical frontend variables:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_BACKEND_URL`
- any public auth/session variables used by the app

Important:

- make sure the frontend points to the new clean API service, not production

## 5. Initial Deploy

Deploy both services from the current `main` branch.

Verify:

- API starts successfully
- frontend loads
- login works
- admin area loads

Do not import data yet.

## 6. Run Schema Migrations

If the app runs migrations automatically on startup, verify they completed successfully.

If you run them manually, do that now before the reset script.

Verify that these categories exist:

- users/config tables
- templates tables
- custom fields tables
- jobs/clients tables
- datasets/factors tables
- spend tables
- job files tables

## 7. Run the Clean Reset SQL on the New Database

Run:

- [9001_reset_business_data_for_clean_wfm_reload.sql](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/sql_migrations/9001_reset_business_data_for_clean_wfm_reload.sql)

This should leave:

- users
- system settings
- templates
- custom field definitions
- lookup/reference tables

And clear:

- clients
- jobs
- spend data
- scope rows
- datasets
- factor rows
- CRM/BD activity

## 8. Smoke Test the Empty Clean Environment

Verify:

- login works
- admin pages load
- legal/help pages load
- template download endpoints do not error
- SharePoint storage health is still good

Quick checks:

- no clients
- no jobs
- no datasets
- users still exist

## 9. Import Fresh Datasets First

Load datasets before WFM import.

Recommended order:

1. core UK activity datasets
2. spend datasets
3. UAE / regional activity-and-spend datasets
4. any custom factors needed for launch

Validate:

- dataset upload works
- factor search works
- Spend template `Spend Conversions` tab looks correct
- Data Upload template downloads work

## 10. Validate Templates Before WFM Import

Check:

- job data upload template download
- spend template download
- filename format
- reporting period behavior
- spend conversion dropdown contents

Do template fixes now, before importing business data.

## 11. Run WFM Import in Two Passes

### Pass 1: Clients

Start with a small sample:

- 3 to 5 known clients

Validate:

- client names
- contacts
- sites
- benchmark dates
- SIC codes
- currencies
- custom field mappings

Then run the broader client import.

### Pass 2: Jobs

Start with a small sample:

- 5 to 10 jobs across known clients

Validate:

- client linkage
- reporting periods
- job template assignments
- milestone template assignments
- CRM owner values
- job/site behavior

Then run the broader job import.

## 12. Post-import Validation

Check a representative sample:

- open 5 clients
- open 10 jobs
- download templates
- upload a test file to SharePoint
- run spend workflow
- run data entry / data output views
- run one reporting workflow

If there are issues, fix them here before cutover.

## 13. Cutover Preparation

Before switching users:

- freeze admin changes in old production
- notify users of cutover window
- confirm the clean stack is on the intended git commit
- confirm backups exist
- confirm login works for at least one admin and one normal user

## 14. Cutover Options

### Option A: Swap Custom Domains

Use this if the current production environment is accessed through Render custom domains.

Steps:

1. detach domain from old web/api services if required
2. attach domain to new web/api services
3. update DNS if needed
4. verify SSL issuance
5. smoke test the live domain

### Option B: Promote New URLs First

Use this if you want a softer transition.

Steps:

1. share the new clean URLs internally
2. validate with a small admin/user group
3. switch domains once approved

## 15. Post-cutover

After cutover:

- keep old production read-only/reference if possible
- do not delete the old database immediately
- monitor:
  - login
  - job file uploads
  - WFM imports
  - template downloads
  - email sending

Recommended retention:

- keep old production for at least 2 to 4 weeks before decommissioning

## 16. Go / No-Go Checklist

Go live only if all are true:

- new API and frontend deploy cleanly
- new DB is confirmed in use
- reset SQL completed on new DB
- datasets loaded successfully
- WFM clients imported successfully
- WFM jobs imported successfully
- template downloads work
- SharePoint uploads work
- login works for admins and standard users
- backups of old production are verified

## 17. Suggested Render Execution Notes

When you actually do the cutover, record:

- old API URL
- old web URL
- new API URL
- new web URL
- old DB name
- new DB name
- production commit hash before cutover
- clean environment commit hash at cutover
- date and time of cutover
- who approved go-live
