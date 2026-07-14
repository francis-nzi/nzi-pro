-- 0055_reapply_column_text_view_coalesce.sql
--
-- 0054 added emission_factor_definitions.column_text and rewrote v_factor_lookup
-- to COALESCE it over the legacy factor_lookup.column_text. But 0051 (an earlier
-- authored "perf indexes" migration, numbered lower but not merged/deployed until
-- after 0054) also does a CREATE OR REPLACE VIEW of v_factor_lookup, and its
-- version predates the column_text change — so applying 0051 after 0054 silently
-- reverted the column_text COALESCE back to a bare `fl.column_text`. Confirmed via
-- pg_get_viewdef and applied_migrations timestamps (0051 applied 2026-07-14
-- 12:37:00Z, after 0054's 12:25:36Z) while testing the admin Search & Edit Factors
-- column_text fix.
--
-- This reissues 0051's view definition (untrimmed join, kept for the index-scan
-- perf fix) with the column_text COALESCE restored, so it can't be silently lost
-- again by re-ordering.

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
