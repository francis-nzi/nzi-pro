import type { ActivityBarPoint } from "./types";

const ACTIVITY_COLORS = ["#0ea5e9", "#14b8a6", "#f97316", "#8b5cf6", "#22c55e", "#ef4444", "#64748b", "#eab308"];

type ActivitySourceRow = {
  dataset_category?: string | null;
  lookup_category?: string | null;
  category?: string | null;
  report_label?: string | null;
  activity_group?: string | null;
  calc_tco2e?: number | null;
  emissions?: number | null;
};

function bucketKey(value?: string | null): string {
  const raw = String(value ?? "").trim();
  return raw.length > 0 ? raw : "Unknown";
}

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSeries<T extends { value: number }>(rows: T[], targetTotal: number): T[] {
  const rawTotal = rows.reduce((acc, row) => acc + Number(row.value || 0), 0);
  if (rawTotal <= 0 || targetTotal <= 0) return rows;
  const scale = Math.abs(rawTotal - targetTotal) > 0.05 ? targetTotal / rawTotal : 1;
  return rows.map((row) => ({ ...row, value: Number(row.value || 0) * scale }));
}

export function buildActivityBarData(rows: ActivitySourceRow[], targetTotal = 0, limit = 8): ActivityBarPoint[] {
  const map = new Map<string, number>();

  rows.forEach((row) => {
    const label = bucketKey(row.dataset_category || row.lookup_category || row.category || row.report_label || row.activity_group);
    map.set(label, (map.get(label) ?? 0) + toNum(row.calc_tco2e ?? row.emissions ?? 0));
  });

  const normalized = normalizeSeries(
    Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit),
    targetTotal,
  );

  return normalized.map((activity, index) => ({
    name: activity.name,
    fullName: activity.name,
    value: activity.value,
    fill: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length],
  }));
}

