export type EmissionsPathwayPoint = {
  year: number;
  actual_total?: number | null;
  actual_s1?: number | null;
  actual_s2?: number | null;
  actual_s3?: number | null;
  target_total?: number | null;
  target_s1?: number | null;
  target_s2?: number | null;
  target_s3?: number | null;
};

export type YearlyEmissionLike = {
  year: number;
  scope1: number;
  scope2: number;
  scope3: number;
  total: number;
};

export type BuildEmissionsReductionPathwayDataOptions = {
  yearlyEmissions: YearlyEmissionLike[];
  scope1Fallback: number;
  scope2Fallback: number;
  scope3Fallback: number;
  benchmarkYear?: number | null;
  currentYear?: number | null;
  targetYear?: number | null;
  interimYear?: number | null;
  targetReductionPct?: number | null;
  interimS1Pct?: number | null;
  interimS2Pct?: number | null;
  interimS3Pct?: number | null;
};

export function buildEmissionsReductionPathwayData({
  yearlyEmissions,
  scope1Fallback,
  scope2Fallback,
  scope3Fallback,
  benchmarkYear,
  currentYear,
  targetYear,
  interimYear,
  targetReductionPct,
  interimS1Pct,
  interimS2Pct,
  interimS3Pct,
}: BuildEmissionsReductionPathwayDataOptions): EmissionsPathwayPoint[] {
  const firstHistoricalYear = yearlyEmissions.length > 0 ? yearlyEmissions[0].year : null;
  const fallbackYear = currentYear && currentYear > 1900 ? currentYear : new Date().getFullYear() - 1;
  const baselineYear =
    benchmarkYear != null && benchmarkYear > 1900
      ? benchmarkYear
      : firstHistoricalYear ?? fallbackYear;
  const endYear = targetYear != null && targetYear > baselineYear ? targetYear : Math.max(baselineYear + 1, 2050);

  const benchmarkRow = yearlyEmissions.find((row) => row.year === baselineYear) ?? null;
  const benchS1 = benchmarkRow ? benchmarkRow.scope1 : scope1Fallback;
  const benchS2 = benchmarkRow ? benchmarkRow.scope2 : scope2Fallback;
  const benchS3 = benchmarkRow ? benchmarkRow.scope3 : scope3Fallback;

  const finalFactor = (100 - (targetReductionPct ?? 100)) / 100;
  const iYear = interimYear != null && interimYear > baselineYear && interimYear < endYear ? interimYear : null;

  const forecastScope = (bench: number, interimPct: number | null | undefined, year: number): number => {
    if (year <= baselineYear) return bench;
    const finalTarget = bench * finalFactor;
    const iTarget = iYear != null && interimPct != null ? bench * (1 - interimPct / 100) : null;
    if (iYear != null && iTarget != null && year <= iYear) {
      const span = iYear - baselineYear;
      const t = span > 0 ? (year - baselineYear) / span : 1;
      return bench + (iTarget - bench) * t;
    }
    const segStart = iYear ?? baselineYear;
    const segVal = iTarget ?? bench;
    const span = endYear - segStart;
    const t = span > 0 ? (year - segStart) / span : 1;
    return Math.max(segVal + (finalTarget - segVal) * t, 0);
  };

  const yearSet = new Set<number>();
  for (let y = baselineYear; y <= endYear; y += 1) yearSet.add(y);
  yearlyEmissions.forEach((row) => {
    if (row.year <= endYear) yearSet.add(row.year);
  });
  const years = Array.from(yearSet).sort((a, b) => a - b);

  return years.map((year) => {
    const actual = yearlyEmissions.find((row) => row.year === year) ?? null;
    return {
      year,
      actual_total: actual ? actual.total : null,
      actual_s1: actual ? actual.scope1 : null,
      actual_s2: actual ? actual.scope2 : null,
      actual_s3: actual ? actual.scope3 : null,
      target_total:
        forecastScope(benchS1, interimS1Pct, year) +
        forecastScope(benchS2, interimS2Pct, year) +
        forecastScope(benchS3, interimS3Pct, year),
      target_s1: forecastScope(benchS1, interimS1Pct, year),
      target_s2: benchS2 > 0 ? forecastScope(benchS2, interimS2Pct, year) : undefined,
      target_s3: forecastScope(benchS3, interimS3Pct, year),
    };
  });
}
