CREATE TABLE IF NOT EXISTS crm_events (
  event_id BIGSERIAL PRIMARY KEY,
  client_db_id INTEGER NOT NULL,
  job_id INTEGER NULL,
  event_type VARCHAR(50) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  direction VARCHAR(20) NULL,
  subject TEXT NULL,
  body_text TEXT NULL,
  body_html TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'logged',
  owner_user_id VARCHAR NULL,
  due_at TIMESTAMP NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(120) NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_crm_events_client_created
  ON crm_events (client_db_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_events_job_created
  ON crm_events (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_events_type
  ON crm_events (event_type);
CREATE INDEX IF NOT EXISTS ix_crm_events_status
  ON crm_events (status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_events_source_ref
  ON crm_events (source, source_ref)
  WHERE source_ref IS NOT NULL AND source_ref <> '';

CREATE TABLE IF NOT EXISTS crm_tasks (
  task_id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NULL REFERENCES crm_events(event_id) ON DELETE SET NULL,
  client_db_id INTEGER NOT NULL,
  job_id INTEGER NULL,
  title VARCHAR(255) NOT NULL,
  details TEXT NULL,
  assignee_user_id VARCHAR NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  sla_due_at TIMESTAMP NULL,
  due_at TIMESTAMP NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  completed_at TIMESTAMP NULL,
  created_by VARCHAR NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_crm_tasks_client_status
  ON crm_tasks (client_db_id, status, due_at);
CREATE INDEX IF NOT EXISTS ix_crm_tasks_job_status
  ON crm_tasks (job_id, status, due_at);
CREATE INDEX IF NOT EXISTS ix_crm_tasks_assignee_status
  ON crm_tasks (assignee_user_id, status, due_at);

CREATE TABLE IF NOT EXISTS crm_tags (
  tag_id BIGSERIAL PRIMARY KEY,
  tag_name VARCHAR(80) NOT NULL UNIQUE,
  color_hex VARCHAR(7) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS crm_event_tags (
  event_id BIGINT NOT NULL REFERENCES crm_events(event_id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES crm_tags(tag_id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, tag_id)
);

INSERT INTO crm_tags (tag_name, color_hex, is_active)
SELECT 'follow-up', '#F59E0B', TRUE
WHERE NOT EXISTS (SELECT 1 FROM crm_tags WHERE lower(tag_name) = 'follow-up');

INSERT INTO crm_tags (tag_name, color_hex, is_active)
SELECT 'risk', '#EF4444', TRUE
WHERE NOT EXISTS (SELECT 1 FROM crm_tags WHERE lower(tag_name) = 'risk');

INSERT INTO crm_tags (tag_name, color_hex, is_active)
SELECT 'finance', '#10B981', TRUE
WHERE NOT EXISTS (SELECT 1 FROM crm_tags WHERE lower(tag_name) = 'finance');

INSERT INTO crm_tags (tag_name, color_hex, is_active)
SELECT 'client-waiting', '#3B82F6', TRUE
WHERE NOT EXISTS (SELECT 1 FROM crm_tags WHERE lower(tag_name) = 'client-waiting');
