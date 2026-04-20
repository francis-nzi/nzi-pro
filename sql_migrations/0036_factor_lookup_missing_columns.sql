-- Add columns to factor_lookup table that were previously only in Python migrations.
-- These are required by admin_routes.py search_factors and related endpoints.

ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS category VARCHAR;
ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS report_label VARCHAR;
ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS original_id VARCHAR;
ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS year INTEGER;
ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS level_4 VARCHAR;
ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS ghg_unit VARCHAR;
ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS method VARCHAR;
ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS valid_from DATE;
ALTER TABLE factor_lookup ADD COLUMN IF NOT EXISTS valid_to DATE;
