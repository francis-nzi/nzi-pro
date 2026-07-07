-- 0052_phase3_alias_backfill_unlinked_factors.sql
--
-- Phase 3: Backfill emission_factor_aliases for the ~5,560 factor_lookup rows
-- that were not linked during Phase 1 (mainly UK 2026 and UAE 2026 datasets).
--
-- HOW TO RUN
-- ----------
-- Execute the steps in order via the Supabase SQL editor.
-- Each step is idempotent (ON CONFLICT DO NOTHING / safe to re-run).
-- Always run Step 0 first to see what the script will do before committing.
--
-- MATCHING STRATEGY
-- -----------------
-- A. Content-match (Step 1): an unlinked row maps to an existing
--    emission_factor_definitions record when the combination of
--    (scope, level_1, level_2, level_3, level_4, uom, ghg_unit) is unique.
--    This handles new-year editions of existing factors (e.g. UK 2026 is the
--    same factor family as UK 2025, just with a new numeric value).
--
-- B. New definitions (Step 2): rows with NO matching definition are genuinely
--    new factor families (e.g. new UAE factor types with no UK equivalent).
--    A new emission_factor_definitions row is minted for each.
--
-- C. Year values (Step 3): for every newly aliased row, an
--    emission_factor_year_values record is inserted if one doesn't exist yet.


-- =====================================================================
-- STEP 0 – Diagnostics (read-only — run this first, commit nothing)
-- =====================================================================

-- 0a. Unlinked rows per dataset
SELECT
    d.name,
    d.year,
    COUNT(*) AS unlinked_rows
FROM factor_lookup fl
LEFT JOIN emission_factor_aliases efa
    ON  efa.dataset_id        = fl.dataset_id
    AND TRIM(efa.original_id) = TRIM(fl.original_id)
LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
WHERE efa.factor_id IS NULL
GROUP BY d.name, d.year
ORDER BY unlinked_rows DESC;


-- 0b. Match quality preview
-- Shows how many unlinked rows will get a unique content-match (will_link),
-- how many need a new definition (new_defn), and how many are ambiguous.
WITH unlinked AS (
    SELECT
        fl.dataset_id,
        fl.original_id,
        TRIM(LOWER(COALESCE(fl.scope,'')))    AS scope,
        TRIM(LOWER(COALESCE(fl.level_1,'')))  AS level_1,
        TRIM(LOWER(COALESCE(fl.level_2,'')))  AS level_2,
        TRIM(LOWER(COALESCE(fl.level_3,'')))  AS level_3,
        TRIM(LOWER(COALESCE(fl.level_4,'')))  AS level_4,
        TRIM(LOWER(COALESCE(fl.uom,'')))      AS uom,
        TRIM(LOWER(COALESCE(fl.ghg_unit,''))) AS ghg_unit
    FROM factor_lookup fl
    LEFT JOIN emission_factor_aliases efa
        ON  efa.dataset_id        = fl.dataset_id
        AND TRIM(efa.original_id) = TRIM(fl.original_id)
    WHERE efa.factor_id IS NULL
),
candidates AS (
    SELECT
        u.dataset_id,
        u.original_id,
        COUNT(DISTINCT efd.factor_id) AS match_count
    FROM unlinked u
    LEFT JOIN emission_factor_definitions efd
        ON  TRIM(LOWER(COALESCE(efd.scope,'')))    = u.scope
        AND TRIM(LOWER(COALESCE(efd.level_1,'')))  = u.level_1
        AND TRIM(LOWER(COALESCE(efd.level_2,'')))  = u.level_2
        AND TRIM(LOWER(COALESCE(efd.level_3,'')))  = u.level_3
        AND TRIM(LOWER(COALESCE(efd.level_4,'')))  = u.level_4
        AND TRIM(LOWER(COALESCE(efd.uom,'')))      = u.uom
        AND TRIM(LOWER(COALESCE(efd.ghg_unit,''))) = u.ghg_unit
    GROUP BY u.dataset_id, u.original_id
)
SELECT
    SUM(CASE WHEN match_count = 1 THEN 1 ELSE 0 END) AS will_link_to_existing,
    SUM(CASE WHEN match_count = 0 THEN 1 ELSE 0 END) AS will_create_new_definition,
    SUM(CASE WHEN match_count > 1 THEN 1 ELSE 0 END) AS ambiguous_skipped
FROM candidates;


-- 0c. Sample of rows that will create new definitions (review before Step 2)
WITH unlinked AS (
    SELECT
        fl.dataset_id,
        fl.original_id,
        fl.scope,
        fl.level_1,
        fl.level_2,
        fl.level_3,
        fl.level_4,
        fl.uom,
        fl.ghg_unit,
        fl.report_label,
        fl.category,
        fl.source,
        fl.region,
        fl.method
    FROM factor_lookup fl
    LEFT JOIN emission_factor_aliases efa
        ON  efa.dataset_id        = fl.dataset_id
        AND TRIM(efa.original_id) = TRIM(fl.original_id)
    WHERE efa.factor_id IS NULL
),
no_match AS (
    SELECT u.*
    FROM unlinked u
    WHERE NOT EXISTS (
        SELECT 1
        FROM emission_factor_definitions efd
        WHERE TRIM(LOWER(COALESCE(efd.scope,'')))    = TRIM(LOWER(COALESCE(u.scope,'')))
          AND TRIM(LOWER(COALESCE(efd.level_1,'')))  = TRIM(LOWER(COALESCE(u.level_1,'')))
          AND TRIM(LOWER(COALESCE(efd.level_2,'')))  = TRIM(LOWER(COALESCE(u.level_2,'')))
          AND TRIM(LOWER(COALESCE(efd.level_3,'')))  = TRIM(LOWER(COALESCE(u.level_3,'')))
          AND TRIM(LOWER(COALESCE(efd.level_4,'')))  = TRIM(LOWER(COALESCE(u.level_4,'')))
          AND TRIM(LOWER(COALESCE(efd.uom,'')))      = TRIM(LOWER(COALESCE(u.uom,'')))
          AND TRIM(LOWER(COALESCE(efd.ghg_unit,''))) = TRIM(LOWER(COALESCE(u.ghg_unit,'')))
    )
)
SELECT DISTINCT
    scope, level_1, level_2, level_3, level_4, uom, ghg_unit, report_label, source, region
FROM no_match
ORDER BY scope, level_1, level_2, level_3, level_4
LIMIT 100;


-- =====================================================================
-- STEP 1 – Link unlinked rows to EXISTING definitions (unique match only)
-- =====================================================================
-- Inserts into emission_factor_aliases where there is exactly one matching
-- emission_factor_definitions record by content.

WITH unlinked AS (
    SELECT
        fl.dataset_id,
        fl.original_id,
        TRIM(LOWER(COALESCE(fl.scope,'')))    AS scope,
        TRIM(LOWER(COALESCE(fl.level_1,'')))  AS level_1,
        TRIM(LOWER(COALESCE(fl.level_2,'')))  AS level_2,
        TRIM(LOWER(COALESCE(fl.level_3,'')))  AS level_3,
        TRIM(LOWER(COALESCE(fl.level_4,'')))  AS level_4,
        TRIM(LOWER(COALESCE(fl.uom,'')))      AS uom,
        TRIM(LOWER(COALESCE(fl.ghg_unit,''))) AS ghg_unit
    FROM factor_lookup fl
    LEFT JOIN emission_factor_aliases efa
        ON  efa.dataset_id        = fl.dataset_id
        AND TRIM(efa.original_id) = TRIM(fl.original_id)
    WHERE efa.factor_id IS NULL
),
matches AS (
    SELECT
        u.dataset_id,
        u.original_id,
        MIN(efd.factor_id) AS factor_id,   -- MIN is deterministic when match_count = 1
        COUNT(DISTINCT efd.factor_id) AS match_count
    FROM unlinked u
    JOIN emission_factor_definitions efd
        ON  TRIM(LOWER(COALESCE(efd.scope,'')))    = u.scope
        AND TRIM(LOWER(COALESCE(efd.level_1,'')))  = u.level_1
        AND TRIM(LOWER(COALESCE(efd.level_2,'')))  = u.level_2
        AND TRIM(LOWER(COALESCE(efd.level_3,'')))  = u.level_3
        AND TRIM(LOWER(COALESCE(efd.level_4,'')))  = u.level_4
        AND TRIM(LOWER(COALESCE(efd.uom,'')))      = u.uom
        AND TRIM(LOWER(COALESCE(efd.ghg_unit,''))) = u.ghg_unit
    GROUP BY u.dataset_id, u.original_id
)
INSERT INTO emission_factor_aliases (dataset_id, original_id, factor_id, note)
SELECT
    dataset_id,
    original_id,
    factor_id,
    '0052 phase3 content-match'
FROM matches
WHERE match_count = 1
ON CONFLICT (dataset_id, original_id) DO NOTHING;

-- Check how many were inserted:
SELECT COUNT(*) AS aliases_inserted_step1
FROM emission_factor_aliases
WHERE note = '0052 phase3 content-match';


-- =====================================================================
-- STEP 2 – Create NEW definitions for rows that still have no match
-- =====================================================================
-- Mints one emission_factor_definitions row per distinct factor-type
-- (unique combination of scope/level1-4/uom/ghg_unit) that has no existing
-- definition, then inserts aliases for all unlinked rows of that type.

-- 2a. Identify the distinct new factor-types still needed
WITH still_unlinked AS (
    SELECT
        fl.dataset_id,
        fl.original_id,
        fl.scope,
        fl.category,
        fl.level_1,
        fl.level_2,
        fl.level_3,
        fl.level_4,
        fl.report_label,
        fl.uom,
        fl.ghg_unit,
        fl.source,
        fl.region,
        fl.method,
        -- Representative db_id for seeding the new factor_id
        MIN(fl.db_id) OVER (
            PARTITION BY
                TRIM(LOWER(COALESCE(fl.scope,''))),
                TRIM(LOWER(COALESCE(fl.level_1,''))),
                TRIM(LOWER(COALESCE(fl.level_2,''))),
                TRIM(LOWER(COALESCE(fl.level_3,''))),
                TRIM(LOWER(COALESCE(fl.level_4,''))),
                TRIM(LOWER(COALESCE(fl.uom,''))),
                TRIM(LOWER(COALESCE(fl.ghg_unit,'')))
        ) AS canonical_db_id
    FROM factor_lookup fl
    LEFT JOIN emission_factor_aliases efa
        ON  efa.dataset_id        = fl.dataset_id
        AND TRIM(efa.original_id) = TRIM(fl.original_id)
    WHERE efa.factor_id IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM emission_factor_definitions efd
          WHERE TRIM(LOWER(COALESCE(efd.scope,'')))    = TRIM(LOWER(COALESCE(fl.scope,'')))
            AND TRIM(LOWER(COALESCE(efd.level_1,'')))  = TRIM(LOWER(COALESCE(fl.level_1,'')))
            AND TRIM(LOWER(COALESCE(efd.level_2,'')))  = TRIM(LOWER(COALESCE(fl.level_2,'')))
            AND TRIM(LOWER(COALESCE(efd.level_3,'')))  = TRIM(LOWER(COALESCE(fl.level_3,'')))
            AND TRIM(LOWER(COALESCE(efd.level_4,'')))  = TRIM(LOWER(COALESCE(fl.level_4,'')))
            AND TRIM(LOWER(COALESCE(efd.uom,'')))      = TRIM(LOWER(COALESCE(fl.uom,'')))
            AND TRIM(LOWER(COALESCE(efd.ghg_unit,''))) = TRIM(LOWER(COALESCE(fl.ghg_unit,'')))
      )
),
-- One representative row per distinct factor-type
new_types AS (
    SELECT DISTINCT ON (canonical_db_id)
        canonical_db_id AS factor_id,
        scope,
        category,
        level_1,
        level_2,
        level_3,
        level_4,
        report_label,
        uom,
        ghg_unit,
        source,
        region,
        method
    FROM still_unlinked
    ORDER BY canonical_db_id
)
-- 2b. Insert the new definitions
INSERT INTO emission_factor_definitions
    (factor_id, scope, category, level_1, level_2, level_3, level_4,
     report_label, uom, ghg_unit, source, region, method)
SELECT
    factor_id, scope, category, level_1, level_2, level_3, level_4,
    report_label, uom, ghg_unit, source, region, method
FROM new_types
ON CONFLICT (factor_id) DO NOTHING;

-- Check:
SELECT COUNT(*) AS new_definitions_created_step2
FROM emission_factor_definitions
WHERE factor_id IN (
    SELECT MIN(fl.db_id)
    FROM factor_lookup fl
    LEFT JOIN emission_factor_aliases efa
        ON  efa.dataset_id = fl.dataset_id
        AND TRIM(efa.original_id) = TRIM(fl.original_id)
    WHERE efa.factor_id IS NULL
    GROUP BY
        TRIM(LOWER(COALESCE(fl.scope,''))),
        TRIM(LOWER(COALESCE(fl.level_1,''))),
        TRIM(LOWER(COALESCE(fl.level_2,''))),
        TRIM(LOWER(COALESCE(fl.level_3,''))),
        TRIM(LOWER(COALESCE(fl.level_4,''))),
        TRIM(LOWER(COALESCE(fl.uom,''))),
        TRIM(LOWER(COALESCE(fl.ghg_unit,'')))
);


-- 2c. Now insert aliases for every still-unlinked row pointing to the new
--     definitions just created.
WITH still_unlinked AS (
    SELECT
        fl.dataset_id,
        fl.original_id,
        TRIM(LOWER(COALESCE(fl.scope,'')))    AS scope,
        TRIM(LOWER(COALESCE(fl.level_1,'')))  AS level_1,
        TRIM(LOWER(COALESCE(fl.level_2,'')))  AS level_2,
        TRIM(LOWER(COALESCE(fl.level_3,'')))  AS level_3,
        TRIM(LOWER(COALESCE(fl.level_4,'')))  AS level_4,
        TRIM(LOWER(COALESCE(fl.uom,'')))      AS uom,
        TRIM(LOWER(COALESCE(fl.ghg_unit,''))) AS ghg_unit
    FROM factor_lookup fl
    LEFT JOIN emission_factor_aliases efa
        ON  efa.dataset_id        = fl.dataset_id
        AND TRIM(efa.original_id) = TRIM(fl.original_id)
    WHERE efa.factor_id IS NULL
),
match_to_new AS (
    SELECT
        u.dataset_id,
        u.original_id,
        MIN(efd.factor_id) AS factor_id,
        COUNT(DISTINCT efd.factor_id) AS match_count
    FROM still_unlinked u
    JOIN emission_factor_definitions efd
        ON  TRIM(LOWER(COALESCE(efd.scope,'')))    = u.scope
        AND TRIM(LOWER(COALESCE(efd.level_1,'')))  = u.level_1
        AND TRIM(LOWER(COALESCE(efd.level_2,'')))  = u.level_2
        AND TRIM(LOWER(COALESCE(efd.level_3,'')))  = u.level_3
        AND TRIM(LOWER(COALESCE(efd.level_4,'')))  = u.level_4
        AND TRIM(LOWER(COALESCE(efd.uom,'')))      = u.uom
        AND TRIM(LOWER(COALESCE(efd.ghg_unit,''))) = u.ghg_unit
    GROUP BY u.dataset_id, u.original_id
)
INSERT INTO emission_factor_aliases (dataset_id, original_id, factor_id, note)
SELECT
    dataset_id,
    original_id,
    factor_id,
    '0052 phase3 new-definition'
FROM match_to_new
WHERE match_count = 1
ON CONFLICT (dataset_id, original_id) DO NOTHING;

-- Check:
SELECT COUNT(*) AS aliases_inserted_step2
FROM emission_factor_aliases
WHERE note = '0052 phase3 new-definition';


-- =====================================================================
-- STEP 3 – Backfill emission_factor_year_values for newly aliased rows
-- =====================================================================
-- For each newly created alias, insert a year-value row if one doesn't exist.
-- This ensures the numeric factor value is in the new tables and the view
-- can resolve it correctly.

INSERT INTO emission_factor_year_values
    (factor_id, dataset_id, original_id, year, factor, currency,
     valid_from, valid_to, notes)
SELECT
    efa.factor_id,
    fl.dataset_id,
    fl.original_id,
    fl.year,
    fl.factor,
    fl.currency,
    fl.valid_from,
    fl.valid_to,
    '0052 phase3 backfill'
FROM factor_lookup fl
JOIN emission_factor_aliases efa
    ON  efa.dataset_id        = fl.dataset_id
    AND TRIM(efa.original_id) = TRIM(fl.original_id)
WHERE efa.note IN ('0052 phase3 content-match', '0052 phase3 new-definition')
  -- Only if a year-value doesn't already exist for this factor/dataset/year
  AND NOT EXISTS (
      SELECT 1
      FROM emission_factor_year_values efyv
      WHERE efyv.factor_id   = efa.factor_id
        AND efyv.dataset_id  = fl.dataset_id
        AND (efyv.year = fl.year OR (efyv.year IS NULL AND fl.year IS NULL))
        AND efyv.superseded_by IS NULL
  )
ON CONFLICT DO NOTHING;

-- Check:
SELECT COUNT(*) AS year_values_inserted_step3
FROM emission_factor_year_values
WHERE notes = '0052 phase3 backfill';


-- =====================================================================
-- STEP 4 – Final verification
-- =====================================================================

-- 4a. Remaining unlinked count (should be 0 or only ambiguous cases)
SELECT COUNT(*) AS still_unlinked
FROM factor_lookup fl
LEFT JOIN emission_factor_aliases efa
    ON  efa.dataset_id        = fl.dataset_id
    AND TRIM(efa.original_id) = TRIM(fl.original_id)
WHERE efa.factor_id IS NULL;

-- 4b. Summary by dataset
SELECT
    d.name,
    d.year,
    COUNT(fl.db_id)       AS total_rows,
    COUNT(efa.alias_id)   AS linked_rows,
    COUNT(fl.db_id) - COUNT(efa.alias_id) AS still_unlinked
FROM factor_lookup fl
LEFT JOIN emission_factor_aliases efa
    ON  efa.dataset_id        = fl.dataset_id
    AND TRIM(efa.original_id) = TRIM(fl.original_id)
LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
GROUP BY d.name, d.year
ORDER BY still_unlinked DESC, d.name;
