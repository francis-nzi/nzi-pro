# Training Workflow Brief

## Purpose

Training is not just a small subtype of CRP. It is a delivery model with its own scheduling, participants, attendance, reminders, certificates, documents, invoicing rules, and capacity management.

The purpose of this brief is to define a training workflow that supports:

- client and non-client attendees
- free places linked from CRP jobs
- paid places billed through invoicing
- multi-session courses spanning one or more days
- in-person, online, and hybrid delivery
- automated reminders and post-course follow-up
- attendance, no-shows, certificates, and documents

This brief sits on top of the existing job-family model, where `training` is one of the canonical families.

## Core Principle

> **Treat training as a course delivery model, not just a job record with a few extra fields.**

The job record should remain the commercial wrapper for ownership, client linkage, and billing context. The actual training delivery should be modelled as course runs, sessions, participant bookings, attendance records, and documents.

## Commercial Rules

Training should support the following commercial modes:

- included in a job fee
- invoiceable as a standalone course
- free place linked from a CRP job
- discounted place
- complimentary internal place

### Free places linked to CRP jobs

The existing job setup already includes fields such as:

- `training_place_included`
- `free_training_place`
- `date_training_completed`

Those fields should support the hand-off from a CRP job to a training entitlement, but they are not enough on their own. The workflow needs an explicit entitlement model so usage, cancellations, transfers, and audit history are reliable.

Recommended rule:

- when a CRP job includes a free training place, the job should create or reference an explicit training entitlement
- the entitlement should be able to link to the booking that consumed it
- the CRP job should record whether the entitlement was available, reserved, consumed, cancelled, transferred, or expired

### Invoicing

Training should connect to the invoicing process already in the platform.

Recommended billing logic:

- a training engagement can be billed by course run, by participant, or by booking block
- the system should support invoice generation from the training booking or course run
- invoice lines should be able to reflect:
  - course fee
  - participant fee
  - additional attendee fee
  - cancellation fee
  - no-show fee if required

## Recommended Model Layers

The training workflow should keep these layers separate:

- **Training job**: the commercial wrapper and client/job context
- **Training product**: reusable course definition, such as "CPD Accredited Net Zero Leaders"
- **Training course run**: one scheduled delivery instance of that product
- **Training session**: one delivery block within a course run
- **Training booking**: one participant booking onto a course run
- **Training attendance**: one session attendance record for one booking
- **Training entitlement**: a free or discounted seat linked from a CRP job
- **Trainer assignment**: the trainer or facilitator allocation
- **Venue**: physical delivery location, if relevant

This avoids mixing reusable course definitions with scheduled runs or booking data.

## Wrapper-Level Job Details

The `job_training_details` table should remain a wrapper-level summary only. It should not duplicate the live delivery engine.

Recommended wrapper-level fields:

| Field | Purpose |
|---|---|
| `job_id` | Parent commercial job |
| `training_summary` | Short summary of the training engagement |
| `delivery_mode_preference` | Preferred delivery mode at job level |
| `commercial_mode` | Included, paid, free place, discounted, mixed |
| `primary_product_name` | Friendly course name for the job wrapper |
| `internal_notes` | Internal delivery notes |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

## Training Product

The training product is the reusable definition of a course offering.

Recommended fields:

| Field | Purpose |
|---|---|
| `training_product_id` | Primary key |
| `product_code` | Internal or external code |
| `product_name` | Course / product name |
| `description` | Product description |
| `default_hours` | Default allocated hours |
| `default_delivery_format` | `in_person`, `online`, `hybrid` |
| `default_capacity` | Default maximum participants |
| `default_min_attendees` | Optional minimum delivery threshold |
| `certificate_policy` | Whether certificates are required |
| `default_document_set` | Default supporting documents |
| `is_active` | Active or retired |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

## Training Course Run

A course run is a scheduled delivery instance of a product. This is the thing that appears in the calendar and that participants book onto.

Recommended fields:

| Field | Purpose |
|---|---|
| `training_course_run_id` | Primary key |
| `job_id` | Parent commercial job |
| `training_product_id` | Parent product |
| `run_name` | Friendly label for the specific run |
| `course_code` | Instance code or reference |
| `total_hours` | Allocated delivery hours for the run |
| `delivery_format` | `in_person`, `online`, `hybrid` |
| `capacity` | Maximum participants |
| `min_attendees` | Optional minimum delivery threshold |
| `status` | Draft, scheduled, open, full, in progress, completed, cancelled, archived |
| `workflow_stage_key` | Current delivery workflow stage |
| `venue_id` | Linked venue if in person |
| `online_meeting_url` | Linked online meeting URL if virtual |
| `online_meeting_id` | Optional meeting ID |
| `online_passcode` | Optional passcode |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

## Training Session

A course run may span one or more delivery sessions.

Recommended fields:

| Field | Purpose |
|---|---|
| `training_session_id` | Primary key |
| `training_course_run_id` | Parent course run |
| `session_date` | Date of the session |
| `start_time` | Start time |
| `end_time` | End time |
| `timezone` | Timezone for the session |
| `session_order` | Sequence order for multi-day courses |
| `session_hours` | Allocated hours for the session |
| `location_note` | Optional room / link / joining note |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

## Participant / Booking

Training participants should be modelled separately from the course run because a run may include:

- client contacts
- external individuals
- internal participants

Recommended fields:

| Field | Purpose |
|---|---|
| `training_booking_id` | Primary key |
| `training_course_run_id` | Parent course run |
| `client_db_id` | Linked client, if any |
| `contact_id` | Linked client contact, if any |
| `person_name` | Participant name |
| `person_email` | Participant email |
| `person_phone` | Participant phone |
| `booking_type` | `client`, `external`, `internal` |
| `booking_source` | `free_place`, `paid`, `included`, `discounted`, `complimentary` |
| `billing_status` | `not_billable`, `to_invoice`, `invoiced`, `paid`, `waived`, `refunded` |
| `attendance_status` | `invited`, `booked`, `confirmed`, `attended`, `partial`, `no_show`, `cancelled`, `transferred` |
| `special_requirements` | Accessibility, dietary, or access notes |
| `consent_status` | Communication consent or marketing opt-in |
| `entitlement_id` | Linked training entitlement if the booking consumes one |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

## Attendance

Attendance should be tracked at session level, not only at course run level.

Recommended fields:

| Field | Purpose |
|---|---|
| `training_attendance_id` | Primary key |
| `training_session_id` | Parent session |
| `training_booking_id` | Parent booking |
| `attendance_status` | `attended`, `no_show`, `late`, `partial`, `excused` |
| `minutes_attended` | Actual attendance duration |
| `mark_method` | Manual / imported / auto-confirmed |
| `marked_by_user_id` | User who recorded attendance |
| `marked_at` | Timestamp |

## Trainers and Venues

Trainers and venues should be first-class entities so calendar management and clash detection work reliably.

### Trainer assignment

Recommended fields:

| Field | Purpose |
|---|---|
| `training_trainer_assignment_id` | Primary key |
| `training_course_run_id` | Parent course run |
| `user_id` | Trainer / facilitator user |
| `role` | Lead trainer, co-trainer, assessor, observer |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

### Venue

Recommended fields:

| Field | Purpose |
|---|---|
| `training_venue_id` | Primary key |
| `venue_name` | Venue name |
| `address_line_1` | Address line 1 |
| `address_line_2` | Address line 2 |
| `city` | City |
| `postcode` | Postcode |
| `country` | Country |
| `capacity` | Venue capacity |
| `accessibility_notes` | Access / mobility / dietary notes |
| `is_active` | Active or retired |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

## Training Entitlements

Free or discounted places linked from CRP jobs should be modelled explicitly.

Recommended fields:

| Field | Purpose |
|---|---|
| `training_entitlement_id` | Primary key |
| `source_job_id` | CRP job that created the entitlement |
| `source_job_number` | Human-readable job reference |
| `entitlement_type` | `free_place`, `discounted_place` |
| `status` | `available`, `reserved`, `consumed`, `cancelled`, `transferred`, `expired` |
| `allocated_to_booking_id` | Booking that consumed the entitlement |
| `reserved_at` | Timestamp when reserved |
| `consumed_at` | Timestamp when consumed |
| `expires_at` | Optional expiry timestamp |
| `notes` | Audit notes |

## Workflow

Training needs two layers of workflow:

1. **Job lifecycle**: the commercial wrapper state
2. **Course run lifecycle**: the delivery state of the actual course run

### Recommended job lifecycle

- draft
- active
- completed
- cancelled
- archived

### Recommended course run lifecycle

- draft
- scheduled
- open
- full
- in_progress
- completed
- cancelled
- archived

### Recommended course run workflow stages

- setup_complete
- booking_open
- reminder_sent
- in_progress
- awaiting_certificates
- completed
- closed

### Booking and attendance states

Participant state should be separate from course run state.

- booked
- confirmed
- attended
- partial
- no_show
- cancelled
- transferred
- waived

## Scheduling and Calendar

Training needs a calendar-first experience.

The system should support:

- course calendar view
- session calendar view
- trainer calendar view
- venue calendar view
- participant booking calendar or list view

Scheduling should include:

- single day delivery
- 2 x half-day delivery
- multi-day delivery
- recurring delivery dates if needed

The system should also detect:

- trainer clashes
- venue clashes
- over-capacity sessions
- participant double-bookings if that data is available

The course run should be the calendar object that appears in scheduling views, not the reusable product definition.

## Delivery Modes

### In person

In-person courses should manage:

- venue name
- address
- room
- parking / access notes
- seating or room capacity
- arrival instructions

### Online

Online courses should manage:

- meeting URL
- meeting ID
- passcode
- joining instructions
- fallback contact details

### Hybrid

Hybrid delivery should be supported without needing a separate model. It can be handled by session or course metadata, depending on implementation needs.

## Communications and Automation

The system should be able to email participants from within the platform.

Recommended communication events:

- booking confirmation
- reminder before course start
- reminder on the day
- joining instructions
- follow-up email
- certificate issued
- questionnaire or feedback request

Suggested reminder timing:

- immediately after booking
- 7 days before
- 24 hours before
- 2 hours before
- after completion

The communication system should support:

- sending to all participants
- sending to a selected subset
- sending to one participant
- resending a previous message
- tracking whether the email was sent

### Automation rules

The system should support rules such as:

- resend reminders when a course is rescheduled
- suppress reminders for cancelled bookings
- generate certificate tasks when completion criteria are met
- generate questionnaire or feedback emails after course completion
- notify admins when a course is nearing capacity

## Certificates and Documents

The system should support automatic and manual document handling.

Recommended document types:

- certificate
- attendance confirmation
- questionnaire
- feedback form
- joining instructions
- course slides
- post-course resources

Recommended certificate rules:

- certificates should be generated when completion criteria are met
- certificates should be stored and re-downloadable
- certificates should be re-issuable if needed
- certificate sending should be logged
- certificate templates should be versioned
- the system should allow manual override where appropriate

## Completion Rules

Training completion should be determined by course policy.

Possible completion criteria:

- attended all sessions
- attended minimum required hours
- completed questionnaire
- trainer sign-off

The system should be able to flag:

- partial attendance
- no-shows
- cancellations
- transferred bookings
- substitutions

## Administration Screens

Recommended admin screens for training:

1. Product / course definition
2. Course run setup
3. Session schedule
4. Trainer assignment
5. Venue management
6. Participant management
7. Attendance marking
8. Email / reminder management
9. Certificate management
10. Documents and attachments
11. Invoicing and billing
12. Calendar view
13. Reporting view

## Reporting

Training should have its own reporting layer separate from CRP dashboards.

Useful training metrics:

- total course runs delivered
- total sessions delivered
- seats offered
- seats booked
- seats attended
- no-show rate
- completion rate
- certificate issue rate
- revenue by course run
- revenue by participant
- free places used from CRP jobs
- lead source / client source
- capacity utilisation
- course fill rate

## Data Integration Notes

The training workflow should integrate with existing platform concepts:

- job families
- client records
- contacts
- invoicing
- notes
- communications
- file uploads
- custom fields

It should not duplicate CRP emissions logic.

The job-level `job_training_details` table should remain a summary and bridge to the detailed training delivery tables rather than duplicating session or booking state.

## Recommended Implementation Phases

### Phase 0

- confirm whether one training job can have multiple course runs
- confirm whether the reusable product and the course run should be separately editable
- confirm whether external individuals can be booked without a client record
- confirm the trainer and venue entities
- confirm entitlement status rules for free CRP-linked places
- confirm certificate policy defaults

### Phase 1

- add training product and course run tables
- support course run creation
- support participant booking
- support basic schedule and capacity
- support explicit training entitlement linkage from CRP jobs
- keep job-level `job_training_details` as a wrapper summary only

### Phase 2

- add attendance tracking
- add reminder emails
- add trainer assignment and venue records
- add online delivery details
- connect to invoicing

### Phase 3

- add certificates
- add questionnaires and post-course documents
- add calendar views and conflict checks
- add reporting

### Phase 4

- add automation and richer workflow controls
- add waitlists, substitutions, and repeat courses
- add deeper audit and analytics

## Implementation Checklist

This is the recommended build order for the first delivery cycle.

### Phase 0: decisions to lock

- [ ] Confirm whether one training job can have multiple course runs
- [ ] Confirm whether the reusable product and the course run should be separately editable
- [ ] Confirm whether external individuals can be booked without a client record
- [ ] Confirm whether trainer and venue records are mandatory for scheduled runs
- [ ] Confirm entitlement status rules for free CRP-linked places
- [ ] Confirm certificate policy defaults
- [ ] Confirm whether reminders are global defaults or course-run overrides
- [ ] Confirm whether course runs are created with the job or after job creation

### Phase 1: database foundation

- [ ] Create `training_products`
- [ ] Create `training_course_runs`
- [ ] Create `training_sessions`
- [ ] Create `training_bookings`
- [ ] Create `training_attendance`
- [ ] Create `training_entitlements`
- [ ] Create `training_trainer_assignments`
- [ ] Create `training_venues`
- [ ] Keep `job_training_details` as a wrapper summary only
- [ ] Add indexes for `job_id`, `training_product_id`, `training_course_run_id`, `client_db_id`, and `status`
- [ ] Add foreign keys and delete behaviour for booking, attendance, and entitlement links

### Phase 2: backend API

- [ ] Add endpoints to create, update, fetch, and list training products
- [ ] Add endpoints to create, update, fetch, and list course runs
- [ ] Add endpoints to create, update, and cancel bookings
- [ ] Add endpoints to record attendance at session level
- [ ] Add endpoints to allocate and consume training entitlements
- [ ] Add endpoints to manage trainer assignments
- [ ] Add endpoints to manage venues
- [ ] Add endpoints to send participant emails and reminders
- [ ] Add endpoints to issue and reissue certificates
- [ ] Add endpoints to attach and retrieve course documents

### Phase 3: UI foundation

- [ ] Add training product and course run screens in the job workspace
- [ ] Add a course run setup panel for training jobs
- [ ] Add booking management for client and external participants
- [ ] Add attendance marking per session
- [ ] Add venue and online delivery details
- [ ] Add trainer assignment UI
- [ ] Add entitlement linking UI for CRP free places
- [ ] Add reminders and email send controls

### Phase 4: automation and documents

- [ ] Add certificate generation rules
- [ ] Add questionnaire and follow-up document sending
- [ ] Add automatic reminder schedules
- [ ] Add course completion checks
- [ ] Add no-show / cancellation handling
- [ ] Add waitlist and substitution handling if needed

### Phase 5: reporting and operations

- [ ] Add training occupancy reporting
- [ ] Add booking and attendance reporting
- [ ] Add revenue reporting by course run and participant
- [ ] Add free-place usage reporting from CRP jobs
- [ ] Add trainer and venue utilisation reporting
- [ ] Add course calendar view
- [ ] Add clash detection for trainer, venue, and capacity constraints

## Day 1 Engineering Plan

Day 1 should create the minimum viable training foundation:

- a reusable training product
- a scheduled course run
- participant bookings
- a CRP-linked free-place entitlement
- a wrapper-level training job summary

This is intentionally narrower than the full brief. Attendance, reminders, certificates, and reporting stay out of day 1.

### Day 1 deliverables

1. Database migration for the core training entities
2. Backend routes for products, course runs, bookings, and entitlements
3. Training job workspace UI for creating and viewing a course run
4. Basic participant booking UI
5. Basic free-place linkage from CRP jobs

### Day 1 task sequence

1. Lock the day-1 entity shape
   - Dependency: Phase 0 decisions should be confirmed first.
   - Output: final agreement on `training_products`, `training_course_runs`, `training_bookings`, and `training_entitlements`.

2. Build the database migration
   - Dependency: task 1.
   - Output: `sql_migrations/0046_training_phase1.sql`.
   - Must create the four day-1 tables and keep `job_training_details` as the wrapper summary.

3. Add the backend schema helpers and route module
   - Dependency: task 2.
   - Output: `api/training_products_routes.py`, `api/training_course_runs_routes.py`, `api/training_bookings_routes.py`, `api/training_entitlements_routes.py` or a first-pass `api/job_training_routes.py`.
   - Must expose the day-1 API surface listed below.

4. Register the new backend routes
   - Dependency: task 3.
   - Output: update `api/main.py` to include the training routes.
   - Verify the existing job workspace still loads normally.

5. Add the job workspace training panel
   - Dependency: task 4.
   - Output: `frontend/src/components/JobTraining.tsx` and the training branch in `frontend/src/app/jobs/[jobId]/page.tsx`.
   - Must show the wrapper summary and the course run form.

6. Add course run creation and edit flow
   - Dependency: task 5.
   - Output: training run form inside the job page.
   - Must allow one initial run per training job and display capacity and delivery mode.

7. Add participant booking UI
   - Dependency: task 6.
   - Output: booking rows under the course run.
   - Must support client contacts and external participants.

8. Add entitlement linking for free CRP places
   - Dependency: task 7 and an available CRP entitlement record.
   - Output: booking selector for `training_entitlements`.
   - Must move entitlements from `available` toward `reserved` or `consumed`.

9. Wire the new training flow into the create-job journey
   - Dependency: tasks 4 to 8.
   - Output: `frontend/src/app/jobs/new/NewJobPageClient.tsx` and `frontend/src/lib/training-workflow.ts`.
   - Must show the training workflow preview and the correct post-create navigation path.

10. Validate the first end-to-end journey
   - Dependency: tasks 1 to 9.
   - Output: create a training job, add a course run, add at least one booking, and link a free entitlement if available.
   - Success criteria: the job loads, the training panel saves, and the booking data persists.

### Exact database changes

Create a new migration file, for example:

- `sql_migrations/0046_training_phase1.sql`

The migration should create:

- `training_products`
- `training_course_runs`
- `training_bookings`
- `training_entitlements`

It should also extend or keep using:

- `job_training_details` as the wrapper-level summary table

It should not yet create:

- `training_sessions`
- `training_attendance`
- `training_trainer_assignments`
- `training_venues`

Those belong to later phases.

### Exact backend files

Create or update these backend files:

- `api/training_products_routes.py`
- `api/training_course_runs_routes.py`
- `api/training_bookings_routes.py`
- `api/training_entitlements_routes.py`
- `api/job_training_routes.py`
- `api/main.py`

If the team wants to move more slowly, the first pass can keep the routes grouped into one `api/job_training_routes.py` module and split them later.

### Day 1 API surface

At minimum, day 1 should support:

- `GET /jobs/{job_id}/training-details`
- `PUT /jobs/{job_id}/training-details`
- `GET /training-products`
- `POST /training-products`
- `GET /training-course-runs?job_id=...`
- `POST /training-course-runs`
- `GET /training-bookings?training_course_run_id=...`
- `POST /training-bookings`
- `PUT /training-bookings/{booking_id}`
- `POST /training-entitlements`
- `PUT /training-entitlements/{entitlement_id}/consume`

### Exact frontend files

Update or create these frontend files:

- `frontend/src/components/JobTraining.tsx`
- `frontend/src/app/jobs/[jobId]/page.tsx`
- `frontend/src/app/jobs/new/NewJobPageClient.tsx`
- `frontend/src/lib/training-workflow.ts`

Day 1 should make the training section on the job page able to:

- show the linked training product
- show the scheduled course run
- add/edit participant bookings
- link a booking to a free CRP entitlement
- show whether the course is in-person or online

### Day 1 UI sequence

1. In the job page, render a training summary panel for `job_family = training`
2. Add a course run form inside the training panel
3. Add participant booking rows under the course run
4. Add a free-place selector that can link a CRP entitlement
5. Add a capacity indicator and a booked-count indicator

### Day 1 business rules

- one training job may initially create one course run
- external participants may be entered without a client record if needed
- course capacity should be checked at booking time
- free entitlements should move from `available` to `reserved` or `consumed`
- no attendance, reminders, or certificates are required on day 1

### Day 1 out of scope

- attendance marking
- reminder automation
- certificate generation
- trainer calendars
- venue calendars
- reporting dashboards
- waitlists
- substitutions
- questionnaire sending

## Open Questions

Before implementation, the team should confirm:

- whether a training job can have multiple course runs
- whether a reusable product can be edited independently of its course runs
- whether external individuals can be booked without a client record
- whether certificates are mandatory for all training course runs
- whether no-show fees should be automatic or manual
- whether course capacity should be enforced strictly
- whether reminders should be configurable per course run or globally
- whether course runs should be created at the same time as the job or separately after job creation
- whether trainer and venue records should be mandatory for scheduled runs

## Summary

Training needs its own operational model. The safest and most scalable approach is to keep the job as the commercial wrapper and add dedicated product, course run, session, booking, attendance, communication, certificate, entitlement, trainer, venue, and document structures underneath it.

That approach covers:

- CRP-linked free places
- standalone paid courses
- client and external participants
- multi-day delivery
- in-person and online delivery
- reminders
- attendance
- invoicing
- certificates
- post-course follow-up
