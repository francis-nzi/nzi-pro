-- 0053_prevent_cross_original_id_factor_merge.sql
--
-- Guards against the bug fixed on 2026-07-14: two one-time backfill scripts
-- (_phase1_backfill.py and sql_migrations/0052) grouped factor_lookup rows by
-- descriptive columns only (scope, level_1..4, uom, ghg_unit) and assumed that
-- combination was unique. It wasn't — DESNZ genuinely reports multiple distinct
-- line items (e.g. refrigerant blend components) that share identical
-- descriptive text but have different original_id/factor values. This silently
-- merged up to 940 rows per dataset onto a single shared factor_id, hiding most
-- of their data behind whichever row's factor_year_value the view happened to
-- pick.
--
-- The current ongoing ingestion path (ingest_conversion_factors.py's
-- _sync_normalised_tables_pg) does not have this bug — it already creates one
-- factor_id per (dataset_id, original_id) using the row's own factor_lookup.db_id,
-- so within-dataset merging cannot occur through normal use. This migration adds
-- a real constraint so it can never happen again regardless of what script or
-- code path touches these tables in the future.
--
-- Cross-dataset sharing of a factor_id (the "same factor family across
-- different year editions" use case the original migrations intended) is
-- unaffected — this only prevents two DIFFERENT original_ids within the SAME
-- dataset_id from ever aliasing to the same factor_id.

CREATE UNIQUE INDEX IF NOT EXISTS uq_emission_factor_aliases_dataset_factor
    ON emission_factor_aliases (dataset_id, factor_id);
