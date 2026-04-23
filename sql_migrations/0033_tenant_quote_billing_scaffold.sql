-- Stage 2 tenant scaffold for quote, invoice, and other-cost tables.
-- This keeps the SQL migration history aligned with the live schema that was
-- applied through the application bootstrap paths.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE quote_lines ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE quote_email_log ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE invoice_email_log ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE job_other_costs ADD COLUMN IF NOT EXISTS org_id UUID;

UPDATE quotes
SET org_id = COALESCE(org_id, (
    SELECT c.org_id
    FROM clients c
    WHERE c.db_id = quotes.client_db_id
    LIMIT 1
 ))
WHERE org_id IS NULL;

UPDATE quote_lines
SET org_id = COALESCE(org_id, (
    SELECT q.org_id
    FROM quotes q
    WHERE q.quote_id = quote_lines.quote_id
    LIMIT 1
 ))
WHERE org_id IS NULL;

UPDATE quote_email_log
SET org_id = COALESCE(org_id, (
    SELECT q.org_id
    FROM quotes q
    WHERE q.quote_id = quote_email_log.quote_id
    LIMIT 1
 ))
WHERE org_id IS NULL;

UPDATE invoices
SET org_id = COALESCE(org_id, (
    SELECT c.org_id
    FROM clients c
    WHERE c.db_id = invoices.client_db_id
    LIMIT 1
 ))
WHERE org_id IS NULL;

UPDATE invoice_lines
SET org_id = COALESCE(org_id, (
    SELECT i.org_id
    FROM invoices i
    WHERE i.invoice_id = invoice_lines.invoice_id
    LIMIT 1
 ))
WHERE org_id IS NULL;

UPDATE invoice_email_log
SET org_id = COALESCE(org_id, (
    SELECT i.org_id
    FROM invoices i
    WHERE i.invoice_id = invoice_email_log.invoice_id
    LIMIT 1
 ))
WHERE org_id IS NULL;

UPDATE job_other_costs
SET org_id = COALESCE(org_id, (
    SELECT c.org_id
    FROM jobs j
    JOIN clients c ON c.db_id = j.client_db_id
    WHERE j.job_id = job_other_costs.job_id
    LIMIT 1
 ))
WHERE org_id IS NULL;
