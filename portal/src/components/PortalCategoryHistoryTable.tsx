"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type HistoryItem = {
  year: number;
  activity: string;
  emissions_tco2e: number;
  quantity: number;
};

/** Prior-year totals for one Data Entry category, pivoted year-as-column to
 * match the CRM's own Year-over-Year Detailed Activity Breakdown table --
 * same underlying figures (services/portal_data_entry.py
 * load_client_category_history), just scoped to this one bucket so clients
 * can see what they reported last time while filling in this year's data. */
export default function PortalCategoryHistoryTable({ fetchUrl }: { fetchUrl: string }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(fetchUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { items: HistoryItem[] }) => {
        if (!cancelled) setItems(d.items || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchUrl]);

  if (loading || items.length === 0) return null;

  const years = Array.from(new Set(items.map((i) => i.year))).sort((a, b) => a - b);
  const activities = Array.from(new Set(items.map((i) => i.activity))).sort();
  const byKey = new Map(items.map((i) => [`${i.year}|${i.activity}`, i.emissions_tco2e]));
  const yearTotals = years.map((y) => items.filter((i) => i.year === y).reduce((sum, i) => sum + i.emissions_tco2e, 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Previous Years</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2 text-left">Activity</th>
                {years.map((y) => (
                  <th key={y} className="p-2 text-right">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => (
                <tr key={activity} className="border-b last:border-0">
                  <td className="p-2">{activity}</td>
                  {years.map((y) => {
                    const value = byKey.get(`${y}|${activity}`);
                    return (
                      <td key={y} className="p-2 text-right font-mono">
                        {value !== undefined ? value.toFixed(2) : "-"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td className="p-2">Total (tCO&#8322;e)</td>
                {yearTotals.map((total, idx) => (
                  <td key={years[idx]} className="p-2 text-right font-mono">
                    {total.toFixed(2)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
