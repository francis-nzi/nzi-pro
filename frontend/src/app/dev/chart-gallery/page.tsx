"use client";

/**
 * Chart gallery — renders every report-widget with deterministic fixture data.
 *
 * Purposes:
 *  1. Golden-image visual tests (tests/visual/chart-golden.spec.ts) screenshot
 *     each widget here and diff against checked-in goldens. Any unintended
 *     visual change to a chart fails CI.
 *  2. A human reference page: open /dev/chart-gallery to see the canonical
 *     appearance of every chart in the system.
 *
 * Rules (see CHARTS.md at the repository root):
 *  - This page must render ONLY report-widgets components with ONLY fixture
 *    data from @/lib/chart-fixtures. No API calls, no live data.
 *  - Fixed container widths keep screenshots deterministic.
 */

import type { ReactNode } from "react";
import {
  EmissionsByActivityWidget,
  EmissionsReductionPathwayWidget,
  HistoricalEmissionsTrendWidget,
  IntensityPathwayWidget,
  ScopeCategoryComparisonTable,
  ScopeSummaryDonutWidget,
  ScopeYearOnYearBarWidget,
  SiteSummaryDonutWidget,
} from "@/components/report-widgets";
import {
  FIXTURE_ACTIVITY_BARS,
  FIXTURE_BENCHMARK_TOTAL,
  FIXTURE_BENCHMARK_YEAR,
  FIXTURE_CLIENT_NAME,
  FIXTURE_COMPARISON_ROWS,
  FIXTURE_COMPARISON_YEARS,
  FIXTURE_CURRENT_TOTAL,
  FIXTURE_CURRENT_YEAR,
  FIXTURE_HISTORICAL_TREND,
  FIXTURE_INTENSITY_POINTS,
  FIXTURE_INTENSITY_SERIES,
  FIXTURE_INTERIM_YEAR,
  FIXTURE_PATHWAY,
  FIXTURE_SCOPE_DONUT,
  FIXTURE_SITE_DONUT,
  FIXTURE_TARGET_YEAR,
  FIXTURE_YOY_BARS,
} from "@/lib/chart-fixtures";

const WIDGET_WIDTH = 860;

function GallerySlot({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section
      data-gallery-widget={id}
      style={{ width: WIDGET_WIDTH, margin: "0 auto 32px auto", background: "#ffffff" }}
    >
      {children}
    </section>
  );
}

export default function ChartGalleryPage() {
  return (
    <main style={{ padding: 24, background: "#ffffff" }}>
      <h1 className="text-xl font-semibold mb-1">Chart Gallery (fixture data)</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Canonical rendering of every report widget. Backed by golden-image tests — see CHARTS.md.
      </p>

      <GallerySlot id="emissions_scope_donut">
        <ScopeSummaryDonutWidget
          title="Emissions by Scope"
          subtitle="Reporting year 2025"
          clientName={FIXTURE_CLIENT_NAME}
          data={FIXTURE_SCOPE_DONUT}
          currentYear={FIXTURE_CURRENT_YEAR}
          benchmarkYear={FIXTURE_BENCHMARK_YEAR}
          benchmarkTotal={FIXTURE_BENCHMARK_TOTAL}
          currentTotal={FIXTURE_CURRENT_TOTAL}
          showPngButton={false}
        />
      </GallerySlot>

      <GallerySlot id="emissions_site_donut">
        <SiteSummaryDonutWidget
          title="Emissions by Site"
          subtitle="Reporting year 2025"
          clientName={FIXTURE_CLIENT_NAME}
          data={FIXTURE_SITE_DONUT}
          currentYear={FIXTURE_CURRENT_YEAR}
          benchmarkYear={FIXTURE_BENCHMARK_YEAR}
          benchmarkTotal={FIXTURE_BENCHMARK_TOTAL}
          currentTotal={FIXTURE_CURRENT_TOTAL}
        />
      </GallerySlot>

      <GallerySlot id="emissions_by_activity">
        <EmissionsByActivityWidget
          title="Emissions by Activity Group"
          subtitle="Reporting year 2025"
          clientName={FIXTURE_CLIENT_NAME}
          data={FIXTURE_ACTIVITY_BARS}
          showPng={false}
        />
      </GallerySlot>

      <GallerySlot id="historical_emissions_trend">
        <HistoricalEmissionsTrendWidget
          title="Historical Emissions Trend"
          subtitle="2022–2025"
          clientName={FIXTURE_CLIENT_NAME}
          data={FIXTURE_HISTORICAL_TREND}
          showPng={false}
        />
      </GallerySlot>

      <GallerySlot id="emissions_reduction_pathway">
        <EmissionsReductionPathwayWidget
          title="Emissions Reduction Pathway"
          subtitle="Net zero by 2040"
          clientName={FIXTURE_CLIENT_NAME}
          data={FIXTURE_PATHWAY}
          benchmarkYear={FIXTURE_BENCHMARK_YEAR}
          targetYear={FIXTURE_TARGET_YEAR}
          interimYear={FIXTURE_INTERIM_YEAR}
        />
      </GallerySlot>

      <GallerySlot id="intensity_pathway">
        <IntensityPathwayWidget
          title="Intensity Metrics Pathway"
          subtitle="Per employee and per £m turnover"
          clientName={FIXTURE_CLIENT_NAME}
          data={FIXTURE_INTENSITY_POINTS}
          series={FIXTURE_INTENSITY_SERIES}
          benchmarkYear={FIXTURE_BENCHMARK_YEAR}
          targetYear={FIXTURE_TARGET_YEAR}
          interimYear={FIXTURE_INTERIM_YEAR}
        />
      </GallerySlot>

      <GallerySlot id="scope_year_on_year_bar">
        <ScopeYearOnYearBarWidget
          title="Scope Comparison Year on Year"
          subtitle="Baseline vs previous vs current"
          clientName={FIXTURE_CLIENT_NAME}
          data={FIXTURE_YOY_BARS}
          benchmarkLabel="2022 (benchmark)"
          previousLabel="2024"
          currentLabel="2025"
        />
      </GallerySlot>

      <GallerySlot id="scope_category_comparison">
        <ScopeCategoryComparisonTable
          years={FIXTURE_COMPARISON_YEARS}
          rows={FIXTURE_COMPARISON_ROWS}
        />
      </GallerySlot>
    </main>
  );
}
