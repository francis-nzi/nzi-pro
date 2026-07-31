"use client";

import { useEffect, useRef, useState } from "react";
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
import PortalSpendTab from "@/components/PortalSpendTab";
import PortalCommutingTab from "@/components/PortalCommutingTab";

// ── Types ────────────────────────────────────────────────────────────────────

type Bucket = { bucket_key: string; label: string };

type Site = { site_id: number; site_name: string | null };

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

type PreviousRow = {
  scope: string | null;
  category: string | null;
  report_label: string | null;
  original_id: string | null;
  uom: string | null;
  last_qty: number | null;
  last_job_id: number;
  last_reporting_year: number | null;
};

type TopFactor = {
  scope: string | null;
  category: string | null;
  report_label: string | null;
  original_id: string | null;
  uom: string | null;
  use_count: number;
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

// Nothing is coming-soon anymore -- Employee Commuting and Purchased Goods &
// Services are both real now, just structurally different from the generic
// factor-search-and-add table (fixed dropdown vocab / raw ledger lines
// respectively), so each gets its own dedicated tab component below rather
// than being forced into this file's generic table.
const COMING_SOON_BUCKETS: Bucket[] = [];

const SPEND_BUCKET: Bucket = { bucket_key: "purchased_goods_and_services", label: "Purchased Goods & Services" };
const COMMUTING_BUCKET: Bucket = { bucket_key: "employee_commuting", label: "Employee Commuting" };

// Skips an unnecessary "Select a site" click for the (common) case of a
// client with only one site on their account.
function defaultSiteId(siteList: Site[]): string {
  return siteList.length === 1 ? String(siteList[0].site_id) : "";
}

function isPositiveQty(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0;
}

export default function PortalDataEntry() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [activeBucket, setActiveBucket] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Set when the backend 404s specifically because this client has no open
  // job yet (e.g. every job is Closed) -- ~15% of clients hit this. This is
  // an expected, actionable state, not a real error, so it gets its own
  // calmer panel instead of the red error banner.
  const [noJobMessage, setNoJobMessage] = useState("");
  // Set from the job's Data Collection Deadline milestone (or a CRM override)
  // once it's passed -- another expected, actionable state with its own panel.
  const [dataEntryExpired, setDataEntryExpired] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [factorOptions, setFactorOptions] = useState<FactorOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFactor, setSelectedFactor] = useState<FactorOption | null>(null);
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Every row is now attributed to a site -- the CRM can only ever have one
  // *approved* row per site+scope+factor, so knowing the site up front is
  // what lets duplicate submissions be grouped and consolidated before
  // approval instead of silently colliding.
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState("");

  const [previousRows, setPreviousRows] = useState<PreviousRow[]>([]);
  const [topFactors, setTopFactors] = useState<TopFactor[]>([]);

  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editQty, setEditQty] = useState("");
  const [rowActionSaving, setRowActionSaving] = useState(false);

  // Registration-number lookup (Phase 3) -- only offered for the two vehicle-
  // shaped buckets; everything else keeps the plain search flow above.
  const [regNumber, setRegNumber] = useState("");
  const [regLookupLoading, setRegLookupLoading] = useState(false);
  const [regLookupError, setRegLookupError] = useState("");
  const [regLookupVehicle, setRegLookupVehicle] = useState<{ make: string | null; fuel_type: string | null } | null>(null);

  useEffect(() => {
    apiFetch("/portal/data-entry/buckets")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { buckets: Bucket[] }) => {
        setBuckets(d.buckets || []);
        if (d.buckets?.length) setActiveBucket(d.buckets[0].bucket_key);
      })
      .catch(() => setError("Failed to load data entry categories."));

    apiFetch("/portal/data-entry/sites")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { sites: Site[] }) => setSites(d.sites || []))
      .catch(() => setSites([]))
      .finally(() => setSitesLoaded(true));

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
    };
  }, []);

  // Sites can finish loading after the first bucket has already switched (they're
  // fetched in parallel above), so this catches the single-site auto-select in
  // that ordering too -- the bucket-switch effect below covers every subsequent switch.
  useEffect(() => {
    if (sites.length === 1 && !selectedSiteId) {
      setSelectedSiteId(String(sites[0].site_id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites]);

  const isComingSoon = COMING_SOON_BUCKETS.some((b) => b.bucket_key === activeBucket);
  const isSpendTab = activeBucket === SPEND_BUCKET.bucket_key;
  const isCommutingTab = activeBucket === COMMUTING_BUCKET.bucket_key;

  useEffect(() => {
    if (!activeBucket || isComingSoon || isSpendTab || isCommutingTab) return;
    loadRows(activeBucket);
    setShowAdd(false);
    setSearch("");
    setFactorOptions([]);
    setSelectedFactor(null);
    setQty("");
    setSelectedSiteId(defaultSiteId(sites));
    setRegNumber("");
    setRegLookupError("");
    setRegLookupVehicle(null);
    setNoJobMessage("");
    setDataEntryExpired(false);
    setPreviousRows([]);
    setTopFactors([]);
    setJustAdded(false);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBucket]);

  async function loadRows(bucketKey: string) {
    setRowsLoading(true);
    setError("");
    setNoJobMessage("");
    setDataEntryExpired(false);
    try {
      const res = await apiFetch(`/portal/data-entry/${bucketKey}/rows`);
      if (res.ok) {
        const d = await res.json();
        setRows(d.rows || []);
        setJobNumber(d.job_number || null);
        setDataEntryExpired(Boolean(d.portal_data_entry_expired));
      } else if (res.status === 404) {
        const d = await res.json().catch(() => ({}));
        setNoJobMessage(d?.detail || "No open job found for this account yet — contact your NZI consultant.");
      } else {
        setError("Failed to load your submitted data.");
      }
    } finally {
      setRowsLoading(false);
    }
  }

  async function loadQuickPicks(bucketKey: string) {
    try {
      const [prevRes, topRes] = await Promise.all([
        apiFetch(`/portal/data-entry/${bucketKey}/previous-rows`),
        apiFetch(`/portal/data-entry/${bucketKey}/top-factors`),
      ]);
      setPreviousRows(prevRes.ok ? (await prevRes.json()).items || [] : []);
      setTopFactors(topRes.ok ? (await topRes.json()).items || [] : []);
    } catch {
      setPreviousRows([]);
      setTopFactors([]);
    }
  }

  function pickQuickFactor(item: PreviousRow | TopFactor) {
    setSelectedFactor({
      scope: item.scope,
      category: item.category,
      report_label: item.report_label,
      original_id: item.original_id,
      uom: item.uom,
      factor: null,
      dataset_id: null,
      factor_db_id: null,
    });
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

  async function lookupByRegistration() {
    if (!regNumber.trim()) return;
    setRegLookupLoading(true);
    setRegLookupError("");
    setRegLookupVehicle(null);
    try {
      const res = await apiFetch("/portal/vehicle-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_number: regNumber }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.factor) {
        setSelectedFactor(d.factor);
        setRegLookupVehicle({ make: d.make, fuel_type: d.fuel_type });
        setRegNumber("");
      } else {
        setRegLookupError(d?.detail || "Couldn't look up that registration.");
      }
    } finally {
      setRegLookupLoading(false);
    }
  }

  async function submitRow() {
    if (!selectedFactor || !isPositiveQty(qty) || !selectedSiteId) return;
    setSaving(true);
    setError("");
    setJustAdded(false);
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
          site_id: Number(selectedSiteId),
        }),
      });
      if (res.ok) {
        // Deliberately keeps the panel open and the site selected (only the
        // factor/qty/search reset) -- entering several rows in one sitting is
        // the common case, and re-opening the panel + re-picking the site for
        // every single row was the biggest friction point in this flow.
        setSelectedFactor(null);
        setQty("");
        setSearch("");
        setFactorOptions([]);
        setRegLookupVehicle(null);
        setJustAdded(true);
        if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
        justAddedTimerRef.current = setTimeout(() => setJustAdded(false), 4000);
        void loadRows(activeBucket);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to submit this row.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveRowEdit(rowId: number) {
    if (!isPositiveQty(editQty)) return;
    setRowActionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/data-entry/${activeBucket}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: Number(editQty) }),
      });
      if (res.ok) {
        setEditingRowId(null);
        setEditQty("");
        void loadRows(activeBucket);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to update this row.");
      }
    } finally {
      setRowActionSaving(false);
    }
  }

  async function deleteRow(rowId: number) {
    if (!window.confirm("Delete this row? This can't be undone.")) return;
    setRowActionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/data-entry/${activeBucket}/rows/${rowId}`, { method: "DELETE" });
      if (res.ok) {
        void loadRows(activeBucket);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to delete this row.");
      }
    } finally {
      setRowActionSaving(false);
    }
  }

  const isVehicleBucket = activeBucket === "company_vehicles" || activeBucket === "business_travel";
  const allTabs = [...buckets, COMMUTING_BUCKET, SPEND_BUCKET, ...COMING_SOON_BUCKETS];
  const activeBucketLabel = allTabs.find((b) => b.bucket_key === activeBucket)?.label || "";

  // Shared between the table (desktop) and card (mobile) layouts below so the
  // edit/delete/save-cancel behavior can't drift between the two.
  function renderQtyValue(row: Row) {
    if (editingRowId !== row.row_id) return row.qty ?? "-";
    return (
      <Input
        type="number"
        min="0"
        step="any"
        value={editQty}
        onChange={(e) => setEditQty(e.target.value)}
        className="h-7 w-24 text-right"
      />
    );
  }

  function renderStatus(row: Row) {
    const review = REVIEW_LABEL[row.review_status || "pending_review"];
    return (
      <>
        <span className={`rounded-full px-2 py-0.5 text-xs ${review.className}`}>{review.label}</span>
        {row.review_status === "rejected" && row.review_note && (
          <div className="mt-1 text-xs text-muted-foreground">{row.review_note}</div>
        )}
      </>
    );
  }

  function renderActions(row: Row, align: "start" | "end") {
    const justify = align === "end" ? "justify-end" : "justify-start";
    if (row.review_status === "approved" || dataEntryExpired) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    if (editingRowId === row.row_id) {
      return (
        <div className={`flex items-center ${justify} gap-2`}>
          <Button size="sm" variant="outline" disabled={rowActionSaving || !isPositiveQty(editQty)} onClick={() => void saveRowEdit(row.row_id)}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditingRowId(null); setEditQty(""); }}>
            Cancel
          </Button>
        </div>
      );
    }
    return (
      <div className={`flex items-center ${justify} gap-3 text-xs`}>
        <button
          className="text-primary hover:underline"
          onClick={() => { setEditingRowId(row.row_id); setEditQty(row.qty !== null && row.qty !== undefined ? String(row.qty) : ""); }}
        >
          Edit
        </button>
        <button
          className="text-rose-700 hover:underline disabled:opacity-50"
          disabled={rowActionSaving}
          onClick={() => void deleteRow(row.row_id)}
        >
          Delete
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Data Entry</h1>
        <p className="text-sm text-muted-foreground">
          Add your activity data directly here — no more downloading and re-uploading spreadsheets.
          Submissions are reviewed by your NZI consultant before they count toward your reported emissions.
        </p>
        {jobNumber && !isSpendTab && !isCommutingTab && (
          <p className="mt-1 text-xs text-muted-foreground">Job: {jobNumber}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {allTabs.map((b) => (
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

      {noJobMessage && (
        <EmptyStatePanel
          title="Not available yet for this account"
          description={noJobMessage}
        />
      )}

      {!noJobMessage && dataEntryExpired && (
        <EmptyStatePanel
          title="Data entry is closed for this period"
          description="The data collection deadline has passed. Contact your NZI consultant if you still need to submit or edit data here."
        />
      )}

      {isComingSoon && (
        <EmptyStatePanel
          title={`${activeBucketLabel} isn't available here yet`}
          description="For now, please contact your NZI consultant to submit this data. We're working on bringing it into this page."
        />
      )}

      {isSpendTab && <PortalSpendTab />}
      {isCommutingTab && <PortalCommutingTab />}

      {!isComingSoon && !isSpendTab && !isCommutingTab && !noJobMessage && (
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{rows.length} submitted row(s) in {activeBucketLabel}</div>
        {!dataEntryExpired && (
          <Button
            onClick={() => {
              const next = !showAdd;
              setShowAdd(next);
              if (next) void loadQuickPicks(activeBucket);
            }}
          >
            {showAdd ? "Cancel" : "+ Add Row"}
          </Button>
        )}
      </div>
      )}

      {!isComingSoon && !isSpendTab && !isCommutingTab && !noJobMessage && !dataEntryExpired && showAdd && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            {justAdded && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Row added — ready for the next one.
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Site</label>
              {sitesLoaded && sites.length === 0 ? (
                <div className="text-xs text-rose-700">
                  No sites are set up for your account yet — contact your NZI consultant before submitting data.
                </div>
              ) : (
                <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                  <SelectTrigger>
                    <SelectValue placeholder={sitesLoaded ? "Select a site…" : "Loading sites…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site.site_id} value={String(site.site_id)}>
                        {site.site_name || `Site #${site.site_id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {isVehicleBucket && !selectedFactor && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <label className="text-xs font-medium text-muted-foreground">
                  Have the vehicle&apos;s registration number? We&apos;ll work out the right category for you.
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. AB12 CDE"
                    value={regNumber}
                    onChange={(e) => setRegNumber(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void lookupByRegistration()}
                  />
                  <Button disabled={regLookupLoading || !regNumber.trim()} onClick={() => void lookupByRegistration()}>
                    {regLookupLoading ? "Looking up..." : "Look up"}
                  </Button>
                </div>
                {regLookupError && <div className="text-xs text-rose-700">{regLookupError}</div>}
                <div className="text-xs text-muted-foreground">— or search for the vehicle type manually below —</div>
              </div>
            )}
            {regLookupVehicle && selectedFactor && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                Found: {regLookupVehicle.make || "vehicle"} ({regLookupVehicle.fuel_type || "unknown fuel"}) — matched to{" "}
                {selectedFactor.report_label}
              </div>
            )}
            {!selectedFactor && !search.trim() && previousRows.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Previously used</label>
                <div className="flex flex-wrap gap-1.5">
                  {previousRows.map((item, idx) => (
                    <button
                      key={`prev-${item.original_id}-${idx}`}
                      className="rounded-full border bg-muted/40 px-3 py-1 text-xs hover:bg-muted"
                      onClick={() => pickQuickFactor(item)}
                      title={item.last_reporting_year ? `Last used in ${item.last_reporting_year}` : undefined}
                    >
                      {item.report_label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!selectedFactor && !search.trim() && topFactors.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Frequently used</label>
                <div className="flex flex-wrap gap-1.5">
                  {topFactors.map((item, idx) => (
                    <button
                      key={`top-${item.original_id}-${idx}`}
                      className="rounded-full border bg-muted/40 px-3 py-1 text-xs hover:bg-muted"
                      onClick={() => pickQuickFactor(item)}
                    >
                      {item.report_label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!selectedFactor && (
              <Input
                placeholder={`Search ${activeBucketLabel.toLowerCase()}...`}
                value={search}
                onChange={(e) => {
                  const value = e.target.value;
                  setSearch(value);
                  if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                  if (!value.trim()) {
                    setFactorOptions([]);
                    setSearching(false);
                    return;
                  }
                  setSearching(true);
                  searchDebounceRef.current = setTimeout(() => void searchFactors(value), 300);
                }}
              />
            )}
            {selectedFactor ? (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium">{selectedFactor.report_label}</div>
                <div className="text-xs text-muted-foreground">
                  {selectedFactor.scope} &middot; {selectedFactor.category} &middot; unit: {selectedFactor.uom}
                </div>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setSelectedFactor(null)}>
                  Change
                </Button>
              </div>
            ) : search.trim() ? (
              searching ? (
                <div className="text-sm text-muted-foreground">Searching...</div>
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
              )
            ) : null}

            {selectedFactor && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Quantity ({selectedFactor.uom || "units"}, annual total)</label>
                  <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
                  {qty.trim() && !isPositiveQty(qty) && (
                    <div className="mt-1 text-xs text-rose-700">Enter a quantity greater than 0.</div>
                  )}
                </div>
                <Button disabled={saving || !isPositiveQty(qty) || !selectedSiteId} onClick={() => void submitRow()}>
                  {saving ? "Submitting..." : "Submit"}
                </Button>
              </div>
            )}
            {selectedFactor && !selectedSiteId && (
              <div className="text-xs text-rose-700">Select a site above before submitting.</div>
            )}
          </CardContent>
        </Card>
      )}

      {!isComingSoon && !isSpendTab && !isCommutingTab && !noJobMessage && (
        rowsLoading ? (
          <SkeletonLoader />
        ) : rows.length === 0 ? (
          <EmptyStatePanel title={`No ${activeBucketLabel.toLowerCase()} data submitted yet.`} />
        ) : (
          <>
            {/* Desktop/tablet: table. A wide fixed-column table just scrolls
                horizontally on a phone, which is a poor experience for a
                client-facing tool people may well use on mobile -- so below
                sm it switches to a stacked card layout instead (same data,
                same actions, reusing renderQtyValue/renderStatus/renderActions
                so the two layouts can't drift out of sync). */}
            <div className="hidden overflow-x-auto rounded-md border sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left">Report Label</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-left">Unit</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.row_id} className="border-b last:border-0">
                      <td className="p-2">{row.report_label || row.original_id}</td>
                      <td className="p-2 text-right font-mono">
                        <div className="flex justify-end">{renderQtyValue(row)}</div>
                      </td>
                      <td className="p-2">{row.uom || "-"}</td>
                      <td className="p-2">{renderStatus(row)}</td>
                      <td className="p-2 text-right">{renderActions(row, "end")}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {sumByUnit(rows).map(({ uom, total }) => (
                    <tr key={uom} className="border-t bg-muted/30 font-medium">
                      <td className="p-2 text-right" colSpan={1}>Total</td>
                      <td className="p-2 text-right font-mono">{total.toLocaleString()}</td>
                      <td className="p-2">{uom}</td>
                      <td className="p-2" colSpan={2} />
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>

            <div className="space-y-2 sm:hidden">
              {rows.map((row) => (
                <div key={row.row_id} className="rounded-md border p-3 text-sm">
                  <div className="font-medium">{row.report_label || row.original_id}</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="font-mono">
                      {renderQtyValue(row)} <span className="text-xs text-muted-foreground">{row.uom || ""}</span>
                    </span>
                    <span>{renderStatus(row)}</span>
                  </div>
                  <div className="mt-2 border-t pt-2">{renderActions(row, "start")}</div>
                </div>
              ))}
              {sumByUnit(rows).map(({ uom, total }) => (
                <div key={uom} className="rounded-md border bg-muted/30 p-3 text-sm font-medium">
                  Total: {total.toLocaleString()} {uom}
                </div>
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}

function sumByUnit(rows: Row[]): { uom: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.qty === null || row.qty === undefined) continue;
    const key = row.uom || "units";
    totals.set(key, (totals.get(key) || 0) + Number(row.qty));
  }
  return Array.from(totals.entries()).map(([uom, total]) => ({ uom, total }));
}
