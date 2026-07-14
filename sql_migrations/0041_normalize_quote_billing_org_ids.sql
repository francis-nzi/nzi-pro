-- Normalize legacy quote/billing org_id columns to UUID.
-- Existing data was audited and found to contain UUID-safe values only.
--
-- Postgres refuses ALTER COLUMN ... TYPE on a column referenced by an RLS
-- policy (0038_tenant_rls_org_policies.sql created "tenant_org_isolation" on
-- every org_id-bearing table, including these). Drop it before the type
-- change and recreate it identically afterward -- same policy text as 0038,
-- confirmed as the only policy present on each of these tables.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'quotes',
    'quote_lines',
    'quote_email_log',
    'invoices',
    'invoice_lines',
    'invoice_email_log',
    'job_other_costs'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'org_id'
        AND data_type <> 'uuid'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS tenant_org_isolation ON public.%I', tbl);

      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN org_id TYPE UUID USING NULLIF(org_id::text, '''')::UUID',
        tbl
      );

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
          tbl
      );
    END IF;
  END LOOP;
END $$;

