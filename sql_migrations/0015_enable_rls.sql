-- 0015_enable_rls.sql
-- Enable RLS across all application tables in public schema and add baseline policies.
--
-- Baseline posture:
-- - RLS enabled for every user table in public schema
-- - "authenticated" role can access rows (existing behavior preserved for logged-in clients)
-- - "service_role" can access rows (server-side jobs/integrations)
-- - no "anon" policy (anonymous access denied by default when RLS is enabled)
--
-- NOTE:
-- This migration intentionally does not use FORCE ROW LEVEL SECURITY.
-- Table owners (e.g., postgres) may still bypass RLS. If you later want strict
-- enforcement for owner connections, add FORCE RLS after validating policies.

DO $$
DECLARE
    rec RECORD;
    v_table TEXT;
    v_auth_pol TEXT;
    v_srv_pol TEXT;
BEGIN
    FOR rec IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT LIKE 'pg_%'
          AND tablename NOT IN ('applied_migrations')
    LOOP
        v_table := rec.tablename;
        v_auth_pol := format('%I_authenticated_all', v_table);
        v_srv_pol := format('%I_service_role_all', v_table);

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

        EXECUTE format(
            'CREATE POLICY %I ON public.%I
             FOR ALL TO authenticated
             USING (true)
             WITH CHECK (true)',
            v_auth_pol, v_table
        );

        EXECUTE format(
            'CREATE POLICY %I ON public.%I
             FOR ALL TO service_role
             USING (true)
             WITH CHECK (true)',
            v_srv_pol, v_table
        );
    END LOOP;
END
$$;

