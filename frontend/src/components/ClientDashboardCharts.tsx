"use client";

import { useMemo } from "react";
import { EmissionsByActivityWidget } from "@/components/report-widgets/EmissionsByActivityWidget";
import { HistoricalEmissionsTrendWidget } from "@/components/report-widgets/HistoricalEmissionsTrendWidget";
import { ScopeSummaryDonutWidget } from "@/components/report-widgets/ScopeSummaryDonutWidget";
import EmptyChart from "@/components/EmptyChart";

type ScopeDatum = {
  name: string;
  value: number;
};

type TrendDatum = {
  year: string;
  total: number;
  scope1: number;
  scope2: number;
  scope3: number;
};

type TopCategoryDatum = {
  category: string;
  emissions: number;
  percentage: number;
};

type ClientDashboardChartsProps = {
  scopeData: ScopeDatum[];
  total: number;
  trendData: TrendDatum[];
  topCategoryData: TopCategoryDatum[];
  view: "overview" | "trends";
  year?: string | number | null;
};

export default function ClientDashboardCharts({
  scopeData,
  total,
  trendData,
  topCategoryData,
  view,
  year,
}: ClientDashboardChartsProps) {
  const activityData = useMemo(
    () => topCategoryData.map((d) => ({ name: d.category, value: d.emissions })),
    [topCategoryData],
  );

  const historicalData = useMemo(
    () => trendData.map((d) => ({ year: Number(d.year), scope1: d.scope1, scope2: d.scope2, scope3: d.scope3, total: d.total })),
    [trendData],
  );

  if (view === "overview") {
    return (
      <div className="space-y-6">
        <ScopeSummaryDonutWidget
          title="Emissions by Scope"
          data={scopeData}
          currentTotal={total}
          yearLabel={year != null ? String(year) : null}
          showPngButton={false}
        />
        {topCategoryData.length === 0 ? (
          <EmptyChart
            title="No dataset category data available"
            description="This client does not have dataset-category-level emissions for the selected year."
            minHeight="min-h-[320px]"
          />
        ) : (
          <EmissionsByActivityWidget
            title="Top Emissions by Category"
            data={activityData}
            showPng={false}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {trendData.length === 0 ? (
        <EmptyChart
          title="No trend data available"
          description="There are no yearly emissions points available for this client yet."
          minHeight="min-h-[320px]"
        />
      ) : (
        <HistoricalEmissionsTrendWidget
          title="Emissions Trend"
          data={historicalData}
          showPng={false}
        />
      )}
    </div>
  );
}
