-- Baseline schema extracted from the legacy runtime bootstrap.
--
-- This file now holds the schema SQL that used to live in core/database.py.
-- It is intentionally plain SQL with no Python wrapper.

CREATE TABLE IF NOT EXISTS users (
          user_id VARCHAR PRIMARY KEY, full_name VARCHAR, role VARCHAR, email VARCHAR, password_hash VARCHAR, status VARCHAR DEFAULT 'Active'
        );
        CREATE TABLE IF NOT EXISTS roles_lookup (role_name VARCHAR PRIMARY KEY, is_active BOOLEAN DEFAULT TRUE);

        CREATE TABLE IF NOT EXISTS clients (
          db_id INTEGER PRIMARY KEY,
          client_name VARCHAR, industry VARCHAR, description_long TEXT,
          website VARCHAR, year_end_month VARCHAR, company_reg VARCHAR,
          headquarters VARCHAR,
          addr_line1 VARCHAR, addr_line2 VARCHAR, addr_city VARCHAR, addr_region VARCHAR, addr_postcode VARCHAR, addr_country VARCHAR,
          logo_url VARCHAR,
          crm_owner VARCHAR, status VARCHAR DEFAULT 'Active',
          net_zero_year INTEGER DEFAULT 2050, interim_year INTEGER DEFAULT 2035,
          interim_s1_pct INTEGER DEFAULT 50, interim_s2_pct INTEGER DEFAULT 50, interim_s3_pct INTEGER DEFAULT 50,
          benchmark_year INTEGER,
          benchmark_scope_1_tco2e DOUBLE,
          benchmark_scope_2_tco2e DOUBLE,
          benchmark_scope_3_tco2e DOUBLE,
          benchmark_total_tco2e DOUBLE,
          engagement_start_date DATE,
          engagement_end_date DATE,
          touchpoint_cadence VARCHAR DEFAULT 'monthly'
        );

        CREATE TABLE IF NOT EXISTS client_contacts (
          contact_id INTEGER PRIMARY KEY, client_db_id INTEGER, full_name VARCHAR, job_title VARCHAR, email VARCHAR
        );
        CREATE TABLE IF NOT EXISTS client_sites (
          site_id INTEGER PRIMARY KEY, client_db_id INTEGER, site_name VARCHAR, location VARCHAR, is_registered_office BOOLEAN DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS job_types (job_type_id INTEGER PRIMARY KEY, name VARCHAR UNIQUE, is_active BOOLEAN DEFAULT TRUE);

        CREATE TABLE IF NOT EXISTS job_statuses_lookup (
          status_id INTEGER PRIMARY KEY,
          name VARCHAR UNIQUE,
          sort_order INTEGER,
          is_active BOOLEAN DEFAULT TRUE
        );

        CREATE TABLE IF NOT EXISTS vat_rates_lookup (
          vat_rate_id INTEGER PRIMARY KEY,
          name VARCHAR,
          rate_pct DOUBLE,
          is_default BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE
        );
        CREATE TABLE IF NOT EXISTS jobs (
          job_id INTEGER PRIMARY KEY, client_db_id INTEGER, job_type_id INTEGER, job_type VARCHAR,
          job_number VARCHAR UNIQUE, title VARCHAR, reporting_year INTEGER,
          crp_id INTEGER, status VARCHAR DEFAULT 'Open',
          start_date DATE, due_date DATE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS crp_reports (
          crp_id INTEGER PRIMARY KEY, client_db_id INTEGER, reporting_year INTEGER, is_benchmark BOOLEAN DEFAULT FALSE, status VARCHAR,
          period_from DATE, period_to DATE,
          org_boundary_type VARCHAR, org_boundary_note TEXT,
          issued_date DATE,
          client_signee_name VARCHAR, client_signee_position VARCHAR, client_signature_date DATE,
          nzi_signee_name VARCHAR, nzi_signee_position VARCHAR, nzi_signature_date DATE,
          client_logo_url VARCHAR,
          premises_owned INTEGER, premises_leased INTEGER, vehicles_owned INTEGER, vehicles_leased INTEGER,
          employees INTEGER, turnover DOUBLE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS time_subjects (subject_id INTEGER PRIMARY KEY, name VARCHAR, is_active BOOLEAN DEFAULT TRUE);

        CREATE TABLE IF NOT EXISTS portfolios_lookup (
          portfolio_id INTEGER PRIMARY KEY,
          name VARCHAR,
          is_active BOOLEAN DEFAULT TRUE
        );
        CREATE TABLE IF NOT EXISTS time_logs (
          time_id INTEGER PRIMARY KEY, job_id INTEGER, user_id VARCHAR, subject VARCHAR,
          work_date DATE, minutes INTEGER, notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS datasets (
          dataset_id INTEGER PRIMARY KEY,
          name VARCHAR, source VARCHAR, analysis_type VARCHAR,
          country VARCHAR, region VARCHAR, currency VARCHAR,
          year INTEGER, version VARCHAR, license VARCHAR, notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS factor_lookup (
          db_id INTEGER PRIMARY KEY, dataset_id INTEGER,
          file_name VARCHAR, year INTEGER, original_id VARCHAR,
          scope VARCHAR, level_1 VARCHAR, level_2 VARCHAR, level_3 VARCHAR,
          column_text VARCHAR, uom VARCHAR, factor DOUBLE, source VARCHAR, region VARCHAR, currency VARCHAR
        );

        CREATE TABLE IF NOT EXISTS activity_data (
          activity_id INTEGER PRIMARY KEY, client_db_id INTEGER, crp_id INTEGER, site_id INTEGER,
          scope VARCHAR, category VARCHAR, subcategory VARCHAR,
          amount DOUBLE, unit VARCHAR, factor_id INTEGER, emissions_tco2e DOUBLE,
          source_type VARCHAR, note TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS client_notes (
          note_id INTEGER PRIMARY KEY, client_db_id INTEGER, author VARCHAR, note_text TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS client_touchpoints (
          touchpoint_id INTEGER PRIMARY KEY,
          org_id UUID NOT NULL,
          client_db_id INTEGER NOT NULL,
          crm_owner VARCHAR NOT NULL,
          touchpoint_type VARCHAR NOT NULL DEFAULT 'call',
          summary TEXT,
          outcome VARCHAR,
          next_action TEXT,
          next_action_due DATE,
          occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR
        );
        CREATE TABLE IF NOT EXISTS client_health_snapshots (
          snapshot_id INTEGER PRIMARY KEY,
          org_id UUID NOT NULL,
          client_db_id INTEGER NOT NULL,
          health_score INTEGER NOT NULL DEFAULT 0,
          score_emissions INTEGER,
          score_milestones INTEGER,
          score_engagement INTEGER,
          score_payments INTEGER,
          risk_flags TEXT,
          computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (org_id, client_db_id)
        );

        CREATE TABLE IF NOT EXISTS currencies_lookup (
          currency_code VARCHAR PRIMARY KEY,
          symbol VARCHAR,
          name VARCHAR,
          is_active BOOLEAN DEFAULT TRUE
        );

        CREATE TABLE IF NOT EXISTS quotes (
          quote_id INTEGER PRIMARY KEY,
          client_db_id INTEGER,
          contact_id INTEGER,
          quote_date DATE,
          valid_to DATE,
          salesperson VARCHAR,
          payment_term_id INTEGER,
          currency_code VARCHAR,
          description TEXT,
          notes TEXT,
          status VARCHAR,
          revision_of_quote_id INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS quote_lines (
          line_id INTEGER PRIMARY KEY,
          quote_id INTEGER,
          line_type VARCHAR,
          sort_order INTEGER,
          job_type_id INTEGER,
          description TEXT,
          qty DOUBLE,
          unit_price_ex_vat DOUBLE,
          vat_rate_id INTEGER,
          is_selected BOOLEAN
        );
