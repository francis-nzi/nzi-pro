ALTER TABLE public.job_scope_rows
  ADD COLUMN IF NOT EXISTS data_confidence varchar DEFAULT 'M';
