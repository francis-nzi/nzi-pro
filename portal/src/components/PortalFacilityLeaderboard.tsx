"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { formatEmissions } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendChip } from "@/components/shared/TrendChip";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";

type BySiteRow = { year: number; total: number; [site: string]: number };

type LeaderboardRow = {
  site: string;
  emissions: number;
  trend: number | null;
};

/**
 * Ranked list of sites by emissions, per UX spec §6.1. Built entirely from
 * the same by_site grouping the Data tab already uses (real today, no new
 * backend work) — trend is derived client-side by comparing the latest year
 * to the previous year for the same site key, since site-level year-on-year
 * isn't returned as its own field but is fully computable from what's here.
 * Country/Intensity/Status columns from the spec are deliberately omitted:
 * client_sites has no structured country field (location is free text) and
 * no per-site intensity or status tracking exists yet.
 */
export default function PortalFacilityLeaderboard() {
  const [rows, setRows] = useState<BySiteRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/portal/reporting-data")
      .then((r) => (r.ok ? (r.json() as Promise<{ by_site?: BySiteRow[] }>) : Promise.reject(new Error(`${r.status}`))))
      .then((d) => setRows(d.by_site ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const body = (() => {
    if (loading) return <SkeletonLoader rows={4} />;
    if (error) return <ErrorPanel description={`Failed to load facility data: ${error}`} />;
    if (!rows || rows.length === 0) {
      return (
        <EmptyStatePanel
          title="No site-level data yet"
          description="Facility-level emissions will appear here once site data has been reported."
        />
      );
    }

    const latest = rows[rows.length - 1];
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    const siteNames = Object.keys(latest).filter((k) => k !== "year" && k !== "total");

    const leaderboard: LeaderboardRow[] = siteNames
      .map((site) => {
        const emissions = Number(latest[site] ?? 0);
        const prevEmissions = previous ? Number(previous[site] ?? 0) : null;
        const trend =
          prevEmissions && prevEmissions > 0 ? ((emissions - prevEmissions) / prevEmissions) * 100 : null;
        return { site, emissions, trend };
      })
      .filter((row) => row.emissions > 0)
      .sort((a, b) => b.emissions - a.emissions);

    if (leaderboard.length === 0) {
      return (
        <EmptyStatePanel
          title="No site-level data yet"
          description="Facility-level emissions will appear here once site data has been reported."
        />
      );
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Site</TableHead>
            <TableHead className="text-right">Emissions ({latest.year})</TableHead>
            <TableHead className="text-right">Trend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leaderboard.map((row) => (
            <TableRow key={row.site}>
              <TableCell className="font-medium">{row.site}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatEmissions(row.emissions)} tCO<sub>2</sub>e
              </TableCell>
              <TableCell className="text-right">
                {row.trend !== null ? (
                  <TrendChip value={row.trend} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  })();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Facility Leaderboard</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
