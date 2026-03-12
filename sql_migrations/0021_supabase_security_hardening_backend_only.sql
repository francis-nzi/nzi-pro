-- 0021_supabase_security_hardening_backend_only.sql
-- Purpose:
--   Harden Supabase Postgres for backend-only access patterns.
--   This script:
--   1) Revokes broad grants from anon/authenticated roles
--   2) Enables RLS on all public base tables (except applied_migrations)
--   3) Removes permissive authenticated policies created by older baseline scripts
--   4) Adds service_role-only ALL policy per table
--   5) Sets public views to security_invoker=true where supported
--
-- Safe to run multiple times (idempotent).

BEGIN;

-- 1) Remove broad direct grants from Supabase client roles.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Keep schema usage for object name resolution; object-level grants/RLS still gate access.
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 2-4) Enforce RLS and keep only service_role policy on each table.
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

    -- Remove older permissive policies if present.
    EXECUTE format('DROP POLICY IF EXISTS %I_authenticated_all ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_all ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS auth_all ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_all ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS svc_role_all ON public.%I', t);

    -- Service-role-only access policy.
    EXECUTE format(
      'CREATE POLICY svc_role_all ON public.%I
       FOR ALL TO service_role
       USING (true)
       WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- 5) Reduce Security Advisor warnings on security definer views.
-- Some Postgres versions may not support this reloption; handle gracefully.
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
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', rec.view_name);
    EXCEPTION WHEN OTHERS THEN
      -- Keep migration non-fatal if unsupported on this PG version.
      NULL;
    END;
  END LOOP;
END $$;

COMMIT;

