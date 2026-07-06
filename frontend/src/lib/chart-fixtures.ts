/**
 * Deterministic fixture data for the report-widgets chart library.
 *
 * Used by /dev/chart-gallery and the golden-image visual tests
 * (tests/visual/chart-golden.spec.ts). DO NOT change these values casually:
 * any change invalidates the golden screenshots and requires regenerating
 * them with `npm run test:visual:update` — which should only happen when a
 * chart's appearance is being changed DELIBERATELY.
 *
 * See CHARTS.md at the repository root for the chart architecture contract.
 */

import type {
  ActivityBarPoint,
  HistoricalEmissionsPoint,
  ReportComparisonYear,
  ScopeCategoryComparisonRow,
} from "@/components/report-widgets";
import type { ScopeDonutItem } from "@/components/report-widgets/ScopeSummaryDonutWidget";
import type { ScopeYoYBarPoint } from "@/components/report-widgets/ScopeYearOnYearBarWidget";
import type {
  IntensityPathwayPoint,
  IntensityPathwaySeries,
} from "@/components/report-widgets/IntensityPathwayWidget";
import type { EmissionsPathwayPoint } from "@/components/report-widgets/pathway-data";

export const FIXTURE_CLIENT_NAME = "Fixture Manufacturing Ltd";
export const FIXTURE_CURRENT_YEAR = 2025;
export const FIXTURE_BENCHMARK_YEAR = 2022;
export const FIXTURE_TARGET_YEAR = 2040;
export const FIXTURE_INTERIM_YEAR = 2030;

export const FIXTURE_SCOPE_DONUT: ScopeDonutItem[] = [
  { name: "Scope 1", value: 420.5 },
  { name: "Scope 2", value: 185.25 },
  { name: "Scope 3", value: 1290.75 },
];

export const FIXTURE_CURRENT_TOTAL = 1896.5;
export const FIXTURE_BENCHMARK_TOTAL = 2310.4;

export const FIXTURE_SITE_DONUT: ScopeDonutItem[] = [
  { name: "Head Office", value: 512.3 },
  { name: "Factory North", value: 848.9 },
  { name: "Factory South", value: 401.1 },
  { name: "Distribution Hub", value: 134.2 },
];

export const FIXTURE_ACTIVITY_BARS: ActivityBarPoint[] = [
  { name: "Energy", value: 605.75 },
  { name: "Business Travel", value: 132.4 },
  { name: "Employee Commuting", value: 98.6 },
  { name: "Purchased Goods & Se…", fullName: "Purchased Goods & Services", value: 754.25 },
  { name: "Waste", value: 61.3 },
  { name: "Water", value: 12.2 },
];

export const FIXTURE_HISTORICAL_TREND: HistoricalEmissionsPoint[] = [
  { year: 2022, scope1: 502.1, scope2: 260.8, scope3: 1547.5, total: 2310.4 },
  { year: 2023, scope1: 470.3, scope2: 231.4, scope3: 1450.2, total: 2151.9 },
  { year: 2024, scope1: 447.8, scope2: 205.6, scope3: 1360.9, total: 2014.3 },
  { year: 2025, scope1: 420.5, scope2: 185.25, scope3: 1290.75, total: 1896.5 },
];

export const FIXTURE_PATHWAY: EmissionsPathwayPoint[] = [
  { year: 2022, actual_total: 2310.4, actual_s1: 502.1, actual_s2: 260.8, actual_s3: 1547.5, target_total: 2310.4 },
  { year: 2023, actual_total: 2151.9, actual_s1: 470.3, actual_s2: 231.4, actual_s3: 1450.2, target_total: 2182.0 },
  { year: 2024, actual_total: 2014.3, actual_s1: 447.8, actual_s2: 205.6, actual_s3: 1360.9, target_total: 2053.7 },
  { year: 2025, actual_total: 1896.5, actual_s1: 420.5, actual_s2: 185.25, actual_s3: 1290.75, target_total: 1925.3 },
  { year: 2030, target_total: 1283.6 },
  { year: 2035, target_total: 641.8 },
  { year: 2040, target_total: 0 },
];

export const FIXTURE_INTENSITY_SERIES: IntensityPathwaySeries[] = [
  { key: "per_employee", label: "Employee", color: "#0f766e" },
  { key: "per_million_gbp", label: "GBP £m turnover", color: "#0891b2" },
];

export const FIXTURE_INTENSITY_POINTS: IntensityPathwayPoint[] = [
  { year: 2022, per_employee: 9.24, per_million_gbp: 128.4 },
  { year: 2023, per_employee: 8.61, per_million_gbp: 116.9 },
  { year: 2024, per_employee: 7.9, per_million_gbp: 104.2 },
  { year: 2025, per_employee: 7.3, per_million_gbp: 95.8 },
];

export const FIXTURE_YOY_BARS: ScopeYoYBarPoint[] = [
  { scope: "Scope 1", benchmark: 502.1, previous: 447.8, current: 420.5, pct: -6.1 },
  { scope: "Scope 2", benchmark: 260.8, previous: 205.6, current: 185.25, pct: -9.9 },
  { scope: "Scope 3", benchmark: 1547.5, previous: 1360.9, current: 1290.75, pct: -5.2 },
];

export const FIXTURE_COMPARISON_YEARS: ReportComparisonYear[] = [
  { year: 2022, isBenchmark: true, jobNumber: "J000100" },
  { year: 2024, jobNumber: "J000200" },
  { year: 2025, jobNumber: "J000300" },
];

export const FIXTURE_COMPARISON_ROWS: ScopeCategoryComparisonRow[] = [
  { type: "category", scope: "Scope 1", category: "Stationary Combustion", values: [310.2, 275.4, 262.3] },
  { type: "category", scope: "Scope 1", category: "Company Vehicles", values: [191.9, 172.4, 158.2] },
  { type: "subtotal", scope: "Scope 1", values: [502.1, 447.8, 420.5] },
  { type: "category", scope: "Scope 2", category: "Purchased Electricity", values: [260.8, 205.6, 185.25] },
  { type: "subtotal", scope: "Scope 2", values: [260.8, 205.6, 185.25] },
  { type: "category", scope: "Scope 3", category: "Purchased Goods & Services", values: [880.1, 800.4, 754.25] },
  { type: "category", scope: "Scope 3", category: "Business Travel", values: [180.6, 145.2, 132.4] },
  { type: "category", scope: "Scope 3", category: "Employee Commuting", values: [128.3, 105.1, 98.6] },
  { type: "category", scope: "Scope 3", category: "Other Upstream", values: [358.5, 310.2, 305.5] },
  { type: "subtotal", scope: "Scope 3", values: [1547.5, 1360.9, 1290.75] },
  { type: "total", values: [2310.4, 2014.3, 1896.5] },
];
