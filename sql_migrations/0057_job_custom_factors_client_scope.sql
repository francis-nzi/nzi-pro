-- 0057_job_custom_factors_client_scope.sql
--
-- "Job-Only Factors" (job_custom_factors) were scoped strictly to the job
-- they were created in -- unusable in any other job for the same client,
-- including prior years. This migration makes client_db_id the real
-- ownership column (mirroring custom_factors' client_db_id/is_global
-- pattern), adds a normalized per-year values table (mirroring
-- custom_factor_year_values), and relaxes job_id's FK so deleting the
-- job a factor happened to be created in no longer deletes a factor
-- other jobs may now depend on -- job_id becomes provenance, not an
-- access-control column.

ALTER TABLE job_custom_factors ADD COLUMN IF NOT EXISTS client_db_id INTEGER;

UPDATE job_custom_factors jcf
SET client_db_id = j.client_db_id
FROM jobs j
WHERE j.job_id = jcf.job_id
  AND jcf.client_db_id IS NULL;

CREATE INDEX IF NOT EXISTS job_custom_factors_client_idx
ON job_custom_factors (client_db_id, archived, is_active, scope);

CREATE TABLE IF NOT EXISTS job_custom_factor_year_values (
  factor_id INTEGER NOT NULL REFERENCES job_custom_factors(factor_id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  factor DOUBLE PRECISION,
  PRIMARY KEY (factor_id, year)
);

ALTER TABLE job_custom_factors ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE job_custom_factors DROP CONSTRAINT IF EXISTS job_custom_factors_job_id_fkey;

ALTER TABLE job_custom_factors
  ADD CONSTRAINT job_custom_factors_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE SET NULL;
