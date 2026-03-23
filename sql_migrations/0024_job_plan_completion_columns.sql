ALTER TABLE public.job_plan
    ADD COLUMN IF NOT EXISTS data_collection_completed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS data_collection_completed_by VARCHAR,
    ADD COLUMN IF NOT EXISTS first_draft_completed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS first_draft_completed_by VARCHAR,
    ADD COLUMN IF NOT EXISTS final_report_completed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS final_report_completed_by VARCHAR;
