"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { REPORT_WIDGET_IDS } from "./registry";
import { registerWidgetPngExporter } from "./export-registry";
import { buildPngFilename, downloadChartAsPng, findLargestSvg, renderChartAsPngDataUrl } from "./png-export";

export type ScopeYoYBarPoint = {
  scope: string;
  benchmark?: number | null;
  previous?: number | null;
  current?: number | null;
  pct?: number | null;
};

type LegendItem = { label: string; color: string };

type ScopeYearOnYearBarWidgetProps = {
  title?: string;
  subtitle?: string;
  clientName?: string | null;
  data: ScopeYoYBarPoint[];
  benchmarkLabel: string;
  previousLabel: string;
  currentLabel: string;
  showBenchmarkBar?: boolean;
  showPreviousBar?: boolean;
  showComparisonPct?: boolean;
  widgetKey?: string;
  showWidgetRef?: boolean;
  presentation?: "card" | "image";
  storedPngUrl?: string | null;
  className?: string;
};

const BENCHMARK_COLOR = "#94a3b8";
const PREVIOUS_COLOR = "#64748b";
const CURRENT_COLOR = "#0f766e";

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
}

export function ScopeYearOnYearBarWidget({
  title,
  subtitle,
  clientName,
  data,
  benchmarkLabel,
  previousLabel,
  currentLabel,
  showBenchmarkBar = true,
  showPreviousBar = true,
  showComparisonPct = true,
  widgetKey = REPORT_WIDGET_IDS.scopeYearOnYearBar,
  showWidgetRef = false,
  presentation = "card",
  storedPngUrl,
  className,
}: ScopeYearOnYearBarWidgetProps) {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const resolvedTitle = title ?? `${clientName ?? "Client"} Year-on-Year Comparison by Scope`;

  const legendItems = useMemo<LegendItem[]>(
    () => [
      ...(showBenchmarkBar ? [{ label: benchmarkLabel, color: BENCHMARK_COLOR }] : []),
      ...(showPreviousBar ? [{ label: previousLabel, color: PREVIOUS_COLOR }] : []),
      { label: currentLabel, color: CURRENT_COLOR },
    ],
    [benchmarkLabel, currentLabel, previousLabel, showBenchmarkBar, showPreviousBar]
  );

  const downloadPng = async () => {
    const svg = findLargestSvg(chartWrapRef.current);
    if (!svg) return;
    await downloadChartAsPng({
      svg,
      filename: buildPngFilename(resolvedTitle, clientName),
      title: resolvedTitle,
      subtitle,
      legendItems,
      canvasWidth: 960,
    });
  };

  const exportPngDataUrl = async () => {
    const svg = findLargestSvg(chartWrapRef.current);
    if (!svg) return "";
    return renderChartAsPngDataUrl({
      svg,
      title: resolvedTitle,
      subtitle,
      legendItems,
      canvasWidth: 960,
    });
  };

  useEffect(() => {
    if (!widgetKey || storedPngUrl) return;
    return registerWidgetPngExporter(widgetKey, exportPngDataUrl);
  }, [exportPngDataUrl, widgetKey, storedPngUrl]);

  const renderTooltip = (props: any) => {
    if (!props.active) return null;
    const payload = Array.isArray(props.payload) ? (props.payload[0]?.payload as ScopeYoYBarPoint | undefined) : undefined;
    if (!payload) return null;

    const benchmark = Number(payload.benchmark ?? 0);
    const previous = Number(payload.previous ?? 0);
    const current = Number(payload.current ?? 0);
    const pct = showComparisonPct ? payload.pct : null;

    return (
      <div className="rounded-md border bg-background px-3 py-2 shadow-sm">
        <div className="text-sm font-medium">{payload.scope}</div>
        <div className="mt-2 space-y-1">
          {showBenchmarkBar ? (
            <div className="flex items-center justify-between gap-4 text-sm">
              <span>{benchmarkLabel}</span>
              <span className="font-medium">{formatNumber(benchmark, 1)} tCO₂e</span>
            </div>
          ) : null}
          {showPreviousBar ? (
            <div className="flex items-center justify-between gap-4 text-sm">
              <span>{previousLabel}</span>
              <span className="font-medium">{formatNumber(previous, 1)} tCO₂e</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4 text-sm">
            <span>{currentLabel}</span>
            <span className="font-medium">{formatNumber(current, 1)} tCO₂e</span>
          </div>
          {showComparisonPct && pct != null ? (
            <div className="pt-1 text-xs font-semibold" style={{ color: pct < 0 ? "#16a34a" : "#dc2626" }}>
              {`${formatPct(pct)} vs benchmark`}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  if (presentation === "image" && storedPngUrl) {
    return (
      <div className={className} data-widget-key={widgetKey}>
        <img
          src={storedPngUrl}
          alt={resolvedTitle}
          className="mx-auto block max-w-full h-auto object-contain"
          style={{ width: "100%" }}
        />
      </div>
    );
  }

  if (!data.length) {
    return (
      <Card className={className}>
        <CardHeader className="space-y-1">
          <CardTitle>{resolvedTitle}</CardTitle>
          {subtitle ? <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No comparison data available.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className} data-widget-key={widgetKey}>
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{resolvedTitle}</CardTitle>
            {subtitle ? <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => void downloadPng()}>
              <Download className="mr-2 h-4 w-4" />
              PNG
            </Button>
            {showWidgetRef ? (
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                <span className="block text-right">Widget ref</span>
                <span className="block font-mono tracking-[0.18em] text-foreground">{widgetKey}</span>
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div ref={chartWrapRef}>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data} margin={{ top: 20, right: 24, left: 8, bottom: 36 }} barCategoryGap="30%" barGap={3}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0F0" />
                <XAxis
                  dataKey="scope"
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  tick={(tickProps: any) => {
                    const { x, y, payload } = tickProps as { x: number; y: number; payload: { value: string } };
                    const row = data.find((d) => d.scope === payload?.value);
                    const pct = showComparisonPct ? row?.pct ?? null : null;
                    return (
                      <g transform={`translate(${x},${y})`}>
                        <text textAnchor="middle" fontSize={11} fill="#334155" y={14}>
                          {payload?.value}
                        </text>
                        {pct != null ? (
                          <text textAnchor="middle" fontSize={10} fill={pct < 0 ? "#16a34a" : "#dc2626"} y={28}>
                            {formatPct(pct)}
                          </text>
                        ) : null}
                      </g>
                    );
                  }}
                />
                <YAxis
                  domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.2)]}
                  tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: "tCO₂e", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "#94a3b8" } }}
                />
                <Tooltip
                  formatter={(v: unknown, name: unknown) => [typeof v === "number" ? `${formatNumber(v, 1)} tCO₂e` : "—", String(name ?? "")]}
                  content={renderTooltip}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
                {showBenchmarkBar ? (
                  <Bar isAnimationActive={false} dataKey="benchmark" name={benchmarkLabel} fill={BENCHMARK_COLOR} radius={[3, 3, 0, 0]}>
                    <LabelList
                      dataKey="benchmark"
                      position="top"
                      formatter={(v: unknown) => (typeof v === "number" && v > 0 ? formatNumber(v, 1) : "")}
                      style={{ fontSize: 11, fill: "#64748b" }}
                    />
                  </Bar>
                ) : null}
                {showPreviousBar ? (
                  <Bar isAnimationActive={false} dataKey="previous" name={previousLabel} fill={PREVIOUS_COLOR} radius={[3, 3, 0, 0]}>
                    <LabelList
                      dataKey="previous"
                      position="top"
                      formatter={(v: unknown) => (typeof v === "number" && v > 0 ? formatNumber(v, 1) : "")}
                      style={{ fontSize: 11, fill: "#475569" }}
                    />
                  </Bar>
                ) : null}
                <Bar isAnimationActive={false} dataKey="current" name={currentLabel} fill={CURRENT_COLOR} radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="current"
                    position="top"
                    formatter={(v: unknown) => (typeof v === "number" && v > 0 ? formatNumber(v, 1) : "")}
                    style={{ fontSize: 11, fill: CURRENT_COLOR }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

