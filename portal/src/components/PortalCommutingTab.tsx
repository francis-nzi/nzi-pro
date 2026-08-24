"use client";

import { Fragment, useEffect, useRef, useState } from "react";
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
import PortalCategoryHistoryTable, { type HistoryItem } from "@/components/PortalCategoryHistoryTable";

type Options = { mode_options: string[]; service_options: string[]; unit_options: string[] };

type QuickPickFactor = {
  scope: string | null;
  category: string | null;
  report_label: string | null;
  original_id: string;
  uom: string | null;
};

type Site = { site_id: number; site_name: string | null; is_registered_office?: boolean };

type Row = {
  source_id: number;
  employee_name: string | null;
  source_subtype: string | null;
  qty: number | null;
  uom: string | null;
  calc_tco2e: number | null;
  site_id: number | null;
  site_name: string | null;
  report_label: string | null;
  review_status: "pending_review" | "approved" | "rejected" | null;
  review_note: string | null;
  month_1: number | null;
  month_2: number | null;
  month_3: number | null;
  month_4: number | null;
  month_5: number | null;
  month_6: number | null;
  month_7: number | null;
  month_8: number | null;
  month_9: number | null;
  month_10: number | null;
  month_11: number | null;
  month_12: number | null;
};

const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => `month_${i + 1}` as keyof Row);

// Rows created before the monthly-grid feature only have a flat qty, no
// month_N detail to edit -- fall back to the old single-total edit for those.
function rowHasMonthlyDetail(row: Row): boolean {
  return MONTH_KEYS.some((k) => row[k] !== null && row[k] !== undefined);
}

const REVIEW_LABEL: Record<string, { label: string; className: string }> = {
  pending_review: { label: "Awaiting review", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected — please review", className: "bg-rose-100 text-rose-800" },
};

function isPositiveNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Months are displayed starting from the job's own reporting period (matching
// the CRM's Data Entry Monthly editor), but always stored calendar-indexed
// (months[0]=Jan .. months[11]=Dec) regardless of display order -- same
// convention as job_scope_rows.month_N, so it lines up with the rest of the
// system rather than drifting into a fiscal-position-vs-calendar-month mismatch.
function getOrderedMonths(reportingPeriodStart: string | null): string[] {
  if (!reportingPeriodStart) return MONTH_NAMES;
  try {
    const startIdx = new Date(reportingPeriodStart).getMonth();
    return [...MONTH_NAMES.slice(startIdx), ...MONTH_NAMES.slice(0, startIdx)];
  } catch {
    return MONTH_NAMES;
  }
}

function getMonthIndex(reportingPeriodStart: string | null, displayIndex: number): number {
  if (!reportingPeriodStart) return displayIndex;
  try {
    const startIdx = new Date(reportingPeriodStart).getMonth();
    return (startIdx + displayIndex) % 12;
  } catch {
    return displayIndex;
  }
}

export default function PortalCommutingTab() {
  const [options, setOptions] = useState<Options | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [noJobMessage, setNoJobMessage] = useState("");
  const [dataEntryExpired, setDataEntryExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const justAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [rowType, setRowType] = useState<"commuting" | "wfh">("commuting");
  const [entryMode, setEntryMode] = useState<"dropdown" | "vehicle">("dropdown");
  const [employeeName, setEmployeeName] = useState("");
  const [modeValue, setModeValue] = useState("");
  const [serviceValue, setServiceValue] = useState("");
  const [unitValue, setUnitValue] = useState("miles");
  // Set by clicking a "Quick picks" pill or a copied-forward previous-year
  // activity -- when present, submitRow sends original_id directly and
  // skips the mode/service/unit dropdowns entirely (see
  // api/portal_commuting_routes.py portal_commuting_create_row and the
  // original_id passthrough in _resolve_manual_commuting_rows).
  const [quickPickOriginalId, setQuickPickOriginalId] = useState<string | null>(null);
  const [quickPickLabel, setQuickPickLabel] = useState<string | null>(null);
  const [quickPickUom, setQuickPickUom] = useState<string | null>(null);
  const [previousFactors, setPreviousFactors] = useState<QuickPickFactor[]>([]);
  const [topFactors, setTopFactors] = useState<QuickPickFactor[]>([]);
  // Same "copy previous years forward" queue as PortalDataEntry.tsx --
  // checking activities in the Previous Years table promotes them here
  // rather than creating anything, so the client still fills in an
  // employee name + distance before it becomes a real entry.
  const [copiedFactors, setCopiedFactors] = useState<QuickPickFactor[]>([]);
  // Shared by both commuting entry paths (dropdown and vehicle-registration) --
  // only one is visible at a time via entryMode, so one array covers both.
  // months[0]=Jan .. months[11]=Dec; a blank month means no commuting that
  // month (e.g. a starter/leaver), not zero distance every day.
  const [months, setMonths] = useState<string[]>(Array(12).fill(""));
  const [annualDays, setAnnualDays] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("");
  const [notes, setNotes] = useState("");

  // "I drive my own car" -- registration lookup instead of mode/service dropdowns.
  const [regNumber, setRegNumber] = useState("");
  const [regLookupError, setRegLookupError] = useState("");

  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [reportingYear, setReportingYear] = useState<number | null>(null);
  const [reportingPeriodStart, setReportingPeriodStart] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editEmployeeName, setEditEmployeeName] = useState("");
  const [editQty, setEditQty] = useState("");
  // Separate from `months` (the Add form) so editing a row can't collide with
  // an Add panel left open at the same time.
  const [editMonths, setEditMonths] = useState<string[]>(Array(12).fill(""));
  const [rowActionSaving, setRowActionSaving] = useState(false);

  const [sites, setSites] = useState<Site[]>([]);
  const [siteUpdatingRowId, setSiteUpdatingRowId] = useState<number | null>(null);
  const defaultSiteId = sites.find((s) => s.is_registered_office)?.site_id ?? sites[0]?.site_id ?? null;

  useEffect(() => {
    apiFetch("/portal/commuting/options")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Options) => {
        setOptions(d);
        if (d.mode_options?.length) setModeValue(d.mode_options[0]);
        if (d.service_options?.length) setServiceValue(d.service_options[0]);
      })
      .catch(() => setError("Failed to load commuting options."));
    apiFetch("/portal/data-entry/sites")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { sites: Site[] }) => setSites(d.sites || []))
      .catch(() => setSites([]));
    void loadRows();

    return () => {
      if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
    };
  }, []);

  function showJustAdded() {
    setJustAdded(true);
    if (justAddedTimerRef.current) clearTimeout(justAddedTimerRef.current);
    justAddedTimerRef.current = setTimeout(() => setJustAdded(false), 4000);
  }

  async function loadRows() {
    setLoading(true);
    setError("");
    setNoJobMessage("");
    setDataEntryExpired(false);
    try {
      const res = await apiFetch("/portal/commuting/rows");
      if (res.ok) {
        const d = await res.json();
        setRows(d.rows || []);
        setJobNumber(d.job_number || null);
        setReportingYear(d.reporting_year || null);
        setReportingPeriodStart(d.reporting_period_start || null);
        setDataEntryExpired(Boolean(d.portal_data_entry_expired));
      } else if (res.status === 404) {
        const d = await res.json().catch(() => ({}));
        setNoJobMessage(d?.detail || "No open job found for this account yet — contact your NZI consultant.");
      } else {
        setError("Failed to load your submitted commuting data.");
      }
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setEmployeeName("");
    setMonths(Array(12).fill(""));
    setAnnualDays("");
    setHoursPerDay("");
    setNotes("");
    setRegNumber("");
    setRegLookupError("");
    // Quick pick deliberately survives a reset -- entering several
    // employees against the same commute factor back-to-back is the common
    // case, so only "Change" or switching mode/entry type clears it.
  }

  async function loadCommutingQuickPicks() {
    try {
      const [prevRes, topRes] = await Promise.all([
        apiFetch("/portal/commuting/previous-rows"),
        apiFetch("/portal/commuting/top-factors"),
      ]);
      const prevItems: QuickPickFactor[] = prevRes.ok ? (await prevRes.json()).items || [] : [];
      const topItems: QuickPickFactor[] = topRes.ok ? (await topRes.json()).items || [] : [];
      setPreviousFactors(prevItems);
      const seen = new Set(prevItems.map((item) => item.original_id));
      setTopFactors(topItems.filter((item) => !seen.has(item.original_id)));
    } catch {
      setPreviousFactors([]);
      setTopFactors([]);
    }
  }

  function pickQuickCommuteFactor(item: QuickPickFactor) {
    setQuickPickOriginalId(item.original_id);
    setQuickPickLabel(item.report_label || item.original_id);
    setQuickPickUom(item.uom || null);
  }

  function clearQuickPick() {
    setQuickPickOriginalId(null);
    setQuickPickLabel(null);
    setQuickPickUom(null);
  }

  function pickCopiedFactor(item: QuickPickFactor) {
    pickQuickCommuteFactor(item);
    setCopiedFactors((prev) => prev.filter((f) => f.original_id !== item.original_id));
  }

  function handleCopySelectedFromHistory(items: HistoryItem[]) {
    const asFactors: QuickPickFactor[] = items
      .filter((i) => i.original_id)
      .map((i) => ({
        scope: i.scope ?? null,
        category: null,
        report_label: i.activity,
        original_id: i.original_id as string,
        uom: i.uom,
      }));
    setCopiedFactors((prev) => {
      const existing = new Set(prev.map((f) => f.original_id));
      return [...prev, ...asFactors.filter((f) => !existing.has(f.original_id))];
    });
    setRowType("commuting");
    setEntryMode("dropdown");
    setShowAdd(true);
    if (!previousFactors.length && !topFactors.length) void loadCommutingQuickPicks();
  }

  function updateMonth(actualIndex: number, value: string) {
    const next = [...months];
    next[actualIndex] = value;
    setMonths(next);
  }

  function monthsSum(): number {
    return months.reduce((sum, val) => {
      const parsed = val.trim() === "" ? 0 : Number(val);
      return sum + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);
  }

  function monthsPayload(): (number | null)[] {
    return months.map((val) => {
      const trimmed = val.trim();
      if (trimmed === "") return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    });
  }

  function copyFirstMonthToAll() {
    const firstValue = months[getMonthIndex(reportingPeriodStart, 0)] ?? "";
    setMonths(Array(12).fill(firstValue));
  }

  async function submitByVehicle() {
    if (!employeeName.trim() || !regNumber.trim() || monthsSum() <= 0) return;
    setSaving(true);
    setError("");
    setRegLookupError("");
    setJustAdded(false);
    try {
      const res = await apiFetch("/portal/commuting/rows-by-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_name: employeeName.trim(),
          registration_number: regNumber.trim(),
          months: monthsPayload(),
        }),
      });
      if (res.ok) {
        // Panel stays open (site-less form, so no site to re-pick) -- clearing
        // just the per-employee fields makes entering several employees' data
        // back-to-back faster than reopening the panel each time.
        resetForm();
        showJustAdded();
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setRegLookupError(d?.detail || "Couldn't look up that registration.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function submitRow() {
    if (!employeeName.trim()) return;
    if (rowType === "commuting" && monthsSum() <= 0) return;
    if (rowType === "wfh" && (!isPositiveNumber(annualDays) || !isPositiveNumber(hoursPerDay))) return;
    setSaving(true);
    setError("");
    setJustAdded(false);
    try {
      const payload: Record<string, unknown> = {
        row_type: rowType,
        employee_name: employeeName.trim(),
        notes: notes.trim() || null,
      };
      if (rowType === "commuting") {
        Object.assign(
          payload,
          quickPickOriginalId
            ? { original_id: quickPickOriginalId }
            : { mode_value: modeValue, service_value: serviceValue, unit_value: unitValue },
          {
            // Monthly breakdown instead of a single annual figure -- lets
            // starters/leavers and irregular travel patterns be entered
            // accurately. The backend sums these into annual_quantity (see
            // _manual_entry_to_parsed_row in api/employee_commuting_routes.py).
            months: monthsPayload(),
          }
        );
      } else {
        Object.assign(payload, {
          annual_days: Number(annualDays),
          hours_per_day: Number(hoursPerDay),
        });
      }

      const res = await apiFetch("/portal/commuting/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // Panel stays open -- see the comment in submitByVehicle above.
        resetForm();
        showJustAdded();
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail?.message || d?.detail || "Failed to submit this entry.");
      }
    } finally {
      setSaving(false);
    }
  }

  function editMonthsSum(): number {
    return editMonths.reduce((sum, val) => {
      const parsed = val.trim() === "" ? 0 : Number(val);
      return sum + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);
  }

  function editMonthsPayload(): (number | null)[] {
    return editMonths.map((val) => {
      const trimmed = val.trim();
      if (trimmed === "") return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    });
  }

  function copyFirstEditMonthToAll() {
    const firstValue = editMonths[getMonthIndex(reportingPeriodStart, 0)] ?? "";
    setEditMonths(Array(12).fill(firstValue));
  }

  function updateEditMonth(actualIndex: number, value: string) {
    const next = [...editMonths];
    next[actualIndex] = value;
    setEditMonths(next);
  }

  function usesMonthlyEdit(row: Row | undefined): boolean {
    return !!row && row.source_subtype === "commuting" && rowHasMonthlyDetail(row);
  }

  async function saveRowEdit(sourceId: number) {
    const row = rows.find((r) => r.source_id === sourceId);
    const useMonths = usesMonthlyEdit(row);
    if (!editEmployeeName.trim()) return;
    if (useMonths ? editMonthsSum() <= 0 : !isPositiveNumber(editQty)) return;
    setRowActionSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = { employee_name: editEmployeeName.trim() };
      if (useMonths) {
        body.months = editMonthsPayload();
      } else {
        body.qty = Number(editQty);
      }
      const res = await apiFetch(`/portal/commuting/rows/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditingRowId(null);
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to update this entry.");
      }
    } finally {
      setRowActionSaving(false);
    }
  }

  async function updateRowSite(sourceId: number, siteId: string) {
    const parsed = Number(siteId);
    if (!Number.isFinite(parsed)) return;
    setSiteUpdatingRowId(sourceId);
    setError("");
    try {
      const res = await apiFetch(`/portal/commuting/rows/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: parsed }),
      });
      if (res.ok) {
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to update this entry's site.");
      }
    } finally {
      setSiteUpdatingRowId(null);
    }
  }

  async function deleteRow(sourceId: number) {
    if (!window.confirm("Delete this entry? This can't be undone.")) return;
    setRowActionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/commuting/rows/${sourceId}`, { method: "DELETE" });
      if (res.ok) {
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to delete this entry.");
      }
    } finally {
      setRowActionSaving(false);
    }
  }

  // Shared between the table (desktop) and card (mobile) layouts below.
  // Falls back to the registered-office site when a row hasn't had one set
  // yet (e.g. every row submitted before this selector existed).
  function renderSiteSelect(row: Row) {
    if (dataEntryExpired || sites.length === 0) {
      return <span className="text-xs text-muted-foreground">{row.site_name || "-"}</span>;
    }
    const value = row.site_id !== null ? String(row.site_id) : defaultSiteId !== null ? String(defaultSiteId) : "";
    return (
      <Select
        value={value}
        onValueChange={(v) => void updateRowSite(row.source_id, v)}
        disabled={siteUpdatingRowId === row.source_id}
      >
        <SelectTrigger className="h-7 w-36 text-xs">
          <SelectValue placeholder="Select site..." />
        </SelectTrigger>
        <SelectContent>
          {sites.map((site) => (
            <SelectItem key={site.site_id} value={String(site.site_id)}>
              {site.site_name || `Site #${site.site_id}`}
              {site.is_registered_office ? " ★" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Shared between the table (desktop) and card (mobile) layouts below.
  function renderActions(row: Row, align: "start" | "end") {
    const justify = align === "end" ? "justify-end" : "justify-start";
    if (dataEntryExpired) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    if (editingRowId === row.source_id) {
      const useMonths = usesMonthlyEdit(row);
      return (
        <div className={`flex items-center ${justify} gap-2`}>
          <Button
            size="sm"
            variant="outline"
            disabled={rowActionSaving || !editEmployeeName.trim() || (useMonths ? editMonthsSum() <= 0 : !isPositiveNumber(editQty))}
            onClick={() => void saveRowEdit(row.source_id)}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingRowId(null)}>
            Cancel
          </Button>
        </div>
      );
    }
    return (
      <div className={`flex items-center ${justify} gap-3 text-xs`}>
        <button
          className="text-primary hover:underline"
          onClick={() => {
            setEditingRowId(row.source_id);
            setEditEmployeeName(row.employee_name || "");
            setEditQty(row.qty !== null && row.qty !== undefined ? String(row.qty) : "");
            setEditMonths(MONTH_KEYS.map((k) => (row[k] !== null && row[k] !== undefined ? String(row[k]) : "")));
          }}
        >
          Edit
        </button>
        {row.review_status !== "approved" && (
          <button className="text-rose-700 hover:underline disabled:opacity-50" disabled={rowActionSaving} onClick={() => void deleteRow(row.source_id)}>
            Delete
          </button>
        )}
      </div>
    );
  }

  // Shared by the Add form (both commuting entry paths) and row editing --
  // takes the values/handlers as params so Add and Edit can each pass their
  // own state without the two colliding.
  function renderMonthlyGridFor(
    unitLabel: string,
    values: string[],
    onChange: (actualIndex: number, value: string) => void,
    onCopyFirst: () => void,
    sum: number,
  ) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-muted-foreground">Monthly Distance ({unitLabel}, round trip)</label>
          <Button type="button" variant="outline" size="sm" onClick={onCopyFirst}>
            Copy First Month to All
          </Button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {getOrderedMonths(reportingPeriodStart).map((label, displayIndex) => {
            const actualIndex = getMonthIndex(reportingPeriodStart, displayIndex);
            return (
              <div key={`${label}-${displayIndex}`}>
                <label className="text-xs text-muted-foreground">{label}</label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={values[actualIndex]}
                  onChange={(e) => onChange(actualIndex, e.target.value)}
                />
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Leave a month blank if they weren&rsquo;t commuting that month (e.g. joined or left partway through the
          year). Total: {sum.toFixed(0)} {unitLabel}/year.
        </p>
      </div>
    );
  }

  function renderMonthlyGrid(unitLabel: string) {
    return renderMonthlyGridFor(unitLabel, months, updateMonth, copyFirstMonthToAll, monthsSum());
  }

  function renderEditMonthlyGrid(unitLabel: string) {
    return renderMonthlyGridFor(unitLabel, editMonths, updateEditMonth, copyFirstEditMonthToAll, editMonthsSum());
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add employee commuting or working-from-home data here. Your NZI consultant reviews and approves each entry
        before it counts toward your reported emissions.
      </p>
      {jobNumber && (
        <p className="-mt-2 text-sm font-semibold text-foreground">
          Job {jobNumber}
          {reportingYear ? ` · Reporting Year ${reportingYear}` : ""}
        </p>
      )}

      {error && <ErrorPanel description={error} />}
      {noJobMessage && <EmptyStatePanel title="Not available yet for this account" description={noJobMessage} />}

      {!noJobMessage && dataEntryExpired && (
        <EmptyStatePanel
          title="Data entry is closed for this period"
          description="The data collection deadline has passed. Contact your NZI consultant if you still need to submit or edit data here."
        />
      )}

      {!noJobMessage && (
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{rows.length} entr{rows.length === 1 ? "y" : "ies"} submitted</div>
        {!dataEntryExpired && (
          <Button
            onClick={() => {
              const next = !showAdd;
              setShowAdd(next);
              if (next) void loadCommutingQuickPicks();
            }}
          >
            {showAdd ? "Cancel" : "+ Add Entry"}
          </Button>
        )}
      </div>
      )}

      {!noJobMessage && !dataEntryExpired && showAdd && options && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            {justAdded && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Entry added — ready for the next one.
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={rowType === "commuting" ? "default" : "outline"}
                size="sm"
                onClick={() => setRowType("commuting")}
              >
                Commuting
              </Button>
              <Button
                type="button"
                variant={rowType === "wfh" ? "default" : "outline"}
                size="sm"
                onClick={() => setRowType("wfh")}
              >
                Working From Home
              </Button>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Initials or Staff Number</label>
              <Input
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="e.g. JD or EMP-4471 — do not enter full names"
              />
            </div>

            {rowType === "commuting" && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={entryMode === "dropdown" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEntryMode("dropdown")}
                >
                  Choose mode &amp; distance
                </Button>
                <Button
                  type="button"
                  variant={entryMode === "vehicle" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEntryMode("vehicle")}
                >
                  I drive my own car (registration)
                </Button>
              </div>
            )}

            {rowType === "commuting" && entryMode === "vehicle" ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Vehicle Registration Number</label>
                  <Input
                    placeholder="e.g. AB12 CDE"
                    value={regNumber}
                    onChange={(e) => setRegNumber(e.target.value)}
                  />
                </div>
                {renderMonthlyGrid("miles")}
                {regLookupError && <div className="text-xs text-rose-700">{regLookupError}</div>}
                <Button
                  disabled={saving || !employeeName.trim() || !regNumber.trim() || monthsSum() <= 0}
                  onClick={() => void submitByVehicle()}
                >
                  {saving ? "Looking up & submitting..." : "Submit Entry"}
                </Button>
              </div>
            ) : rowType === "commuting" ? (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-3">
                  {quickPickOriginalId ? (
                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium">{quickPickLabel}</div>
                      <Button size="sm" variant="outline" className="mt-2" onClick={clearQuickPick}>
                        Change
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Commute Mode</label>
                        <Select value={modeValue} onValueChange={setModeValue}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {options.mode_options.map((m) => (
                              <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Vehicle / Service Type</label>
                        <Select value={serviceValue} onValueChange={setServiceValue}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {options.service_options.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Distance Unit</label>
                        <Select value={unitValue} onValueChange={setUnitValue}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {options.unit_options.map((u) => (
                              <SelectItem key={u} value={u}>{u}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  {renderMonthlyGrid(quickPickOriginalId ? quickPickUom || "units" : unitValue)}
                </div>

                {!quickPickOriginalId && (previousFactors.length > 0 || topFactors.length > 0 || copiedFactors.length > 0) && (
                  <div className="space-y-3 rounded-md border bg-muted/20 p-3 md:self-start">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Quick picks
                    </div>
                    {copiedFactors.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-foreground">Copied from previous years</div>
                        <div className="space-y-0.5">
                          {copiedFactors.map((item, idx) => (
                            <button
                              key={`copied-${item.original_id}-${idx}`}
                              className="block w-full rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-left text-xs hover:bg-primary/10"
                              onClick={() => pickCopiedFactor(item)}
                            >
                              {item.report_label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {previousFactors.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-foreground">Previously used</div>
                        <div className="space-y-0.5">
                          {previousFactors.map((item, idx) => (
                            <button
                              key={`prev-${item.original_id}-${idx}`}
                              className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-background"
                              onClick={() => pickQuickCommuteFactor(item)}
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
                              onClick={() => pickQuickCommuteFactor(item)}
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
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs text-muted-foreground">Annual WFH Days</label>
                  <Input type="number" min="0" step="any" value={annualDays} onChange={(e) => setAnnualDays(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Hours Per Day</label>
                  <Input type="number" min="0" step="any" value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} />
                </div>
              </div>
            )}

            {!(rowType === "commuting" && entryMode === "vehicle") && (
              <div>
                <label className="text-xs text-muted-foreground">Notes (optional)</label>
                <textarea
                  className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything your NZI consultant should know about this entry"
                />
              </div>
            )}

            {!(rowType === "commuting" && entryMode === "vehicle") && (
              <Button
                disabled={
                  saving ||
                  !employeeName.trim() ||
                  (rowType === "commuting"
                    ? monthsSum() <= 0
                    : !isPositiveNumber(annualDays) || !isPositiveNumber(hoursPerDay))
                }
                onClick={() => void submitRow()}
              >
                {saving ? "Submitting..." : "Submit Entry"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!noJobMessage && (loading ? (
        <SkeletonLoader />
      ) : rows.length === 0 ? (
        <EmptyStatePanel title="No commuting data submitted yet." />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-md border sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-left">Initials / Staff No.</th>
                  <th className="p-2 text-left">Activity</th>
                  <th className="p-2 text-left">Site</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const review = row.review_status ? REVIEW_LABEL[row.review_status] : null;
                  const isEditing = editingRowId === row.source_id;
                  const editWithGrid = isEditing && usesMonthlyEdit(row);
                  return (
                    <Fragment key={row.source_id}>
                      <tr className="border-b last:border-0">
                        <td className="p-2">
                          {isEditing ? (
                            <Input value={editEmployeeName} onChange={(e) => setEditEmployeeName(e.target.value)} className="h-7 w-28" />
                          ) : (
                            row.employee_name || "-"
                          )}
                        </td>
                        <td className="p-2">{row.report_label || row.source_subtype || "-"}</td>
                        <td className="p-2">{renderSiteSelect(row)}</td>
                        <td className="p-2 text-right font-mono">
                          {editWithGrid ? (
                            <span className="text-xs text-muted-foreground">Edit monthly figures below &darr;</span>
                          ) : isEditing ? (
                            <Input type="number" min="0" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="ml-auto h-7 w-20 text-right" />
                          ) : (
                            <>{row.qty !== null && row.qty !== undefined ? row.qty.toLocaleString() : "-"} {row.uom || ""}</>
                          )}
                        </td>
                        <td className="p-2">
                          {review ? (
                            <>
                              <span className={`rounded-full px-2 py-0.5 text-xs ${review.className}`}>{review.label}</span>
                              {row.review_status === "rejected" && row.review_note && (
                                <div className="mt-1 text-xs text-muted-foreground">{row.review_note}</div>
                              )}
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="p-2 text-right">{renderActions(row, "end")}</td>
                      </tr>
                      {editWithGrid && (
                        <tr className="border-b last:border-0 bg-muted/20">
                          <td className="p-3" colSpan={6}>
                            {renderEditMonthlyGrid(row.uom || "miles")}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 sm:hidden">
            {rows.map((row) => {
              const review = row.review_status ? REVIEW_LABEL[row.review_status] : null;
              const isEditing = editingRowId === row.source_id;
              const editWithGrid = isEditing && usesMonthlyEdit(row);
              return (
                <div key={row.source_id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {isEditing ? (
                        <Input value={editEmployeeName} onChange={(e) => setEditEmployeeName(e.target.value)} className="h-7 w-28" />
                      ) : (
                        <div className="font-medium">{row.employee_name || "-"}</div>
                      )}
                      <div className="text-xs text-muted-foreground">{row.report_label || row.source_subtype || "-"}</div>
                    </div>
                    {review ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${review.className}`}>{review.label}</span>
                    ) : null}
                  </div>
                  {review?.label && row.review_status === "rejected" && row.review_note && (
                    <div className="mt-1 text-xs text-muted-foreground">{row.review_note}</div>
                  )}
                  <div className="mt-2">{renderSiteSelect(row)}</div>
                  {editWithGrid ? (
                    <div className="mt-2">{renderEditMonthlyGrid(row.uom || "miles")}</div>
                  ) : (
                    <div className="mt-2 flex items-baseline justify-between font-mono text-sm">
                      <span>
                        {isEditing ? (
                          <Input type="number" min="0" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="h-7 w-20" />
                        ) : (
                          <>{row.qty !== null && row.qty !== undefined ? row.qty.toLocaleString() : "-"} {row.uom || ""}</>
                        )}
                      </span>
                    </div>
                  )}
                  <div className="mt-2 border-t pt-2">{renderActions(row, "start")}</div>
                </div>
              );
            })}
          </div>
        </>
      ))}

      {!noJobMessage && (
        <PortalCategoryHistoryTable
          fetchUrl="/portal/commuting/history"
          onCopySelected={dataEntryExpired ? undefined : handleCopySelectedFromHistory}
        />
      )}
    </div>
  );
}
