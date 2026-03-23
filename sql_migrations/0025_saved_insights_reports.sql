CREATE TABLE IF NOT EXISTS saved_insights_reports (
  saved_report_id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  name VARCHAR(120) NOT NULL,
  report_view VARCHAR(64) NOT NULL,
  report_year INTEGER NULL,
  industry VARCHAR NULL,
  crm_owner VARCHAR NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_insights_reports_user_updated
  ON saved_insights_reports (user_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_insights_reports_user_name
  ON saved_insights_reports (user_id, lower(name));
