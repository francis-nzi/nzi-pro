-- 0049_report_reviews_portal_columns.sql
--
-- Safety-net migration: ensures the portal workflow columns exist on report_reviews.
-- 0046_review_portal_publish.sql adds these with FK constraints, but if that
-- migration was rolled back due to a transaction error it shares with other 0046-0048
-- files, these columns may be absent.  ADD COLUMN IF NOT EXISTS is idempotent and
-- safe to run regardless.

ALTER TABLE report_reviews ADD COLUMN IF NOT EXISTS portal_version_id BIGINT;
ALTER TABLE report_reviews ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;
ALTER TABLE report_reviews ADD COLUMN IF NOT EXISTS published_by VARCHAR;
ALTER TABLE report_reviews ADD COLUMN IF NOT EXISTS pdf_version_id BIGINT;
