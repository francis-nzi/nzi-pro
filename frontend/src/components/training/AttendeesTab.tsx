"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Plus, Pencil, Trash2, Search, Filter, Building2, ChevronDown, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  TRAINING_BOOKING_STATUS_OPTIONS,
  TRAINING_BILLING_STATUS_OPTIONS,
  TRAINING_PARTICIPANT_TYPE_OPTIONS,
  TRAINING_BOOKING_SOURCE_OPTIONS,
  formatTrainingBookingStatus,
  formatTrainingBillingStatus,
  formatTrainingParticipantType,
} from "@/lib/training-workflow";
import type { TrainingBooking, TrainingCourseRun, TrainingSession } from "./types";

type Props = {
  runs: TrainingCourseRun[];
  sessions: TrainingSession[];
  baseUrl: string;
  onRefresh: () => void;
};

function attendanceColor(s: string) {
  switch (s) {
    case "attended": return "bg-green-100 text-green-800";
    case "confirmed": return "bg-blue-100 text-blue-800";
    case "booked": return "bg-slate-100 text-slate-700";
    case "cancelled": return "bg-red-100 text-red-700";
    case "no_show": return "bg-orange-100 text-orange-700";
    case "waitlist": return "bg-purple-100 text-purple-700";
    default: return "bg-slate-100 text-slate-600";
  }
}

function billingColor(s: string) {
  switch (s) {
    case "paid": return "bg-green-100 text-green-800";
    case "invoiced": return "bg-blue-100 text-blue-800";
    case "included": return "bg-teal-100 text-teal-800";
    case "waived": return "bg-slate-100 text-slate-500";
    default: return "bg-amber-100 text-amber-700";
  }
}

const EMPTY_BOOKING = (): Partial<TrainingBooking> => ({
  person_name: "",
  person_email: "",
  person_phone: "",
  participant_type: "external_individual",
  booking_source: "manual",
  billing_status: "pending",
  attendance_status: "booked",
  special_requirements: "",
  notes: "",
  client_db_id: null,
  training_course_run_id: 0,
});

type BookingWithRun = TrainingBooking & { run_name: string; run_id: number };

export default function AttendeesTab({ runs, sessions, baseUrl, onRefresh }: Props) {
  const [search, setSearch] = useState("");
  const [filterRun, setFilterRun] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [showForm, setShowForm] = useState(false);
  const [editBooking, setEditBooking] = useState<BookingWithRun | null>(null);
  const [form, setForm] = useState<Partial<TrainingBooking>>(EMPTY_BOOKING());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  // Reassign state
  const [reassignBooking, setReassignBooking] = useState<BookingWithRun | null>(null);
  const [reassignRunId, setReassignRunId] = useState<string>("");
  const [reassignSessionIds, setReassignSessionIds] = useState<Set<number>>(new Set());
  const [reassigning, setReassigning] = useState(false);

  function openReassign(b: BookingWithRun) {
    setReassignBooking(b);
    setReassignRunId("");
    setReassignSessionIds(new Set());
  }

  const reassignTargetRun = useMemo(
    () => runs.find((r) => String(r.training_course_run_id) === reassignRunId) ?? null,
    [runs, reassignRunId],
  );

  async function submitReassign() {
    if (!reassignBooking || !reassignRunId) return;
    setReassigning(true);
    try {
      const res = await fetch(`${baseUrl}/training-bookings/${reassignBooking.training_booking_id}/reassign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_run_id: Number(reassignRunId),
          session_ids: [...reassignSessionIds],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`${reassignBooking.person_name} moved to new run`);
      setReassignBooking(null);
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setReassigning(false);
    }
  }

  // Client search state
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<{ client_db_id: number; client_name: string }[]>([]);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);
  const [contacts, setContacts] = useState<{ contact_id: number; full_name: string | null; email: string | null; job_title: string | null }[]>([]);
  const clientSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchClients = useCallback(async (q: string) => {
    if (!q.trim()) { setClientResults([]); return; }
    try {
      const res = await fetch(`${baseUrl}/clients?q=${encodeURIComponent(q)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setClientResults((data.items ?? []).map((c: { client_db_id: number; client_name: string }) => ({
          client_db_id: c.client_db_id,
          client_name: c.client_name,
        })));
      }
    } catch { /* silent */ }
  }, [baseUrl]);

  useEffect(() => {
    if (clientSearchRef.current) clearTimeout(clientSearchRef.current);
    clientSearchRef.current = setTimeout(() => { void searchClients(clientQuery); }, 300);
    return () => { if (clientSearchRef.current) clearTimeout(clientSearchRef.current); };
  }, [clientQuery, searchClients]);

  async function selectClient(client: { client_db_id: number; client_name: string }) {
    setSelectedClientName(client.client_name);
    setForm((f) => ({ ...f, client_db_id: client.client_db_id }));
    setClientSearchOpen(false);
    setClientQuery("");
    setClientResults([]);
    setContacts([]);
    try {
      const res = await fetch(`${baseUrl}/clients/${client.client_db_id}/contacts`);
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts ?? []);
      }
    } catch { /* silent */ }
  }

  function clearClient() {
    setSelectedClientName(null);
    setContacts([]);
    setForm((f) => ({ ...f, client_db_id: null }));
  }

  const allBookings = useMemo<BookingWithRun[]>(() => {
    const result: BookingWithRun[] = [];
    for (const run of runs) {
      for (const b of run.bookings) {
        result.push({
          ...b,
          run_name: run.run_name || run.product_name || `Run #${run.training_course_run_id}`,
          run_id: run.training_course_run_id,
        });
      }
    }
    return result;
  }, [runs]);

  const filtered = useMemo(() => {
    return allBookings.filter((b) => {
      if (filterRun !== "all" && String(b.training_course_run_id) !== filterRun) return false;
      if (filterStatus !== "all" && b.attendance_status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !b.person_name.toLowerCase().includes(q) &&
          !(b.person_email ?? "").toLowerCase().includes(q) &&
          !(b.client_name ?? "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [allBookings, search, filterRun, filterStatus]);

  function openCreate() {
    setEditBooking(null);
    setForm({ ...EMPTY_BOOKING(), training_course_run_id: runs[0]?.training_course_run_id ?? 0 });
    setSelectedRunId(runs[0]?.training_course_run_id ?? null);
    setSelectedClientName(null);
    setContacts([]);
    setClientQuery("");
    setShowForm(true);
  }

  function openEdit(b: BookingWithRun) {
    setEditBooking(b);
    setForm({ ...b });
    setSelectedRunId(b.training_course_run_id);
    setSelectedClientName(b.client_name ?? null);
    setContacts([]);
    setClientQuery("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditBooking(null);
    setSelectedClientName(null);
    setContacts([]);
    setClientSearchOpen(false);
  }

  async function save() {
    if (!form.person_name?.trim()) { toast.error("Name is required"); return; }
    const runId = form.training_course_run_id;
    if (!runId) { toast.error("Select a course run"); return; }
    setSaving(true);
    try {
      const url = editBooking
        ? `${baseUrl}/training-bookings/${editBooking.training_booking_id}`
        : `${baseUrl}/training-course-runs/${runId}/bookings`;
      const res = await fetch(url, {
        method: editBooking ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(editBooking ? "Attendee updated" : "Attendee added");
      closeForm();
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteBooking(b: BookingWithRun) {
    if (!confirm(`Remove ${b.person_name} from the course?`)) return;
    setDeleting(b.training_booking_id);
    try {
      const res = await fetch(`${baseUrl}/training-bookings/${b.training_booking_id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Attendee removed");
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setDeleting(null);
    }
  }

  async function quickUpdateStatus(b: BookingWithRun, field: "attendance_status" | "billing_status", value: string) {
    try {
      const res = await fetch(`${baseUrl}/training-bookings/${b.training_booking_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...b, [field]: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-8"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterRun} onValueChange={setFilterRun}>
          <SelectTrigger className="w-[180px]">
            <Filter className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
            <SelectValue placeholder="All runs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All runs</SelectItem>
            {runs.map((r) => (
              <SelectItem key={r.training_course_run_id} value={String(r.training_course_run_id)}>
                {r.run_name || r.product_name || `Run #${r.training_course_run_id}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {TRAINING_BOOKING_STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" /> Add Attendee
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {allBookings.length === 0 ? "No attendees booked yet." : "No attendees match your filters."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Run</TableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => (
                    <TableRow key={b.training_booking_id}>
                      <TableCell className="font-medium text-sm">
                        <div>{b.person_name}</div>
                        {b.client_name && <div className="text-xs text-slate-400">{b.client_name}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">{b.person_email ?? "—"}</TableCell>
                      <TableCell className="text-xs text-slate-600 max-w-[130px] truncate">{b.run_name}</TableCell>
                      <TableCell>
                        <Select
                          value={b.attendance_status}
                          onValueChange={(v) => quickUpdateStatus(b, "attendance_status", v)}
                        >
                          <SelectTrigger className="h-6 w-[110px] border-0 p-0 text-xs focus:ring-0">
                            <Badge className={`text-xs ${attendanceColor(b.attendance_status)}`} variant="outline">
                              {formatTrainingBookingStatus(b.attendance_status)}
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {TRAINING_BOOKING_STATUS_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={b.billing_status}
                          onValueChange={(v) => quickUpdateStatus(b, "billing_status", v)}
                        >
                          <SelectTrigger className="h-6 w-[90px] border-0 p-0 text-xs focus:ring-0">
                            <Badge className={`text-xs ${billingColor(b.billing_status)}`} variant="outline">
                              {formatTrainingBillingStatus(b.billing_status)}
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {TRAINING_BILLING_STATUS_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatTrainingParticipantType(b.participant_type)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => openEdit(b)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {runs.length > 1 && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-500" title="Reassign to different run" onClick={() => openReassign(b)}>
                              <ArrowLeftRight className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-red-400"
                            onClick={() => deleteBooking(b)}
                            disabled={deleting === b.training_booking_id}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-400">{filtered.length} of {allBookings.length} attendees</p>

      {/* Add/Edit dialog */}
      <Dialog open={showForm} onOpenChange={(o) => !o && closeForm()}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editBooking ? `Edit: ${editBooking.person_name}` : "Add Attendee"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {!editBooking && (
              <div className="col-span-2">
                <Label>Course Run *</Label>
                <Select
                  value={String(form.training_course_run_id ?? "")}
                  onValueChange={(v) => setForm((f) => ({ ...f, training_course_run_id: Number(v) }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select run..." /></SelectTrigger>
                  <SelectContent>
                    {runs.map((r) => (
                      <SelectItem key={r.training_course_run_id} value={String(r.training_course_run_id)}>
                        {r.run_name || r.product_name || `Run #${r.training_course_run_id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* Client company search */}
            <div className="col-span-2">
              <Label className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-slate-400" /> Client Company</Label>
              {selectedClientName ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <span className="flex-1 text-sm font-medium text-emerald-800">{selectedClientName}</span>
                  <button type="button" onClick={clearClient} className="text-xs text-slate-400 hover:text-red-500">Clear</button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Search client companies…"
                    value={clientQuery}
                    onChange={(e) => { setClientQuery(e.target.value); setClientSearchOpen(true); }}
                    onFocus={() => setClientSearchOpen(true)}
                    onBlur={() => setTimeout(() => setClientSearchOpen(false), 200)}
                  />
                  {clientSearchOpen && clientResults.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
                      {clientResults.map((c) => (
                        <button
                          key={c.client_db_id}
                          type="button"
                          onMouseDown={() => selectClient(c)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          {c.client_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Contact picker */}
            {contacts.length > 0 && (
              <div className="col-span-2">
                <Label>Select Contact (optional)</Label>
                <div className="relative">
                  <select
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    defaultValue=""
                    onChange={(e) => {
                      const c = contacts.find((c) => String(c.contact_id) === e.target.value);
                      if (c) setForm((f) => ({
                        ...f,
                        person_name: c.full_name ?? f.person_name,
                        person_email: c.email ?? f.person_email,
                      }));
                    }}
                  >
                    <option value="">— pick a contact to auto-fill —</option>
                    {contacts.map((c) => (
                      <option key={c.contact_id} value={String(c.contact_id)}>
                        {c.full_name ?? "(no name)"}{c.job_title ? ` · ${c.job_title}` : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>
            )}

            <div className="col-span-2">
              <Label>Full Name *</Label>
              <Input value={form.person_name ?? ""} onChange={(e) => setForm((f) => ({ ...f, person_name: e.target.value }))} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.person_email ?? ""} onChange={(e) => setForm((f) => ({ ...f, person_email: e.target.value || null }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.person_phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, person_phone: e.target.value || null }))} />
            </div>
            <div>
              <Label>Participant Type</Label>
              <Select value={form.participant_type ?? "external_individual"} onValueChange={(v) => setForm((f) => ({ ...f, participant_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAINING_PARTICIPANT_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Booking Source</Label>
              <Select value={form.booking_source ?? "manual"} onValueChange={(v) => setForm((f) => ({ ...f, booking_source: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAINING_BOOKING_SOURCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Attendance Status</Label>
              <Select value={form.attendance_status ?? "booked"} onValueChange={(v) => setForm((f) => ({ ...f, attendance_status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAINING_BOOKING_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Billing Status</Label>
              <Select value={form.billing_status ?? "pending"} onValueChange={(v) => setForm((f) => ({ ...f, billing_status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAINING_BILLING_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Special Requirements / Dietary</Label>
              <Textarea rows={2} value={form.special_requirements ?? ""} onChange={(e) => setForm((f) => ({ ...f, special_requirements: e.target.value || null }))} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editBooking ? "Save Changes" : "Add Attendee"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reassign dialog */}
      <Dialog open={!!reassignBooking} onOpenChange={(o) => !o && setReassignBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-blue-500" />
              Reassign Participant
            </DialogTitle>
          </DialogHeader>
          {reassignBooking && (
            <div className="space-y-4 py-1">
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium">{reassignBooking.person_name}</span>
                <span className="ml-2 text-slate-500">currently in: {reassignBooking.run_name}</span>
              </div>

              <div>
                <Label>Move to Run</Label>
                <Select value={reassignRunId} onValueChange={(v) => { setReassignRunId(v); setReassignSessionIds(new Set()); }}>
                  <SelectTrigger><SelectValue placeholder="Select a different run…" /></SelectTrigger>
                  <SelectContent>
                    {runs
                      .filter((r) => r.training_course_run_id !== reassignBooking.training_course_run_id)
                      .map((r) => (
                        <SelectItem key={r.training_course_run_id} value={String(r.training_course_run_id)}>
                          {r.run_name || r.product_name || `Run #${r.training_course_run_id}`}
                          {r.start_date ? ` · ${new Date(r.start_date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {reassignTargetRun && (() => {
                const runSessions = sessions.filter((s) => s.training_course_run_id === reassignTargetRun.training_course_run_id);
                return runSessions.length > 0 ? (
                  <div>
                    <Label className="mb-2 block">Enrol in sessions (optional)</Label>
                    <div className="space-y-1.5 rounded-lg border border-slate-200 p-2">
                      {runSessions.map((s) => {
                        const checked = reassignSessionIds.has(s.training_course_session_id);
                        return (
                          <label key={s.training_course_session_id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                            <input
                              type="checkbox"
                              className="accent-emerald-600"
                              checked={checked}
                              onChange={(e) => {
                                setReassignSessionIds((prev) => {
                                  const next = new Set(prev);
                                  e.target.checked ? next.add(s.training_course_session_id) : next.delete(s.training_course_session_id);
                                  return next;
                                });
                              }}
                            />
                            <span className="font-medium">
                              {s.session_date
                                ? new Date(s.session_date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                                : "TBC"}
                            </span>
                            {s.session_title && <span className="text-slate-600">{s.session_title}</span>}
                            {s.start_time && <span className="ml-auto text-xs text-slate-400">{s.start_time.slice(0, 5)}{s.end_time ? `–${s.end_time.slice(0, 5)}` : ""}</span>}
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">Existing attendance records for the old run will be removed.</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No sessions in this run yet.</p>
                );
              })()}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setReassignBooking(null)}>Cancel</Button>
            <Button onClick={submitReassign} disabled={reassigning || !reassignRunId}>
              {reassigning ? "Moving…" : "Confirm Reassignment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
