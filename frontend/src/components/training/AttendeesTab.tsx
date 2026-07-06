"use client";

import { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from "react";
import { Plus, Pencil, Trash2, Search, Filter, Building2, ChevronDown, ArrowLeftRight, BookOpen, UserPlus } from "lucide-react";
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

type SessionAssignTarget = {
  session: TrainingSession;
};

type LearningHistoryTarget = BookingWithRun;

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

function formatDisplayDate(date: string | null | undefined) {
  return date
    ? new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "No date";
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

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function buildBookingSearchText(b: BookingWithRun) {
  return [
    b.person_name,
    b.person_email,
    b.person_phone,
    b.client_name,
    b.client_addr_city,
    b.client_addr_country,
    b.run_name,
    b.source_job_number,
    b.participant_type,
    b.attendance_status,
    b.billing_status,
  ]
    .filter((part) => Boolean(part && String(part).trim()))
    .map((part) => String(part).toLowerCase())
    .join(" ");
}

function parseSessionDateTime(sessionDate: string | null, timeText: string | null, offsetMinutes = 0) {
  if (!sessionDate) return null;
  const base = new Date(`${sessionDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  if (!timeText) {
    if (offsetMinutes !== 0) base.setMinutes(base.getMinutes() + offsetMinutes);
    return base;
  }
  const [hoursText, minutesText, secondsText] = timeText.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText || 0);
  const seconds = Number(secondsText || 0);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  base.setHours(hours, minutes + offsetMinutes, seconds, 0);
  return base;
}

function getSessionRange(session: TrainingSession) {
  const start = parseSessionDateTime(session.session_date, session.start_time);
  const end = parseSessionDateTime(session.session_date, session.end_time);
  if (start && end) return { start, end };
  if (start && !end) return { start, end: new Date(start.getTime() + 60 * 60 * 1000) };
  if (!start && end) return { start: new Date(end.getTime() - 60 * 60 * 1000), end };
  if (session.session_date) {
    const day = parseSessionDateTime(session.session_date, null);
    if (day) return { start: day, end: new Date(day.getTime() + 24 * 60 * 60 * 1000) };
  }
  return null;
}

function sessionsClash(a: TrainingSession, b: TrainingSession) {
  if (a.training_course_session_id === b.training_course_session_id) return false;
  if (!a.session_date || !b.session_date) return false;
  const aStatus = normalizeSearchText(a.status);
  const bStatus = normalizeSearchText(b.status);
  if (aStatus === "completed" || aStatus === "cancelled" || bStatus === "completed" || bStatus === "cancelled") return false;
  const rangeA = getSessionRange(a);
  const rangeB = getSessionRange(b);
  if (!rangeA || !rangeB) return a.session_date === b.session_date;
  return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
}

export default function AttendeesTab({ runs, sessions, baseUrl, onRefresh }: Props) {
  const [search, setSearch] = useState("");
  const [filterRun, setFilterRun] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [showForm, setShowForm] = useState(false);
  const [editBooking, setEditBooking] = useState<BookingWithRun | null>(null);
  const [form, setForm] = useState<Partial<TrainingBooking>>(EMPTY_BOOKING());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  // Reassign state
  const [reassignBooking, setReassignBooking] = useState<BookingWithRun | null>(null);
  const [reassignRunId, setReassignRunId] = useState<string>("");
  const [reassignSessionIds, setReassignSessionIds] = useState<Set<number>>(new Set());
  const [reassigning, setReassigning] = useState(false);
  const [assignTarget, setAssignTarget] = useState<SessionAssignTarget | null>(null);
  const [assignBookingId, setAssignBookingId] = useState<string>("");
  const [assignAttendanceStatus, setAssignAttendanceStatus] = useState<string>("booked");
  const [assigning, setAssigning] = useState(false);
  const [assignSearchName, setAssignSearchName] = useState("");
  const [assignSearchCompany, setAssignSearchCompany] = useState("");
  const [assignSearchCity, setAssignSearchCity] = useState("");
  const [assignSearchCountry, setAssignSearchCountry] = useState("");
  const [historyTarget, setHistoryTarget] = useState<LearningHistoryTarget | null>(null);

  function openReassign(b: BookingWithRun) {
    setReassignBooking(b);
    setReassignRunId("");
    setReassignSessionIds(new Set());
  }

  function openLearningHistory(b: BookingWithRun) {
    setHistoryTarget(b);
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
      toast.success(`${reassignBooking.person_name} moved to a new cohort`);
      setReassignBooking(null);
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setReassigning(false);
    }
  }

  function openAssignToSession(session: TrainingSession) {
    setAssignTarget({ session });
    setAssignBookingId("");
    setAssignAttendanceStatus("booked");
    setAssignSearchName("");
    setAssignSearchCompany("");
    setAssignSearchCity("");
    setAssignSearchCountry("");
  }

  async function submitAssignToSession() {
    if (!assignSession || !assignBookingId) return;
    setAssigning(true);
    try {
      const res = await fetch(`${baseUrl}/training-course-sessions/${assignSession.training_course_session_id}/attendance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              training_booking_id: Number(assignBookingId),
              attendance_status: assignAttendanceStatus,
              attendance_minutes: null,
              notes: null,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Participant assigned to session");
      setAssignTarget(null);
      setAssignBookingId("");
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setAssigning(false);
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
          run_name: run.run_name || run.product_name || `Cohort #${run.training_course_run_id}`,
          run_id: run.training_course_run_id,
        });
      }
    }
    return result;
  }, [runs]);

  const assignSession = assignTarget?.session ?? null;
  const deferredAssignSearchName = useDeferredValue(assignSearchName);
  const deferredAssignSearchCompany = useDeferredValue(assignSearchCompany);
  const deferredAssignSearchCity = useDeferredValue(assignSearchCity);
  const deferredAssignSearchCountry = useDeferredValue(assignSearchCountry);

  const assignCandidateBookings = useMemo(() => {
    const nameQuery = normalizeSearchText(deferredAssignSearchName);
    const companyQuery = normalizeSearchText(deferredAssignSearchCompany);
    const cityQuery = normalizeSearchText(deferredAssignSearchCity);
    const countryQuery = normalizeSearchText(deferredAssignSearchCountry);

    return allBookings.filter((booking) => {
      const searchText = buildBookingSearchText(booking);
      if (nameQuery && !searchText.includes(nameQuery)) return false;
      if (companyQuery && !normalizeSearchText(booking.client_name).includes(companyQuery)) return false;
      if (cityQuery && !normalizeSearchText(booking.client_addr_city).includes(cityQuery)) return false;
      if (countryQuery && !normalizeSearchText(booking.client_addr_country).includes(countryQuery)) return false;
      return true;
    }).slice(0, 100);
  }, [allBookings, deferredAssignSearchCompany, deferredAssignSearchCountry, deferredAssignSearchCity, deferredAssignSearchName]);

  const assignSelectedBooking = useMemo(
    () => allBookings.find((b) => String(b.training_booking_id) === assignBookingId) ?? null,
    [allBookings, assignBookingId],
  );

  const assignSelectedClashes = useMemo(() => {
    if (!assignSession || !assignSelectedBooking) return [];
    return sessions
      .filter((session) => {
        if (session.training_course_session_id === assignSession.training_course_session_id) return false;
        return (session.attendance ?? []).some((attendance) => attendance.training_booking_id === assignSelectedBooking.training_booking_id);
      })
      .filter((session) => sessionsClash(session, assignSession))
      .sort((a, b) => {
        const aDate = a.session_date ?? "";
        const bDate = b.session_date ?? "";
        return aDate.localeCompare(bDate) || (a.start_time ?? "").localeCompare(b.start_time ?? "") || a.training_course_session_id - b.training_course_session_id;
      });
  }, [assignSelectedBooking, assignSession, sessions]);

  const learningHistoryBookings = useMemo(() => {
    if (!historyTarget) return [];
    const email = (historyTarget.person_email ?? "").trim().toLowerCase();
    const name = historyTarget.person_name.trim().toLowerCase();
    const client = (historyTarget.client_name ?? "").trim().toLowerCase();
    return allBookings.filter((b) => {
      const bEmail = (b.person_email ?? "").trim().toLowerCase();
      const bName = b.person_name.trim().toLowerCase();
      const bClient = (b.client_name ?? "").trim().toLowerCase();
      if (email && bEmail && email === bEmail) return true;
      if (!email && bName === name && (!client || bClient === client)) return true;
      if (historyTarget.training_booking_id === b.training_booking_id) return true;
      return false;
    });
  }, [allBookings, historyTarget]);

  const learningHistorySessionItems = useMemo(() => {
    if (!historyTarget) return [];
    const bookingIds = new Set(learningHistoryBookings.map((b) => b.training_booking_id));
    const items: Array<{
      training_course_session_id: number;
      session_title: string;
      session_date: string | null;
      attendance_status: string;
      run_name: string;
      booking_name: string;
    }> = [];
    for (const session of sessions) {
      for (const attendance of session.attendance ?? []) {
        if (!bookingIds.has(attendance.training_booking_id)) continue;
        items.push({
          training_course_session_id: session.training_course_session_id,
          session_title: session.session_title || `Session #${session.training_course_session_id}`,
          session_date: session.session_date,
          attendance_status: attendance.attendance_status,
          run_name: runs.find((r) => r.training_course_run_id === session.training_course_run_id)?.run_name
            || runs.find((r) => r.training_course_run_id === session.training_course_run_id)?.product_name
            || `Cohort #${session.training_course_run_id}`,
          booking_name: attendance.person_name,
        });
      }
    }
    return items.sort((a, b) => (a.session_date ?? "").localeCompare(b.session_date ?? "") || a.session_title.localeCompare(b.session_title));
  }, [historyTarget, learningHistoryBookings, runs, sessions]);

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
    setSelectedClientName(null);
    setContacts([]);
    setClientQuery("");
    setShowForm(true);
  }

  function openEdit(b: BookingWithRun) {
    setEditBooking(b);
    setForm({ ...b });
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
    if (!runId) { toast.error("Select a cohort"); return; }
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
            <SelectValue placeholder="All cohorts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cohorts</SelectItem>
            {runs.map((r) => (
              <SelectItem key={r.training_course_run_id} value={String(r.training_course_run_id)}>
                {r.run_name || r.product_name || `Cohort #${r.training_course_run_id}`}
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
          <div className="border-b px-4 py-3 text-xs text-slate-500">
            Cohort booking statuses are now managed from the Schedule tab. This view is for browsing participant bookings and learning history.
          </div>
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
                    <TableHead>Cohort</TableHead>
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
                        <Badge className={`text-xs ${attendanceColor(b.attendance_status)}`} variant="outline">
                          {formatTrainingBookingStatus(b.attendance_status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${billingColor(b.billing_status)}`} variant="outline">
                          {formatTrainingBillingStatus(b.billing_status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatTrainingParticipantType(b.participant_type)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => openEdit(b)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {sessions.length > 0 && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-600" title="Assign to session" onClick={() => openAssignToSession(sessions.find((s) => s.training_course_run_id === b.training_course_run_id) ?? sessions[0])}>
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-600" title="Learning history" onClick={() => openLearningHistory(b)}>
                            <BookOpen className="h-3.5 w-3.5" />
                          </Button>
                          {runs.length > 1 && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-500" title="Reassign to different cohort" onClick={() => openReassign(b)}>
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
                <Label>Cohort *</Label>
                <Select
                  value={String(form.training_course_run_id ?? "")}
                  onValueChange={(v) => setForm((f) => ({ ...f, training_course_run_id: Number(v) }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select cohort..." /></SelectTrigger>
                  <SelectContent>
                    {runs.map((r) => (
                      <SelectItem key={r.training_course_run_id} value={String(r.training_course_run_id)}>
                        {r.run_name || r.product_name || `Cohort #${r.training_course_run_id}`}
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

      <Dialog open={!!historyTarget} onOpenChange={(o) => !o && setHistoryTarget(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-emerald-600" />
              Learning History
            </DialogTitle>
          </DialogHeader>
          {historyTarget && (
            <div className="space-y-4 py-1">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <div className="font-medium text-slate-900">{historyTarget.person_name}</div>
                <div className="text-xs text-slate-500">
                  {historyTarget.person_email || "No email"}{historyTarget.client_name ? ` · ${historyTarget.client_name}` : ""}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-800">Cohort history</h4>
                    <span className="text-xs text-slate-400">{learningHistoryBookings.length} booking{learningHistoryBookings.length === 1 ? "" : "s"}</span>
                  </div>
                  {learningHistoryBookings.length === 0 ? (
                    <p className="text-xs text-slate-400">No cohort history found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Cohort</TableHead>
                            <TableHead>Booking</TableHead>
                            <TableHead>Attendance</TableHead>
                            <TableHead>Billing</TableHead>
                            <TableHead>Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {learningHistoryBookings.map((b) => (
                            <TableRow key={b.training_booking_id}>
                              <TableCell className="font-medium text-slate-900">{b.run_name}</TableCell>
                              <TableCell className="text-slate-500">#{b.training_booking_id}</TableCell>
                              <TableCell>
                                <Badge className={`text-xs ${attendanceColor(b.attendance_status)}`} variant="outline">
                                  {formatTrainingBookingStatus(b.attendance_status)}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge className={`text-xs ${billingColor(b.billing_status)}`} variant="outline">
                                  {formatTrainingBillingStatus(b.billing_status)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-slate-500">{formatTrainingParticipantType(b.participant_type)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-800">Session history</h4>
                    <span className="text-xs text-slate-400">{learningHistorySessionItems.length} session{learningHistorySessionItems.length === 1 ? "" : "s"}</span>
                  </div>
                  {learningHistorySessionItems.length === 0 ? (
                    <p className="text-xs text-slate-400">No session attendance found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Session</TableHead>
                            <TableHead>Cohort</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {learningHistorySessionItems.map((item) => (
                            <TableRow key={`${item.training_course_session_id}-${item.booking_name}-${item.attendance_status}`}>
                              <TableCell className="font-medium text-slate-900">{item.session_title}</TableCell>
                              <TableCell className="text-slate-500">{item.run_name}</TableCell>
                              <TableCell className="text-slate-500">{formatDisplayDate(item.session_date)}</TableCell>
                              <TableCell>
                                <Badge className={`text-xs ${attendanceColor(item.attendance_status)}`} variant="outline">
                                  {item.attendance_status.replace(/_/g, " ")}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end border-t pt-3">
            <Button variant="outline" onClick={() => setHistoryTarget(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignTarget} onOpenChange={(o) => !o && setAssignTarget(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-emerald-600" />
              Assign Participant to Session
            </DialogTitle>
          </DialogHeader>
          {assignSession && (
            <div className="space-y-4 py-1">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <div className="font-medium text-slate-900">{assignSession.session_title || `Session #${assignSession.training_course_session_id}`}</div>
                <div className="text-xs text-slate-500">
                  {assignSession.session_date
                    ? new Date(assignSession.session_date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                    : "No date"}
                  {assignSession.start_time ? ` · ${assignSession.start_time}` : ""}
                  {assignSession.end_time ? ` - ${assignSession.end_time}` : ""}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <Label>Search name / email</Label>
                  <Input value={assignSearchName} onChange={(e) => setAssignSearchName(e.target.value)} placeholder="Name, email, phone, job #" />
                </div>
                <div>
                  <Label>Company</Label>
                  <Input value={assignSearchCompany} onChange={(e) => setAssignSearchCompany(e.target.value)} placeholder="Company name" />
                </div>
                <div>
                  <Label>Town / City</Label>
                  <Input value={assignSearchCity} onChange={(e) => setAssignSearchCity(e.target.value)} placeholder="Town or city" />
                </div>
                <div>
                  <Label>Country</Label>
                  <Input value={assignSearchCountry} onChange={(e) => setAssignSearchCountry(e.target.value)} placeholder="Country" />
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{assignCandidateBookings.length} matching participant booking{assignCandidateBookings.length === 1 ? "" : "s"}</span>
                <span>Search by participant, company, city, country, email, phone, or job number.</span>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div className="max-h-72 overflow-y-auto">
                  {assignCandidateBookings.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Participant</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Cohort</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignCandidateBookings.map((b) => {
                          const selected = String(b.training_booking_id) === assignBookingId;
                          return (
                            <TableRow
                              key={b.training_booking_id}
                              className={selected ? "bg-emerald-50/60" : "cursor-pointer hover:bg-slate-50"}
                              onClick={() => setAssignBookingId(String(b.training_booking_id))}
                            >
                              <TableCell className="align-top">
                                <div className="font-medium text-slate-900">{b.person_name}</div>
                                <div className="text-xs text-slate-500">
                                  {formatTrainingParticipantType(b.participant_type)} · {formatTrainingBookingStatus(b.attendance_status)}
                                </div>
                              </TableCell>
                              <TableCell className="align-top text-slate-600">
                                <div>{b.client_name || "-"}</div>
                                {b.source_job_number ? <div className="text-xs text-slate-400">Job {b.source_job_number}</div> : null}
                              </TableCell>
                              <TableCell className="align-top text-slate-600">
                                <div>{b.client_addr_city || "-"}</div>
                                <div className="text-xs text-slate-400">{b.client_addr_country || "-"}</div>
                              </TableCell>
                              <TableCell className="align-top text-slate-600">
                                <div className="truncate">{b.person_email || "-"}</div>
                                {b.person_phone ? <div className="text-xs text-slate-400">{b.person_phone}</div> : null}
                              </TableCell>
                              <TableCell className="align-top text-slate-600">
                                <div className="font-medium text-slate-800">{b.run_name}</div>
                                <div className="mt-1 flex flex-wrap gap-2">
                                  <Badge className={`text-xs ${billingColor(b.billing_status)}`} variant="outline">{formatTrainingBillingStatus(b.billing_status)}</Badge>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="px-4 py-6 text-sm text-slate-500">
                      No matches found. Try a broader name, company, city, or country filter.
                    </div>
                  )}
                </div>
              </div>

              {assignSelectedBooking ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">Selected: {assignSelectedBooking.person_name}</div>
                      <div className="text-xs text-slate-500">
                        {assignSelectedBooking.client_name || "No company"}
                        {assignSelectedBooking.client_addr_city ? ` · ${assignSelectedBooking.client_addr_city}` : ""}
                        {assignSelectedBooking.client_addr_country ? ` · ${assignSelectedBooking.client_addr_country}` : ""}
                        {assignSelectedBooking.person_email ? ` · ${assignSelectedBooking.person_email}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={`text-xs ${attendanceColor(assignSelectedBooking.attendance_status)}`} variant="outline">
                        {formatTrainingBookingStatus(assignSelectedBooking.attendance_status)}
                      </Badge>
                      <Badge className={`text-xs ${billingColor(assignSelectedBooking.billing_status)}`} variant="outline">
                        {formatTrainingBillingStatus(assignSelectedBooking.billing_status)}
                      </Badge>
                    </div>
                  </div>

                  {assignSelectedClashes.length > 0 ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <div className="font-medium">Potential clash detected</div>
                      <div className="mt-1 text-amber-800">
                        This participant is already booked on {assignSelectedClashes.length} other active session{assignSelectedClashes.length === 1 ? "" : "s"} that overlap with the selected session.
                      </div>
                      <div className="mt-2 space-y-1">
                        {assignSelectedClashes.map((session) => (
                          <div key={session.training_course_session_id} className="rounded border border-amber-200 bg-white/70 px-2 py-1 text-amber-900">
                            <div className="font-medium">{session.session_title || `Session #${session.training_course_session_id}`}</div>
                            <div className="text-[11px] text-amber-800">
                              {session.session_date ? formatDisplayDate(session.session_date) : "No date"}
                              {session.start_time ? ` · ${session.start_time}` : ""}
                              {session.end_time ? ` - ${session.end_time}` : ""}
                              {session.status ? ` · ${formatTrainingBookingStatus(session.status)}` : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                      No obvious clash found with the selected session.
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  Select a participant from the filtered list above.
                </div>
              )}

              <div>
                <Label>Attendance Status</Label>
                <Select value={assignAttendanceStatus} onValueChange={setAssignAttendanceStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAINING_BOOKING_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="text-xs text-slate-400">
                This creates or updates the selected participant&apos;s attendance record for the session.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button onClick={() => void submitAssignToSession()} disabled={assigning || !assignBookingId || !assignSession}>
              {assigning ? "Assigning..." : "Assign"}
            </Button>
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
                <Label>Move to Cohort</Label>
                <Select value={reassignRunId} onValueChange={(v) => { setReassignRunId(v); setReassignSessionIds(new Set()); }}>
                  <SelectTrigger><SelectValue placeholder="Select a different cohort…" /></SelectTrigger>
                  <SelectContent>
                    {runs
                      .filter((r) => r.training_course_run_id !== reassignBooking.training_course_run_id)
                      .map((r) => (
                        <SelectItem key={r.training_course_run_id} value={String(r.training_course_run_id)}>
                          {r.run_name || r.product_name || `Cohort #${r.training_course_run_id}`}
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
                                  if (e.target.checked) {
                                    next.add(s.training_course_session_id);
                                  } else {
                                    next.delete(s.training_course_session_id);
                                  }
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
                    <p className="mt-1.5 text-xs text-slate-400">Existing attendance records for the old cohort will be removed.</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No sessions in this cohort yet.</p>
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
