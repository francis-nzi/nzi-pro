# WorkflowMax Import (Current NZI Schema)

This folder now includes a schema-aware importer that works with the current NZI tables:
- `clients`
- `client_contacts`
- `jobs`
- `crp_job_details`
- `job_scope_rows` (synthetic imported scope totals when needed)

It is designed for safe trial imports first, then live import.

## What was changed

The previous routine targeted legacy/optional tables (`job_services`, `client_invoices`, etc.) and columns not present in the current database.  
The updated importer avoids those assumptions and imports core entities needed for immediate use.

## Import script

`wfm_import/wfm_import_routine.py`

Features:
- Dry-run mode (default)
- Trial filtering by client IDs, client names, job numbers, or max client count
- Cleans WFM formula-style values such as `="1500"`
- Idempotent mapping via:
  - `wfm_import_map` (created automatically)
  - `wfm_import_audit` (created automatically)
- Upsert behavior using WFM map + natural keys (`client_name`, `job_number`, client+email contact)
- Job-level mapping from WFM custom fields:
  - `Report From` / `Report To` -> job reporting period
  - `Scope 1/2/3 (tCO2e)` -> scope totals seed rows
  - `Number of Employees` / `Turnover` -> intensity metrics
  - WFM `Job Manager` -> `jobs.crm_name`

## Commands

### 1. Dry-run (recommended first)

```bash
python wfm_import/wfm_import_routine.py --dry-run --max-clients 3
```

### 2. Live trial import (3 clients + related contacts/jobs)

```bash
python wfm_import/wfm_import_routine.py --import --max-clients 3
```

### 3. Import specific clients by WFM UUID

```bash
python wfm_import/wfm_import_routine.py --import --client-ids "<id1>,<id2>,<id3>"
```

### 4. Import specific clients by name

```bash
python wfm_import/wfm_import_routine.py --import --client-names "First Event,Client B,Client C"
```

### 5. Import a specific job by job number

```bash
python wfm_import/wfm_import_routine.py --import --job-numbers "J000547"

### 6. Build template row -> factor ID mapping dictionary

Uses `Sample Data Sheet With IDs for Mapping.xlsx` to generate mapping artifacts:
- `wfm_import/analysis/wfm_template_id_mapping.json` (full row metadata)
- `wfm_import/analysis/wfm_template_id_lookup.json` (key -> factor_original_id)

```bash
python wfm_import/build_template_id_mapping.py
```

The importer auto-loads this lookup (if present) from:
- `wfm_import/analysis/wfm_template_id_lookup.json`

This enables automatic `factor_original_id` resolution for incoming template-based WFM rows that do not carry IDs directly.
```

## Trial import executed

A 3-client live trial has been run successfully with this script.

Imported:
- 3 clients
- 5 inserted contacts (1 updated)
- 3 jobs

## Optional future phase

The files `0016_wfm_import_schema.sql` and `0017_payments_table.sql` are still useful for a later extended migration phase (services/invoices/payments/custom fields), but are not required for the core client/job trial import.
