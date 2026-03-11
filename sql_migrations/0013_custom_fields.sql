-- Custom Fields System - Version 0013
-- Adds support for dynamic custom fields on Clients, Jobs, Contacts, Quotes, and Suppliers

-- Table to store custom field definitions (created by Admin)
CREATE TABLE IF NOT EXISTS custom_field_definitions (
    field_id SERIAL PRIMARY KEY,
    field_name VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) NOT NULL CHECK (field_type IN ('checkbox', 'option', 'multiline_text', 'decimal', 'number', 'dropdown', 'date', 'text')),
    field_label VARCHAR(255) NOT NULL,
    is_required BOOLEAN DEFAULT FALSE,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('client', 'job', 'contact', 'quote', 'supplier')),
    options JSONB, -- For dropdown/option types: [{"value": "option1", "label": "Option 1"}]
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Table to store custom field values (filled by users)
CREATE TABLE IF NOT EXISTS custom_field_values (
    value_id SERIAL PRIMARY KEY,
    field_id INTEGER NOT NULL REFERENCES custom_field_definitions(field_id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL, -- The ID of the client/job/contact/quote/supplier
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('client', 'job', 'contact', 'quote', 'supplier')),
    field_value TEXT, -- Stores the value (can be text, number, boolean, or JSON for complex types)
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    UNIQUE(field_id, entity_id, entity_type)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_custom_field_values_entity 
ON custom_field_values(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_entity 
ON custom_field_definitions(entity_type, is_active);

-- Insert sample custom fields (examples from the user's requirements)
INSERT INTO custom_field_definitions (field_name, field_type, field_label, is_required, entity_type, display_order) VALUES
    ('multi_year_contract', 'checkbox', 'Multi-Year Contract', FALSE, 'job', 1),
    ('training_place_included', 'checkbox', 'Training Place Included', FALSE, 'job', 2),
    ('free_training_place', 'checkbox', 'Free Training Place', FALSE, 'job', 3),
    ('date_training_completed', 'date', 'Date Training Completed', FALSE, 'job', 4)
ON CONFLICT DO NOTHING;
