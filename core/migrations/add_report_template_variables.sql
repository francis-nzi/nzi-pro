-- Migration: Add report template variables system
-- This allows storing template-specific variables that can be edited per job

-- Table to store report template definitions
CREATE TABLE IF NOT EXISTS report_templates (
    template_id SERIAL PRIMARY KEY,
    template_key VARCHAR(100) UNIQUE NOT NULL,
    template_name VARCHAR(255) NOT NULL,
    template_type VARCHAR(50) NOT NULL, -- 'carbon_reduction_plan', 'ppn_006', etc.
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table to store template variable definitions
CREATE TABLE IF NOT EXISTS report_template_variables (
    variable_id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES report_templates(template_id) ON DELETE CASCADE,
    variable_key VARCHAR(100) NOT NULL,
    variable_label VARCHAR(255) NOT NULL,
    variable_type VARCHAR(50) NOT NULL, -- 'text', 'number', 'date', 'textarea', 'boolean'
    default_value TEXT,
    placeholder TEXT,
    help_text TEXT,
    is_required BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0,
    section VARCHAR(100), -- Group variables by section
    UNIQUE(template_id, variable_key)
);

-- Legacy table retained only for historical compatibility.
-- New writes should target job_report_variable_values instead.
CREATE TABLE IF NOT EXISTS job_report_variables (
    job_variable_id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL,
    template_id INTEGER REFERENCES report_templates(template_id) ON DELETE CASCADE,
    variable_key VARCHAR(100) NOT NULL,
    variable_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255),
    UNIQUE(job_id, template_id, variable_key)
);

-- Versioned replacement table (one row per job/template/version/key)
CREATE TABLE IF NOT EXISTS job_report_variable_values (
    job_id INTEGER NOT NULL,
    template_id INTEGER REFERENCES report_templates(template_id) ON DELETE CASCADE,
    version_id INTEGER,
    variable_key VARCHAR(100) NOT NULL,
    variable_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255),
    PRIMARY KEY (job_id, template_id, version_id, variable_key)
);

-- Insert Standard Carbon Reduction Plan template
INSERT INTO report_templates (template_key, template_name, template_type, description) VALUES
('STANDARD_CRP', 'Standard Carbon Reduction Plan', 'carbon_reduction_plan', 
 'Comprehensive carbon reduction plan following UK government guidelines')
ON CONFLICT (template_key) DO NOTHING;

-- Insert UK PPN 06/21 template
INSERT INTO report_templates (template_key, template_name, template_type, description) VALUES
('UK_PPN_006', 'UK PPN 06/21 Carbon Reduction Plan', 'ppn_006', 
 'Carbon Reduction Plan for UK public sector procurement (PPN 06/21)')
ON CONFLICT (template_key) DO NOTHING;

-- Standard CRP Variables
INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'company_description', 'Company Description', 'textarea', '', 'Brief description of the company...', 'Overview of company activities and operations', TRUE, 1, 'Company Information'
FROM report_templates WHERE template_key = 'STANDARD_CRP'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'reporting_boundary', 'Reporting Boundary', 'textarea', '', 'Describe the organizational boundary...', 'Define which entities and operations are included', TRUE, 2, 'Company Information'
FROM report_templates WHERE template_key = 'STANDARD_CRP'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'methodology', 'Calculation Methodology', 'textarea', 'GHG Protocol Corporate Standard', 'GHG Protocol Corporate Standard', 'Standards and methodologies used for calculations', TRUE, 3, 'Methodology'
FROM report_templates WHERE template_key = 'STANDARD_CRP'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'emission_factors_source', 'Emission Factors Source', 'text', 'UK Government GHG Conversion Factors', 'UK Government GHG Conversion Factors', 'Source of emission factors used', TRUE, 4, 'Methodology'
FROM report_templates WHERE template_key = 'STANDARD_CRP'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'net_zero_commitment', 'Net Zero Commitment Statement', 'textarea', '', 'We are committed to achieving net zero by...', 'Statement of commitment to net zero', TRUE, 5, 'Commitments'
FROM report_templates WHERE template_key = 'STANDARD_CRP'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'reduction_actions', 'Carbon Reduction Actions', 'textarea', '', 'List key actions to reduce emissions...', 'Planned or implemented reduction initiatives', TRUE, 6, 'Actions'
FROM report_templates WHERE template_key = 'STANDARD_CRP'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'board_approval_date', 'Board Approval Date', 'date', '', 'YYYY-MM-DD', 'Date when the plan was approved by the board', FALSE, 7, 'Approval'
FROM report_templates WHERE template_key = 'STANDARD_CRP'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'signatory_name', 'Signatory Name', 'text', '', 'Full name', 'Name of person signing off the report', FALSE, 8, 'Approval'
FROM report_templates WHERE template_key = 'STANDARD_CRP'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'signatory_title', 'Signatory Title', 'text', '', 'Job title', 'Title/position of signatory', FALSE, 9, 'Approval'
FROM report_templates WHERE template_key = 'STANDARD_CRP'
ON CONFLICT (template_id, variable_key) DO NOTHING;

-- UK PPN 06/21 Variables
INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'supplier_name', 'Supplier Name', 'text', '', 'Company name', 'Legal name of the supplier', TRUE, 1, 'Supplier Information'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'publication_date', 'Publication Date', 'date', '', 'YYYY-MM-DD', 'Date of CRP publication', TRUE, 2, 'Supplier Information'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'commitment_statement', 'Commitment to Net Zero', 'textarea', '', 'We are committed to achieving net zero emissions by...', 'Statement of commitment as per PPN 06/21 requirements', TRUE, 3, 'Commitment'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'baseline_year', 'Baseline Year', 'number', '', 'YYYY', 'Baseline year for emissions comparison', TRUE, 4, 'Emissions'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'scope_coverage', 'Scopes Covered', 'textarea', 'Scope 1, 2, and 3 (partial)', 'Scope 1, 2, and 3', 'Which GHG Protocol scopes are included', TRUE, 5, 'Emissions'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'reduction_targets', 'Carbon Reduction Targets', 'textarea', '', 'Describe reduction targets and timelines...', 'Specific targets aligned with net zero commitment', TRUE, 6, 'Targets'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'completed_measures', 'Completed Carbon Reduction Measures', 'textarea', '', 'List measures already implemented...', 'Actions taken to date', TRUE, 7, 'Measures'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'planned_measures', 'Planned Carbon Reduction Measures', 'textarea', '', 'List measures planned for implementation...', 'Future actions and initiatives', TRUE, 8, 'Measures'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'declaration_statement', 'Declaration Statement', 'textarea', 'This Carbon Reduction Plan has been completed in accordance with PPN 06/21 and associated guidance and reporting standard for Carbon Reduction Plans.', 'Standard declaration text...', 'Formal declaration as required by PPN 06/21', TRUE, 9, 'Declaration'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

INSERT INTO report_template_variables (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section) 
SELECT template_id, 'signed_by', 'Signed By', 'text', '', 'Name and title', 'Name and title of authorized signatory', TRUE, 10, 'Declaration'
FROM report_templates WHERE template_key = 'UK_PPN_006'
ON CONFLICT (template_id, variable_key) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_report_template_variables_template ON report_template_variables(template_id);
CREATE INDEX IF NOT EXISTS idx_job_report_variables_job ON job_report_variables(job_id);
CREATE INDEX IF NOT EXISTS idx_job_report_variables_template ON job_report_variables(template_id);
CREATE INDEX IF NOT EXISTS idx_job_report_variable_values_lookup ON job_report_variable_values(job_id, template_id, version_id);
