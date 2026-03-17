-- WARNING
-- Run this only against a freshly cloned / replacement environment,
-- never against the current live production database without a verified backup.
--
-- Purpose:
-- - preserve system/configuration tables
-- - clear business/test data so WFM clients/jobs can be re-imported cleanly
-- - clear datasets/factors so a fresh factor upload sequence can be performed
--
-- Preserved by this script:
-- - users
-- - roles_lookup
-- - system_settings
-- - job_templates
-- - milestone_templates
-- - report_templates
-- - report_template_variables
-- - custom_field_definitions
-- - lookup/reference tables (currencies, VAT, job types/items, etc.)
--
-- Cleared by this script:
-- - clients / jobs and dependent data
-- - datasets / factor rows
-- - spend data and mappings
-- - LCA data
-- - CRM / BD activity tied to old clients/jobs
-- - quotes / invoices / job other costs
--
-- Recommended execution:
-- 1. clone production to a new environment
-- 2. run app migrations in the new environment
-- 3. verify admin login works
-- 4. run this script
-- 5. import fresh datasets
-- 6. import WFM clients, then WFM jobs

BEGIN;

DO $$
DECLARE
  table_name text;
  reset_tables text[] := ARRAY[
    -- Child / transactional tables first
    'invoice_email_log',
    'invoice_lines',
    'invoices',
    'quote_lines',
    'quotes',
    'job_files',
    'job_other_costs',
    'job_report_variable_values',
    'job_spend_entries',
    'client_spend_mappings',
    'job_scope_rows',
    'job_scope_config',
    'crp_scope_entries',
    'crp_job_details',
    'lca_inventory_items',
    'lca_result_snapshots',
    'lca_products',
    'crm_event_tags',
    'crm_tasks',
    'crm_events',
    'bd_ai_generated_leads',
    'bd_opportunities',
    'bd_leads',
    'feedback_items',
    'time_logs',
    'client_users',
    'custom_field_values',
    'job_plan',

    -- Parent business entities
    'client_contacts',
    'client_sites',
    'client_notes',
    'jobs',
    'clients',

    -- Factor / dataset layer
    'custom_factor_year_values',
    'custom_factors',
    'factor_lookup',
    'datasets'
  ];
BEGIN
  FOREACH table_name IN ARRAY reset_tables LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', table_name);
      RAISE NOTICE 'Truncated public.%', table_name;
    ELSE
      RAISE NOTICE 'Skipped missing table public.%', table_name;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Suggested verification after running:
-- SELECT COUNT(*) FROM clients;
-- SELECT COUNT(*) FROM jobs;
-- SELECT COUNT(*) FROM datasets;
-- SELECT COUNT(*) FROM factor_lookup;
-- SELECT COUNT(*) FROM users;
-- SELECT COUNT(*) FROM custom_field_definitions;
