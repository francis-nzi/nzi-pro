-- Per-site persistence for job scope rows

ALTER TABLE public.job_scope_rows
  ADD COLUMN IF NOT EXISTS site_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_scope_rows_site_id_fkey'
  ) THEN
    ALTER TABLE public.job_scope_rows
      ADD CONSTRAINT job_scope_rows_site_id_fkey
      FOREIGN KEY (site_id)
      REFERENCES public.client_sites(site_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS job_scope_rows_job_site_scope_oid_uidx
ON public.job_scope_rows (job_id, site_id, scope, original_id);
