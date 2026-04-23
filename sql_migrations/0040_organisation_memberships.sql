-- 0040_organisation_memberships.sql
-- Add organisation membership tracking so active org switching and invite
-- acceptance can be enforced independently of the current session org.

CREATE TABLE IF NOT EXISTS organisation_memberships (
  membership_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES organisations(org_id) NOT NULL,
  user_id VARCHAR NOT NULL,
  role VARCHAR DEFAULT 'Consultant',
  is_active BOOLEAN DEFAULT TRUE,
  is_owner BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_organisation_memberships_org_user
ON organisation_memberships (org_id, user_id);

INSERT INTO organisation_memberships (org_id, user_id, role, is_active, is_owner)
SELECT org_id, user_id, COALESCE(role, 'Consultant'), TRUE,
       CASE WHEN lower(COALESCE(role, '')) IN ('admin', 'superadmin') THEN TRUE ELSE FALSE END
FROM users
WHERE org_id IS NOT NULL
ON CONFLICT (org_id, user_id) DO UPDATE SET
  role = EXCLUDED.role,
  is_active = TRUE,
  updated_at = NOW();
