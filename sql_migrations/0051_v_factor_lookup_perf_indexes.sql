-- 0051_v_factor_lookup_perf_indexes.sql
--
-- Performance fix for v_factor_lookup view.
--
-- The view (0050) used TRIM() in join conditions which prevents index scans —
-- PostgreSQL must hash-scan emission_factor_aliases for every factor_lookup row.
-- With 10+ read paths now routed through the view this caused a CPU spike.
--
-- Fix 1: functional indexes so TRIM(original_id) lookups are indexable.
-- Fix 2: rewrite the view without TRIM in join conditions; original_id data
--        was normalised in Phase 0/1 so whitespace padding is not present.
--        TRIM is kept only in the COALESCE column expressions (safe).
-- Fix 3: composite index on efyv for the (factor_id, dataset_id) join.

-- ── Functional indexes for the alias join ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_fl_dataset_trim_original
    ON factor_lookup (dataset_id, TRIM(original_id));

CREATE INDEX IF NOT EXISTS idx_efa_dataset_trim_original
    ON emission_factor_aliases (dataset_id, TRIM(original_id));

-- ── Composite index for the year-values join ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_efyv_factor_dataset_active
    ON emission_factor_year_values (factor_id, dataset_id)
    WHERE superseded_by IS NULL;

-- ── Rewrite view: remove TRIM from join conditions ────────────────────────────
-- The COALESCE expressions still TRIM their inputs for display safety.

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
