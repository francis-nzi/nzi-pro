-- 0039_force_rls_org_scoped_tables.sql
-- Force RLS on org-scoped application tables after tenant-aware policies
-- have been installed and the runtime now stamps app.current_org_id.

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

        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    END LOOP;
END
$$;
