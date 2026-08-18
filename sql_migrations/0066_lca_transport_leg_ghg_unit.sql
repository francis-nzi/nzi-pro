-- 0066_lca_transport_leg_ghg_unit.sql
--
-- lca_transport_legs.factor_unit was being used to hold a bare activity
-- unit (e.g. "tonne.km", "km", "miles") copied straight from the emission
-- factor's UOM column, while the emissions calc (services/lca_transport.py
-- compute_leg_emissions_tco2e) expected a combined "kgCO2e/tonne.km"-style
-- string -- the format regular LCA line items actually use, but that
-- transport legs never produced. That mismatch made the mass (kg->tonne)
-- scaling silently skip and the kg-vs-tonne magnitude misfire to x1.0
-- instead of x0.001 for any tonne.km-denominated factor (e.g. sea freight),
-- overstating those legs by roughly 1000x. See scripts/fix_lca_transport_leg_emissions.py
-- for the one-off recompute of legs created before this fix.
--
-- This column gives the numerator (emissions unit) its own field, separate
-- from factor_unit (kept as the bare activity/denominator unit), matching
-- the uom/ghg_unit split already used everywhere else in this schema
-- (factor_lookup, job_custom_factors, custom_factors).

ALTER TABLE lca_transport_legs ADD COLUMN IF NOT EXISTS factor_ghg_unit VARCHAR;
