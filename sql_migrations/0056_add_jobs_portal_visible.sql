-- 0056_add_jobs_portal_visible.sql
--
-- Adds a per-job visibility switch for the client portal. Every portal
-- job-listing/single-job endpoint currently returns all of a client's jobs
-- unconditionally with no way to keep a draft/cancelled job out of the
-- client's view. Defaults to TRUE so existing behaviour (all jobs visible)
-- is unchanged until a CRM user explicitly hides one via Client -> Portal
-- -> Jobs.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS portal_visible BOOLEAN NOT NULL DEFAULT TRUE;
