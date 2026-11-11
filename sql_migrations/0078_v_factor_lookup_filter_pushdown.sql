-- 0078_v_factor_lookup_filter_pushdown.sql
--
-- v_factor_lookup used SELECT DISTINCT ON (fl.db_id) to keep one
-- emission_factor_year_values row per factor. DISTINCT ON stops Postgres
-- pushing WHERE clauses into the view, so every query (e.g. a job's factor
-- search filtered to 2-3 datasets) built and sorted all ~270k rows first:
-- ~1s per query, several per search, and under concurrency 20-30s searches
-- that held pooled connections and stalled the whole app.
--
-- Same rows, same columns: the year-value join now keeps only the lowest
-- factor_year_value_id per (factor_id, dataset_id, year) via NOT EXISTS,
-- which matches the old DISTINCT ON pick exactly (aliases are unique per
-- (dataset_id, original_id) and definitions per factor_id). dataset_id is
-- now fl.dataset_id, which the join already forced it to equal. Verified
-- against production: EXCEPT ALL both ways returns 0 rows.
--
-- core/migrations.py recreates this view at startup and must stay identical.

CREATE OR REPLACE VIEW v_factor_lookup AS
SELECT
    fl.db_id,
    fl.dataset_id                                                                       AS dataset_id,
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
LEFT JOIN (
    SELECT y.*
    FROM emission_factor_year_values y
    WHERE y.superseded_by IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM emission_factor_year_values y2
          WHERE y2.factor_id      = y.factor_id
            AND y2.dataset_id     = y.dataset_id
            AND y2.superseded_by IS NULL
            AND y2.year IS NOT DISTINCT FROM y.year
            AND y2.factor_year_value_id < y.factor_year_value_id
      )
) efyv
    ON  efyv.factor_id      = efa.factor_id
    AND efyv.dataset_id     = fl.dataset_id
    AND (efyv.year = fl.year OR (efyv.year IS NULL AND fl.year IS NULL))
ORDER BY fl.db_id;
