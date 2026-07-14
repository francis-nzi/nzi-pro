-- 0054_add_column_text_to_definitions.sql
--
-- Closes a schema gap found during the 2026-07-14 dataset-merge investigation:
-- emission_factor_definitions has scope/category/levels/report_label/uom/
-- ghg_unit/source/region/method (all year-independent descriptive metadata)
-- but never had column_text, even though it belongs in the same category and
-- can legitimately differ from report_label (127 of 2844 rows in the UK 2025
-- reference file have distinct column_text vs report_label text).
--
-- column_text was not corrupted by the alias-merge bug (v_factor_lookup always
-- read it straight from the legacy factor_lookup table), so this is a
-- completeness fix, not a correctness fix: it lets the new, split schema
-- actually represent the full row, and lets the view prefer a
-- definition-level correction if one is ever made, falling back to the
-- legacy value otherwise (identical to today's behavior until that happens).

ALTER TABLE emission_factor_definitions
    ADD COLUMN IF NOT EXISTS column_text VARCHAR;

-- Backfill from the factor_lookup row each definition was originally seeded
-- from. Every emission_factor_definitions.factor_id equals the db_id of the
-- factor_lookup row used as its canonical source (true across all three
-- creation paths: _phase1_backfill.py, sql_migrations/0052, and the ongoing
-- _sync_normalised_tables_pg), so this join is exact, not a guess.
UPDATE emission_factor_definitions efd
SET column_text = fl.column_text
FROM factor_lookup fl
WHERE fl.db_id = efd.factor_id
  AND efd.column_text IS NULL;

-- Rewrite the view to prefer a definition-level column_text when set, falling
-- back to the legacy value — same COALESCE pattern already used for
-- report_label/category/scope/etc.
CREATE OR REPLACE VIEW v_factor_lookup AS
SELECT DISTINCT ON (fl.db_id)
    fl.db_id,
    COALESCE(efyv.dataset_id, fl.dataset_id)                                           AS dataset_id,
    fl.file_name,
    COALESCE(efyv.year, fl.year)                                                        AS year,
    COALESCE(NULLIF(TRIM(efyv.original_id), ''), NULLIF(TRIM(fl.original_id), ''))     AS original_id,
    COALESCE(NULLIF(TRIM(efd.scope), ''),       NULLIF(TRIM(fl.scope), ''))             AS scope,
    COALESCE(NULLIF(TRIM(efd.level_1), ''),     NULLIF(TRIM(fl.level_1), ''))           AS level_1,
    COALESCE(NULLIF(TRIM(efd.level_2), ''),     NULLIF(TRIM(fl.level_2), ''))           AS level_2,
    COALESCE(NULLIF(TRIM(efd.level_3), ''),     NULLIF(TRIM(fl.level_3), ''))           AS level_3,
    COALESCE(NULLIF(TRIM(efd.level_4), ''),     NULLIF(TRIM(fl.level_4), ''))           AS level_4,
    COALESCE(NULLIF(TRIM(efd.column_text), ''), NULLIF(TRIM(fl.column_text), ''))::character varying AS column_text,
    COALESCE(NULLIF(TRIM(efd.uom), ''),         NULLIF(TRIM(fl.uom), ''))               AS uom,
    COALESCE(NULLIF(TRIM(efd.ghg_unit), ''),    NULLIF(TRIM(fl.ghg_unit), ''))          AS ghg_unit,
    COALESCE(efyv.factor, fl.factor)                                                    AS factor,
    COALESCE(NULLIF(TRIM(efd.source), ''),      NULLIF(TRIM(fl.source), ''))            AS source,
    COALESCE(NULLIF(TRIM(efd.region), ''),      NULLIF(TRIM(fl.region), ''))            AS region,
    COALESCE(efyv.currency, fl.currency)                                                AS currency,
    COALESCE(NULLIF(TRIM(efd.category), ''),    NULLIF(TRIM(fl.category), ''))          AS category,
    COALESCE(NULLIF(TRIM(efd.report_label),''), NULLIF(TRIM(fl.report_label), ''))      AS report_label,
    COALESCE(NULLIF(TRIM(efd.method), ''),      NULLIF(TRIM(fl.method), ''))            AS method,
    COALESCE(efyv.valid_from, fl.valid_from)                                            AS valid_from,
    COALESCE(efyv.valid_to,   fl.valid_to)                                              AS valid_to,
    NULL::text                                                                          AS country,
    efa.factor_id                                                                       AS factor_definition_id,
    efyv.factor_year_value_id,
    efd.archived                                                                        AS factor_archived
FROM factor_lookup fl
LEFT JOIN emission_factor_aliases efa
    ON  efa.dataset_id  = fl.dataset_id
    AND efa.original_id = fl.original_id
LEFT JOIN emission_factor_definitions efd
    ON  efd.factor_id = efa.factor_id
LEFT JOIN emission_factor_year_values efyv
    ON  efyv.factor_id      = efa.factor_id
    AND efyv.dataset_id     = fl.dataset_id
    AND efyv.superseded_by IS NULL
    AND (efyv.year = fl.year OR (efyv.year IS NULL AND fl.year IS NULL))
ORDER BY fl.db_id, efyv.factor_year_value_id NULLS LAST;
