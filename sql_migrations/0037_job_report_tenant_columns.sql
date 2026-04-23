-- Tenant columns for report/archive tables and report draft storage.
-- These tables are job-scoped and must carry org_id for multi-tenant isolation.

ALTER TABLE IF EXISTS job_report_variable_values ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE IF EXISTS job_report_template_assignments ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE IF EXISTS job_report_versions ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE IF EXISTS job_report_drafts ADD COLUMN IF NOT EXISTS org_id TEXT;

UPDATE job_report_variable_values jrv
SET org_id = COALESCE(jrv.org_id, c.org_id)
FROM jobs j
JOIN clients c ON c.db_id = j.client_db_id
WHERE j.job_id = jrv.job_id
  AND jrv.org_id IS NULL;

UPDATE job_report_template_assignments jra
SET org_id = COALESCE(jra.org_id, c.org_id)
FROM jobs j
JOIN clients c ON c.db_id = j.client_db_id
WHERE j.job_id = jra.job_id
  AND jra.org_id IS NULL;

UPDATE job_report_versions jrv
SET org_id = COALESCE(jrv.org_id, c.org_id)
FROM jobs j
JOIN clients c ON c.db_id = j.client_db_id
WHERE j.job_id = jrv.job_id
  AND jrv.org_id IS NULL;

UPDATE job_report_drafts jrd
SET org_id = COALESCE(jrd.org_id, c.org_id)
FROM jobs j
JOIN clients c ON c.db_id = j.client_db_id
WHERE j.job_id = jrd.job_id
  AND jrd.org_id IS NULL;

CREATE INDEX IF NOT EXISTS job_report_variable_values_lookup_idx
ON job_report_variable_values (org_id, job_id, template_id, version_id);

CREATE INDEX IF NOT EXISTS job_report_template_assignments_org_idx
ON job_report_template_assignments (org_id, job_id);

CREATE INDEX IF NOT EXISTS job_report_versions_org_idx
ON job_report_versions (org_id, job_id, version_number DESC);

CREATE INDEX IF NOT EXISTS job_report_drafts_org_idx
ON job_report_drafts (org_id, job_id, template_id, version_id, section_key, updated_at DESC);

