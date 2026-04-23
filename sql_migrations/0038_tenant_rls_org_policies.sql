-- 0038_tenant_rls_org_policies.sql
-- Replace permissive RLS policies with tenant-aware policies for org-scoped tables.
--
-- Policy model:
-- - Rows are visible when app.current_org_id matches the row org_id.
-- - A migration/backfill bypass is available through app.bypass_tenant_rls = 'on'.
-- - Non-org-scoped tables are left untouched by this migration.
--
-- This script intentionally does not FORCE ROW LEVEL SECURITY. That is handled
-- separately once the runtime paths have been verified to set app.current_org_id
-- consistently for every request and background job.

DO $$
DECLARE
    rec RECORD;
    v_table TEXT;
BEGIN
    FOR rec IN
        SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name = 'org_id'
          AND t.table_type = 'BASE TABLE'
          AND c.table_name NOT IN ('applied_migrations')
        GROUP BY c.table_name
    LOOP
        v_table := rec.table_name;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

        EXECUTE format('DROP POLICY IF EXISTS %I_authenticated_all ON public.%I', v_table, v_table);
        EXECUTE format('DROP POLICY IF EXISTS %I_service_role_all ON public.%I', v_table, v_table);
        EXECUTE format('DROP POLICY IF EXISTS svc_role_all ON public.%I', v_table);
        EXECUTE format('DROP POLICY IF EXISTS tenant_org_isolation ON public.%I', v_table);
        EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', v_table, v_table);

        EXECUTE format(
            $policy$
            CREATE POLICY tenant_org_isolation ON public.%I
            FOR ALL
            USING (
                lower(coalesce(current_setting('app.bypass_tenant_rls', true), 'off')) = 'on'
                OR (
                    NULLIF(current_setting('app.current_org_id', true), '') IS NOT NULL
                    AND COALESCE(org_id::text, '') = current_setting('app.current_org_id', true)
                )
            )
            WITH CHECK (
                lower(coalesce(current_setting('app.bypass_tenant_rls', true), 'off')) = 'on'
                OR (
                    NULLIF(current_setting('app.current_org_id', true), '') IS NOT NULL
                    AND COALESCE(org_id::text, '') = current_setting('app.current_org_id', true)
                )
            )
            $policy$,
            v_table
        );
    END LOOP;
END
$$;
