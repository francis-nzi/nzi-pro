-- Tenancy bootstrap: create organisations table, seed default org, add org_id
-- to all tenant-scoped tables, and backfill existing rows.
-- This mirrors the Python core/migrations.py tenancy scaffold so it runs
-- reliably via apply_sql_migrations.py on every deploy.

-- 1. Organisations table
CREATE TABLE IF NOT EXISTS organisations (
  org_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE,
  plan VARCHAR DEFAULT 'trial',
  plan_status VARCHAR DEFAULT 'active',
  trial_ends_at TIMESTAMP,
  stripe_customer_id VARCHAR,
  stripe_subscription_id VARCHAR,
  max_users INTEGER DEFAULT 3,
  max_clients INTEGER DEFAULT 10,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Organisation invitations table
CREATE TABLE IF NOT EXISTS organisation_invitations (
  invitation_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES organisations(org_id),
  email VARCHAR NOT NULL,
  role VARCHAR DEFAULT 'Consultant',
  invited_by VARCHAR,
  token VARCHAR UNIQUE NOT NULL,
  accepted_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Seed the default internal organisation
INSERT INTO organisations (name, slug, plan, plan_status, max_users, max_clients)
SELECT 'NZI Internal', 'nzi-internal', 'trial', 'active', 999, 999
WHERE NOT EXISTS (
  SELECT 1 FROM organisations WHERE slug = 'nzi-internal'
);

-- 4. Add org_id column to all tenant-scoped tables
-- Using DO block so each ALTER is independent and won't fail if the table
-- doesn't exist yet (e.g. on a fresh DB where not all features are deployed).
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'users',
      'clients',
      'client_contacts',
      'client_sites',
      'client_notes',
      'jobs',
      'job_scope_rows',
      'job_scope_config',
      'job_emission_groups',
      'job_emission_sources',
      'job_custom_factors',
      'job_plan',
      'job_files',
      'job_templates',
      'crp_job_details',
      'crp_scope_entries',
      'time_logs',
      'feedback_items',
      'datasets',
      'custom_factors',
      'custom_factor_year_values',
      'custom_conversion_factors',
      'milestone_templates',
      'milestone_template_items',
      'xero_connections',
      'xero_contact_links',
      'xero_invoice_links',
      'system_settings',
      'lookups',
      'roles_lookup',
      'time_subjects',
      'portfolios_lookup',
      'job_types'
    ])
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS org_id UUID', tbl);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END LOOP;
END
$$;

-- 5. Backfill all NULL org_id rows with the default organisation
DO $$
DECLARE
  default_org UUID;
  tbl TEXT;
BEGIN
  SELECT org_id INTO default_org
  FROM organisations
  WHERE slug = 'nzi-internal'
  LIMIT 1;

  IF default_org IS NULL THEN
    RETURN;
  END IF;

  FOR tbl IN
    SELECT unnest(ARRAY[
      'users',
      'clients',
      'client_contacts',
      'client_sites',
      'client_notes',
      'jobs',
      'job_scope_rows',
      'job_scope_config',
      'job_emission_groups',
      'job_emission_sources',
      'job_custom_factors',
      'job_plan',
      'job_files',
      'job_templates',
      'crp_job_details',
      'crp_scope_entries',
      'time_logs',
      'feedback_items',
      'datasets',
      'custom_factors',
      'custom_factor_year_values',
      'custom_conversion_factors',
      'milestone_templates',
      'milestone_template_items',
      'xero_connections',
      'xero_contact_links',
      'xero_invoice_links',
      'system_settings',
      'lookups',
      'roles_lookup',
      'time_subjects',
      'portfolios_lookup',
      'job_types'
    ])
  LOOP
    BEGIN
      EXECUTE format('UPDATE %I SET org_id = $1 WHERE org_id IS NULL', tbl) USING default_org;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END LOOP;
END
$$;
