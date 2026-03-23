# Attribute Override Cheat Sheet

Use `attribute_override_template.xlsx` to bulk update existing clients and jobs.

## Core Rule

Each updatable field has:

- a value column, for example `sic_code`
- a clear column, for example `clear_sic_code`

How they work:

- Value blank + clear blank: leave unchanged
- Value filled + clear blank: set/update value
- Value blank + clear `TRUE`: clear the existing value
- Value filled + clear `TRUE`: invalid, the importer will warn and skip that field

Accepted clear values:

- `TRUE`
- `1`
- `yes`
- `y`
- `on`

## Matching Records

### Clients sheet

Use one of these to identify the client:

- `client_db_id`
- `wfm_client_id`
- `client_name`

If `match_by` is blank, the importer uses the first populated match column.

### Jobs sheet

Use one of these to identify the job:

- `job_id`
- `wfm_job_id`
- `job_number`

If `match_by` is blank, the importer uses the first populated match column.

## Client Fields You Can Update

- `industry`
- `crm_owner`
- `benchmark_period_start`
- `benchmark_period_end`
- `benchmark_year`
- `company_reg`
- `sic_code`
- `year_end_month`
- `currency`
- `description_long`
- `net_zero_year`

### Client Clear Columns

- `clear_industry`
- `clear_crm_owner`
- `clear_benchmark_period_start`
- `clear_benchmark_period_end`
- `clear_benchmark_year`
- `clear_company_reg`
- `clear_sic_code`
- `clear_year_end_month`
- `clear_currency`
- `clear_description_long`
- `clear_net_zero_year`

## Job Fields You Can Update

- `crm_name`
- `reporting_period_start`
- `reporting_period_end`
- `baseline_year`
- `title`
- `status`
- `start_date`
- `due_date`

### Job Clear Columns

- `clear_crm_name`
- `clear_reporting_period_start`
- `clear_reporting_period_end`
- `clear_baseline_year`
- `clear_title`
- `clear_status`
- `clear_start_date`
- `clear_due_date`

## Date Format

Recommended format:

- `YYYY-MM-DD`

Also accepted by the importer:

- `DD/MM/YYYY`
- `DD-MM-YYYY`
- `YYYY/MM/DD`
- `DD.MM.YYYY`

## Examples

### Update SIC code

- `client_db_id` = `18`
- `sic_code` = `62012`
- `clear_sic_code` = blank

### Clear company registration number

- `client_db_id` = `18`
- `company_reg` = blank
- `clear_company_reg` = `TRUE`

### Leave benchmark end unchanged

- `client_db_id` = `18`
- `benchmark_period_end` = blank
- `clear_benchmark_period_end` = blank

### Update a job due date

- `job_number` = `J000547`
- `due_date` = `2026-04-30`
- `clear_due_date` = blank

## Important Notes

- Blank cells do not clear values
- Only use `clear_<field>` when you want to remove an existing value
- Do not set a value and clear the same field in the same row
- `job_name` in the jobs sheet is reference-only and ignored by the importer
- Preview before commit whenever possible
