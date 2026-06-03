import type { ReactNode } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { REPORT_WIDGET_IDS } from "./registry";

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
  data: EmissionsPathwayPoint[];
  benchmarkYear?: number | null;
  targetYear?: number | null;
  interimYear?: number | null;
  showScope2?: boolean;
  widgetKey?: string;
  className?: string;
  valueFormatter?: (value: number | null | undefined) => ReactNode;
};

const DEFAULT_SCOPE_COLORS = ["#4b8b3b", "#4d4d4d", "#38bdf8"];

export function EmissionsReductionPathwayWidget({
  title,
  subtitle,
  data,
  benchmarkYear,
  targetYear,
  interimYear,
  showScope2 = true,
  widgetKey = REPORT_WIDGET_IDS.emissionsReductionPathway,
  className,
  valueFormatter = (value) => `${formatNumber(Number(value || 0), 1)} tCO₂e`,
}: EmissionsReductionPathwayWidgetProps) {
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

  return (
    <Card className={className} data-widget-key={widgetKey}>
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            {subtitle ? <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
          </div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            <span className="block text-right">Widget ref</span>
            <span className="block font-mono tracking-[0.18em] text-foreground">{widgetKey}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={data} margin={{ top: 5, right: 24, left: 6, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString("en-GB", { maximumFractionDigits: 0 })} />
              <Tooltip formatter={(value: unknown) => [valueFormatter(Number(value || 0)), ""]} labelFormatter={(v) => `Year: ${v}`} />
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
                name="Total (actual)"
                stroke="#0f766e"
                strokeWidth={3}
                dot={{ r: 5 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="actual_s1"
                name="Scope 1 (actual)"
                stroke={DEFAULT_SCOPE_COLORS[0]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              {showScope2 && (
                <Line
                  type="monotone"
                  dataKey="actual_s2"
                  name="Scope 2 (actual)"
                  stroke={DEFAULT_SCOPE_COLORS[1]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="actual_s3"
                name="Scope 3 (actual)"
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
              />
              <Line
                type="monotone"
                dataKey="target_s1"
                name="Scope 1 (target)"
                stroke={DEFAULT_SCOPE_COLORS[0]}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
              />
              {showScope2 && (
                <Line
                  type="monotone"
                  dataKey="target_s2"
                  name="Scope 2 (target)"
                  stroke={DEFAULT_SCOPE_COLORS[1]}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="target_s3"
                name="Scope 3 (target)"
                stroke={DEFAULT_SCOPE_COLORS[2]}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

