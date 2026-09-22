const DEFAULT_LOCATION_BASED_ELECTRICITY_FACTOR_KG_PER_KWH = 0.177;

export type EnergyEmissionFactorDetails = {
  uk_location_based_kg_per_kwh?: number | null;
  uk_market_based_kg_per_kwh?: number | null;
  uk_transmission_distribution_kg_per_kwh?: number | null;
  uk_combined_kg_per_kwh?: number | null;
  non_uk_location_based_kg_per_kwh?: number | null;
  non_uk_market_based_kg_per_kwh?: number | null;
  non_uk_transmission_distribution_kg_per_kwh?: number | null;
  non_uk_combined_kg_per_kwh?: number | null;
};

export const AUTO_REPORT_METADATA_KEYS = [
  "datasets_names",
  "energy_consumption_uk_kwh",
  "energy_consumption_non_uk_kwh",
  "renewable_energy_kwh",
  "energy_emissions_tco2e",
  "energy_emissions_market_tco2e",
] as const;

function parseNumericValue(value: unknown): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDerivedValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10000) / 10000;
  return rounded
    .toFixed(4)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function pickFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function calculateDerivedEnergyEmissionFields(
  values: Record<string, unknown>,
  factorDetails?: EnergyEmissionFactorDetails | null,
): Record<string, string> {
  const ukKwh = Math.max(0, parseNumericValue(values.energy_consumption_uk_kwh) ?? 0);
  const nonUkKwh = Math.max(0, parseNumericValue(values.energy_consumption_non_uk_kwh) ?? 0);
  const totalKwh = ukKwh + nonUkKwh;
  const renewableKwhRaw = Math.max(0, parseNumericValue(values.renewable_energy_kwh) ?? 0);
  const renewableKwh = Math.min(renewableKwhRaw, totalKwh);
  // Mirrors _sync_energy_emissions_from_kwh in api/report_template_routes.py:
  // both figures are generation only. T&D losses are not part of either Scope 2
  // total under the GHG Protocol Scope 2 Guidance -- they are disclosed under
  // Scope 3 category 3, from the job's own T&D rows.
  const ukLocationFactor =
    pickFiniteNumber(factorDetails?.uk_location_based_kg_per_kwh) ??
    DEFAULT_LOCATION_BASED_ELECTRICITY_FACTOR_KG_PER_KWH;
  // The market-based blend is weighted over grid kWh alone, so it can differ
  // from the location-based blend when grid and renewable draw fall in months
  // priced by different factor years.
  const ukMarketFactor =
    pickFiniteNumber(factorDetails?.uk_market_based_kg_per_kwh) ?? ukLocationFactor;
  const nonUkLocationFactor =
    pickFiniteNumber(factorDetails?.non_uk_location_based_kg_per_kwh) ?? ukLocationFactor;
  const nonUkMarketFactor =
    pickFiniteNumber(factorDetails?.non_uk_market_based_kg_per_kwh) ?? nonUkLocationFactor;
  const renewableRatio = totalKwh > 0 ? renewableKwh / totalKwh : 0;
  const ukGridKwh = ukKwh * (1 - renewableRatio);
  const nonUkGridKwh = nonUkKwh * (1 - renewableRatio);

  return {
    energy_emissions_tco2e: formatDerivedValue(
      ((ukKwh * ukLocationFactor) + (nonUkKwh * nonUkLocationFactor)) / 1000,
    ),
    energy_emissions_market_tco2e: formatDerivedValue(
      ((ukGridKwh * ukMarketFactor) + (nonUkGridKwh * nonUkMarketFactor)) / 1000,
    ),
  };
}
