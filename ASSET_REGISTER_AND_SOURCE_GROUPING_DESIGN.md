# Asset Register and Source Grouping Design

## Goal

We need to capture detailed source-level data for:

- Scope 1 assets such as vehicles, boilers, generators, refrigerant systems, and other owned or controlled equipment.
- Scope 3 business travel where many employees may use the same travel mode or same vehicle type.
- Future source types that have the same problem: many real-world items, one emissions factor family, and a need to report by Scope and Category while preserving inspectable detail.

The current `job_scope_rows` model is good for roll-up emissions, but it is too narrow to represent multiple real-world sources that share the same factor. We should separate:

1. source detail
2. grouped roll-up
3. report-facing emissions rows

## Proposed Model

### 1) `job_emission_sources`

One row per real-world source record.

Examples:

- one vehicle
- one piece of equipment
- one employee business-travel pattern
- one commuter response row

Suggested columns:

- `source_id` PK
- `job_id`
- `scope`
- `category`
- `source_type` - `asset`, `business_travel`, `commuting`, `fuel`, `equipment`, `custom`
- `source_subtype` - optional finer classification
- `group_id` - nullable link to a roll-up group
- `site_id`
- `source_name` - user-facing label
- `asset_identifier` - registration, asset tag, VIN, serial number, employee ref, etc.
- `factor_db_id`
- `dataset_id`
- `original_id`
- `qty`
- `uom`
- `apply_pct`
- `data_source`
- `data_confidence`
- `notes`
- `enabled`
- `month_1` ... `month_12`
- `detail_json` - type-specific fields that do not belong in the common columns
- `created_at`
- `updated_at`

Good practice:

- keep common fields relational
- keep type-specific fields in `detail_json`
- allow multiple sources to share the same factor and category

### 2) `job_emission_groups`

One row per grouped source set.

This is the bridge between source detail and report roll-up.

Suggested columns:

- `group_id` PK
- `job_id`
- `scope`
- `category`
- `group_type` - `fleet`, `asset_pool`, `business_travel_group`, `employee_travel_pattern`
- `group_name`
- `site_id`
- `rollup_method` - `sum`, `weighted_sum`, `headcount_scaled`, `average`
- `notes`
- `enabled`
- `created_at`
- `updated_at`

Examples:

- `Fleet - Medium Diesel Vehicles`
- `Business Travel - Staff Cars`
- `Office Plant and Equipment`

### 3) `job_scope_rows`

Keep this as the report-facing roll-up table.

It should be generated from grouped source records and remain the table used by:

- job totals
- report output
- dashboards
- charts
- export logic

Recommended additions:

- `source_group_id`
- `source_count`
- `source_total_qty`
- `source_total_tco2e`
- `source_summary_json`

This keeps the report rows compact while preserving the relationship back to the detailed register.

## How The Data Flows

### Scope 1 assets

1. User adds one or more real assets into the Asset Register.
2. Each asset gets its own `job_emission_sources` row.
3. Similar assets can be assigned to the same `job_emission_groups` row.
4. The grouping engine rolls the group into one or more `job_scope_rows` lines.
5. Reports show the summary, but can drill into the source records.

### Scope 3 business travel

1. User adds employee travel records into the Business Travel Register.
2. Each employee or trip pattern becomes a source row.
3. Many rows may share the same car type, rail type, bus type, or mileage pattern.
4. Group by mode, department, site, or travel pattern as needed.
5. Roll-up emits grouped Scope 3 rows while preserving every source row for inspection.

### Employee commuting

This same model can also absorb commuting survey rows.

That lets us:

- preserve each respondent row
- scale to headcount
- inspect the raw survey data later
- report the final grouped emissions separately from the source detail

## UI Design

### Jobs navigation

Add a new section under `Data`:

- `Asset Register`
- `Business Travel Register`
- `Employee Commuting Register`

Keep the existing `Data Entry` screen as the calculated emissions view for power users and legacy support.

### Asset Register screen

Recommended layout:

- top summary cards: total assets, grouped assets, ungrouped assets, emissions total
- left filter rail: scope, site, group, asset type, status
- main table: one row per source record
- right-side details drawer: asset identity, factor, monthly profile, notes, files
- group assignment controls: create group, move selected sources into group, ungroup

Suggested columns:

- asset name
- asset identifier
- site
- scope
- category
- source type
- group
- factor ID
- quantity
- unit
- tCO2e
- enabled
- last updated

### Business Travel Register screen

Use the same pattern, but with travel-oriented fields:

- employee name or team
- mode
- vehicle type
- trip pattern
- distance
- frequency
- site
- group
- factor ID
- tCO2e

### Inspection view

Add a detail panel on each roll-up row showing:

- source count
- grouped source names
- grouped identifiers
- total source quantity
- total emissions
- links to the underlying source rows

That gives a clean path from report row back to the original record.

## Reporting Design

Reports should have two layers:

1. executive summary and charts
2. detailed appendix

### Summary layer

Keep the current report output style:

- Scope totals
- category breakdowns
- charts and dashboards
- actions and narrative

### Detail appendix

Add a new appendix section for inspectable source data.

Suggested appendix groupings:

- Scope 1 - Assets
- Scope 3 - Business Travel
- Scope 3 - Employee Commuting

Suggested appendix columns:

- source name
- source identifier
- site
- scope
- category
- group
- factor
- quantity
- unit
- apply %
- tCO2e
- notes

This appendix can be collapsed in HTML and paginated in PDF.

## Business Rules

- Multiple source records may share the same factor ID.
- Uniqueness should apply to the source identity, not the factor ID.
- A disabled historical source row must not block a new active source row.
- Grouping is optional, but every source must belong either to a group or to an ungrouped bucket.
- Roll-up rows should be regenerated from sources whenever source detail changes.

## Recommended Roll-Up Logic

For each source row:

- resolve factor
- calculate source emissions
- assign to a group if present
- otherwise roll directly into an ungrouped summary bucket

For each group:

- sum source emissions
- sum source quantities where meaningful
- write or update the matching `job_scope_rows` row

For reporting:

- use `job_scope_rows` for totals and charts
- use `job_emission_sources` for appendix and inspection

## Migration Path

### Phase 1

- Add `job_emission_sources`
- Add `job_emission_groups`
- Add `source_group_id` and related summary columns to `job_scope_rows`
- Keep existing screens working

### Phase 2

- Add Asset Register UI
- Add Business Travel Register UI
- Add source-to-group assignment

### Phase 3

- Update report generation to include detailed appendices
- Expose drill-down links from report rows back to source detail

### Phase 4

- Move Scope 1 and business travel data entry away from one-row-per-factor editing
- Keep legacy `Data Entry` as a calculated and support view

## Practical Recommendation

Use one generic source register model instead of separate one-off tables for vehicles, travel, and commuting. That gives us:

- fewer schema changes
- better reporting consistency
- easier inspection
- a single grouping engine
- a path for future source types

The report-facing table should remain separate, because it is the layer that clients read and audit trails inspect.
