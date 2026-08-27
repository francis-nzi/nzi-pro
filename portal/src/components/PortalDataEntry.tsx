"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/auth";
import { formatDate } from "@/lib/format";
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
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PortalSpendTab from "@/components/PortalSpendTab";
import PortalCommutingTab from "@/components/PortalCommutingTab";
import PortalCategoryHistoryTable, { type HistoryItem } from "@/components/PortalCategoryHistoryTable";

// ── Types ────────────────────────────────────────────────────────────────────

type Bucket = { bucket_key: string; label: string; has_data?: boolean };

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
  month_1: number | null; month_2: number | null; month_3: number | null;
  month_4: number | null; month_5: number | null; month_6: number | null;
  month_7: number | null; month_8: number | null; month_9: number | null;
  month_10: number | null; month_11: number | null; month_12: number | null;
};

const ALL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// month_1..month_12 are relative to the job's reporting period, not the
// calendar year -- month_1 is whichever month the period actually starts in
// (e.g. April for an Apr-Mar year). Mirrors JobDataEntry.tsx's getOrderedMonths
// / getMonthIndex so the portal's grid lines up with the same underlying columns.
function getOrderedMonths(reportingPeriodStart: string | null): string[] {
  if (!reportingPeriodStart) return ALL_MONTHS;
  const startDate = new Date(reportingPeriodStart);
  if (Number.isNaN(startDate.getTime())) return ALL_MONTHS;
  const startMonthIndex = startDate.getMonth();
  return [...ALL_MONTHS.slice(startMonthIndex), ...ALL_MONTHS.slice(0, startMonthIndex)];
}

function getMonthIndex(displayIndex: number, reportingPeriodStart: string | null): number {
  if (!reportingPeriodStart) return displayIndex;
  const startDate = new Date(reportingPeriodStart);
  if (Number.isNaN(startDate.getTime())) return displayIndex;
  return (displayIndex + startDate.getMonth()) % 12;
}

function parseMonthlyValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function sumMonthlyValues(values: string[]): number {
  return values.reduce((sum, v) => sum + (parseMonthlyValue(v) ?? 0), 0);
}

function monthFieldsFromValues(values: string[]): Record<string, number | null> {
  const fields: Record<string, number | null> = {};
  values.forEach((v, i) => { fields[`month_${i + 1}`] = parseMonthlyValue(v); });
  return fields;
}

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [activeBucket, setActiveBucket] = useState<string>("");

  // Keeps the active sub-tab in the URL (?tab=data_entry&bucket=...) instead
  // of only local state, so a browser refresh restores the tab the client
  // was on instead of silently resetting to Company Vehicles (the first
  // bucket returned) every time.
  function selectBucket(bucketKey: string) {
    setActiveBucket(bucketKey);
    const params = new URLSearchParams(searchParams.toString());
    params.set("bucket", bucketKey);
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
  }
  const [rows, setRows] = useState<Row[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [reportingYear, setReportingYear] = useState<number | null>(null);
  const [reportingPeriodStart, setReportingPeriodStart] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Set when the backend 404s specifically because this client has no open
  // job yet (e.g. every job is Closed) -- ~15% of clients hit this. This is
  // an expected, actionable state, not a real error, so it gets its own
  // calmer panel instead of the red error banner.
  const [noJobMessage, setNoJobMessage] = useState("");
  // Set from the job's Data Collection Deadline milestone (or a CRM override)
  // once it's passed -- another expected, actionable state with its own panel.
  const [dataEntryExpired, setDataEntryExpired] = useState(false);
  const [dataEntryExpiry, setDataEntryExpiry] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [factorOptions, setFactorOptions] = useState<FactorOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFactor, setSelectedFactor] = useState<FactorOption | null>(null);
  const [qty, setQty] = useState("");
  const [useMonthly, setUseMonthly] = useState(false);
  const [monthlyValues, setMonthlyValues] = useState<string[]>(Array(12).fill(""));
  const [notes, setNotes] = useState("");
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
  // "Copy selected to this year" from the Previous Years table creates real
  // rows immediately (site + factor carried over, qty left blank -- this
  // bucket's create endpoint doesn't require a quantity up front, unlike
  // Employee Commuting), so the client edits the quantity in place on each
  // new row rather than re-picking the factor from a quick-pick pill.
  const [copyingFromHistory, setCopyingFromHistory] = useState(false);

  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editQty, setEditQty] = useState("");
  const [rowActionSaving, setRowActionSaving] = useState(false);

  // Monthly-breakdown edit modal for an existing row (mirrors the CRM's Data
  // Entry "Monthly Data" modal in JobDataEntry.tsx).
  const [monthlyModalRow, setMonthlyModalRow] = useState<Row | null>(null);
  const [monthlyModalValues, setMonthlyModalValues] = useState<string[]>(Array(12).fill(""));
  const [monthlyModalSaving, setMonthlyModalSaving] = useState(false);

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
        const bucketFromUrl = searchParams.get("bucket");
        const isValidFromUrl = (d.buckets || []).some((b) => b.bucket_key === bucketFromUrl);
        if (isValidFromUrl && bucketFromUrl) {
          setActiveBucket(bucketFromUrl);
        } else if (d.buckets?.length) {
          setActiveBucket(d.buckets[0].bucket_key);
        }
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
    setUseMonthly(false);
    setMonthlyValues(Array(12).fill(""));
    setNotes("");
    setSelectedSiteId(defaultSiteId(sites));
    setRegNumber("");
    setRegLookupError("");
    setRegLookupVehicle(null);
    setNoJobMessage("");
    setDataEntryExpired(false);
    setDataEntryExpiry(null);
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
    setDataEntryExpiry(null);
    try {
      const res = await apiFetch(`/portal/data-entry/${bucketKey}/rows`);
      if (res.ok) {
        const d = await res.json();
        setRows(d.rows || []);
        setJobNumber(d.job_number || null);
        setReportingYear(d.reporting_year || null);
        setReportingPeriodStart(d.reporting_period_start || null);
        setDataEntryExpired(Boolean(d.portal_data_entry_expired));
        setDataEntryExpiry(d.portal_data_entry_expiry || null);
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
      const prevItems: PreviousRow[] = prevRes.ok ? (await prevRes.json()).items || [] : [];
      const topItems: TopFactor[] = topRes.ok ? (await topRes.json()).items || [] : [];
      setPreviousRows(prevItems);
      // "Frequently used" is drawn from the same client's job_scope_rows history
      // as "Previously used" with no shared exclusion, so a factor used often is
      // almost always also the most recent -- drop anything already shown above
      // rather than showing the same pill twice.
      const seen = new Set(prevItems.map((item) => item.original_id));
      setTopFactors(topItems.filter((item) => !seen.has(item.original_id)));
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

  async function handleCopySelectedFromHistory(items: HistoryItem[]) {
    const candidates = items.filter((i) => i.original_id);
    if (candidates.length === 0 || copyingFromHistory) return;
    setShowAdd(true);
    setError("");
    setCopyingFromHistory(true);
    const isVehicleTab = activeBucket === "company_vehicles" || activeBucket === "business_travel";
    const fallbackSiteId = selectedSiteId ? Number(selectedSiteId) : sites.length === 1 ? sites[0].site_id : null;
    let succeeded = 0;
    const failures: string[] = [];
    try {
      for (const item of candidates) {
        const siteId = item.site_id ?? fallbackSiteId;
        if (!siteId) {
          failures.push(`${item.activity}: no site on record — add it manually and pick a site.`);
          continue;
        }
        try {
          const res = await apiFetch(`/portal/data-entry/${activeBucket}/rows`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope: item.scope,
              original_id: item.original_id,
              category: item.category,
              report_label: item.activity,
              uom: item.uom,
              qty: null,
              site_id: siteId,
              ...(isVehicleTab && item.identifier ? { vehicle_registration: item.identifier } : {}),
            }),
          });
          if (res.ok) {
            succeeded += 1;
          } else {
            const d = await res.json().catch(() => ({}));
            failures.push(`${item.activity}: ${d?.detail || "failed to add"}`);
          }
        } catch {
          failures.push(`${item.activity}: failed to add`);
        }
      }
    } finally {
      setCopyingFromHistory(false);
    }
    if (succeeded > 0) {
      setJustAdded(true);
      if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
      justAddedTimerRef.current = setTimeout(() => setJustAdded(false), 4000);
      void loadRows(activeBucket);
    }
    if (failures.length > 0) {
      setError(`Some entries couldn't be copied: ${failures.join("; ")}`);
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
        // regNumber is deliberately kept (not cleared here) -- submitRow()
        // still needs it to record which vehicle this row belongs to.
        // Clearing it immediately after the lookup meant the registration
        // was never actually saved even though the backend already
        // supported it (asset_identifier), since submitRow's own check
        // ran against an already-emptied value.
      } else {
        setRegLookupError(d?.detail || "Couldn't look up that registration.");
      }
    } finally {
      setRegLookupLoading(false);
    }
  }

  async function submitRow() {
    const monthlySum = sumMonthlyValues(monthlyValues);
    const qtyValid = useMonthly ? monthlySum > 0 : isPositiveQty(qty);
    if (!selectedFactor || !qtyValid || !selectedSiteId) return;
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
          qty: useMonthly ? monthlySum : Number(qty),
          site_id: Number(selectedSiteId),
          notes: notes.trim() || null,
          ...(isVehicleBucket && regNumber.trim() ? { vehicle_registration: regNumber.trim() } : {}),
          ...(useMonthly ? monthFieldsFromValues(monthlyValues) : {}),
        }),
      });
      if (res.ok) {
        // Deliberately keeps the panel open and the site selected (only the
        // factor/qty/search reset) -- entering several rows in one sitting is
        // the common case, and re-opening the panel + re-picking the site for
        // every single row was the biggest friction point in this flow.
        setSelectedFactor(null);
        setQty("");
        setUseMonthly(false);
        setMonthlyValues(Array(12).fill(""));
        setNotes("");
        setSearch("");
        setFactorOptions([]);
        setRegLookupVehicle(null);
        setRegNumber("");
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

  function openMonthlyModal(row: Row) {
    setMonthlyModalRow(row);
    setMonthlyModalValues([
      row.month_1, row.month_2, row.month_3, row.month_4, row.month_5, row.month_6,
      row.month_7, row.month_8, row.month_9, row.month_10, row.month_11, row.month_12,
    ].map((v) => (v === null || v === undefined ? "" : String(v))));
  }

  function closeMonthlyModal() {
    setMonthlyModalRow(null);
    setMonthlyModalValues(Array(12).fill(""));
  }

  async function saveMonthlyModal() {
    if (!monthlyModalRow) return;
    setMonthlyModalSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/data-entry/${activeBucket}/rows/${monthlyModalRow.row_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qty: sumMonthlyValues(monthlyModalValues),
          ...monthFieldsFromValues(monthlyModalValues),
        }),
      });
      if (res.ok) {
        closeMonthlyModal();
        void loadRows(activeBucket);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to update this row.");
      }
    } finally {
      setMonthlyModalSaving(false);
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
  // Employee Commuting and Purchased Goods & Services now arrive from the
  // buckets API too (with their has_data flag) -- COMMUTING_BUCKET/SPEND_BUCKET
  // above stay only as bucket_key constants for the isSpendTab/isCommutingTab
  // checks, not appended again here.
  const allTabs = [...buckets, ...COMING_SOON_BUCKETS];
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
        <button className="text-primary hover:underline" onClick={() => openMonthlyModal(row)}>
          Monthly
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
          <p className="mt-1 text-sm font-semibold text-foreground">
            Job {jobNumber}
            {reportingYear ? ` · Reporting Year ${reportingYear}` : ""}
            {dataEntryExpiry && (
              <span className={dataEntryExpired ? "text-rose-700" : "text-muted-foreground font-normal"}>
                {" · "}Data entry {dataEntryExpired ? "closed" : "closes"} {formatDate(dataEntryExpiry)}
              </span>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {allTabs.map((b) => (
          <button
            key={b.bucket_key}
            onClick={() => selectBucket(b.bucket_key)}
            title={b.has_data ? "Data submitted" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              activeBucket === b.bucket_key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {b.label}
            {b.has_data && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />
            )}
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
            {copyingFromHistory && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                Copying selected entries to this year...
              </div>
            )}
            {justAdded && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Row added — ready for the next one.
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
              <div className="space-y-3">
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
                {/* The qty field only appears once a factor is picked (see the
                    selectedFactor block below) -- this step indicator is what
                    signals that picking a quick pick/search result is step one
                    of two, not the whole action. Given its own colored/numbered
                    treatment rather than muted text so it doesn't read as one
                    more line of fine print. */}
                <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                    {selectedFactor ? "2" : "1"}
                  </span>
                  <span className="text-sm font-medium">
                    {selectedFactor
                      ? "Enter the quantity and submit."
                      : "Choose what you're logging — quick picks are on the right, or search below."}
                  </span>
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
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-muted-foreground">
                        {useMonthly
                          ? `Monthly breakdown (${selectedFactor.uom || "units"})`
                          : `Quantity (${selectedFactor.uom || "units"}, annual total)`}
                      </label>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => setUseMonthly((v) => !v)}
                      >
                        {useMonthly ? "Switch to single total" : "Enter monthly breakdown instead"}
                      </button>
                    </div>
                    {useMonthly ? (
                      <div className="space-y-2">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline"
                            onClick={() => {
                              const firstValue = monthlyValues[getMonthIndex(0, reportingPeriodStart)] ?? "";
                              setMonthlyValues(Array(12).fill(firstValue));
                            }}
                          >
                            Copy first month to all
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {getOrderedMonths(reportingPeriodStart).map((month, displayIndex) => {
                            const actualIndex = getMonthIndex(displayIndex, reportingPeriodStart);
                            return (
                              <div key={`${month}-${displayIndex}`}>
                                <Label htmlFor={`add-month-${displayIndex}`} className="text-xs">{month}</Label>
                                <Input
                                  id={`add-month-${displayIndex}`}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={monthlyValues[actualIndex] ?? ""}
                                  onChange={(e) => {
                                    const next = [...monthlyValues];
                                    next[actualIndex] = e.target.value;
                                    setMonthlyValues(next);
                                  }}
                                  className="h-8 text-sm"
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Total: <span className="font-medium text-foreground">{sumMonthlyValues(monthlyValues).toLocaleString()}</span> {selectedFactor.uom || "units"}
                        </div>
                        {sumMonthlyValues(monthlyValues) <= 0 && (
                          <div className="text-xs text-rose-700">Enter at least one month greater than 0.</div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
                        {qty.trim() && !isPositiveQty(qty) && (
                          <div className="mt-1 text-xs text-rose-700">Enter a quantity greater than 0.</div>
                        )}
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-muted-foreground">Notes (optional)</label>
                      <textarea
                        className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Anything your NZI consultant should know about this entry"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        disabled={saving || !selectedSiteId || (useMonthly ? sumMonthlyValues(monthlyValues) <= 0 : !isPositiveQty(qty))}
                        onClick={() => void submitRow()}
                      >
                        {saving ? "Submitting..." : "Submit"}
                      </Button>
                    </div>
                  </div>
                )}
                {selectedFactor && !selectedSiteId && (
                  <div className="text-xs text-rose-700">Select a site above before submitting.</div>
                )}
              </div>

              {/* Quick picks live in their own column throughout, rather than
                  as inline pill rows above the search box -- keeps the primary
                  flow (site -> pick -> qty) visually linear instead of forcing
                  the eye through two chip lists before it reaches the search
                  input. Stays visible while searching too, since it's no
                  longer competing with the results list for the same space. */}
              {!selectedFactor && (previousRows.length > 0 || topFactors.length > 0) && (
                <div className="space-y-3 rounded-md border bg-muted/20 p-3 md:self-start">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Quick picks
                  </div>
                  {previousRows.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-foreground">Previously used</div>
                      <div className="space-y-0.5">
                        {previousRows.map((item, idx) => (
                          <button
                            key={`prev-${item.original_id}-${idx}`}
                            className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-background"
                            onClick={() => pickQuickFactor(item)}
                            title={item.last_reporting_year ? `Last used in ${item.last_reporting_year}` : undefined}
                          >
                            {item.report_label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {topFactors.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-foreground">Frequently used</div>
                      <div className="space-y-0.5">
                        {topFactors.map((item, idx) => (
                          <button
                            key={`top-${item.original_id}-${idx}`}
                            className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-background"
                            onClick={() => pickQuickFactor(item)}
                          >
                            {item.report_label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
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

      {!isComingSoon && !isSpendTab && !isCommutingTab && !noJobMessage && activeBucket && (
        <PortalCategoryHistoryTable
          fetchUrl={`/portal/data-entry/${activeBucket}/history`}
          onCopySelected={dataEntryExpired ? undefined : handleCopySelectedFromHistory}
        />
      )}

      <Dialog open={monthlyModalRow !== null} onOpenChange={(open) => { if (!open) closeMonthlyModal(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Monthly breakdown</DialogTitle>
            {monthlyModalRow && (
              <div className="mt-1 text-xs text-muted-foreground">
                {monthlyModalRow.report_label || monthlyModalRow.original_id}
                {monthlyModalRow.uom ? ` · unit: ${monthlyModalRow.uom}` : ""}
              </div>
            )}
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  const firstValue = monthlyModalValues[getMonthIndex(0, reportingPeriodStart)] ?? "";
                  setMonthlyModalValues(Array(12).fill(firstValue));
                }}
              >
                Copy first month to all
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {getOrderedMonths(reportingPeriodStart).map((month, displayIndex) => {
                const actualIndex = getMonthIndex(displayIndex, reportingPeriodStart);
                return (
                  <div key={`${month}-${displayIndex}`}>
                    <Label htmlFor={`modal-month-${displayIndex}`} className="text-xs">{month}</Label>
                    <Input
                      id={`modal-month-${displayIndex}`}
                      type="number"
                      min="0"
                      step="any"
                      value={monthlyModalValues[actualIndex] ?? ""}
                      onChange={(e) => {
                        const next = [...monthlyModalValues];
                        next[actualIndex] = e.target.value;
                        setMonthlyModalValues(next);
                      }}
                      className="h-8 text-sm"
                    />
                  </div>
                );
              })}
            </div>
            <div className="text-sm text-muted-foreground">
              Total: <span className="font-medium text-foreground">{sumMonthlyValues(monthlyModalValues).toLocaleString()}</span>{" "}
              {monthlyModalRow?.uom || "units"}
            </div>
            {error && <div className="text-xs text-rose-700">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeMonthlyModal}>
              Cancel
            </Button>
            <Button
              disabled={monthlyModalSaving || sumMonthlyValues(monthlyModalValues) <= 0}
              onClick={() => void saveMonthlyModal()}
            >
              {monthlyModalSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
