-- 0046_review_portal_publish.sql
--
-- Extends report_reviews to support the controlled Send-to-Portal workflow.
--
-- portal_version_id  — FK to job_report_versions: the frozen snapshot the client sees.
--                      Set when CRM clicks "Send to Portal". Updated on each re-send.
-- published_at/by    — When the CRM explicitly publishes the final PDF for client download.
-- pdf_version_id     — FK to the specific job_report_versions record that is the published PDF.

ALTER TABLE report_reviews
    ADD COLUMN IF NOT EXISTS portal_version_id BIGINT
        REFERENCES job_report_versions(report_version_id) ON DELETE SET NULL;

ALTER TABLE report_reviews
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;

ALTER TABLE report_reviews
    ADD COLUMN IF NOT EXISTS published_by VARCHAR;

ALTER TABLE report_reviews
    ADD COLUMN IF NOT EXISTS pdf_version_id BIGINT
        REFERENCES job_report_versions(report_version_id) ON DELETE SET NULL;
