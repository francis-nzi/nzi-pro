-- Migration 0012: Add report metadata fields to jobs table
-- Required for carbon reporting enhancements

-- Add baseline_year (number) - The year against which reductions are measured
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS baseline_year INTEGER;

-- Add net_zero_target_year (number) - The year by which net zero is targeted
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS net_zero_target_year INTEGER;

-- Add glossary_terms (JSON) - Custom glossary terms for the report
-- Stored as JSON array: [{"term": "tCO2e", "definition": "..."}, ...]
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS glossary_terms JSONB DEFAULT '[]'::jsonb;

-- Add interim_target_year (number) - Explicit interim target year override
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS interim_target_year INTEGER;

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_jobs_baseline_year ON jobs(baseline_year) WHERE baseline_year IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_net_zero_target_year ON jobs(net_zero_target_year) WHERE net_zero_target_year IS NOT NULL;

COMMENT ON COLUMN jobs.baseline_year IS 'The baseline year against which emissions reductions are measured';
COMMENT ON COLUMN jobs.net_zero_target_year IS 'The target year for achieving net zero emissions';
COMMENT ON COLUMN jobs.glossary_terms IS 'JSON array of custom glossary terms for the report';
COMMENT ON COLUMN jobs.interim_target_year IS 'Explicit interim target year override';
