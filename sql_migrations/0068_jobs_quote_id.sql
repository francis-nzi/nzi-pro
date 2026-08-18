-- 0068_jobs_quote_id.sql
--
-- Durable link from a job back to the quote it was created from, matching
-- the pattern invoices.quote_id already establishes. Previously the only
-- link was a one-directional, best-effort PATCH writing the new job's
-- job_number string back onto the quote row (NewJobPageClient.tsx) --
-- fragile, and never used to actually copy the quote's line items into
-- the new job's job_line_items (see api/job_management_routes.py
-- create_job(), which always populated from the generic job_type_items
-- template regardless of an accepted quote existing).

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_id INTEGER REFERENCES quotes(quote_id);
