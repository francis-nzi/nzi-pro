export type ScopeDonutDataItem = {
  name: string;
  value: number;
};

type YearlyEmissionLike = {
  year: number;
  total?: number | null;
};

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function buildScopeDonutItems(
  scope1?: number | null,
  scope2?: number | null,
  scope3?: number | null,
): ScopeDonutDataItem[] {
  return [
    { name: "Scope 1", value: toNum(scope1) },
    { name: "Scope 2", value: toNum(scope2) },
    { name: "Scope 3", value: toNum(scope3) },
  ];
}

export function resolveScopeDonutBenchmarkYear(
  benchmarkYear: number | null | undefined,
  firstHistoricalYear: number | null | undefined,
  currentYear: number,
): number {
  return benchmarkYear ?? firstHistoricalYear ?? currentYear;
}

export function resolveScopeDonutBenchmarkTotal(
  yearlyEmissions: YearlyEmissionLike[] | null | undefined,
  benchmarkYear: number | null | undefined,
  fallback?: number | null,
): number | null {
  if (benchmarkYear == null) return fallback ?? null;
  const benchmarkRow = yearlyEmissions?.find((row) => row.year === benchmarkYear);
  if (benchmarkRow) return toNum(benchmarkRow.total);
  return fallback ?? null;
}
