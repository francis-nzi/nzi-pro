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
  /** Employee initials/staff number (Employee Commuting) or an asset
   * register identifier (Company Vehicles/Business Travel) -- whichever
   * this bucket's entries carry. */
  identifier?: string | null;
  /** Vehicle registration, alongside `identifier` -- only Employee
   * Commuting's vehicle-registration-lookup entries populate this. */
  reg_number?: string | null;
  site_name?: string | null;
  site_id?: number | null;
  /** The factor's category string -- needed to recreate a row directly
   * (see PortalDataEntry.tsx's bucket-match check), not shown in the table. */
  category?: string | null;
};

/** Prior-year individual entries for one Data Entry category, listed one
 * row per original submission (not summed across sites or merged by
 * activity label) so a client can see exactly what they reported last time
 * -- see services/portal_data_entry.py load_client_category_history /
 * load_client_commuting_history_detail. Every row still carries its own
 * unit, since quantities aren't summable across differing units (GBP,
 * tonnes, miles, etc. can all appear in the same bucket).
 *
 * `onCopySelected`, when provided, turns on checkboxes (+ select-all) on
 * the most recent year's rows that carry a resolvable original_id, and a
 * button that hands the selected entries back to the caller so they can be
 * recreated as blank draft rows for the current year -- see
 * PortalDataEntry.tsx / PortalCommutingTab.tsx for what "recreated" means
 * per bucket type. Rows missing original_id (pre-dates this field, or an
 * activity whose factor changed identity) simply can't be selected -- the
 * historical entry still displays, it just isn't a copy-forward candidate. */
export default function PortalCategoryHistoryTable({
  fetchUrl,
  onCopySelected,
}: {
  fetchUrl: string;
  onCopySelected?: (items: HistoryItem[]) => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<number>>(new Set());

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

  const showIdentifier = items.some((i) => i.identifier);
  const showRegNumber = items.some((i) => i.reg_number);
  const showSite = items.some((i) => i.site_name);

  const mostRecentYear = items.reduce((max, i) => Math.max(max, i.year), items[0].year);

  const sorted = [...items].sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    const activityCmp = a.activity.localeCompare(b.activity);
    if (activityCmp !== 0) return activityCmp;
    return (a.identifier || "").localeCompare(b.identifier || "");
  });

  const totalsByYear = new Map<number, number>();
  for (const item of items) {
    totalsByYear.set(item.year, (totalsByYear.get(item.year) || 0) + item.emissions_tco2e);
  }
  const yearsDesc = Array.from(totalsByYear.keys()).sort((a, b) => b - a);

  // Copy-forward is limited to the most recent year's rows -- the closest
  // thing to "still valid" data to bring into this year's entry.
  const copyableIndices = new Set(
    sorted
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.year === mostRecentYear && Boolean(item.original_id))
      .map(({ idx }) => idx)
  );

  function toggleRow(idx: number) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedKeys((prev) =>
      prev.size === copyableIndices.size ? new Set() : new Set(copyableIndices)
    );
  }

  function copySelected() {
    if (!onCopySelected) return;
    const picked = Array.from(selectedKeys)
      .map((idx) => sorted[idx])
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
      <CardContent>
        {onCopySelected && copyableIndices.size > 0 && (
          <div className="mb-2 text-xs text-muted-foreground">
            Tick any {mostRecentYear} entries below to copy them onto this year&apos;s data entry as blank rows ready to fill in.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {onCopySelected && (
                  <th className="p-2 text-left">
                    {copyableIndices.size > 0 && (
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={selectedKeys.size > 0 && selectedKeys.size === copyableIndices.size}
                        onChange={toggleSelectAll}
                      />
                    )}
                  </th>
                )}
                <th className="p-2 text-right">Year</th>
                <th className="p-2 text-left">Activity</th>
                {showIdentifier && <th className="p-2 text-left">ID</th>}
                {showRegNumber && <th className="p-2 text-left">Reg No.</th>}
                {showSite && <th className="p-2 text-left">Site</th>}
                <th className="p-2 text-right">Quantity</th>
                <th className="p-2 text-left">Unit</th>
                <th className="p-2 text-right">tCO&#8322;e</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, idx) => {
                const canCopy = copyableIndices.has(idx);
                return (
                  <tr key={idx} className="border-b last:border-0">
                    {onCopySelected && (
                      <td className="p-2">
                        {canCopy && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.activity} (${item.year})`}
                            checked={selectedKeys.has(idx)}
                            onChange={() => toggleRow(idx)}
                          />
                        )}
                      </td>
                    )}
                    <td className="p-2 text-right font-mono">{item.year}</td>
                    <td className="p-2">{item.activity}</td>
                    {showIdentifier && <td className="p-2 text-muted-foreground">{item.identifier || "-"}</td>}
                    {showRegNumber && <td className="p-2 text-muted-foreground">{item.reg_number || "-"}</td>}
                    {showSite && <td className="p-2 text-muted-foreground">{item.site_name || "-"}</td>}
                    <td className="p-2 text-right font-mono">
                      {item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-2 text-muted-foreground">{item.uom || "-"}</td>
                    <td className="p-2 text-right font-mono">{item.emissions_tco2e.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {yearsDesc.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wide">Total tCO&#8322;e</span>
            {yearsDesc.map((year) => (
              <span key={year}>
                {year}: <span className="font-mono text-foreground">{(totalsByYear.get(year) || 0).toFixed(2)}</span>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
