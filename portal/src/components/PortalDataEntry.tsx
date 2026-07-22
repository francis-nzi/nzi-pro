"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";

// ── Types ────────────────────────────────────────────────────────────────────

type Bucket = { bucket_key: string; label: string };

type FactorOption = {
  scope: string | null;
  category: string | null;
  report_label: string | null;
  original_id: string | null;
  uom: string | null;
  factor: number | null;
  dataset_id: number | null;
  factor_db_id: number | null;
  level_1?: string | null;
  level_2?: string | null;
};

type Row = {
  row_id: number;
  site_id: number | null;
  scope: string | null;
  category: string | null;
  report_label: string | null;
  original_id: string | null;
  uom: string | null;
  qty: number | null;
  factor: number | null;
  calc_tco2e: number | null;
  review_status: "pending_review" | "approved" | "rejected" | null;
  review_note: string | null;
  submitted_by_portal: boolean;
};

const REVIEW_LABEL: Record<string, { label: string; className: string }> = {
  pending_review: { label: "Awaiting review", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected — please review", className: "bg-rose-100 text-rose-800" },
};

// Employee Commuting and Purchased Goods & Services aren't part of this
// generic search-and-add table (see CLIENT_PORTAL_DATA_ENTRY_SCOPE.md):
// Employee Commuting needs its own bespoke entry flow wired up for portal
// auth with the same submit-then-review safety gate the generic buckets
// have, and PG&S is Phase 2 entirely (spend-mapping based, no factor at
// ingestion). Shown as coming-soon placeholders so clients can see the
// full intended shape of this page rather than being silently omitted.
const COMING_SOON_BUCKETS: Bucket[] = [
  { bucket_key: "employee_commuting", label: "Employee Commuting" },
  { bucket_key: "purchased_goods_and_services", label: "Purchased Goods & Services" },
];

export default function PortalDataEntry() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [activeBucket, setActiveBucket] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [factorOptions, setFactorOptions] = useState<FactorOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFactor, setSelectedFactor] = useState<FactorOption | null>(null);
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch("/portal/data-entry/buckets")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { buckets: Bucket[] }) => {
        setBuckets(d.buckets || []);
        if (d.buckets?.length) setActiveBucket(d.buckets[0].bucket_key);
      })
      .catch(() => setError("Failed to load data entry categories."));
  }, []);

  const isComingSoon = COMING_SOON_BUCKETS.some((b) => b.bucket_key === activeBucket);

  useEffect(() => {
    if (!activeBucket || isComingSoon) return;
    loadRows(activeBucket);
    setShowAdd(false);
    setSearch("");
    setFactorOptions([]);
    setSelectedFactor(null);
    setQty("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBucket]);

  async function loadRows(bucketKey: string) {
    setRowsLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/data-entry/${bucketKey}/rows`);
      if (res.ok) {
        const d = await res.json();
        setRows(d.rows || []);
      } else {
        setError("Failed to load your submitted data.");
      }
    } finally {
      setRowsLoading(false);
    }
  }

  async function searchFactors(text: string) {
    setSearching(true);
    try {
      const res = await apiFetch(
        `/portal/data-entry/${activeBucket}/factors?search=${encodeURIComponent(text)}`
      );
      if (res.ok) {
        const d = await res.json();
        setFactorOptions(d.factors || []);
      }
    } finally {
      setSearching(false);
    }
  }

  async function submitRow() {
    if (!selectedFactor || !qty.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/data-entry/${activeBucket}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: selectedFactor.scope,
          original_id: selectedFactor.original_id,
          category: selectedFactor.category,
          report_label: selectedFactor.report_label,
          uom: selectedFactor.uom,
          qty: Number(qty),
        }),
      });
      if (res.ok) {
        setShowAdd(false);
        setSelectedFactor(null);
        setQty("");
        setSearch("");
        setFactorOptions([]);
        void loadRows(activeBucket);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to submit this row.");
      }
    } finally {
      setSaving(false);
    }
  }

  const activeBucketLabel =
    [...buckets, ...COMING_SOON_BUCKETS].find((b) => b.bucket_key === activeBucket)?.label || "";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Data Entry</h1>
        <p className="text-sm text-muted-foreground">
          Add your activity data directly here — no more downloading and re-uploading spreadsheets.
          Submissions are reviewed by your NZI consultant before they count toward your reported emissions.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {[...buckets, ...COMING_SOON_BUCKETS].map((b) => (
          <button
            key={b.bucket_key}
            onClick={() => setActiveBucket(b.bucket_key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              activeBucket === b.bucket_key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {error && <ErrorPanel description={error} />}

      {isComingSoon && (
        <EmptyStatePanel
          title={`${activeBucketLabel} isn't available here yet`}
          description="For now, please contact your NZI consultant to submit this data. We're working on bringing it into this page."
        />
      )}

      {!isComingSoon && (
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{rows.length} submitted row(s) in {activeBucketLabel}</div>
        <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Cancel" : "+ Add Row"}</Button>
      </div>
      )}

      {!isComingSoon && showAdd && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <Input
              placeholder={`Search ${activeBucketLabel.toLowerCase()}...`}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                void searchFactors(e.target.value);
              }}
              onFocus={() => {
                if (factorOptions.length === 0) void searchFactors("");
              }}
            />
            {searching ? (
              <div className="text-sm text-muted-foreground">Searching...</div>
            ) : selectedFactor ? (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium">{selectedFactor.report_label}</div>
                <div className="text-xs text-muted-foreground">
                  {selectedFactor.scope} &middot; {selectedFactor.category} &middot; unit: {selectedFactor.uom}
                </div>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setSelectedFactor(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-md border">
                {factorOptions.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No matches — try a different search term.</div>
                ) : (
                  factorOptions.slice(0, 50).map((f, idx) => (
                    <button
                      key={`${f.original_id}-${idx}`}
                      className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted"
                      onClick={() => setSelectedFactor(f)}
                    >
                      <div className="font-medium">{f.report_label}</div>
                      <div className="text-xs text-muted-foreground">
                        {f.scope} &middot; {f.category} &middot; unit: {f.uom}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {selectedFactor && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Quantity ({selectedFactor.uom || "units"}, annual total)</label>
                  <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
                <Button disabled={saving || !qty.trim()} onClick={() => void submitRow()}>
                  {saving ? "Submitting..." : "Submit"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isComingSoon && (
        rowsLoading ? (
          <SkeletonLoader />
        ) : rows.length === 0 ? (
          <EmptyStatePanel title={`No ${activeBucketLabel.toLowerCase()} data submitted yet.`} />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-left">Report Label</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-left">Unit</th>
                  <th className="p-2 text-right">tCO&#8322;e</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const review = REVIEW_LABEL[row.review_status || "pending_review"];
                  return (
                    <tr key={row.row_id} className="border-b last:border-0">
                      <td className="p-2">{row.report_label || row.original_id}</td>
                      <td className="p-2 text-right font-mono">{row.qty ?? "-"}</td>
                      <td className="p-2">{row.uom || "-"}</td>
                      <td className="p-2 text-right font-mono">{row.calc_tco2e?.toFixed(2) ?? "-"}</td>
                      <td className="p-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${review.className}`}>{review.label}</span>
                        {row.review_status === "rejected" && row.review_note && (
                          <div className="mt-1 text-xs text-muted-foreground">{row.review_note}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
