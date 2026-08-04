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
import PortalCategoryHistoryTable from "@/components/PortalCategoryHistoryTable";

type Options = { mode_options: string[]; service_options: string[]; unit_options: string[] };

type Row = {
  source_id: number;
  employee_name: string | null;
  source_subtype: string | null;
  qty: number | null;
  uom: string | null;
  calc_tco2e: number | null;
  review_status: "pending_review" | "approved" | "rejected" | null;
  review_note: string | null;
};

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
  const [oneWayDistance, setOneWayDistance] = useState("");
  const [officeDays, setOfficeDays] = useState("");
  const [weeksPerYear, setWeeksPerYear] = useState("48");
  const [annualDays, setAnnualDays] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("");
  const [notes, setNotes] = useState("");

  // "I drive my own car" -- registration lookup instead of mode/service dropdowns.
  const [regNumber, setRegNumber] = useState("");
  const [regAnnualMiles, setRegAnnualMiles] = useState("");
  const [regLookupError, setRegLookupError] = useState("");

  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [reportingYear, setReportingYear] = useState<number | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editEmployeeName, setEditEmployeeName] = useState("");
  const [editQty, setEditQty] = useState("");
  const [rowActionSaving, setRowActionSaving] = useState(false);

  useEffect(() => {
    apiFetch("/portal/commuting/options")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Options) => {
        setOptions(d);
        if (d.mode_options?.length) setModeValue(d.mode_options[0]);
        if (d.service_options?.length) setServiceValue(d.service_options[0]);
      })
      .catch(() => setError("Failed to load commuting options."));
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
    setOneWayDistance("");
    setOfficeDays("");
    setWeeksPerYear("48");
    setAnnualDays("");
    setHoursPerDay("");
    setNotes("");
    setRegNumber("");
    setRegAnnualMiles("");
    setRegLookupError("");
  }

  async function submitByVehicle() {
    if (!employeeName.trim() || !regNumber.trim() || !isPositiveNumber(regAnnualMiles)) return;
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
          annual_quantity: Number(regAnnualMiles),
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
    if (rowType === "commuting" && (!isPositiveNumber(oneWayDistance) || !isPositiveNumber(officeDays) || !isPositiveNumber(weeksPerYear))) return;
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
        Object.assign(payload, {
          mode_value: modeValue,
          service_value: serviceValue,
          unit_value: unitValue,
          one_way_distance: Number(oneWayDistance),
          office_days: Number(officeDays),
          weeks_per_year: Number(weeksPerYear),
        });
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

  async function saveRowEdit(sourceId: number) {
    if (!editEmployeeName.trim() || !isPositiveNumber(editQty)) return;
    setRowActionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/commuting/rows/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_name: editEmployeeName.trim(), qty: Number(editQty) }),
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
  function renderActions(row: Row, align: "start" | "end") {
    const justify = align === "end" ? "justify-end" : "justify-start";
    if (row.review_status === "approved" || dataEntryExpired) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    if (editingRowId === row.source_id) {
      return (
        <div className={`flex items-center ${justify} gap-2`}>
          <Button
            size="sm"
            variant="outline"
            disabled={rowActionSaving || !editEmployeeName.trim() || !isPositiveNumber(editQty)}
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
          }}
        >
          Edit
        </button>
        <button className="text-rose-700 hover:underline disabled:opacity-50" disabled={rowActionSaving} onClick={() => void deleteRow(row.source_id)}>
          Delete
        </button>
      </div>
    );
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
          <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Cancel" : "+ Add Entry"}</Button>
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
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Vehicle Registration Number</label>
                    <Input
                      placeholder="e.g. AB12 CDE"
                      value={regNumber}
                      onChange={(e) => setRegNumber(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Annual Commuting Miles</label>
                    <Input type="number" value={regAnnualMiles} onChange={(e) => setRegAnnualMiles(e.target.value)} />
                  </div>
                </div>
                {regAnnualMiles.trim() && !isPositiveNumber(regAnnualMiles) && (
                  <div className="text-xs text-rose-700">Annual commuting miles must be greater than 0.</div>
                )}
                {regLookupError && <div className="text-xs text-rose-700">{regLookupError}</div>}
                <Button
                  disabled={saving || !employeeName.trim() || !regNumber.trim() || !isPositiveNumber(regAnnualMiles)}
                  onClick={() => void submitByVehicle()}
                >
                  {saving ? "Looking up & submitting..." : "Submit Entry"}
                </Button>
              </div>
            ) : rowType === "commuting" ? (
              <div className="grid gap-3 md:grid-cols-2">
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
                <div>
                  <label className="text-xs text-muted-foreground">One-Way Distance</label>
                  <Input type="number" min="0" step="any" value={oneWayDistance} onChange={(e) => setOneWayDistance(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Office Days / Week</label>
                  <Input type="number" min="0" step="any" value={officeDays} onChange={(e) => setOfficeDays(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Weeks / Year</label>
                  <Input type="number" min="0" step="any" value={weeksPerYear} onChange={(e) => setWeeksPerYear(e.target.value)} />
                </div>
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
                    ? !isPositiveNumber(oneWayDistance) || !isPositiveNumber(officeDays) || !isPositiveNumber(weeksPerYear)
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
                  <th className="p-2 text-left">Type</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-right">tCO&#8322;e</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const review = row.review_status ? REVIEW_LABEL[row.review_status] : null;
                  const isEditing = editingRowId === row.source_id;
                  return (
                    <tr key={row.source_id} className="border-b last:border-0">
                      <td className="p-2">
                        {isEditing ? (
                          <Input value={editEmployeeName} onChange={(e) => setEditEmployeeName(e.target.value)} className="h-7 w-28" />
                        ) : (
                          row.employee_name || "-"
                        )}
                      </td>
                      <td className="p-2">{row.source_subtype || "-"}</td>
                      <td className="p-2 text-right font-mono">
                        {isEditing ? (
                          <Input type="number" min="0" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="ml-auto h-7 w-20 text-right" />
                        ) : (
                          <>{row.qty ?? "-"} {row.uom || ""}</>
                        )}
                      </td>
                      <td className="p-2 text-right font-mono">{row.calc_tco2e?.toFixed(4) ?? "-"}</td>
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
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 sm:hidden">
            {rows.map((row) => {
              const review = row.review_status ? REVIEW_LABEL[row.review_status] : null;
              const isEditing = editingRowId === row.source_id;
              return (
                <div key={row.source_id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {isEditing ? (
                        <Input value={editEmployeeName} onChange={(e) => setEditEmployeeName(e.target.value)} className="h-7 w-28" />
                      ) : (
                        <div className="font-medium">{row.employee_name || "-"}</div>
                      )}
                      <div className="text-xs text-muted-foreground">{row.source_subtype || "-"}</div>
                    </div>
                    {review ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${review.className}`}>{review.label}</span>
                    ) : null}
                  </div>
                  {review?.label && row.review_status === "rejected" && row.review_note && (
                    <div className="mt-1 text-xs text-muted-foreground">{row.review_note}</div>
                  )}
                  <div className="mt-2 flex items-baseline justify-between font-mono text-sm">
                    <span>
                      {isEditing ? (
                        <Input type="number" min="0" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="h-7 w-20" />
                      ) : (
                        <>{row.qty ?? "-"} {row.uom || ""}</>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{row.calc_tco2e?.toFixed(4) ?? "-"} tCO&#8322;e</span>
                  </div>
                  <div className="mt-2 border-t pt-2">{renderActions(row, "start")}</div>
                </div>
              );
            })}
          </div>
        </>
      ))}

      {!noJobMessage && <PortalCategoryHistoryTable fetchUrl="/portal/commuting/history" />}
    </div>
  );
}
