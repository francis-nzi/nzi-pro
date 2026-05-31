# Training Workflow Brief

## Purpose

Training is no longer just a small job subtype. It is a deliverable with its own operational lifecycle, participants, sessions, reminders, certificates, invoicing rules, and calendar management needs.

The purpose of this brief is to define a training workflow that supports:

- client and non-client attendees
- free places linked from CRP jobs
- paid places billed through invoicing
- multi-session courses spanning one or more days
- in-person, online, and hybrid delivery
- automated reminders and post-course follow-up
- attendance, no-shows, certificates, and documents

This brief is intended to sit on top of the existing job-family model, where `training` is one of the canonical families.

## Core Principle

> **Treat training as a course delivery model, not just a job record with a few extra fields.**

The commercial job record should remain the container for ownership, client linkage, and billing context, but the actual training delivery should be modelled as course sessions and participant bookings.

## Recommended Structure

The cleanest model is:

- **Training Job**: the commercial wrapper and client/job context
- **Training Course**: the training product or course offering
- **Training Session**: one scheduled delivery block, such as a full day, half-day, or multi-day course component
- **Training Booking / Enrollment**: one participant booking onto a course
- **Training Attendance**: attendance record for a participant on a session
- **Training Documents**: certificates, questionnaires, joining instructions, slides, and feedback forms

This gives the system enough flexibility to handle:

- one-off CPD courses
- repeated public courses
- client-only courses
- mixed client and external attendee courses
- courses included in a CRP engagement
- courses that are invoiced separately

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

These should be used to support the hand-off from a CRP job to an associated training entitlement.

Recommended rule:

- when a CRP job includes a free training place, the job should be able to link to the training booking that consumed that entitlement
- the training booking should show where the free place originated from
- the CRP job should record whether the free place was used, booked, completed, cancelled, or transferred

### Invoicing

Training should connect to the invoicing process already in the platform.

Recommended billing logic:

- a course can be billed by course, by participant, or by booking block
- the system should support invoice generation from the training booking
- invoice lines should be able to reflect:
  - course fee
  - participant fee
  - additional attendee fee
  - cancellation fee
  - no-show fee if required

## Course Model

### Training Course

The course record should hold the offering itself, not just the booking.

Recommended fields:

| Field | Purpose |
|---|---|
| `training_course_id` | Primary key |
| `job_id` | Parent commercial job |
| `course_title` | Course name |
| `course_code` | Internal or external reference |
| `course_type` | e.g. CPD, workshop, leadership course |
| `total_hours` | Allocated delivery hours |
| `delivery_format` | `in_person`, `online`, `hybrid` |
| `capacity` | Maximum participants |
| `min_attendees` | Optional minimum delivery threshold |
| `status` | Draft, scheduled, open, full, in progress, completed, cancelled, archived |
| `venue_id` | Linked venue if in person |
| `online_meeting_url` | Linked online meeting URL if virtual |
| `online_meeting_id` | Optional meeting ID |
| `online_passcode` | Optional passcode |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

### Training Session

A course may span one or more delivery sessions.

Recommended fields:

| Field | Purpose |
|---|---|
| `training_session_id` | Primary key |
| `training_course_id` | Parent course |
| `session_date` | Date of the session |
| `start_time` | Start time |
| `end_time` | End time |
| `timezone` | Timezone for the session |
| `session_order` | Sequence order for multi-day courses |
| `session_hours` | Allocated hours for the session |
| `location_note` | Optional room / link / joining note |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

### Participant / Booking

Training participants should be modelled separately from the course because a course may include:

- client contacts
- external individuals
- mixed audiences

Recommended fields:

| Field | Purpose |
|---|---|
| `training_booking_id` | Primary key |
| `training_course_id` | Parent course |
| `client_db_id` | Linked client, if any |
| `contact_id` | Linked client contact, if any |
| `person_name` | Participant name |
| `person_email` | Participant email |
| `person_phone` | Participant phone |
| `booking_type` | `client`, `external`, `internal` |
| `booking_source` | `free_place`, `paid`, `included`, `discounted` |
| `billing_status` | `not_billable`, `to_invoice`, `invoiced`, `paid`, `waived` |
| `attendance_status` | `invited`, `booked`, `confirmed`, `attended`, `no_show`, `cancelled` |
| `special_requirements` | Accessibility, dietary, or access notes |
| `consent_status` | Communication consent or marketing opt-in |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

### Attendance

Attendance should be tracked at session level, not only at course level.

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

## Workflow

Suggested course workflow:

1. Draft
2. Scheduled
3. Open for booking
4. Full
5. In progress
6. Completed
7. Closed / archived

This workflow should sit alongside the shared job lifecycle status, not replace it.

### Suggested workflow stages

- Draft
- Setup complete
- Booking open
- Reminder sent
- Course in progress
- Awaiting certificates
- Completed
- Closed

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

## Delivery Modes

### In person

In-person courses should manage:

- venue name
- address
- room
- parking/access notes
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

## Communications

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

## Administration Screens

Recommended admin screens for training:

1. Course setup
2. Session schedule
3. Participant management
4. Attendance marking
5. Email / reminder management
6. Certificate management
7. Documents and attachments
8. Invoicing and billing
9. Calendar view
10. Reporting view

## Reporting

Training should have its own reporting layer separate from CRP dashboards.

Useful training metrics:

- total courses delivered
- total sessions delivered
- seats offered
- seats booked
- seats attended
- no-show rate
- completion rate
- certificate issue rate
- revenue by course
- revenue by participant
- free places used from CRP jobs
- lead source / client source

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

## Recommended Implementation Phases

### Phase 1

- add training course and booking tables
- support course creation
- support participant booking
- support basic schedule and capacity
- support free-place linkage from CRP jobs

### Phase 2

- add attendance tracking
- add reminder emails
- add venue and online delivery details
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

## Open Questions

Before implementation, the team should confirm:

- whether a training job always creates one course or can have multiple courses
- whether external individuals can be booked without a client record
- whether certificates are mandatory for all training courses
- whether no-show fees should be automatic or manual
- whether course capacity should be enforced strictly
- whether reminders should be configurable per course or globally
- whether the training course should be created at the same time as the job or separately after job creation

## Summary

Training needs its own operational model. The safest and most scalable approach is to keep the job as the commercial wrapper and add dedicated course, session, booking, attendance, communication, certificate, and document structures underneath it.

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

