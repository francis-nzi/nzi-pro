-- 0059_lca_factor_confidence_and_readiness.sql
--
-- Phase 2 of the LCA/PCF rebuild (see plan for full rationale).
--
-- 1) Enables pg_trgm so factor matching can use real trigram similarity
--    instead of the naive ILIKE/keyword-point-scoring in Phase 1, and adds
--    lca_line_items.factor_match_confidence so the best-candidate score is
--    recorded even when it's below the auto-apply confidence threshold
--    (lets the UI/readiness score flag "needs review" lines).
-- 2) Adds a persisted, advisory readiness/data-quality score on
--    lca_assessments (mirrors the real Britannia Fire "Readiness Tracker":
--    mass balance, % real weights, factors sourced, modules covered).
--    Purely informational -- it does not gate or override review_status.
-- 3) Trigram GIN indexes on factor_lookup are perf insurance only; at
--    ~35k rows a sequential scan with similarity() computed on the fly is
--    already fast, but the index keeps this cheap as the table grows.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE lca_line_items
  ADD COLUMN IF NOT EXISTS factor_match_confidence NUMERIC;

ALTER TABLE lca_assessments
  ADD COLUMN IF NOT EXISTS readiness_score NUMERIC,
  ADD COLUMN IF NOT EXISTS readiness_breakdown JSONB DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_factor_lookup_report_label_trgm
  ON factor_lookup USING gin (report_label gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_factor_lookup_column_text_trgm
  ON factor_lookup USING gin (column_text gin_trgm_ops);
