-- 0047_portal_broadcasts.sql
--
-- Portal broadcasting system.
-- Broadcasts can be global (all clients) or targeted to a specific client.
-- The portal status bar renders active broadcasts + derived action items.

CREATE TABLE IF NOT EXISTS portal_broadcasts (
    broadcast_id    BIGSERIAL       PRIMARY KEY,
    title           VARCHAR,
    message         TEXT            NOT NULL,
    broadcast_type  VARCHAR(16)     NOT NULL DEFAULT 'global',  -- 'global' | 'client'
    target_client_db_id INTEGER     REFERENCES clients(db_id) ON DELETE CASCADE,
    style           VARCHAR(16)     NOT NULL DEFAULT 'info',    -- 'info' | 'warning' | 'success' | 'promo'
    link_url        VARCHAR,
    link_label      VARCHAR,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    active_from     TIMESTAMPTZ,
    active_until    TIMESTAMPTZ,
    created_by      VARCHAR         NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deactivated_at  TIMESTAMPTZ,
    deactivated_by  VARCHAR
);

CREATE INDEX IF NOT EXISTS idx_pb_active ON portal_broadcasts (is_active, active_from, active_until);
CREATE INDEX IF NOT EXISTS idx_pb_client ON portal_broadcasts (target_client_db_id) WHERE target_client_db_id IS NOT NULL;
