ALTER TABLE public.job_emission_groups
  ADD COLUMN IF NOT EXISTS dataset_id INTEGER REFERENCES public.datasets(dataset_id);

ALTER TABLE public.job_emission_groups
  ADD COLUMN IF NOT EXISTS factor_db_id INTEGER REFERENCES public.factor_lookup(db_id);

ALTER TABLE public.job_emission_groups
  ADD COLUMN IF NOT EXISTS original_id VARCHAR;

ALTER TABLE public.job_emission_groups
  ADD COLUMN IF NOT EXISTS factor NUMERIC;

ALTER TABLE public.job_emission_groups
  ADD COLUMN IF NOT EXISTS ghg_unit VARCHAR;

ALTER TABLE public.job_emission_groups
  ADD COLUMN IF NOT EXISTS uom VARCHAR;

CREATE INDEX IF NOT EXISTS job_emission_groups_factor_idx
ON public.job_emission_groups (job_id, group_type, factor_db_id, enabled);

UPDATE public.job_emission_groups g
SET dataset_id = COALESCE(g.dataset_id, s.dataset_id),
    factor_db_id = COALESCE(g.factor_db_id, s.factor_db_id),
    original_id = COALESCE(g.original_id, s.original_id),
    factor = COALESCE(g.factor, s.factor),
    ghg_unit = COALESCE(g.ghg_unit, s.ghg_unit),
    uom = COALESCE(g.uom, s.uom),
    updated_at = NOW()
FROM (
    SELECT DISTINCT ON (job_id, group_id)
      job_id, group_id, dataset_id, factor_db_id, original_id, factor, ghg_unit, uom
    FROM public.job_emission_sources
    WHERE group_id IS NOT NULL
      AND COALESCE(enabled, TRUE) = TRUE
      AND (
        dataset_id IS NOT NULL OR factor_db_id IS NOT NULL OR original_id IS NOT NULL
        OR factor IS NOT NULL OR ghg_unit IS NOT NULL OR uom IS NOT NULL
      )
    ORDER BY job_id, group_id, source_id
) s
WHERE g.group_id = s.group_id
  AND g.job_id = s.job_id
  AND (
    g.dataset_id IS NULL OR g.factor_db_id IS NULL OR g.original_id IS NULL
    OR g.factor IS NULL OR g.ghg_unit IS NULL OR g.uom IS NULL
  );
