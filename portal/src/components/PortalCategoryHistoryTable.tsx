"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type HistoryItem = {
  year: number;
  activity: string;
  emissions_tco2e: number;
  quantity: number;
  uom: string | null;
  original_id?: string | null;
  scope?: string | null;
  dataset_id?: number | null;
  factor_db_id?: number | null;
};

/** Prior-year totals for one Data Entry category, pivoted year-as-column to
 * match the CRM's own Year-over-Year Detailed Activity Breakdown table --
 * same underlying figures (services/portal_data_entry.py
 * load_client_category_history), just scoped to this one bucket so clients
 * can see what they reported last time while filling in this year's data.
 * Two stacked tables: volume first (a per-activity Unit column instead of a
 * total row, since quantities aren't summable across differing units --
 * e.g. GBP, tonnes, cubic metres can all appear in the same bucket), then
 * emissions (a universal unit, so a Total row is valid there).
 *
 * `onCopySelected`, when provided, turns on checkboxes (+ select-all) on
 * the Volume rows that carry a resolvable original_id, and a button that
 * hands the selected activities back to the caller so they can be recreated
 * as blank draft rows for the current year -- see PortalDataEntry.tsx /
 * PortalCommutingTab.tsx for what "recreated" means per bucket type. Rows
 * missing original_id (pre-dates this field, or an activity whose factor
 * changed identity) simply can't be selected -- the historical total still
 * displays, it just isn't a copy-forward candidate. */
export default function PortalCategoryHistoryTable({
  fetchUrl,
  onCopySelected,
}: {
  fetchUrl: string;
  onCopySelected?: (items: HistoryItem[]) => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

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
  const emissionsByKey = new Map(items.map((i) => [`${i.year}|${i.activity}`, i.emissions_tco2e]));
  const quantityByKey = new Map(items.map((i) => [`${i.year}|${i.activity}`, i.quantity]));
  const unitByActivity = new Map<string, string>();
  for (const item of items) {
    if (item.uom && !unitByActivity.has(item.activity)) unitByActivity.set(item.activity, item.uom);
  }
  const emissionsYearTotals = years.map((y) =>
    items.filter((i) => i.year === y).reduce((sum, i) => sum + i.emissions_tco2e, 0)
  );

  // Copy-forward always uses the most recent year's version of an
  // activity -- the closest thing to "still valid" if a factor was
  // superseded between years.
  const latestByActivity = new Map<string, HistoryItem>();
  for (const item of items) {
    const current = latestByActivity.get(item.activity);
    if (!current || item.year > current.year) latestByActivity.set(item.activity, item);
  }
  const copyableActivities = activities.filter((a) => Boolean(latestByActivity.get(a)?.original_id));

  function toggleActivity(activity: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(activity)) next.delete(activity);
      else next.add(activity);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedKeys((prev) =>
      prev.size === copyableActivities.length ? new Set() : new Set(copyableActivities)
    );
  }

  function copySelected() {
    if (!onCopySelected) return;
    const picked = Array.from(selectedKeys)
      .map((activity) => latestByActivity.get(activity))
      .filter((item): item is HistoryItem => Boolean(item));
    if (picked.length === 0) return;
    onCopySelected(picked);
    setSelectedKeys(new Set());
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Previous Years</CardTitle>
        {onCopySelected && selectedKeys.size > 0 && (
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            onClick={copySelected}
          >
            Copy {selectedKeys.size} selected to this year
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Volume</div>
          {onCopySelected && copyableActivities.length > 0 && (
            <div className="mb-2 text-xs text-muted-foreground">
              Tick any activities below to copy them onto this year&apos;s data entry as blank rows ready to fill in.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {onCopySelected && (
                    <th className="p-2 text-left">
                      {copyableActivities.length > 0 && (
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={selectedKeys.size > 0 && selectedKeys.size === copyableActivities.length}
                          onChange={toggleSelectAll}
                        />
                      )}
                    </th>
                  )}
                  <th className="p-2 text-left">Activity</th>
                  <th className="p-2 text-left">Unit</th>
                  {years.map((y) => (
                    <th key={y} className="p-2 text-right">
                      {y}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activities.map((activity) => {
                  const canCopy = Boolean(latestByActivity.get(activity)?.original_id);
                  return (
                    <tr key={activity} className="border-b last:border-0">
                      {onCopySelected && (
                        <td className="p-2">
                          {canCopy && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${activity}`}
                              checked={selectedKeys.has(activity)}
                              onChange={() => toggleActivity(activity)}
                            />
                          )}
                        </td>
                      )}
                      <td className="p-2">{activity}</td>
                      <td className="p-2 text-muted-foreground">{unitByActivity.get(activity) || "-"}</td>
                      {years.map((y) => {
                        const value = quantityByKey.get(`${y}|${activity}`);
                        return (
                          <td key={y} className="p-2 text-right font-mono">
                            {value !== undefined ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Emissions (tCO&#8322;e)
          </div>
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
                      const value = emissionsByKey.get(`${y}|${activity}`);
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
                  {emissionsYearTotals.map((total, idx) => (
                    <td key={years[idx]} className="p-2 text-right font-mono">
                      {total.toFixed(2)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
