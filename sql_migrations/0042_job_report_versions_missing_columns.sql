-- 0042_job_report_versions_missing_columns.sql
-- Add columns that were added to the CREATE TABLE definition after the
-- table was first created in some production environments.  The migration
-- uses ALTER TABLE IF EXISTS / ADD COLUMN IF NOT EXISTS so it is safe to
-- re-run and harmless when the columns already exist.

ALTER TABLE IF EXISTS public.job_report_versions
    ADD COLUMN IF NOT EXISTS version_label VARCHAR,
    ADD COLUMN IF NOT EXISTS storage_provider VARCHAR DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS external_item_id VARCHAR,
    ADD COLUMN IF NOT EXISTS external_web_url TEXT,
    ADD COLUMN IF NOT EXISTS external_path TEXT,
    ADD COLUMN IF NOT EXISTS data_hash VARCHAR,
    ADD COLUMN IF NOT EXISTS snapshot_json TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS generated_by VARCHAR,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR,
    ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS finalized_by VARCHAR,
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS superseded_by VARCHAR;
