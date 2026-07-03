-- 0050_phase2_dual_read_view.sql
--
-- Phase 2 of the emissions dataset redesign: dual-read view.
--
-- Creates v_factor_lookup, a read-only view that:
--   - returns every row from factor_lookup (unchanged)
--   - prefers column values from emission_factor_definitions /
--     emission_factor_year_values where the backfill has populated them
--   - falls back transparently to factor_lookup values for any row that
--     was not matched by the alias table (should be zero after Phase 1)
--
-- Also provides:
--   - NULL::text AS country   (factor_lookup never had this column;
--                              the LCA factor-search query uses fl.country
--                              and was silently erroring before this view)
--   - factor_definition_id    (canonical emission_factor_definitions.factor_id)
--   - factor_year_value_id    (emission_factor_year_values PK)
--   - factor_archived         (soft-delete flag on the definition row)
--
-- All existing read paths can be updated from:
--     FROM  factor_lookup fl
--     JOIN  factor_lookup fl
-- to:
--     FROM  v_factor_lookup fl
--     JOIN  v_factor_lookup fl
-- with no other code changes required.
--
-- factor_lookup itself is NOT changed.
-- Writes still go directly to factor_lookup (Phase 3 will change that).

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
    fl.column_text,
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
    -- factor_lookup never had a country column; expose NULL so LCA queries don't error
    NULL::text                                                                          AS country,
    -- Bonus columns for Phase 3+ code that wants to reference the new tables directly
    efa.factor_id                                                                       AS factor_definition_id,
    efyv.factor_year_value_id,
    efd.archived                                                                        AS factor_archived
FROM factor_lookup fl
LEFT JOIN emission_factor_aliases efa
    ON  efa.dataset_id        = fl.dataset_id
    AND TRIM(efa.original_id) = TRIM(fl.original_id)
LEFT JOIN emission_factor_definitions efd
    ON  efd.factor_id = efa.factor_id
LEFT JOIN emission_factor_year_values efyv
    ON  efyv.factor_id        = efa.factor_id
    AND efyv.dataset_id       = fl.dataset_id
    AND efyv.superseded_by IS NULL
    AND (efyv.year = fl.year OR (efyv.year IS NULL AND fl.year IS NULL))
ORDER BY fl.db_id, efyv.factor_year_value_id NULLS LAST;
