-- Add columns to datasets table that were previously only in Python migrations.
-- These are required by admin_routes.py list_datasets, search_factors, and archive endpoints.

ALTER TABLE datasets ADD COLUMN IF NOT EXISTS valid_from DATE;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS valid_to DATE;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS archived_by VARCHAR;
