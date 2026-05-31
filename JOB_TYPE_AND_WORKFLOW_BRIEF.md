# NZI Pro - Job Types and Workflow Brief

## Purpose

The platform currently treats most work as Carbon Reduction Plans (CRPs), but the business is now delivering several different kinds of work. The core service lines are **Carbon Reduction Plans**, **Training**, **Consultancy**, **Life Cycle Analysis (LCA)**, and **Product Carbon Footprinting (PCF)**. These do not all fit the same operational workflow, reporting logic, or detail model.

The purpose of this brief is to define a structure that preserves the current CRP experience while adding support for the other service lines in a way that is **clean, scalable, and implementation-safe**.

## Release 1 Scope

Release 1 should introduce the new job-family workflow layer without changing the visible CRP experience.

In practical terms, that means:

- keep the existing Admin lookup `job_types` table as the business catalogue
- add a canonical `job_family` mapping for workflow and reporting
- add workflow templates and stage tracking to jobs
- make job creation and job detail screens family-aware
- keep CRP reporting isolated from non-CRP work

Release 1 should not try to redesign every service line at once. The first goal is to create a safe foundation that supports CRP, Training, Consultancy, LCA, and PCF cleanly.

### Release 1 non-goals

To keep the first release safe and achievable, do not attempt the following in Release 1:

- redesigning the entire jobs UX
- changing the existing CRP reporting logic beyond filtering by job family where needed
- replacing the Admin `job_types` catalogue with a brand-new registry
- introducing organisation-specific custom workflow builders
- rebuilding every existing job form at once
- migrating historical data into a new reporting warehouse
- changing notes, attachments, invoices, or client relationships unless they are directly needed for the new workflow layer

## Core Principle

> **Keep one shared job record, but allow each job type to use its own workflow, details, and reporting rules.**

This approach avoids forcing training, consultancy, LCA, or PCF work through CRP milestones, avoids duplicating the entire jobs system five times, avoids mixing unrelated reporting logic together, and reduces the risk of breaking the current CRP workflow.

## Product Principle

Users should feel that they are working in **one coherent jobs system**, not five disconnected mini-products. The platform should keep shared navigation, shared ownership, shared notes, shared permissions patterns, shared search, and shared filtering. The type-specific variation should appear inside the job experience rather than fragment the product.

## Existing Admin Lookups

The current system already has an Admin -> Lookups `job_types` table, and that must be treated as the existing operational catalogue rather than ignored or duplicated.

The key rule is:

> **Do not create a second competing job-type registry.**

Instead, the implementation should map the existing lookup values to the canonical job-type families used by the new workflow model.

Recommended handling:

- keep the Admin lookup table as the editable catalogue for job offerings / service definitions
- add a canonical family mapping so each lookup value can resolve to `crp`, `training`, `consultancy`, `lca`, or `pcf`
- preserve the existing admin UI for maintaining lookup items such as pricing and estimated hours
- let the new workflow model read from, but not redefine, the business-facing lookup catalogue

This means the brief is not replacing Admin lookups. It is adding a cleaner workflow layer on top of the current lookup model.

### Mapping decision

The preferred implementation is to extend the existing `job_types` lookup table with a canonical family field, rather than creating a second table or hardcoding the mapping in the frontend.

Recommended field:

- `job_family` text, constrained to one of `crp`, `training`, `consultancy`, `lca`, or `pcf`

This gives the system a single source of truth for:

- what the customer-facing job offering is called in Admin
- which workflow family it belongs to
- which details section to show in the job UI
- which reporting bucket it should fall into

Suggested rule:

- `name` remains the editable business label in Admin
- `job_family` becomes the canonical technical grouping used by the workflow engine and reporting

If a lookup item does not yet have a mapping, it should default to `crp` only as a temporary migration fallback, not as a permanent design choice.

## Recommended Model

### Shared core model

Every job, regardless of type, should exist in one shared `jobs` table. This table should hold the fields that are common across all service lines and represent the stable operational spine of the platform.

| Field | Purpose |
|---|---|
| `job_id` | Primary key for the job record |
| `job_number` | Human-readable reference number |
| `org_id` | Tenant / organisation scope |
| `client_db_id` | Linked client |
| `job_type` | Stable service-line classification such as `crp`, `training`, `consultancy`, `lca`, or `pcf` |
| `title` | Primary job title |
| `description` | Short operational description |
| `status` | Lifecycle status of the job record |
| `workflow_template_id` | Template assigned to the job |
| `workflow_stage_key` | Current stage key within the assigned workflow |
| `owner_crm` | Commercial / relationship owner |
| `assigned_to_user_id` | Operational assignee |
| `priority` | Priority or urgency flag |
| `start_date` | Planned or actual start date |
| `due_date` | Overall delivery due date |
| `completed_at` | Completion timestamp |
| `archived_at` | Archive timestamp |
| `billing_status` | Commercial billing state |
| `quoted_value` | Quoted commercial value |
| `invoice_total` | Total invoiced amount |
| `created_at` | Record created timestamp |
| `updated_at` | Record updated timestamp |

### Lifecycle status versus workflow stage

The system must distinguish clearly between **record lifecycle** and **workflow progression**.

| Field | Meaning | Example values |
|---|---|---|
| `status` | The lifecycle state of the job record | `draft`, `active`, `completed`, `cancelled`, `archived` |
| `workflow_stage_key` | The current operational stage inside the workflow | `data_gathering`, `scheduled`, `review`, `issued` |

This distinction is important. A job might still be **active** while being in the **review** stage, and two job types may both be active while using completely different workflow stages.

### Type-specific detail tables

Type-specific fields should not be forced into the core `jobs` table. Instead, the platform should use one dedicated detail table per job type.

| Table | Purpose |
|---|---|
| `job_crp_details` | CRP-specific fields |
| `job_training_details` | Training-specific fields |
| `job_consultancy_details` | Consultancy-specific fields |
| `job_lca_details` | LCA-specific fields |
| `job_pcf_details` | Product carbon footprinting-specific fields |

This keeps the core job record stable while allowing each service line to evolve independently.

### Workflow model

Workflow templates should be treated as first-class entities rather than informal labels. Each job type can have one or more templates, but each job should have exactly one assigned template.

#### Recommended workflow tables

| Table | Purpose |
|---|---|
| `job_workflow_templates` | Workflow template header |
| `job_workflow_stages` | Ordered stage definitions belonging to a template |
| `job_stage_history` | Per-job audit trail of stage movement |

#### Recommended `job_workflow_templates` fields

| Field | Purpose |
|---|---|
| `workflow_template_id` | Primary key |
| `job_type` | Service line this template applies to |
| `name` | Template name |
| `is_default` | Whether the template is the default for the type |
| `is_active` | Whether the template can still be assigned |
| `version_number` | Optional version marker |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

#### Recommended `job_workflow_stages` fields

| Field | Purpose |
|---|---|
| `workflow_stage_id` | Primary key |
| `workflow_template_id` | Parent template |
| `stage_key` | Stable machine-readable key |
| `stage_label` | Human-readable label |
| `stage_order` | Display and progression order |
| `is_terminal` | Whether the stage ends the workflow |
| `sla_days` | Optional target duration for analytics |
| `is_active` | Soft-activation flag |

#### Recommended `job_stage_history` fields

| Field | Purpose |
|---|---|
| `job_stage_history_id` | Primary key |
| `job_id` | Related job |
| `from_stage_key` | Previous stage |
| `to_stage_key` | New stage |
| `changed_by_user_id` | User who made the change |
| `changed_at` | Timestamp |
| `change_note` | Optional reason / note |

### Why this model is preferred

The platform could store workflow stages as JSON on a template record, but that would be weaker for analytics, validation, auditability, and future automation. A structured workflow model is more robust and reduces ambiguity when reporting on time in stage, progression history, or stage-based alerts.

## Job Type Definitions

### CRP

This remains the primary and most detailed workflow and should preserve the current core experience.

| Typical field | Purpose |
|---|---|
| `reporting_year` | Reporting period |
| `benchmark_year` | Baseline reference year |
| `target_year` | Net zero or reduction target year |
| `benchmark_total_tco2e` | Baseline emissions value |
| `scopes_included` | Scope coverage |
| `final_report_due_date` | Planned final issue date |
| `final_report_completed_at` | Actual report completion timestamp |

### Training

This should support a lighter delivery workflow focused on scheduling, delivery, attendance, and feedback.

| Typical field | Purpose |
|---|---|
| `session_date` | Planned or actual session date |
| `delivery_format` | Onsite, virtual, hybrid |
| `topic` | Training topic |
| `attendee_count` | Audience size |
| `audience` | Intended audience group |
| `materials_link` | Supporting materials |
| `feedback_score` | Post-session rating |

For the detailed training delivery model, scheduling rules, attendance handling, invoicing hooks, reminders, and certificates, see [TRAINING_WORKFLOW_BRIEF.md](TRAINING_WORKFLOW_BRIEF.md).

### Consultancy

This should support scoped advisory work where the workflow is driven by deliverables, reviews, and commercial effort rather than formal carbon-plan stages.

| Typical field | Purpose |
|---|---|
| `engagement_type` | Advisory / review / workshop / retained support |
| `deliverables` | Expected outputs |
| `workshop_count` | Number of workshops included |
| `hours_budget` | Planned hours |
| `hours_used` | Actual hours used |
| `next_review_date` | Planned next review point |

### LCA

This should support methodology-heavy work with assessment-specific inputs and review states.

| Typical field | Purpose |
|---|---|
| `product_or_process_name` | Subject of the assessment |
| `functional_unit` | Functional unit definition |
| `system_boundary` | Assessment boundary |
| `methodology` | Methodology or standard |
| `assumptions` | Key assumptions |
| `data_sources` | Source summary |
| `review_status` | Review readiness or outcome |

### PCF

This should support product carbon footprinting work focused on individual products, components, or product families.

| Typical field | Purpose |
|---|---|
| `product_name` | Product or product family name |
| `product_code` | Internal or external product identifier |
| `functional_unit` | Functional unit definition |
| `system_boundary` | Assessment boundary |
| `data_sources` | Source summary |
| `assumptions` | Key assumptions |
| `review_status` | Review readiness or outcome |

## Example Workflow Templates

The exact templates can evolve, but the platform should start from sensible defaults.

| Job type | Example stages |
|---|---|
| `crp` | `scope` -> `data_gathering` -> `analysis` -> `draft` -> `review` -> `final` |
| `training` | `scoping` -> `scheduled` -> `delivered` -> `feedback` -> `closed` |
| `consultancy` | `discovery` -> `working` -> `review` -> `delivered` |
| `lca` | `scope` -> `inventory` -> `modelling` -> `review` -> `issued` |
| `pcf` | `scope` -> `inventory` -> `modelling` -> `review` -> `issued` |

These stage labels should be presented to users through template metadata, but the database should store stable keys rather than free-form text.

## API Design

The API should treat `job_type`, `workflow_template_id`, and `workflow_stage_key` as first-class concepts.

### Create job

The create payload should include the job type up front. If no template is specified, the API should assign the default active template for that job type.

```json
{
  "client_db_id": 55,
  "job_type": "training",
  "title": "Carbon awareness training",
  "description": "Half-day session for the leadership team",
  "owner_crm": "Chris Williams",
  "assigned_to_user_id": 12,
  "start_date": "2026-06-01",
  "due_date": "2026-06-15",
  "workflow_template_id": 4,
  "workflow_stage_key": "scheduled",
  "details": {
    "session_date": "2026-06-10",
    "delivery_format": "onsite",
    "attendee_count": 18,
    "topic": "Carbon literacy"
  }
}
```

### Get job

The returned payload should include the core job fields, the assigned template, the current workflow stage, the type-specific details, and optionally the stage history.

| Response area | Should include |
|---|---|
| Core job | Shared job fields |
| Workflow | `workflow_template_id`, current stage metadata, available stages |
| Details | Type-specific fields |
| History | Stage history and key activity if requested |

### Update job

Updates should allow core field changes, workflow stage changes, and type-specific detail changes. However, `job_type` should be treated as effectively immutable after creation.

### Job type conversion rule

A job should **not** change type through normal edit flows. If the business later requires conversion, that should be handled only by an explicit admin migration process with clear rules for detail-table migration, history retention, and reporting continuity.

### Workflow metadata

The platform should provide endpoints or configuration data for job types, available templates by job type, stage definitions, and allowed default template mappings.

## Validation Rules

Type-specific `details` should not be treated as an ungoverned JSON blob. Validation rules should live in the API and be mirrored in the UI.

| Rule area | Expectation |
|---|---|
| Core fields | Required and validated for all jobs |
| Type-specific fields | Validated according to `job_type` |
| Template-stage alignment | `workflow_stage_key` must belong to the assigned template |
| Status transitions | `status` changes should follow lifecycle rules |
| Stage transitions | Stage changes should be recorded in `job_stage_history` |

## Workflow Governance

The brief should assume controlled governance rather than unrestricted customisation.

| Governance question | Recommendation |
|---|---|
| Who defines templates? | System-defined initially, with admin-configurable support only if there is a clear business need |
| Can templates be edited after jobs exist? | Prefer versioning rather than editing historical templates in place |
| Can stages be deleted? | No hard deletion once in use; use deactivation instead |
| Can every org customise workflows? | Not in phase one unless this is a strong commercial requirement |

The safest starting point is to support **default system templates per job type**, then add controlled configurability later if the business proves it is necessary.

## Permissions and Roles

The jobs framework should assume shared permission patterns, but it must be designed so job-type-specific restrictions can be added later.

| Permission area | Recommendation |
|---|---|
| View job | Based on normal org and role access |
| Edit core fields | Allowed to permitted operational/admin roles |
| Change stage | Allowed to roles responsible for workflow progression |
| Edit financial fields | Restricted if needed |
| Edit template configuration | Admin-only |

## UI Design

### Job creation

The job-creation experience should use a two-step flow. The user should first choose the job type, then complete a type-aware form that combines shared fields with the relevant detail section.

| Step | Behaviour |
|---|---|
| Step 1 | Choose job type |
| Step 2 | Show shared job fields plus type-specific fields |

The interface should keep shared fields consistently placed so users recognise one jobs system, not five different forms.

### Job detail page

The job detail page should use a shared shell and type-specific content blocks. The shell should always present the same core summary areas such as client, owner, status, workflow, priority, and dates. The inner content should adapt to the job type.

| Job type | Detail experience |
|---|---|
| CRP | Full CRP workflow, milestones, and report detail |
| Training | Delivery schedule, attendance, materials, and feedback |
| Consultancy | Deliverables, effort tracking, and review cadence |
| LCA | Assessment methodology, assumptions, and review state |
| PCF | Product footprint modelling, assumptions, and review state |

### Job list and filters

The job list should remain shared, but it should clearly expose job type and allow strong filtering.

| List column | Recommendation |
|---|---|
| Job type badge | Always visible |
| Job number | Always visible |
| Title | Linked primary label |
| Client | Visible |
| Owner | Visible |
| Status | Visible |
| Workflow stage | Visible |
| Due date | Visible where useful |

Filters should include job type so users can isolate CRPs or view only training, consultancy, LCA, or PCF jobs.

## Reporting Rules

Reporting must separate CRP work from other service lines.

### CRP reporting

CRP dashboards and CRP-specific operational metrics should only include jobs where `job_type = 'crp'`. Training, consultancy, LCA, and PCF work must not distort CRP outputs or carbon-reporting performance views.

### Portfolio reporting

Portfolio reporting should provide cross-service visibility while still separating the service lines clearly.

| Portfolio metric | Definition guidance |
|---|---|
| Total jobs by type | Count of jobs grouped by `job_type` |
| Revenue by type | Based on invoices as the finance source-of-truth, with job-level quote values used only as pipeline context |
| Hours by type | Based on a consistent time-entry model across job types |
| Completion rate by type | Based on jobs whose `status = completed` within the reporting period |
| Active work by type | Based on jobs whose `status = active` |

The business should be careful with cross-type comparisons. A training job and a consultancy engagement may not have equivalent duration or effort, so counts should not be treated as interchangeable measures of workload.

## Notes and Shared Records

Notes should remain shared across the platform. Client-only notes should still work, job-linked notes should still work, and a note linked to a job should be visible from both the client and the job where appropriate. This keeps collaboration coherent across all job types without duplication.

## Migration Strategy

The rollout should remain incremental and should protect the existing CRP workflow at every stage.

### Legacy job classification rule

If the database already contains any non-CRP jobs or backfilled records, they should be explicitly classified before the migration is finalised. The default assumption should be:

- existing CRP jobs stay `crp`
- any clearly identified training, consultancy, or LCA records should be assigned their true `job_type`
- any clearly identified product carbon footprinting records should be assigned their true `job_type`
- only genuinely ambiguous legacy rows should fall back to `crp` during the first cutover

### Phase 1

| Action | Purpose |
|---|---|
| Add `job_type` to `jobs` | Introduce service-line identity |
| Classify legacy jobs before cutover | Preserve real historical service-line meaning where available |
| Default genuinely ambiguous legacy jobs to `crp` | Preserve legacy behaviour without over-complicating migration |
| Add `workflow_template_id` and `workflow_stage_key` | Establish future-ready workflow model |
| Keep current CRP behaviour unchanged | Avoid regression risk |

#### Phase 1 implementation checklist

This is the minimum safe first release for the new job model.

##### Schema changes

- Add `job_type` to `jobs`
- Add `workflow_template_id` to `jobs`
- Add `workflow_stage_key` to `jobs`
- Default existing rows to `job_type = 'crp'`
- Create `job_workflow_templates`
- Create `job_workflow_stages`
- Seed default templates for `crp`, `training`, `consultancy`, and `lca`
- Defer `job_stage_history` to phase 2 unless audit history is required immediately

##### API changes

- `POST /jobs`
  - accept `job_type`
  - accept `workflow_template_id` optionally
  - accept `workflow_stage_key` optionally
  - accept a `details` object for type-specific fields
  - assign the default active template for the selected job type when no template is supplied
  - assign the first stage from that template when no stage is supplied

- `PATCH /jobs/{job_id}`
  - allow shared field updates
  - allow `workflow_stage_key` changes
  - allow type-specific detail updates
  - do not allow normal UI flows to change `job_type`

- `GET /jobs/{job_id}`
  - return `job_type`
  - return `workflow_template_id`
  - return `workflow_stage_key`
  - return template and stage metadata needed by the UI
  - return type-specific details

- `GET /jobs`
  - include `job_type` in list responses
  - support filtering by `job_type`

- `GET /job-types`
  - return the available job types and labels

- `GET /job-workflows/{job_type}`
  - return the default template and ordered stage list for the requested type

##### UI changes

- Add job type selection as the first step in job creation
- Render shared fields plus type-specific fields after the type is chosen
- Display the job type badge on job list rows and job detail headers
- Keep the current CRP workflow UI intact for `job_type = 'crp'`
- Show the correct workflow stages based on the assigned template

##### Reporting changes

- Preserve current CRP reporting by filtering to `job_type = 'crp'`
- Add `job_type` filters to shared job lists and portfolio views
- Do not mix training, consultancy, LCA, or PCF rows into CRP-specific dashboards

### File-by-file implementation plan

This is the recommended build order for phase 1. The goal is to make the change in small, testable steps and keep the current CRP flow stable throughout.

#### 1) `core/migrations.py`

Update the schema bootstrap/migration layer first so the database can store the new job model safely.

Work items:

- add `job_type` to `jobs` if it does not already exist in the target schema
- add `workflow_template_id` to `jobs`
- add `workflow_stage_key` to `jobs`
- create `job_workflow_templates`
- create `job_workflow_stages`
- optionally add `job_stage_history` in the same migration or defer to phase 2 if the team wants the first release to be smaller
- seed default templates for `crp`, `training`, `consultancy`, and `lca`
- backfill legacy jobs to `crp` where classification is ambiguous

Notes:

- if the existing `job_types` lookup table is still the source of truth for the UI, keep it in sync rather than introducing a second type registry
- prefer additive schema changes only
- do not remove or rewrite CRP-specific columns in phase 1

#### 2) `api/job_management_routes.py`

This is the main job create/update/read path and should become job-type aware first.

Work items:

- accept `job_type` as part of create and update payloads
- resolve the default workflow template for the selected job type
- store `workflow_template_id` and `workflow_stage_key`
- allow type-specific `details` payloads through create and update
- return the assigned template and stage metadata in `GET /jobs/{job_id}`
- include `job_type` in `GET /jobs`
- prevent normal edit flows from changing `job_type`

Notes:

- keep the current CRP job creation behaviour intact for existing CRP records
- if the current job system already uses `job_type_id` and the `job_types` lookup table, map the new workflow fields onto that model carefully rather than replacing it in one step

#### 3) `api/job_template_routes.py` or a new workflow route module

This layer should expose workflow metadata to the UI.

Work items:

- return job types and workflow templates
- return ordered stage definitions for a template
- provide the default template for a given `job_type`

Notes:

- if the current app already exposes job type metadata from admin routes, reuse that where practical
- do not require the frontend to hardcode stage lists

#### 4) `frontend/src/app/jobs/new/NewJobPageClient.tsx`

This is where the new job creation flow should become type-aware.

Work items:

- make job type the first meaningful choice in the flow
- after the user selects a type, show the shared job fields plus the relevant type-specific section
- keep the existing CRP flow working exactly as it does today
- submit `job_type`, `workflow_template_id`, `workflow_stage_key`, and `details` to the backend
- show type-specific validation rules in the UI

Notes:

- this page already gathers the core job fields, so it is the best place to introduce the type split without touching every downstream screen at once

#### 5) `frontend/src/app/jobs/[jobId]/page.tsx`

This is the job detail shell and should render the right workflow experience for the job type.

Work items:

- display the job type prominently in the header
- show the correct workflow stage UI for the assigned template
- render type-specific detail sections
- keep the current CRP sections intact for CRP jobs
- make sure links, notes, milestones, and reports still work for all job types

Notes:

- this page is the right place to adapt the detail experience without changing the shared navigation model

#### 6) `frontend/src/components/ClientJobsSection.tsx`

This component should clearly expose job type in client views.

Work items:

- show job type badges in client job lists
- surface workflow stage where helpful
- ensure non-CRP jobs are visually distinguishable from CRPs

#### 7) `frontend/src/components/job-workspace/JobSetupOverviewSection.tsx`

This section should become template-aware if it is currently assuming a CRP-like setup.

Work items:

- accept template and stage metadata from the job payload
- render stages from the selected workflow template
- keep any CRP-specific overview widgets scoped to CRP jobs only

#### 8) Reporting and dashboard files

Update reporting last so the new job types do not leak into CRP metrics before the data model is stable.

Likely files:

- `api/main_dashboard_routes.py`
- `frontend/src/app/insights/InsightsPageClient.tsx`
- any job summary or reporting components that assume all jobs are CRPs

Work items:

- filter CRP dashboards to `job_type = 'crp'`
- add job-type filters to portfolio views
- add service-line breakdowns for leadership reporting

#### 9) Tests and validation

Add tests after the shape of the API is settled.

Likely areas:

- migration tests for the new columns and tables
- job create/update contract tests
- template lookup tests
- reporting filter tests

#### Suggested build order

1. database migration and template seed
2. backend create/read/update job support
3. workflow metadata endpoints
4. new-job UI
5. job-detail UI
6. client job list and shared reporting views
7. tests and final cleanup

### Day 1 checklist with acceptance criteria

Use this as the first implementation pass. The goal is to get the new model into the codebase without changing the visible CRP experience.

#### 1) Confirm lookup mapping

- [ ] Decide which existing Admin `job_types` rows map to `crp`
- [ ] Decide which existing Admin `job_types` rows map to `training`
- [ ] Decide which existing Admin `job_types` rows map to `consultancy`
- [ ] Decide which existing Admin `job_types` rows map to `lca`
- [ ] Decide which existing Admin `job_types` rows map to `pcf`

Acceptance criteria:

- every existing `job_types` row has a canonical `job_family`
- no second job-type registry is introduced
- ambiguous rows are explicitly marked for temporary `crp` fallback

#### 2) Database migration

- [ ] Add `job_family` to `job_types`
- [ ] Add `workflow_template_id` to `jobs`
- [ ] Add `workflow_stage_key` to `jobs`
- [ ] Create `job_workflow_templates`
- [ ] Create `job_workflow_stages`
- [ ] Optionally create `job_stage_history` if the team wants auditability in phase 1
- [ ] Seed default templates for all five families

Acceptance criteria:

- database migration runs cleanly on a fresh database
- migration is additive only
- existing CRP rows remain readable after migration
- default templates exist for `crp`, `training`, `consultancy`, `lca`, and `pcf`

#### 3) Backfill legacy job families

- [ ] Populate `job_family` for all existing `job_types` rows
- [ ] Default ambiguous legacy rows to `crp`
- [ ] Preserve existing CRP behaviour exactly as-is

Acceptance criteria:

- no existing job loses its current type label
- legacy rows that are clearly non-CRP are mapped correctly
- ambiguous rows have a documented fallback rule

#### 4) Backend job routes

- [ ] Update `api/job_management_routes.py` to read `job_family`
- [ ] Store `workflow_template_id` on job create
- [ ] Store `workflow_stage_key` on job create
- [ ] Return workflow metadata from `GET /jobs/{job_id}`
- [ ] Include `job_family` / `job_type` in job list responses
- [ ] Prevent normal edit flows from changing the job family

Acceptance criteria:

- creating a job writes the workflow fields correctly
- fetching a job returns the selected workflow template and stage
- updating a job cannot silently move it to a different family
- CRP job creation continues to work as before

#### 5) Workflow metadata endpoints

- [ ] Expose job family and template metadata
- [ ] Expose ordered stage lists
- [ ] Expose the default template per family

Acceptance criteria:

- the frontend can render stage choices from API data
- no hardcoded stage lists are required in the UI

#### 6) New job UI

- [ ] Update `frontend/src/app/jobs/new/NewJobPageClient.tsx`
- [ ] Show job family selection clearly
- [ ] Branch the form by selected family
- [ ] Keep the CRP flow intact
- [ ] Submit `job_type_id`, `job_family`, `workflow_template_id`, and `workflow_stage_key`

Acceptance criteria:

- a CRP job still creates exactly as expected
- a non-CRP job can be created without CRP-only fields
- the UI shows the correct fields for the selected family

#### 7) Job detail UI

- [ ] Update `frontend/src/app/jobs/[jobId]/page.tsx`
- [ ] Render the workflow for the selected family
- [ ] Keep notes, files, reports, and links working
- [ ] Keep CRP sections unchanged for CRP jobs

Acceptance criteria:

- a CRP job looks and behaves the same as before
- a non-CRP job shows the right type-specific detail blocks

#### 8) Client and list surfaces

- [ ] Update `frontend/src/components/ClientJobsSection.tsx`
- [ ] Show family/type badges in job lists
- [ ] Make non-CRP jobs visually distinct

Acceptance criteria:

- users can tell CRP jobs from other service lines at a glance
- the job list remains a single shared view

#### 9) Reporting later in the sequence

- [ ] Keep CRP dashboards filtered to `crp`
- [ ] Add family/type breakdowns where needed
- [ ] Keep training, consultancy, LCA, and PCF out of CRP-only metrics

Acceptance criteria:

- CRP reporting does not change unexpectedly
- portfolio reporting can distinguish service lines cleanly

### Phase 2

| Action | Purpose |
|---|---|
| Add type-specific detail tables | Support service-line fields cleanly |
| Seed default workflow templates and stages | Establish standard models |
| Add `job_stage_history` | Enable auditability and analytics |
| Update create/edit UI to branch by job type | Introduce user-facing type awareness |

### Phase 3

| Action | Purpose |
|---|---|
| Update dashboards and reports to filter by type | Preserve reporting integrity |
| Keep CRP-only metrics isolated | Protect carbon-reporting views |
| Expose portfolio reporting by service line | Give leadership cross-service visibility |

### Phase 4

| Action | Purpose |
|---|---|
| Add stage analytics and SLA reporting | Improve operational management |
| Refine type-specific fields based on real usage | Avoid over-modelling too early |
| Evaluate controlled template configurability | Add flexibility only if proven necessary |

## Recommended Decision

Use one shared `jobs` table for all job records, a required and stable `job_type` field, a structured workflow model built around `workflow_template_id` and `workflow_stage_key`, separate detail tables per service line, and a per-job stage history table. Treat CRP as the default legacy type for migration and ensure that CRP-specific reporting remains isolated from broader portfolio reporting.

This model gives the business room to grow while preserving the existing CRP workflow and reducing the risk of long-term product and reporting debt.

## Final Recommendation

This brief should be taken forward on the basis that the system remains **one jobs platform with type-aware workflows**, not five disconnected workflow systems. The implementation should favour clear semantics, controlled workflow governance, clean reporting boundaries, and a shared user experience.

If these principles are followed, the platform will be able to support multiple service lines without sacrificing the maturity already built into the CRP workflow.
