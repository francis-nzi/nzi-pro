-- Widget PNG snapshots captured from the Insights page for use in PDF generation.
-- One row per job per widget; upsert on (job_id, widget_id).
CREATE TABLE IF NOT EXISTS job_widget_pngs (
    id            BIGSERIAL PRIMARY KEY,
    job_id        INTEGER NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    widget_id     VARCHAR(64) NOT NULL,
    png_data      TEXT NOT NULL,          -- full data URL: "data:image/png;base64,..."
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    captured_by   VARCHAR,
    UNIQUE (job_id, widget_id)
);

CREATE INDEX IF NOT EXISTS idx_job_widget_pngs_job_id ON job_widget_pngs(job_id);
