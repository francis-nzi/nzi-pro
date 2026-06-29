"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { REPORT_WIDGET_IDS } from "./registry";
import { registerWidgetPngExporter } from "./export-registry";
import { buildPngFilename, findLargestSvg, renderChartAsPngDataUrl } from "./png-export";

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

type EmissionsReductionPathwayWidgetProps = {
  title: string;
  subtitle?: string;
  clientName?: string | null;
  data: EmissionsPathwayPoint[];
  benchmarkYear?: number | null;
  targetYear?: number | null;
  interimYear?: number | null;
  showScope2?: boolean;
  presentation?: "card" | "image";
  storedPngUrl?: string | null;
  widgetKey?: string;
  showWidgetRef?: boolean;
  className?: string;
  valueFormatter?: (value: number | null | undefined) => ReactNode;
};

const DEFAULT_SCOPE_COLORS = ["#4b8b3b", "#4d4d4d", "#38bdf8"];

export function EmissionsReductionPathwayWidget({
  title,
  subtitle,
  clientName,
  data,
  benchmarkYear,
  targetYear,
  interimYear,
  showScope2 = true,
  presentation = "card",
  storedPngUrl,
  widgetKey = REPORT_WIDGET_IDS.emissionsReductionPathway,
  showWidgetRef = false,
  className,
  valueFormatter = (value) => `${formatNumber(Number(value || 0), 1)} tCO2e`,
}: EmissionsReductionPathwayWidgetProps) {
  const yearLookup = new Map<number, EmissionsPathwayPoint>(data.map((point) => [Number(point.year), point]));
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const exportPngDataUrlRef = useRef<() => Promise<string> | string>(() => "");
  const minCaptureWidth = 320;
  const minCaptureHeight = 220;


  const waitForRenderedSvg = useCallback(async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const svg = findLargestSvg(chartWrapRef.current);
      if (svg) {
        const rect = svg.getBoundingClientRect();
        if (rect.width >= minCaptureWidth && rect.height >= minCaptureHeight) {
          return svg;
        }
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 75);
      });
    }
    return findLargestSvg(chartWrapRef.current);
  }, [minCaptureHeight, minCaptureWidth]);

  const exportPngDataUrl = useCallback(async () => {
    const svg = await waitForRenderedSvg();
    if (!svg) return "";

    return renderChartAsPngDataUrl({
      svg,
      title,
      subtitle,
      legendItems: [
        { label: "Total", color: "#0f766e" },
        { label: "Scope 1", color: DEFAULT_SCOPE_COLORS[0] },
        ...(showScope2 ? [{ label: "Scope 2", color: DEFAULT_SCOPE_COLORS[1] }] : []),
        { label: "Scope 3", color: DEFAULT_SCOPE_COLORS[2] },
      ],
      canvasWidth: 960,
    });
  }, [showScope2, subtitle, title, waitForRenderedSvg]);

  useEffect(() => {
    exportPngDataUrlRef.current = exportPngDataUrl;
  }, [exportPngDataUrl]);

  const stableExportPngDataUrl = useCallback(() => exportPngDataUrlRef.current(), []);

  const downloadPng = useCallback(async () => {
    const pngUrl = await exportPngDataUrl();
    if (!pngUrl) return;
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = buildPngFilename(title, clientName);
    a.click();
  }, [clientName, exportPngDataUrl, title]);

  useEffect(() => {
    if (!widgetKey) return;
    return registerWidgetPngExporter(widgetKey, stableExportPngDataUrl);
  }, [stableExportPngDataUrl, widgetKey]);

  if (!data.length) {
    return (
      <Card className={className}>
        <CardHeader className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {subtitle ? <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No pathway data available.</div>
        </CardContent>
      </Card>
    );
  }

  if (presentation === "image" && storedPngUrl) {
    return (
      <div className={className} data-widget-key={widgetKey}>
        <img
          src={storedPngUrl}
          alt={title}
          className="mx-auto block max-w-full h-auto object-contain"
          style={{ width: "100%" }}
        />
      </div>
    );
  }

  return (
    <Card className={className} data-widget-key={widgetKey}>
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
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
        <div ref={chartWrapRef} className="h-[360px]">
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={data} margin={{ top: 5, right: 24, left: 6, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString("en-GB", { maximumFractionDigits: 0 })} />
              <Tooltip
                content={(props: TooltipContentProps<number, string>) => {
                  if (!props.active) return null;
                  const year = Number(props.label);
                  const point = yearLookup.get(year);
                  if (!point) return null;

                  const rows: Array<{ label: string; value: number | null | undefined }> = [
                    { label: "Total", value: point.actual_total ?? point.target_total },
                    { label: "Scope 1", value: point.actual_s1 ?? point.target_s1 },
                    ...(showScope2 ? [{ label: "Scope 2", value: point.actual_s2 ?? point.target_s2 }] : []),
                    { label: "Scope 3", value: point.actual_s3 ?? point.target_s3 },
                  ];

                  return (
                    <div className="rounded-md border bg-background px-3 py-2 shadow-sm">
                      <div className="text-sm font-medium">Year: {year}</div>
                      <div className="mt-2 space-y-1">
                        {rows.map((row) => (
                          <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
                            <span>{row.label}</span>
                            <span className="font-medium">{valueFormatter(row.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }}
              />
              <Legend iconType="circle" />
              {interimYear && interimYear > (benchmarkYear ?? 0) && (
                <ReferenceLine
                  x={interimYear}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 10 }}
                />
              )}
              {targetYear && (
                <ReferenceLine
                  x={targetYear}
                  stroke="#16a34a"
                  strokeDasharray="3 3"
                  label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 10 }}
                />
              )}
              <Line
                type="monotone"
                dataKey="actual_total"
                name="Total"
                stroke="#0f766e"
                strokeWidth={3}
                dot={{ r: 5 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="actual_s1"
                name="Scope 1"
                stroke={DEFAULT_SCOPE_COLORS[0]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              {showScope2 && (
                <Line
                  type="monotone"
                  dataKey="actual_s2"
                  name="Scope 2"
                  stroke={DEFAULT_SCOPE_COLORS[1]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="actual_s3"
                name="Scope 3"
                stroke={DEFAULT_SCOPE_COLORS[2]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="target_total"
                name="Total (target)"
                stroke="#0f766e"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="target_s1"
                name="Scope 1 target"
                stroke={DEFAULT_SCOPE_COLORS[0]}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                legendType="none"
              />
              {showScope2 && (
                <Line
                  type="monotone"
                  dataKey="target_s2"
                  name="Scope 2 target"
                  stroke={DEFAULT_SCOPE_COLORS[1]}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                  legendType="none"
                />
              )}
              <Line
                type="monotone"
                dataKey="target_s3"
                name="Scope 3 target"
                stroke={DEFAULT_SCOPE_COLORS[2]}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                legendType="none"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

