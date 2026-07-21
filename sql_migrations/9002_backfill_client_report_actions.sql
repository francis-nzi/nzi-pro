-- WARNING
-- Manual, one-off migration. Not auto-applied (numbered >= 9000, see
-- apply_sql_migrations.py's _migration_files() gate -- requires
-- INCLUDE_MANUAL_SQL_MIGRATIONS=1 to run at all).
--
-- Prerequisite: the app must have booted at least once against this DB
-- after the code that creates client_report_actions / client_report_action_updates
-- (services/report_actions.py::ensure_report_actions_schema) has been deployed,
-- so those tables already exist before this script runs.
--
-- Purpose:
-- Backfill existing job-scoped "Actions" (job_report_actions) into the new
-- client-scoped table (client_report_actions) -- see the "Actions: move
-- from job-scoped to client-scoped" plan. A client now has one shared
-- action list across all its jobs/reporting years. Where the same client
-- had the same action name on more than one job (a copy, or two
-- independently-created actions with the same name), this keeps ONE row
-- per (client, action name), preferring the most-recently-updated /
-- highest-progress version; every distinct action name across a client's
-- jobs is preserved (nothing dropped for clients whose jobs had genuinely
-- independent action lists).
--
-- Does NOT touch job_report_actions or job_report_action_updates -- both
-- are left exactly as they are, untouched, as a rollback reference. The
-- app no longer reads or writes them after this migration's code lands.
--
-- Dry run this file's mapping SELECT alone (comment out the two INSERT/
-- UPDATE statements below, or run inside a transaction you roll back)
-- before running for real -- already done once this session, confirmed
-- correct for clients 205 and 227, the only two clients with actions on
-- more than one job as of 2026-07-21.

BEGIN;

-- Reviewable mapping: every existing job_report_actions row -> the
-- (client_db_id, lower(action_name)) group it belongs to, plus which row
-- in that group is the surviving "winner". Kept permanently as the audit
-- trail for this migration, not dropped after use.
CREATE TABLE IF NOT EXISTS client_report_actions_migration_map (
  job_action_id         INTEGER PRIMARY KEY,
  job_id                INTEGER NOT NULL,
  client_db_id          INTEGER NOT NULL,
  action_name           TEXT NOT NULL,
  rank_in_group         INTEGER NOT NULL,
  is_winner             BOOLEAN NOT NULL,
  new_client_action_id  INTEGER
);

INSERT INTO client_report_actions_migration_map
  (job_action_id, job_id, client_db_id, action_name, rank_in_group, is_winner)
SELECT
  a.job_action_id,
  a.job_id,
  j.client_db_id,
  a.action_name,
  ROW_NUMBER() OVER (
    PARTITION BY j.client_db_id, LOWER(a.action_name)
    ORDER BY a.updated_at DESC NULLS LAST, a.progress DESC, a.job_action_id DESC
  ) AS rank_in_group,
  ROW_NUMBER() OVER (
    PARTITION BY j.client_db_id, LOWER(a.action_name)
    ORDER BY a.updated_at DESC NULLS LAST, a.progress DESC, a.job_action_id DESC
  ) = 1 AS is_winner
FROM job_report_actions a
JOIN jobs j ON j.job_id = a.job_id
WHERE j.client_db_id IS NOT NULL
ON CONFLICT (job_action_id) DO NOTHING;

-- One client_report_actions row per (client_db_id, action_name) group,
-- using the winner's data. origin_job_id records which job the surviving
-- row was originally created against, for historical traceability only
-- (never used in a WHERE clause by the app).
INSERT INTO client_report_actions
  (client_db_id, origin_job_id, action_option_id, action_name, description,
   action_term, action_category, scope_focus, is_custom, sort_order,
   status, progress, target_date, completed_at, owner_contact_id,
   created_at, updated_at, created_by, updated_by)
SELECT
  j.client_db_id, a.job_id, a.action_option_id, a.action_name, a.description,
  a.action_term, a.action_category, a.scope_focus, a.is_custom, a.sort_order,
  COALESCE(a.status, 'open'), COALESCE(a.progress, 0), a.target_date, a.completed_at,
  a.owner_contact_id, a.created_at, a.updated_at, a.created_by, a.updated_by
FROM job_report_actions a
JOIN jobs j ON j.job_id = a.job_id
JOIN client_report_actions_migration_map m
  ON m.job_action_id = a.job_action_id AND m.is_winner
ON CONFLICT (client_db_id, (LOWER(action_name))) DO NOTHING;

-- Back-fill the mapping table with the surviving client_action_id for
-- every contributing row (winners and the merged-away duplicates alike),
-- so the map is a complete old-row -> new-row lookup.
UPDATE client_report_actions_migration_map m
SET new_client_action_id = c.client_action_id
FROM client_report_actions c
WHERE c.client_db_id = m.client_db_id
  AND LOWER(c.action_name) = LOWER(m.action_name);

COMMIT;

-- Verification queries to run after (not part of the migration itself):
--   SELECT COUNT(*) FROM client_report_actions;
--   SELECT COUNT(*) FROM client_report_actions_migration_map WHERE new_client_action_id IS NULL;  -- should be 0
--   SELECT client_db_id, COUNT(*) FROM client_report_actions WHERE client_db_id IN (205, 227) GROUP BY client_db_id;
