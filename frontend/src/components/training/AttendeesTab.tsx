"use client";

import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, Search, Filter } from "lucide-react";
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
    setShowForm(true);
  }

  function openEdit(b: BookingWithRun) {
    setEditBooking(b);
    setForm({ ...b });
    setSelectedRunId(b.training_course_run_id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditBooking(null);
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
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(b)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
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
    </div>
  );
}
