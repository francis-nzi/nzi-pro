# Clean WFM Rebuild Runbook

This runbook is for creating a clean replacement environment, preserving system configuration, and then re-importing business data in a controlled order.

Do not use this as an in-place production cleanup plan. The safer approach is:

1. keep the current production environment as the archive/reference system
2. clone to a new environment
3. reset only the new environment
4. re-import and validate
5. cut over once the new environment is proven

## Preserve vs Reset

Preserve:
- `users`
- `roles_lookup`
- `system_settings`
- `job_templates`
- `milestone_templates`
- `report_templates`
- `report_template_variables`
- `custom_field_definitions`
- lookup/reference tables such as currencies, VAT, job types/items, portfolios, payment terms

Reset:
- clients, jobs, and dependent data
- spend rows and spend mappings
- scope rows / emissions rows
- datasets and factor rows
- old CRM / BD activity tied to test clients/jobs
- quotes / invoices / other costs if they are test data

## Files Added For This Process

- Reset SQL:
  [9001_reset_business_data_for_clean_wfm_reload.sql](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/sql_migrations/9001_reset_business_data_for_clean_wfm_reload.sql)

## Recommended Execution Order

### 1. Snapshot the current production environment

Take:
- a full Postgres backup/dump
- a copy of current Render environment variables
- a record of current template files
- a record of SharePoint / job-file storage structure

Optional but recommended:
- export current datasets as CSV
- export imported clients/jobs from the current WFM admin tools

### 2. Create the replacement Render environment

Create:
- a fresh Render Postgres database
- a new API service
- a new web service

Point the new services to the new database and copy the required environment variables.

### 3. Run migrations in the new environment

Before any reset/import:
- deploy the current codebase
- confirm the app boots
- sign in as admin
- check that core admin pages load

### 4. Run the reset SQL against the new database

Run:
- [9001_reset_business_data_for_clean_wfm_reload.sql](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/sql_migrations/9001_reset_business_data_for_clean_wfm_reload.sql)

Expected result:
- users and configuration remain
- clients/jobs/datasets and dependent business data are cleared

Quick verification queries:

```sql
SELECT COUNT(*) AS clients FROM clients;
SELECT COUNT(*) AS jobs FROM jobs;
SELECT COUNT(*) AS datasets FROM datasets;
SELECT COUNT(*) AS factor_rows FROM factor_lookup;
SELECT COUNT(*) AS users FROM users;
SELECT COUNT(*) AS custom_field_definitions FROM custom_field_definitions;
```

### 5. Load fresh datasets first

Do this before WFM imports.

Reason:
- upload templates and mapping features depend on the factor layer
- the spend template `Spend Conversions` tab is generated dynamically from spend factors in `factor_lookup`

Recommended order:
1. upload core activity datasets
2. upload spend datasets
3. upload UAE / other regional datasets
4. validate factor search and template downloads

### 6. Validate templates

Check:
- job data upload template downloads
- spend template downloads
- spend conversions list content
- selected reporting-period behavior

Only move on once templates are correct.

### 7. Import WFM clients

Run a small sample first:
- 3 to 5 known clients

Validate:
- client names
- sites
- contacts
- custom fields
- CRM ownership
- SIC / benchmark / currency fields where relevant

Then run the broader client import.

### 8. Import WFM jobs

Again, start with a small sample.

Validate:
- job numbering
- job-client links
- reporting periods
- start/due dates
- milestone template assignments
- job template assignments
- mapped custom fields

Then run the broader job import.

### 9. Post-import checks

Check:
- sample clients and jobs open correctly
- data upload templates download correctly
- spend workflow works
- files upload to SharePoint / OneDrive correctly
- reporting screens load without orphaned references

### 10. Cutover

Once validated:
- update Render/custom domain routing if needed
- communicate freeze/cutover window
- switch users to the new environment
- keep old production read-only/reference for a short period

## Notes

### Spend template source

The spend upload template is not a static workbook file. It is generated dynamically in:

- [spend_data_routes.py](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/api/spend_data_routes.py)

The `Spend Conversions` sheet is populated from `factor_lookup` rows where `original_id` starts with `SPEND`.

That means:
- dataset uploads should happen before spend template review
- if the conversions tab needs changing, either the spend factors or generator logic must be updated

### Safety reminder

Do not run the reset SQL against the current production database unless you explicitly decide to destroy that data and have verified backups.
