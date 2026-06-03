"use client";

import type { ReactNode } from "react";
import { useRef } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { REPORT_WIDGET_IDS } from "./registry";

export type IntensityPathwayPoint = {
  year: number;
  [key: string]: number | string | null | undefined;
};

export type IntensityPathwaySeries = {
  key: string;
  label: string;
  color: string;
};

type IntensityPathwayWidgetProps = {
  title: string;
  subtitle?: string;
  data: IntensityPathwayPoint[];
  series: IntensityPathwaySeries[];
  benchmarkYear?: number | null;
  targetYear?: number | null;
  interimYear?: number | null;
  widgetKey?: string;
  showWidgetRef?: boolean;
  className?: string;
  valueFormatter?: (value: number | null | undefined) => ReactNode;
};

export function IntensityPathwayWidget({
  title,
  subtitle,
  data,
  series,
  benchmarkYear,
  targetYear,
  interimYear,
  widgetKey = REPORT_WIDGET_IDS.intensityPathway,
  showWidgetRef = false,
  className,
  valueFormatter = (value) => `${formatNumber(Number(value || 0), 3)} tCO₂e`,
}: IntensityPathwayWidgetProps) {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const yearLookup = new Map<number, IntensityPathwayPoint>(data.map((point) => [Number(point.year), point]));

  const renderTooltip = (props: any) => {
    if (!props.active) return null;
    const year = Number(props.label);
    const point = yearLookup.get(year);
    if (!point) return null;

    return (
      <div className="rounded-md border bg-background px-3 py-2 shadow-sm">
        <div className="text-sm font-medium">Year: {year}</div>
        <div className="mt-2 space-y-1">
          {series.map((item) => {
            const actual = point[`${item.label}_actual`];
            const target = point[`${item.label}_target`];
            const value = typeof actual === "number" ? actual : typeof target === "number" ? target : null;
            return (
              <div key={item.key} className="flex items-center justify-between gap-4 text-sm">
                <span>{item.label}</span>
                <span className="font-medium">{valueFormatter(value)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const downloadPng = async () => {
    const svg = chartWrapRef.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(rect.width || Number(svg.getAttribute("width") || 1200)));
    const height = Math.max(1, Math.ceil(rect.height || Number(svg.getAttribute("height") || 800)));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    const svgText = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";

    const loadPromise = new Promise<void>((resolve, reject) => {
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas rendering is unavailable.");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);

          canvas.toBlob((pngBlob) => {
            if (!pngBlob) {
              reject(new Error("Unable to generate PNG."));
              return;
            }
            const pngUrl = URL.createObjectURL(pngBlob);
            const a = document.createElement("a");
            a.href = pngUrl;
            a.download = `${widgetKey}.png`;
            a.click();
            URL.revokeObjectURL(pngUrl);
            resolve();
          }, "image/png");
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Unable to render chart image."));
      };
    });

    image.src = url;
    await loadPromise;
  };

  if (!data.length || !series.length) {
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

  return (
    <Card className={className} data-widget-key={widgetKey}>
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            {subtitle ? <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
          </div>
          <div className="flex items-center gap-2">
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
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(2)} />
              <Tooltip content={renderTooltip} />
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
              {series.flatMap((entry) => [
                <Line
                  key={`${entry.key}_actual`}
                  type="monotone"
                  dataKey={`${entry.label}_actual`}
                  name={`${entry.label}`}
                  stroke={entry.color}
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                  connectNulls={false}
                />,
                <Line
                  key={`${entry.key}_target`}
                  type="monotone"
                  dataKey={`${entry.label}_target`}
                  name={`${entry.label} target`}
                  stroke={entry.color}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                />,
              ])}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

