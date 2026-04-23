-- Normalize legacy quote/billing org_id columns to UUID.
-- Existing data was audited and found to contain UUID-safe values only.

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
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN org_id TYPE UUID USING NULLIF(org_id::text, '''')::UUID',
        tbl
      );
    END IF;
  END LOOP;
END $$;

