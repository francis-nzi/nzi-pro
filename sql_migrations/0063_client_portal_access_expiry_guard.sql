-- 0063_client_portal_access_expiry_guard.sql
--
-- Keep client portal access expiry values within the same practical range
-- accepted by the API and browser date controls. The table historically came
-- from services.portal.ensure_portal_schema(), so create it here as well for a
-- fresh database and add the constraint separately for existing databases.

CREATE TABLE IF NOT EXISTS public.client_portal_access (
  client_db_id       INTEGER PRIMARY KEY REFERENCES public.clients(db_id) ON DELETE CASCADE,
  is_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  access_expires_at  TIMESTAMPTZ,
  payment_status     VARCHAR(16) NOT NULL DEFAULT 'unpaid',
  payment_reference  VARCHAR,
  nav_config         JSONB NOT NULL DEFAULT '{}',
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_portal_access_expiry_year_check CHECK (
    access_expires_at IS NULL OR (
      access_expires_at >= TIMESTAMPTZ '2000-01-01 00:00:00+00'
      AND access_expires_at < TIMESTAMPTZ '10000-01-01 00:00:00+00'
    )
  )
);

ALTER TABLE public.client_portal_access
  ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ;

DO $$
DECLARE
  invalid_rows BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_portal_access_expiry_year_check'
      AND conrelid = 'public.client_portal_access'::regclass
  ) THEN
    -- NOT VALID avoids making deployment fail if a legacy row is already out
    -- of range, while still enforcing the constraint for new/updated rows.
    ALTER TABLE public.client_portal_access
      ADD CONSTRAINT client_portal_access_expiry_year_check CHECK (
        access_expires_at IS NULL OR (
          access_expires_at >= TIMESTAMPTZ '2000-01-01 00:00:00+00'
          AND access_expires_at < TIMESTAMPTZ '10000-01-01 00:00:00+00'
        )
      ) NOT VALID;
  END IF;

  SELECT COUNT(*)
  INTO invalid_rows
  FROM public.client_portal_access
  WHERE access_expires_at IS NOT NULL
    AND (
      access_expires_at < TIMESTAMPTZ '2000-01-01 00:00:00+00'
      OR access_expires_at >= TIMESTAMPTZ '10000-01-01 00:00:00+00'
    );

  IF invalid_rows = 0 AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_portal_access_expiry_year_check'
      AND conrelid = 'public.client_portal_access'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE public.client_portal_access
      VALIDATE CONSTRAINT client_portal_access_expiry_year_check;
  ELSIF invalid_rows > 0 THEN
    RAISE WARNING
      'client_portal_access has % out-of-range expiry row(s); constraint left NOT VALID until those rows are reviewed',
      invalid_rows;
  END IF;
END
$$;
