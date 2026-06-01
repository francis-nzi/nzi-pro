-- 0045_phase1_emission_factor_tables.sql
--
-- Phase 1 of the emissions dataset redesign.
-- Creates the three normalised tables alongside the existing factor_lookup.
-- factor_lookup is NOT touched by this migration.
--
-- Tables created:
--   emission_factor_definitions  -- stable family identity (dataset-agnostic)
--   emission_factor_year_values  -- publication-scoped numeric values
--   emission_factor_aliases      -- boundary mapping for re-import

-- ── 1. Stable factor family identity ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS emission_factor_definitions (
    factor_id       INTEGER PRIMARY KEY,   -- seeded from factor_lookup.db_id of canonical row
    source          VARCHAR,
    scope           VARCHAR,
    category        VARCHAR,
    level_1         VARCHAR,
    level_2         VARCHAR,
    level_3         VARCHAR,
    level_4         VARCHAR,
    report_label    VARCHAR,
    uom             VARCHAR,
    ghg_unit        VARCHAR,
    method          VARCHAR,
    region          VARCHAR,
    archived        BOOLEAN     NOT NULL DEFAULT FALSE,
    archived_at     TIMESTAMP,
    archived_by     VARCHAR,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Publication-scoped numeric values ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS emission_factor_year_values (
    factor_year_value_id  SERIAL PRIMARY KEY,
    factor_id             INTEGER     NOT NULL REFERENCES emission_factor_definitions(factor_id),
    dataset_id            INTEGER     NOT NULL REFERENCES datasets(dataset_id),
    original_id           VARCHAR     NOT NULL,
    year                  INTEGER,
    factor                NUMERIC,
    currency              VARCHAR,
    valid_from            DATE,
    valid_to              DATE,
    source_version        VARCHAR,
    superseded_by         INTEGER     REFERENCES emission_factor_year_values(factor_year_value_id),
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identity constraint: one value per factor/dataset/year, one per dataset/original_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_efyv_factor_dataset_year
    ON emission_factor_year_values (factor_id, dataset_id, year)
    WHERE superseded_by IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_efyv_dataset_original
    ON emission_factor_year_values (dataset_id, original_id);

-- ── 3. Boundary alias table for re-import ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS emission_factor_aliases (
    alias_id    SERIAL PRIMARY KEY,
    dataset_id  INTEGER NOT NULL REFERENCES datasets(dataset_id),
    original_id VARCHAR NOT NULL,
    factor_id   INTEGER NOT NULL REFERENCES emission_factor_definitions(factor_id),
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dataset_id, original_id)
);

-- ── Indexes for common lookup patterns ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_efd_scope    ON emission_factor_definitions (scope);
CREATE INDEX IF NOT EXISTS idx_efd_category ON emission_factor_definitions (category);
CREATE INDEX IF NOT EXISTS idx_efd_source   ON emission_factor_definitions (source);

CREATE INDEX IF NOT EXISTS idx_efyv_factor_id  ON emission_factor_year_values (factor_id);
CREATE INDEX IF NOT EXISTS idx_efyv_dataset_id ON emission_factor_year_values (dataset_id);
CREATE INDEX IF NOT EXISTS idx_efyv_year       ON emission_factor_year_values (year);

CREATE INDEX IF NOT EXISTS idx_efa_factor_id   ON emission_factor_aliases (factor_id);
