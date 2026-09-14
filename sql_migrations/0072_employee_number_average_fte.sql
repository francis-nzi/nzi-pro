-- Headcount is now recorded as average FTE over the reporting period, which
-- is not a whole number (e.g. 12.5 FTE). employee_number was INTEGER, so the
-- Intensity Metrics and Reporting Elements screens silently truncated the
-- decimal before it reached the report.
--
-- Plain NUMERIC rather than NUMERIC(p,1): it keeps each value's own scale, so
-- the 183 existing whole-number rows still read "12" rather than "12.0".
ALTER TABLE job_report_metadata
  ALTER COLUMN employee_number TYPE NUMERIC;
