-- Migration: Add benchmark period and improve reporting period handling
-- This allows clients to have a defined benchmark period (financial year)
-- and jobs to automatically calculate their reporting periods based on benchmark + incremental years

-- Add benchmark period columns to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_period_start DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS benchmark_period_end DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS financial_year_end_month INTEGER DEFAULT 12;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS financial_year_end_day INTEGER DEFAULT 31;

-- Add is_benchmark flag to jobs table to identify the benchmark job
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_benchmark BOOLEAN DEFAULT FALSE;

-- Add a comment explaining the period logic
COMMENT ON COLUMN clients.benchmark_period_start IS 'Start date of the benchmark financial year period';
COMMENT ON COLUMN clients.benchmark_period_end IS 'End date of the benchmark financial year period';
COMMENT ON COLUMN clients.financial_year_end_month IS 'Month when financial year ends (1-12)';
COMMENT ON COLUMN clients.financial_year_end_day IS 'Day when financial year ends (1-31)';
COMMENT ON COLUMN jobs.is_benchmark IS 'TRUE if this job represents the benchmark period';
COMMENT ON COLUMN jobs.reporting_period_start IS 'Start date of the reporting period for this job';
COMMENT ON COLUMN jobs.reporting_period_end IS 'End date of the reporting period for this job';

-- Create index for faster benchmark job lookups
CREATE INDEX IF NOT EXISTS idx_jobs_is_benchmark ON jobs(client_db_id, is_benchmark) WHERE is_benchmark = TRUE;

-- Update existing clients to set financial year end based on year_end_month if available
UPDATE clients 
SET financial_year_end_month = CASE 
    WHEN year_end_month = 'January' THEN 1
    WHEN year_end_month = 'February' THEN 2
    WHEN year_end_month = 'March' THEN 3
    WHEN year_end_month = 'April' THEN 4
    WHEN year_end_month = 'May' THEN 5
    WHEN year_end_month = 'June' THEN 6
    WHEN year_end_month = 'July' THEN 7
    WHEN year_end_month = 'August' THEN 8
    WHEN year_end_month = 'September' THEN 9
    WHEN year_end_month = 'October' THEN 10
    WHEN year_end_month = 'November' THEN 11
    WHEN year_end_month = 'December' THEN 12
    ELSE 12
END,
financial_year_end_day = CASE 
    WHEN year_end_month IN ('January', 'March', 'May', 'July', 'August', 'October', 'December') THEN 31
    WHEN year_end_month IN ('April', 'June', 'September', 'November') THEN 30
    WHEN year_end_month = 'February' THEN 28
    ELSE 31
END
WHERE year_end_month IS NOT NULL AND financial_year_end_month IS NULL;

-- For clients with benchmark_year but no benchmark_period, create a default period
-- This assumes the benchmark year aligns with their financial year
UPDATE clients 
SET 
    benchmark_period_start = MAKE_DATE(
        benchmark_year - 1,
        COALESCE(financial_year_end_month, 12),
        COALESCE(financial_year_end_day, 31)
    ) + INTERVAL '1 day',
    benchmark_period_end = MAKE_DATE(
        benchmark_year,
        COALESCE(financial_year_end_month, 12),
        COALESCE(financial_year_end_day, 31)
    )
WHERE benchmark_year IS NOT NULL 
  AND benchmark_period_start IS NULL 
  AND benchmark_period_end IS NULL;

-- Mark jobs with reporting_year matching client benchmark_year as benchmark jobs
UPDATE jobs j
SET is_benchmark = TRUE
FROM clients c
WHERE j.client_db_id = c.db_id
  AND j.reporting_year = c.benchmark_year
  AND j.is_benchmark IS NULL;

-- For jobs with reporting_year but no reporting_period dates, calculate them
-- based on the client's financial year structure
UPDATE jobs j
SET 
    reporting_period_start = MAKE_DATE(
        j.reporting_year - 1,
        COALESCE(c.financial_year_end_month, 12),
        COALESCE(c.financial_year_end_day, 31)
    ) + INTERVAL '1 day',
    reporting_period_end = MAKE_DATE(
        j.reporting_year,
        COALESCE(c.financial_year_end_month, 12),
        COALESCE(c.financial_year_end_day, 31)
    )
FROM clients c
WHERE j.client_db_id = c.db_id
  AND j.reporting_year IS NOT NULL
  AND j.reporting_period_start IS NULL
  AND j.reporting_period_end IS NULL;
