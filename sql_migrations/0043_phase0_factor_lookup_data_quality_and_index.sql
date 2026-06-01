-- 0043_phase0_factor_lookup_data_quality_and_index.sql
--
-- Phase 0 of the emissions dataset redesign.
--
-- 1. Data quality fix: "Cycling" and "Walking" factors in UAE datasets 8 and 12
--    were incorrectly filed under level_1 = 'Business travel- air'. Every other
--    dataset (10 of 12) correctly has them under 'Business travel- land'. These
--    factors all have a conversion value of 0, so no job totals are affected.
--    No live job references these mislabelled rows.
--
-- 2. Unique index on (dataset_id, year, scope, original_id): enforces the
--    identity constraint that ingestion already maintains imperatively. A
--    diagnostic confirmed zero existing duplicates on this key, so the index
--    will be created cleanly. Safe to re-run (IF NOT EXISTS).

-- ── 1. Fix mislabelled UAE rows ───────────────────────────────────────────────

UPDATE factor_lookup
SET    level_1 = 'Business travel- land'
WHERE  original_id IN ('99_316_3160_11_2', '99_316_3160_11_3')
  AND  dataset_id  IN (8, 12)
  AND  level_1     = 'Business travel- air';

-- ── 2. Unique index on the natural identity key ───────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_factor_lookup_dataset_year_scope_original
    ON factor_lookup (dataset_id, year, scope, original_id);
