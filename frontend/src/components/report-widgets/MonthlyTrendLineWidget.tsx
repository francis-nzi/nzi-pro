"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

export type MonthlyTrendPoint = {
  month: string;
  actual: number;
};

const ACTUAL_COLOR = "#0f766e";

function formatTooltip(value: unknown): [string, string] {
  const amount = Array.isArray(value) ? Number(value[0] ?? 0) : Number(value ?? 0);
  return [`${formatNumber(Math.round(amount * 100) / 100, 1)} tCO₂e`, ""];
}

type MonthlyTrendLineWidgetProps = {
  title?: string;
  data: MonthlyTrendPoint[];
};

export function MonthlyTrendLineWidget({
  title = "Monthly Emissions Trend",
  data,
}: MonthlyTrendLineWidgetProps) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={formatTooltip} />
              <Line
                type="monotone"
                dataKey="actual"
                stroke={ACTUAL_COLOR}
                strokeWidth={3}
                dot={{ r: 3 }}
                name="Actual"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
