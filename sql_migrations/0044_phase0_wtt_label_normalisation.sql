-- 0044_phase0_wtt_label_normalisation.sql
--
-- Pre-Phase 1 data preparation: normalise WTT category label formatting.
--
-- Datasets 4 (UK 2022) and 11 (UAE 2022) use a parentheses form for three
-- WTT level_1 labels. All six other datasets (1, 2, 3, 8, 9, 10) use the
-- dash form. The dash form is canonical (used by the newest datasets).
-- Aligning datasets 4 and 11 ensures the Phase 1 family-grouping heuristic
-- collapses these into single families rather than duplicates.
--
-- No live jobs reference any of the affected rows.
-- Row counts are unchanged; only level_1 text is updated.
--
-- Rows affected per statement:
--   WTT- pass vehs & travel (land)   -> dash form:  336 rows
--   WTT- business travel (air)       -> dash form:   28 rows
--   WTT- business travel (sea)       -> dash form:    6 rows

UPDATE factor_lookup
SET    level_1 = 'WTT- pass vehs & travel- land'
WHERE  level_1 = 'WTT- pass vehs & travel (land)'
  AND  dataset_id IN (4, 11);

UPDATE factor_lookup
SET    level_1 = 'WTT- business travel- air'
WHERE  level_1 = 'WTT- business travel (air)'
  AND  dataset_id IN (4, 11);

UPDATE factor_lookup
SET    level_1 = 'WTT- business travel- sea'
WHERE  level_1 = 'WTT- business travel (sea)'
  AND  dataset_id IN (4, 11);
