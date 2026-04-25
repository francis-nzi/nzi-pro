# Tenant Limit Enforcement Checklist

This checklist turns backend capacity checks into a clear, user-friendly experience.

Use it to implement the next ticket after billing and entitlement visibility.

## Goal

Make it obvious why an org action failed and what to do next when:

- the plan is inactive
- the user limit is reached
- the client limit is reached
- the invite limit is reached

## Scope

Cover the primary places where org capacity failures can happen:

- organisation creation and edits
- user invitation
- org switching
- client creation
- any other action that already calls `_require_org_capacity` or `_require_org_plan_active`

## Checklist

### 1. Standardise the error payload

- Confirm every capacity failure returns a consistent error shape.
- Include:
  - `reason`
  - `org_id`
  - `plan`
  - `plan_status`
  - `max_users`
  - `max_clients`
  - `active_members`
  - `active_clients`
  - `pending_invites`
  - `limit_type`
  - `limit_value`
  - `current_value`
- Keep the HTTP status code as `403` for denied capacity actions.

### 2. Add a shared client-side parser

- Create one helper that converts backend limit errors into a readable message.
- Map backend reasons to user-facing copy:
  - inactive plan -> "This organisation is inactive or paused."
  - user limit -> "User limit reached."
  - client limit -> "Client limit reached."
  - invite limit -> "Invite limit reached."
- Include the current usage and limit in the message whenever available.

### 3. Surface the message in the right screens

- Show the limit message on:
  - [`frontend/src/app/admin/organisations/page.tsx`](c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents%20Operations%20Technical%20Systems%20Carbon%20Reporting%20Python%20nzi_pro_v7-POSTGRES/frontend/src/app/admin/organisations/page.tsx)
  - [`frontend/src/app/admin/billing/page.tsx`](c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents%20Operations%20Technical%20Systems%20Carbon%20Reporting%20Python%20nzi_pro_v7-POSTGRES/frontend/src/app/admin/billing/page.tsx)
  - any client/job create flow that can be blocked by org capacity
- Keep the message visible until the user dismisses it or retries successfully.

### 4. Add clear CTAs

- When the limit is a billing or entitlement issue, link to `/admin/billing`.
- When the issue is user/client capacity, link to the organisations page.
- When the issue is invite-related, point to the relevant org membership section.

### 5. Distinguish hard denials from recoverable states

- Preserve fail-closed backend behavior.
- Do not silently retry denied actions.
- Only retry automatically when the backend response is a fallback-safe lookup issue, not a true capacity denial.

### 6. Improve admin visibility

- Show the current usage vs limit card in the billing page.
- Make the organisations page highlight when the selected org is close to or over a limit.
- If possible, add a warning badge for:
  - `>= 80%` of user limit
  - `>= 80%` of client limit
  - pending invites close to the limit

### 7. Add regression tests

- Add backend tests that prove each denial case returns the right reason and payload.
- Add frontend-facing tests or route tests for:
  - inactive plan
  - user limit reached
  - client limit reached
  - invite limit reached
- Keep the smoke test passing.

### 8. Verify the user journey

- Trigger each failure intentionally in a test org.
- Confirm the message is specific and actionable.
- Confirm the CTA points to the right admin page.
- Confirm no confusing 500/403 loop appears.

## Acceptance Criteria

- A user sees a plain-English explanation when a limit blocks an action.
- The message includes the relevant numbers.
- Admins can jump to billing or org management from the failure state.
- Backend enforcement remains unchanged and secure.
- Tests cover each denial mode.

## Stop Conditions

Pause and inspect before merging if:

- a capacity failure is still returning a generic 403 with no detail
- the frontend is swallowing the error and showing a blank page
- a denial is being retried automatically
- the UI suggests the user should keep trying the same blocked action

