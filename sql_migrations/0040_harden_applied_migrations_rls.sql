-- 0040_harden_applied_migrations_rls.sql
-- Enable row level security on the migration audit table so Supabase
-- Security Advisor does not flag it as a public table without RLS.

BEGIN;

ALTER TABLE IF EXISTS public.applied_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS applied_migrations_service_role_all ON public.applied_migrations;

CREATE POLICY applied_migrations_service_role_all
ON public.applied_migrations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMIT;
