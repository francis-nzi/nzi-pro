# CRM Data Entry — Register Consolidation Scope

**Status:** scoped, not started
**Raised:** 2026-09-09, from J000226 (Fenco Group Ltd, job 217)
**Related:** `project_commuting_pattern_parity_2026_08` — this is the concrete version of that task.

## The problem

A consultant opens **Job → Data → Data Entry** expecting to see everything that
counts toward the job. For job 217 they saw 12 rows totalling 19.51 tCO₂e, while
the client had submitted 10 company vehicles (78,944 miles, 21.75 tCO₂e) and 7
business travel entries (6,360 units, 0.94 tCO₂e) through the portal. Those 22.69
tCO₂e are counted correctly in every report and dashboard — they are simply
invisible on the one screen named "Data Entry".

### Why

There are two row stores, and Data Entry reads only one of them.

| Store | Holds | Written by |
|---|---|---|
| `job_scope_rows` | Energy, Fuels, Waste, PG&S, spend, imports, and the consolidated Employee Commuting lines | CRM Data Entry, portal Data Entry (most buckets), `services/employee_commuting_consolidation.py` |
| `job_emission_sources` | Asset Register (`source_type='asset'`), Business Travel Register (`'business_travel'`), per-employee commuting (`'employee_commuting'`) | CRM registers, portal Company Vehicles / Business Travel / Commuting |

The portal deliberately writes Company Vehicles and Business Travel into
`job_emission_sources` so approved submissions land on the CRM register screens
rather than a flat pending list — see the `_BUCKET_REGISTER_SOURCE_TYPE` comment
in [api/portal_data_entry_routes.py:44-56](api/portal_data_entry_routes.py#L44-L56).

Everything that computes totals already unions both stores:

- [services/emissions_reporting.py:238-315](services/emissions_reporting.py#L238-L315) (`legacy_rows` ∪ `source_rows`)
- [api/job_report_routes.py:1527](api/job_report_routes.py#L1527) (`_load_source_register_rows`)
- [api/job_data_output_routes.py:274](api/job_data_output_routes.py#L274), [api/portal_routes.py:704](api/portal_routes.py#L704), [api/main_dashboard_routes.py:367](api/main_dashboard_routes.py#L367)

The CRM Data Entry list endpoint does not — it selects from `job_scope_rows`
alone ([api/job_scope_data_routes.py:1101](api/job_scope_data_routes.py#L1101)).

Employee Commuting already solved this with a bridge: it regenerates read-only
consolidated `job_scope_rows` from its register rows on every mutation, and
guards them against direct edits via `auto_pair_kind='employee_commuting'`.
Company Vehicles and Business Travel never got the equivalent.

## Two ways to close it

### Option A — read-only union in the Data Entry list (recommended)

Extend the Data Entry list endpoint to union `job_emission_sources` rows
(`source_type IN ('asset','business_travel')`) into its result, shaped the way
`_register_source_to_portal_dict` already shapes them for the portal, flagged
`is_register_row: true`.

- **Pros:** one screen, one total, no new rows, no new sync path to keep
  consistent, no risk of double-counting — the reporting layer keeps reading the
  register table directly and never sees a duplicate.
- **Cons:** the rows are not editable in place; the UI must route the edit/delete
  affordances to Asset Register / Business Travel. Filtering, sorting, pagination
  and the CSV export all have to handle a heterogeneous row set.
- Every write path (`PATCH`/`DELETE` on `/jobs/{id}/scope-data/rows/{row_id}`)
  must reject register rows explicitly — row ids come from different sequences,
  so a bare id is ambiguous across the two tables. Return them with a prefixed
  id (`src:470`) rather than a bare integer.

### Option B — consolidation bridge, mirroring Employee Commuting

Add `sync_asset_scope_rows` / `sync_business_travel_scope_rows` alongside
`sync_commuting_scope_rows`, generating read-only `job_scope_rows` grouped by
(site, factor).

- **Pros:** exactly the pattern already proven for commuting; Data Entry, exports
  and anything else reading `job_scope_rows` need no changes at all.
- **Cons:** **every one of the five totals queries listed above must gain an
  `AND js.source_type NOT IN ('asset','business_travel')` exclusion**, matching
  the existing `IS DISTINCT FROM 'employee_commuting'` guard — miss one and the
  job double-counts its whole vehicle fleet. The commuting rollout hit precisely
  this (see `project_commuting_consolidation_2026_08`: five union queries needed
  fixing). It also duplicates rows into a second table that must be regenerated
  on every register mutation, including portal approvals and CRM edits.

**Recommendation: Option A.** The double-count exposure in Option B is the
expensive kind of bug — silent, client-facing, and only visible by cross-checking
a total. Option A cannot double-count by construction.

## Work items (Option A)

1. **Backend** — union register rows into the Data Entry list endpoint
   ([api/job_scope_data_routes.py:1101](api/job_scope_data_routes.py#L1101)),
   reusing the `_load_source_register_rows` column shape. Prefixed row ids.
   Apply the existing site/scope/category/search filters to both halves.
2. **Backend** — reject prefixed/register ids on the scope-row write endpoints
   with a message pointing at the right screen.
3. **Frontend** — render register rows in `JobDataEntry.tsx` with a source badge
   ("Asset Register" / "Business Travel Register"), read-only action column, and
   a link through to the owning screen. The filtered total must include them.
4. **Frontend** — a summary line reconciling the two halves, so the number on
   this screen visibly matches the job total.
5. **Exports** — confirm the Data Entry CSV/XLSX export path carries the register
   rows too, or states plainly that it does not.
6. **Tests** — a job with rows in both stores: Data Entry total equals the
   reporting total; a register row cannot be edited or deleted through the
   scope-row endpoints; filters apply to both halves.

## Out of scope

- Changing where the portal writes Company Vehicles / Business Travel.
- The Asset Register grouping feature (groups roll sources up for reporting;
  ungrouped sources already count on their own — job 217 has 0 groups and all 10
  assets count).
