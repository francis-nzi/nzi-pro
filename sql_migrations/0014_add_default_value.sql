-- Add default_value column to custom_field_definitions table
ALTER TABLE custom_field_definitions ADD COLUMN IF NOT EXISTS default_value TEXT;
