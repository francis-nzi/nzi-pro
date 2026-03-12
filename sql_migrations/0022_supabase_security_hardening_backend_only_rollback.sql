-- 0022_supabase_security_hardening_backend_only_rollback.sql
-- Purpose:
--   Roll back 0021 hardening to a permissive compatibility posture.
--   This script:
--   1) Restores broad grants for anon/authenticated
--   2) Re-adds authenticated/service_role permissive RLS policies
--   3) Attempts to revert security_invoker reloption on public views
--
-- Safe to run multiple times (idempotent).

BEGIN;

-- 1) Restore broad privileges (compatibility mode).
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- 2) Restore permissive RLS policies.
DO $$
DECLARE
  rec RECORD;
  t TEXT;
BEGIN
  FOR rec IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'pg_%'
      AND tablename <> 'applied_migrations'
  LOOP
    t := rec.tablename;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS svc_role_all ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_authenticated_all ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_all ON public.%I', t, t);

    EXECUTE format(
      'CREATE POLICY %I_authenticated_all ON public.%I
       FOR ALL TO authenticated
       USING (true)
       WITH CHECK (true)',
      t, t
    );

    EXECUTE format(
      'CREATE POLICY %I_service_role_all ON public.%I
       FOR ALL TO service_role
       USING (true)
       WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;

-- 3) Revert security_invoker where supported.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT c.relname AS view_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
  LOOP
    BEGIN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = false)', rec.view_name);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;

COMMIT;

