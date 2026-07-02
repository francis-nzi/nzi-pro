"use client";

import { useState, useEffect } from "react";
import {
  Plus, ChevronDown, ChevronRight, Pencil, Trash2, UserPlus, X,
  MapPin, Video, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  TRAINING_COURSE_RUN_STATUS_OPTIONS,
  TRAINING_DELIVERY_MODE_OPTIONS,
  TRAINING_SESSION_STATUS_OPTIONS,
  formatTrainingCourseRunStatus,
  formatTrainingDeliveryMode,
} from "@/lib/training-workflow";
import type { TrainingCourseRun, TrainingProduct, TrainingSession, TrainingSessionStaff } from "./types";
import { STAFF_ROLE_OPTIONS, formatStaffRole } from "./types";
import DocumentsPanel from "./DocumentsPanel";

type Props = {
  jobId: number;
  runs: TrainingCourseRun[];
  products: TrainingProduct[];
  sessions: TrainingSession[];
  baseUrl: string;
  onRefresh: () => void;
};

const EMPTY_RUN = () => ({
  training_product_id: null as number | null,
  run_name: "",
  course_code: "",
  delivery_mode: "",
  capacity: "" as string | number,
  min_attendees: "" as string | number,
  status: "draft",
  start_date: "",
  end_date: "",
  venue_name: "",
  venue_address: "",
  online_meeting_url: "",
  notes: "",
});

const EMPTY_SESSION = () => ({
  session_title: "",
  session_date: "",
  start_time: "",
  end_time: "",
  session_hours: "" as string | number,
  delivery_mode: "",
  venue_name: "",
  notes: "",
  status: "scheduled",
});

const EMPTY_STAFF = () => ({
  staff_name: "",
  staff_email: "",
  staff_role: "trainer",
  staff_title: "",
  notes: "",
});

function runStatusColor(s: string) {
  switch (s) {
    case "open": return "bg-green-100 text-green-800";
    case "in_progress": return "bg-blue-100 text-blue-800";
    case "completed": return "bg-slate-100 text-slate-700";
    case "cancelled": return "bg-red-100 text-red-800";
    case "full": return "bg-amber-100 text-amber-800";
    default: return "bg-purple-100 text-purple-800";
  }
}

function attendanceColor(status: string) {
  switch (status) {
    case "attended": return "bg-green-100 text-green-800";
    case "confirmed": return "bg-blue-100 text-blue-800";
    case "booked": return "bg-slate-100 text-slate-700";
    case "cancelled": return "bg-red-100 text-red-700";
    case "no_show": return "bg-orange-100 text-orange-700";
    case "waitlist": return "bg-purple-100 text-purple-700";
    default: return "bg-slate-100 text-slate-600";
  }
}

export default function ScheduleTab({ jobId, runs, products, sessions, baseUrl, onRefresh }: Props) {
  const [expandedRun, setExpandedRun] = useState<number | null>(runs[0]?.training_course_run_id ?? null);
  const [showRunForm, setShowRunForm] = useState(false);
  const [editRun, setEditRun] = useState<TrainingCourseRun | null>(null);
  const [runForm, setRunForm] = useState(EMPTY_RUN());

  const [showSessionForm, setShowSessionForm] = useState<number | null>(null);
  const [editSession, setEditSession] = useState<TrainingSession | null>(null);
  const [sessionForm, setSessionForm] = useState(EMPTY_SESSION());

  const [staffBySession, setStaffBySession] = useState<Record<number, TrainingSessionStaff[]>>({});
  const [showStaffForm, setShowStaffForm] = useState<number | null>(null);
  const [staffForm, setStaffForm] = useState(EMPTY_STAFF());
  const [editStaff, setEditStaff] = useState<TrainingSessionStaff | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const sessionsForRun = (runId: number) =>
    sessions.filter((s) => s.training_course_run_id === runId).sort((a, b) =>
      (a.session_date ?? "").localeCompare(b.session_date ?? "")
    );

  async function loadStaff(sessionId: number) {
    try {
      const res = await fetch(`${baseUrl}/training-course-sessions/${sessionId}/staff`);
      if (res.ok) {
        const data = await res.json();
        setStaffBySession((prev) => ({ ...prev, [sessionId]: data.items ?? [] }));
      }
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (expandedRun) {
      sessionsForRun(expandedRun).forEach((s) => loadStaff(s.training_course_session_id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedRun, sessions]);

  // ── Run CRUD ──────────────────────────────────────────────────────────────

  function openCreateRun() {
    setEditRun(null);
    setRunForm(EMPTY_RUN());
    setShowRunForm(true);
  }

  function openEditRun(run: TrainingCourseRun) {
    setEditRun(run);
    setRunForm({
      training_product_id: run.training_product_id,
      run_name: run.run_name ?? "",
      course_code: run.course_code ?? "",
      delivery_mode: run.delivery_mode ?? "",
      capacity: run.capacity ?? "",
      min_attendees: run.min_attendees ?? "",
      status: run.status,
      start_date: run.start_date ?? "",
      end_date: run.end_date ?? "",
      venue_name: run.venue_name ?? "",
      venue_address: run.venue_address ?? "",
      online_meeting_url: run.online_meeting_url ?? "",
      notes: run.notes ?? "",
    });
    setShowRunForm(true);
  }

  async function saveRun() {
    setSaving(true);
    try {
      const url = editRun
        ? `${baseUrl}/training-course-runs/${editRun.training_course_run_id}`
        : `${baseUrl}/jobs/${jobId}/training-course-runs`;
      const res = await fetch(url, {
        method: editRun ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...runForm,
          capacity: runForm.capacity === "" ? null : Number(runForm.capacity),
          min_attendees: runForm.min_attendees === "" ? null : Number(runForm.min_attendees),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(editRun ? "Cohort updated" : "Cohort created");
      setShowRunForm(false);
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRun(run: TrainingCourseRun) {
    if (!confirm(`Delete cohort "${run.run_name || run.product_name || "this cohort"}"?`)) return;
    setDeleting(`run-${run.training_course_run_id}`);
    try {
      const res = await fetch(`${baseUrl}/training-course-runs/${run.training_course_run_id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "Delete failed");
      }
      toast.success("Cohort deleted");
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setDeleting(null);
    }
  }

  // ── Session CRUD ──────────────────────────────────────────────────────────

  function openCreateSession(runId: number) {
    setEditSession(null);
    setSessionForm(EMPTY_SESSION());
    setShowSessionForm(runId);
  }

  function openEditSession(s: TrainingSession) {
    setEditSession(s);
    setSessionForm({
      session_title: s.session_title ?? "",
      session_date: s.session_date ?? "",
      start_time: s.start_time?.slice(0, 5) ?? "",
      end_time: s.end_time?.slice(0, 5) ?? "",
      session_hours: s.session_hours ?? "",
      delivery_mode: s.delivery_mode ?? "",
      venue_name: s.venue_name ?? "",
      notes: s.notes ?? "",
      status: s.status,
    });
    setShowSessionForm(s.training_course_run_id);
  }

  async function saveSession() {
    if (!showSessionForm) return;
    setSaving(true);
    try {
      const url = editSession
        ? `${baseUrl}/training-course-sessions/${editSession.training_course_session_id}`
        : `${baseUrl}/training-course-runs/${showSessionForm}/sessions`;
      const res = await fetch(url, {
        method: editSession ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sessionForm,
          session_hours: sessionForm.session_hours === "" ? null : Number(sessionForm.session_hours),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(editSession ? "Session updated" : "Session added");
      setShowSessionForm(null);
      setEditSession(null);
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSession(s: TrainingSession) {
    if (!confirm("Delete this session?")) return;
    setDeleting(`session-${s.training_course_session_id}`);
    try {
      const res = await fetch(`${baseUrl}/training-course-sessions/${s.training_course_session_id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Session deleted");
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setDeleting(null);
    }
  }

  // ── Staff CRUD ────────────────────────────────────────────────────────────

  function openAddStaff(sessionId: number) {
    setEditStaff(null);
    setStaffForm(EMPTY_STAFF());
    setShowStaffForm(sessionId);
  }

  function openEditStaff(staff: TrainingSessionStaff) {
    setEditStaff(staff);
    setStaffForm({
      staff_name: staff.staff_name,
      staff_email: staff.staff_email ?? "",
      staff_role: staff.staff_role,
      staff_title: staff.staff_title ?? "",
      notes: staff.notes ?? "",
    });
    setShowStaffForm(staff.training_course_session_id);
  }

  async function saveStaff() {
    if (!showStaffForm) return;
    if (!staffForm.staff_name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const url = editStaff
        ? `${baseUrl}/training-session-staff/${editStaff.training_session_staff_id}`
        : `${baseUrl}/training-course-sessions/${showStaffForm}/staff`;
      const res = await fetch(url, {
        method: editStaff ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(staffForm),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(editStaff ? "Staff updated" : "Staff added");
      setShowStaffForm(null);
      setEditStaff(null);
      await loadStaff(showStaffForm);
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteStaff(staff: TrainingSessionStaff) {
    if (!confirm(`Remove ${staff.staff_name}?`)) return;
    setDeleting(`staff-${staff.training_session_staff_id}`);
    try {
      const res = await fetch(`${baseUrl}/training-session-staff/${staff.training_session_staff_id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Staff removed");
      await loadStaff(staff.training_course_session_id);
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Cohorts & Sessions</h3>
        <Button size="sm" onClick={openCreateRun}>
          <Plus className="mr-1 h-4 w-4" /> New Cohort
        </Button>
      </div>

      {runs.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No cohorts yet. Create the first one above.
          </CardContent>
        </Card>
      )}

      {runs.map((run) => {
        const isExpanded = expandedRun === run.training_course_run_id;
        const runSessions = sessionsForRun(run.training_course_run_id);

        return (
          <Card key={run.training_course_run_id} className="overflow-hidden">
            {/* Run header */}
            <CardHeader className="p-0">
              <div
                className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50"
                onClick={() => setExpandedRun(isExpanded ? null : run.training_course_run_id)}
              >
                <div className="text-slate-400">
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900">
                      {run.run_name || run.product_name || `Cohort #${run.training_course_run_id}`}
                    </span>
                    <Badge className={`text-xs ${runStatusColor(run.status)}`} variant="outline">
                      {formatTrainingCourseRunStatus(run.status)}
                    </Badge>
                    {run.start_date && (
                      <span className="text-xs text-slate-500">
                        {new Date(run.start_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {run.end_date && run.end_date !== run.start_date &&
                          ` – ${new Date(run.end_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {run.booking_count} enrolled{run.capacity ? ` / ${run.capacity} capacity` : ""}
                    {run.delivery_mode ? ` · ${formatTrainingDeliveryMode(run.delivery_mode)}` : ""}
                    {runSessions.length > 0 ? ` · ${runSessions.length} session${runSessions.length > 1 ? "s" : ""}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditRun(run)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-red-500"
                    onClick={() => deleteRun(run)}
                    disabled={deleting === `run-${run.training_course_run_id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="border-t bg-slate-50/50 p-4">
                {/* Cohort details summary */}
                <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-3">
                  {run.venue_name && (
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" />{run.venue_name}</span>
                  )}
                  {run.online_meeting_url && (
                    <span className="flex items-center gap-1"><Video className="h-3 w-3 text-slate-400" />Online meeting set</span>
                  )}
                  {run.total_hours && (
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-slate-400" />{run.total_hours}h total</span>
                  )}
                  {run.course_code && <span>Code: {run.course_code}</span>}
                </div>

                {/* Sessions */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions</p>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCreateSession(run.training_course_run_id)}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add Session
                    </Button>
                  </div>

                  {runSessions.length === 0 && (
                    <p className="text-xs text-slate-400">No sessions yet.</p>
                  )}

                  {runSessions.map((s) => {
                    const staff = staffBySession[s.training_course_session_id] ?? [];
                    const participants = s.attendance ?? [];
                    return (
                      <div key={s.training_course_session_id} className="rounded-lg border border-slate-200 bg-white">
                        <div className="flex items-start gap-3 p-3">
                          {/* Date badge */}
                          <div className="min-w-[48px] rounded bg-purple-50 px-1.5 py-1 text-center">
                            <p className="text-xs font-bold text-purple-700">
                              {s.session_date
                                ? new Date(s.session_date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                                : "TBC"}
                            </p>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-800">
                              {s.session_title || `Session ${new Date(s.session_date ?? "").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) || ""}`}
                            </p>
                            <p className="text-xs text-slate-500">
                              {s.start_time ? s.start_time.slice(0, 5) : ""}
                              {s.end_time ? `–${s.end_time.slice(0, 5)}` : ""}
                              {s.session_hours ? ` · ${s.session_hours}h` : ""}
                              {s.venue_name ? ` · ${s.venue_name}` : ""}
                            </p>
                            <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Participants</p>
                                <span className="text-xs text-slate-400">
                                  {participants.length} record{participants.length === 1 ? "" : "s"}
                                </span>
                              </div>
                              {participants.length === 0 ? (
                                <p className="text-xs text-slate-400">No participants assigned to this session yet.</p>
                              ) : (
                                <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                                  {participants.map((p) => (
                                    <div
                                      key={p.training_session_attendance_id}
                                      className="flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1 text-xs shadow-sm ring-1 ring-slate-100"
                                    >
                                      <span className="font-medium text-slate-800">{p.person_name}</span>
                                      {p.client_name && <span className="text-slate-400">({p.client_name})</span>}
                                      <Badge className={`text-[10px] ${attendanceColor(p.attendance_status)}`} variant="outline">
                                        {p.attendance_status.replace(/_/g, " ")}
                                      </Badge>
                                      {p.participant_type && (
                                        <span className="text-slate-400">{p.participant_type.replace(/_/g, " ")}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Staff pills */}
                            {staff.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {staff.map((st) => (
                                  <div
                                    key={st.training_session_staff_id}
                                    className="group flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800"
                                  >
                                    <button onClick={() => openEditStaff(st)} className="hover:underline">
                                      {st.staff_name}
                                    </button>
                                    <span className="text-blue-400">·</span>
                                    <span className="text-blue-500">{formatStaffRole(st.staff_role)}</span>
                                    <button
                                      className="ml-0.5 text-blue-300 opacity-0 group-hover:opacity-100 hover:text-red-500"
                                      onClick={() => deleteStaff(st)}
                                      disabled={deleting === `staff-${st.training_session_staff_id}`}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="text-xs text-slate-400">{s.attendance_count} enrolled</span>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-500" title="Add trainer/staff" onClick={() => openAddStaff(s.training_course_session_id)}>
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditSession(s)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-400"
                              onClick={() => deleteSession(s)}
                              disabled={deleting === `session-${s.training_course_session_id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Cohort-level documents */}
                <div className="border-t border-slate-100 pt-4 mt-4">
                  <DocumentsPanel
                    targetType="run"
                    targetId={run.training_course_run_id}
                    baseUrl={baseUrl}
                    title="Cohort Documents"
                  />
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}

      {/* Cohort form dialog */}
      <Dialog open={showRunForm} onOpenChange={(o) => !o && setShowRunForm(false)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRun ? "Edit Cohort" : "New Cohort"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label>Course / Product</Label>
              <Select
                value={String(runForm.training_product_id ?? "")}
                onValueChange={(v) => setRunForm((f) => ({ ...f, training_product_id: v ? Number(v) : null }))}
              >
                <SelectTrigger><SelectValue placeholder="Select course..." /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.training_product_id} value={String(p.training_product_id)}>{p.product_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Cohort Name</Label>
              <Input value={runForm.run_name} onChange={(e) => setRunForm((f) => ({ ...f, run_name: e.target.value }))} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={runForm.status} onValueChange={(v) => setRunForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAINING_COURSE_RUN_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Delivery Mode</Label>
              <Select value={runForm.delivery_mode} onValueChange={(v) => setRunForm((f) => ({ ...f, delivery_mode: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {TRAINING_DELIVERY_MODE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={runForm.start_date} onChange={(e) => setRunForm((f) => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <Label>End Date</Label>
              <Input type="date" value={runForm.end_date} onChange={(e) => setRunForm((f) => ({ ...f, end_date: e.target.value }))} />
            </div>
            <div>
              <Label>Capacity</Label>
              <Input type="number" value={runForm.capacity} onChange={(e) => setRunForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div>
              <Label>Min Attendees</Label>
              <Input type="number" value={runForm.min_attendees} onChange={(e) => setRunForm((f) => ({ ...f, min_attendees: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Venue Name</Label>
              <Input value={runForm.venue_name} onChange={(e) => setRunForm((f) => ({ ...f, venue_name: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Venue Address</Label>
              <Textarea rows={2} value={runForm.venue_address} onChange={(e) => setRunForm((f) => ({ ...f, venue_address: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Online Meeting URL</Label>
              <Input type="url" value={runForm.online_meeting_url} onChange={(e) => setRunForm((f) => ({ ...f, online_meeting_url: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={runForm.notes} onChange={(e) => setRunForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setShowRunForm(false)}>Cancel</Button>
            <Button onClick={saveRun} disabled={saving}>{saving ? "Saving…" : editRun ? "Save" : "Create Cohort"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Session form dialog */}
      <Dialog open={showSessionForm !== null} onOpenChange={(o) => !o && (setShowSessionForm(null), setEditSession(null))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSession ? "Edit Session" : "Add Session"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label>Session Title</Label>
              <Input value={sessionForm.session_title} onChange={(e) => setSessionForm((f) => ({ ...f, session_title: e.target.value }))} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={sessionForm.session_date} onChange={(e) => setSessionForm((f) => ({ ...f, session_date: e.target.value }))} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={sessionForm.status} onValueChange={(v) => setSessionForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAINING_SESSION_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Start Time</Label>
              <Input type="time" value={sessionForm.start_time} onChange={(e) => setSessionForm((f) => ({ ...f, start_time: e.target.value }))} />
            </div>
            <div>
              <Label>End Time</Label>
              <Input type="time" value={sessionForm.end_time} onChange={(e) => setSessionForm((f) => ({ ...f, end_time: e.target.value }))} />
            </div>
            <div>
              <Label>Hours</Label>
              <Input type="number" step="0.5" value={sessionForm.session_hours} onChange={(e) => setSessionForm((f) => ({ ...f, session_hours: e.target.value }))} />
            </div>
            <div>
              <Label>Delivery Mode</Label>
              <Select value={sessionForm.delivery_mode} onValueChange={(v) => setSessionForm((f) => ({ ...f, delivery_mode: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {TRAINING_DELIVERY_MODE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Venue</Label>
              <Input value={sessionForm.venue_name} onChange={(e) => setSessionForm((f) => ({ ...f, venue_name: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={sessionForm.notes} onChange={(e) => setSessionForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => { setShowSessionForm(null); setEditSession(null); }}>Cancel</Button>
            <Button onClick={saveSession} disabled={saving}>{saving ? "Saving…" : editSession ? "Save" : "Add Session"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Staff form dialog */}
      <Dialog open={showStaffForm !== null} onOpenChange={(o) => !o && (setShowStaffForm(null), setEditStaff(null))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editStaff ? "Edit Staff / Trainer" : "Add Trainer / Staff"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label>Name *</Label>
              <Input value={staffForm.staff_name} onChange={(e) => setStaffForm((f) => ({ ...f, staff_name: e.target.value }))} />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={staffForm.staff_role} onValueChange={(v) => setStaffForm((f) => ({ ...f, staff_role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAFF_ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title / Credentials</Label>
              <Input placeholder="e.g. MSc, IEMA" value={staffForm.staff_title} onChange={(e) => setStaffForm((f) => ({ ...f, staff_title: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Email</Label>
              <Input type="email" value={staffForm.staff_email} onChange={(e) => setStaffForm((f) => ({ ...f, staff_email: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={staffForm.notes} onChange={(e) => setStaffForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => { setShowStaffForm(null); setEditStaff(null); }}>Cancel</Button>
            <Button onClick={saveStaff} disabled={saving}>{saving ? "Saving…" : editStaff ? "Save" : "Add"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
