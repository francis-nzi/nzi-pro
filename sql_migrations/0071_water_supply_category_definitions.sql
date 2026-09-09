-- Water Supply is invisible in the portal's Data Entry "Other" bucket.
--
-- The DESNZ Water Supply activity factor (original_id 17_404_4005_1_1 m3 and
-- 17_404_4005_10_1 million litres) is filed under 'Purchased Goods and
-- Services'. services/portal_data_entry.py deliberately drops that category
-- from every generic portal bucket (_EXCLUDED_CATEGORIES, because PG&S has
-- its own spend-based flow), so the factor is unreachable anywhere in the
-- portal -- while its sibling Water Treatment, correctly filed under 'Waste
-- Generated in Operations', shows up fine.
--
-- A 2026-09-01 correction set the category on factor_lookup only. That is the
-- losing half: v_factor_lookup resolves category as
--   COALESCE(emission_factor_definitions.category, factor_lookup.category)
-- so the stale definitions row kept winning and nothing changed in the app.
-- This migration fixes the half the view actually reads, and re-asserts the
-- factor_lookup half so the two agree.
--
-- Scoped through emission_factor_aliases on original_id -- a stable key that
-- is never written here -- rather than on category, which is the write target.
-- Same scope (Scope 3) and same numbers either way; only the reported
-- sub-category line moves, matching Water Treatment.

UPDATE emission_factor_definitions
SET category = 'Waste Generated in Operations'
WHERE source = 'DESNZ'
  AND factor_id IN (
    SELECT DISTINCT a.factor_id
    FROM emission_factor_aliases a
    WHERE a.original_id IN ('17_404_4005_1_1', '17_404_4005_10_1')
  );

UPDATE factor_lookup
SET category = 'Waste Generated in Operations'
WHERE source = 'DESNZ'
  AND original_id IN ('17_404_4005_1_1', '17_404_4005_10_1');
