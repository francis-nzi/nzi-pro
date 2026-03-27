-- Keep active job scope rows unique while allowing disabled history rows to persist.

DROP INDEX IF EXISTS public.job_scope_rows_job_site_scope_oid_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS job_scope_rows_job_site_scope_active_uidx
ON public.job_scope_rows (job_id, site_id, scope, original_id)
WHERE COALESCE(enabled, TRUE) = TRUE;
