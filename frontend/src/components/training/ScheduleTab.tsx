"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Plus, ChevronDown, ChevronRight, Pencil, Trash2, UserPlus, ArrowLeftRight, X, Search, Mail,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  TRAINING_COURSE_RUN_STATUS_OPTIONS,
  TRAINING_DELIVERY_MODE_OPTIONS,
  TRAINING_SESSION_STATUS_OPTIONS,
  TRAINING_BOOKING_STATUS_OPTIONS,
  TRAINING_BILLING_STATUS_OPTIONS,
  TRAINING_ATTENDANCE_STATUS_OPTIONS,
  formatTrainingCourseRunStatus,
  formatTrainingDeliveryMode,
  formatTrainingBillingStatus,
  formatTrainingBookingStatus,
} from "@/lib/training-workflow";
import type { TrainingCourseRun, TrainingProduct, TrainingSession, TrainingSessionStaff } from "./types";
import { STAFF_ROLE_OPTIONS, formatStaffRole } from "./types";
import DocumentsPanel from "./DocumentsPanel";

type BookingRow = {
  training_booking_id: number;
  person_name: string;
  person_email: string | null;
  person_phone: string | null;
  client_name: string | null;
  client_addr_city: string | null;
  client_addr_country: string | null;
  source_job_number: string | null;
  participant_type: string;
  training_course_run_id: number;
  run_name: string;
  billing_status: string;
  attendance_status: string;
};

type Props = {
  jobId: number;
  runs: TrainingCourseRun[];
  products: TrainingProduct[];
  sessions: TrainingSession[];
  baseUrl: string;
  onRefresh: () => void;
  onOpenAutomationTab?: () => void;
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

type ReassignTarget = {
  source_session: TrainingSession;
  source_attendance_id: number;
};

type AssignTarget = {
  session: TrainingSession;
};

type SessionAttendanceRow = NonNullable<TrainingSession["attendance"]>[number];

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

function billingColor(status: string) {
  switch (status) {
    case "paid": return "bg-green-100 text-green-800";
    case "invoiced": return "bg-blue-100 text-blue-800";
    case "included": return "bg-teal-100 text-teal-800";
    case "waived": return "bg-slate-100 text-slate-500";
    default: return "bg-amber-100 text-amber-700";
  }
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function buildBookingSearchText(b: BookingRow) {
  return [
    b.person_name,
    b.person_email,
    b.person_phone,
    b.client_name,
    b.client_addr_city,
    b.client_addr_country,
    b.source_job_number,
    b.participant_type,
    b.attendance_status,
    b.billing_status,
    b.run_name,
  ]
    .filter((part) => Boolean(part && String(part).trim()))
    .map((part) => String(part).toLowerCase())
    .join(" ");
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

export default function ScheduleTab({ jobId, runs, products, sessions, baseUrl, onRefresh, onOpenAutomationTab }: Props) {
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
  const [reassignBooking, setReassignBooking] = useState<ReassignTarget | null>(null);
  const [reassignSelectedAttendanceId, setReassignSelectedAttendanceId] = useState<string>("");
  const [reassignRunId, setReassignRunId] = useState<string>("");
  const [reassignSessionIds, setReassignSessionIds] = useState<Set<number>>(new Set());
  const [reassigning, setReassigning] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState<Set<number>>(new Set());
  const [participantSelection, setParticipantSelection] = useState<Set<number>>(new Set());
  const [emailTargetSession, setEmailTargetSession] = useState<TrainingSession | null>(null);
  const [emailTargetMode, setEmailTargetMode] = useState<"selected" | "all">("selected");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [assignBookingId, setAssignBookingId] = useState<string>("");
  const [assignAttendanceStatus, setAssignAttendanceStatus] = useState<string>("booked");
  const [assigning, setAssigning] = useState(false);
  const [assignSearchName, setAssignSearchName] = useState("");
  const [assignSearchCompany, setAssignSearchCompany] = useState("");
  const [assignSearchCity, setAssignSearchCity] = useState("");
  const [assignSearchCountry, setAssignSearchCountry] = useState("");

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const allBookings = useMemo<BookingRow[]>(() => {
    const result: BookingRow[] = [];
    for (const run of runs) {
      for (const booking of run.bookings) {
        result.push({
          training_booking_id: booking.training_booking_id,
          person_name: booking.person_name,
          person_email: booking.person_email,
          person_phone: booking.person_phone,
          client_name: booking.client_name,
          client_addr_city: booking.client_addr_city,
          client_addr_country: booking.client_addr_country,
          source_job_number: booking.source_job_number,
          participant_type: booking.participant_type,
          training_course_run_id: run.training_course_run_id,
          run_name: run.run_name || run.product_name || `Cohort #${run.training_course_run_id}`,
          billing_status: booking.billing_status,
          attendance_status: booking.attendance_status,
        });
      }
    }
    return result;
  }, [runs]);

  const sessionsForRun = (runId: number) =>
    sessions.filter((s) => s.training_course_run_id === runId).sort((a, b) =>
      (a.session_date ?? "").localeCompare(b.session_date ?? "")
    );

  const reassignTargetRun = runs.find((r) => String(r.training_course_run_id) === reassignRunId) ?? null;
  const reassignTargetSessions = reassignTargetRun
    ? sessionsForRun(reassignTargetRun.training_course_run_id)
    : [];
  const reassignSourceSession = reassignBooking?.source_session ?? null;
  const reassignSourceParticipants = reassignSourceSession?.attendance ?? [];
  const reassignSelectedParticipant = reassignSourceParticipants.find(
    (p) => String(p.training_session_attendance_id) === reassignSelectedAttendanceId
  ) ?? null;
  const assignSession = assignTarget?.session ?? null;
  const assignRunBookings = useMemo(() => {
    if (!assignSession) return [];
    return allBookings.filter((booking) => booking.training_course_run_id === assignSession.training_course_run_id);
  }, [allBookings, assignSession]);

  const deferredAssignSearchName = useDeferredValue(assignSearchName);
  const deferredAssignSearchCompany = useDeferredValue(assignSearchCompany);
  const deferredAssignSearchCity = useDeferredValue(assignSearchCity);
  const deferredAssignSearchCountry = useDeferredValue(assignSearchCountry);

  const assignCandidateBookings = useMemo(() => {
    const nameQuery = normalizeSearchText(deferredAssignSearchName);
    const companyQuery = normalizeSearchText(deferredAssignSearchCompany);
    const cityQuery = normalizeSearchText(deferredAssignSearchCity);
    const countryQuery = normalizeSearchText(deferredAssignSearchCountry);

    return assignRunBookings.filter((booking) => {
      const searchText = buildBookingSearchText(booking);
      if (nameQuery && !searchText.includes(nameQuery)) return false;
      if (companyQuery && !normalizeSearchText(booking.client_name).includes(companyQuery)) return false;
      if (cityQuery && !normalizeSearchText(booking.client_addr_city).includes(cityQuery)) return false;
      if (countryQuery && !normalizeSearchText(booking.client_addr_country).includes(countryQuery)) return false;
      return true;
    }).slice(0, 150);
  }, [assignRunBookings, deferredAssignSearchCompany, deferredAssignSearchCountry, deferredAssignSearchCity, deferredAssignSearchName]);

  const assignSelectedBooking = useMemo(
    () => allBookings.find((booking) => String(booking.training_booking_id) === assignBookingId) ?? null,
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

  const emailRecipients = useMemo(() => {
    if (!emailTargetSession) return [];
    const allRecipients = (emailTargetSession.attendance ?? []).filter((attendance) => strim(attendance.person_email));
    if (emailTargetMode === "all") return allRecipients;
    return allRecipients.filter((attendance) => participantSelection.has(attendance.training_session_attendance_id));
  }, [emailTargetMode, emailTargetSession, participantSelection]);

  function strim(value: string | null | undefined) {
    return String(value ?? "").trim();
  }

  function clearParticipantSelection() {
    setParticipantSelection(new Set());
  }

  function openParticipantEmail(session: TrainingSession, mode: "selected" | "all") {
    setEmailTargetSession(session);
    setEmailTargetMode(mode);
    setEmailSubject(session.session_title ? `Re: ${session.session_title}` : `Training session update`);
    setEmailBody(`Hi,\n\n`);
  }

  function closeParticipantEmail() {
    setEmailTargetSession(null);
    setEmailSubject("");
    setEmailBody("");
    setEmailTargetMode("selected");
  }

  async function sendParticipantEmail() {
    if (!emailTargetSession) return;
    const recipients = emailRecipients.filter((attendance) => strim(attendance.person_email));
    if (recipients.length === 0) {
      toast.error("No participant email addresses selected.");
      return;
    }
    if (!emailSubject.trim()) {
      toast.error("Please add a subject.");
      return;
    }
    if (!emailBody.trim()) {
      toast.error("Please add a message.");
      return;
    }
    setEmailSending(true);
    try {
      const uniqueRecipients = Array.from(
        new Map(recipients.map((attendance) => [strim(attendance.person_email).toLowerCase(), attendance])).values(),
      );
      for (const attendance of uniqueRecipients) {
        const toEmail = strim(attendance.person_email);
        if (!toEmail) continue;
        const fd = new FormData();
        fd.append("to_email", toEmail);
        fd.append("subject", emailSubject.trim());
        fd.append("message_text", emailBody.trim());
        fd.append("cc", JSON.stringify([]));
        fd.append("bcc", JSON.stringify([]));
        fd.append("job_file_ids", JSON.stringify([]));
        const res = await fetch(`${baseUrl}/jobs/${jobId}/communications/email`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Failed to send email to ${toEmail}`);
        }
      }
      toast.success(`Email sent to ${uniqueRecipients.length} participant${uniqueRecipients.length === 1 ? "" : "s"}.`);
      closeParticipantEmail();
      clearParticipantSelection();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setEmailSending(false);
    }
  }

  async function quickUpdateSessionAttendanceStatus(attendance: SessionAttendanceRow, value: string) {
    try {
      const res = await fetch(`${baseUrl}/training-course-sessions/${attendance.training_course_session_id}/attendance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              training_booking_id: attendance.training_booking_id,
              attendance_status: value,
              attendance_minutes: null,
              notes: attendance.notes ?? null,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  async function quickUpdateBookingBilling(attendance: SessionAttendanceRow, value: string) {
    try {
      const runId = sessions.find((s) => s.training_course_session_id === attendance.training_course_session_id)?.training_course_run_id ?? 0;
      const res = await fetch(`${baseUrl}/training-bookings/${attendance.training_booking_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          training_booking_id: attendance.training_booking_id,
          org_id: attendance.org_id,
          training_course_run_id: runId,
          client_db_id: attendance.client_db_id,
          contact_id: attendance.contact_id,
          participant_type: attendance.participant_type,
          booking_source: attendance.booking_source,
          person_name: attendance.person_name,
          person_email: attendance.person_email,
          person_phone: attendance.person_phone,
          billing_status: value,
          attendance_status: attendance.booking_attendance_status,
          special_requirements: attendance.special_requirements,
          consent_status: attendance.consent_status,
          notes: attendance.booking_notes,
          entitlement_id: attendance.entitlement_id,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

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

  function openReassignParticipant(session: TrainingSession, participant: NonNullable<TrainingSession["attendance"]>[number]) {
    setReassignBooking({ source_session: session, source_attendance_id: participant.training_session_attendance_id });
    setReassignSelectedAttendanceId(String(participant.training_session_attendance_id));
    setReassignRunId("");
    setReassignSessionIds(new Set());
  }

  function openReassignFromSession(session: TrainingSession) {
    setReassignBooking({ source_session: session, source_attendance_id: 0 });
    setReassignSelectedAttendanceId("");
    setReassignRunId("");
    setReassignSessionIds(new Set());
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

  async function submitReassign() {
    if (!reassignBooking || !reassignRunId || !reassignSelectedAttendanceId) return;
    setReassigning(true);
    try {
      const res = await fetch(`${baseUrl}/training-session-attendance/${reassignSelectedAttendanceId}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_run_id: Number(reassignRunId),
          session_ids: [...reassignSessionIds],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`${reassignSelectedParticipant?.person_name || "Participant"} moved to a new cohort`);
      setReassignBooking(null);
      setReassignSelectedAttendanceId("");
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setReassigning(false);
    }
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

  function toggleParticipants(sessionId: number) {
    clearParticipantSelection();
    setParticipantsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
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
                    className="h-7 px-2 text-emerald-700"
                    onClick={() => onOpenAutomationTab?.()}
                    disabled={String(run.status).toLowerCase() !== "completed"}
                    title={String(run.status).toLowerCase() !== "completed" ? "Completion pack is available once the cohort is completed" : "Open completion pack tools"}
                  >
                    <Mail className="mr-1 h-3.5 w-3.5" />
                    Completion Pack
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
                    const participantsExpanded = participantsOpen.has(s.training_course_session_id);
                    const selectedIds = new Set(
                      participants
                        .filter((p) => participantSelection.has(p.training_session_attendance_id))
                        .map((p) => p.training_session_attendance_id),
                    );
                    const allParticipantIds = participants.map((p) => p.training_session_attendance_id);
                    const selectedCount = selectedIds.size;
                    const unpaidCount = participants.filter((p) => {
                      const billing = String(p.billing_status || "").toLowerCase();
                      return billing && !["paid", "included", "waived"].includes(billing);
                    }).length;
                    const allSelected = allParticipantIds.length > 0 && selectedCount === allParticipantIds.length;
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
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-emerald-600"
                              onClick={() => openAssignToSession(s)}
                              title="Assign participant to this session"
                            >
                              <UserPlus className="mr-1 h-3.5 w-3.5" />
                              Assign
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-slate-500"
                              onClick={() => toggleParticipants(s.training_course_session_id)}
                              title={participantsExpanded ? "Hide participants" : "View participants"}
                            >
                              {participantsExpanded ? "Hide participants" : "View participants"}
                            </Button>
                            {participants.length > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-blue-600"
                                onClick={() => openReassignFromSession(s)}
                                title="Move a participant from this session"
                              >
                                <ArrowLeftRight className="mr-1 h-3.5 w-3.5" />
                                Move
                              </Button>
                            )}
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
                        {/* Participant panel — full width below session header */}
                        {participantsExpanded && (
                          <div className="border-t border-slate-100 bg-slate-50 p-3 rounded-b-lg">
                            <div className="mb-3 flex w-full flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  <input
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setParticipantSelection((prev) => {
                                          const next = new Set(prev);
                                          participants.forEach((p) => next.add(p.training_session_attendance_id));
                                          return next;
                                        });
                                      } else {
                                        setParticipantSelection((prev) => {
                                          const next = new Set(prev);
                                          participants.forEach((p) => next.delete(p.training_session_attendance_id));
                                          return next;
                                        });
                                      }
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                                  />
                                  Select all
                                </label>
                                <span className="text-xs text-slate-400">
                                  {selectedCount} selected · {participants.length} record{participants.length === 1 ? "" : "s"}
                                  {unpaidCount > 0 ? ` · ${unpaidCount} unpaid` : ""}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  disabled={selectedCount === 0}
                                  onClick={() => openParticipantEmail(s, "selected")}
                                >
                                  <Mail className="mr-1 h-3.5 w-3.5" />
                                  Email selected
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  disabled={participants.length === 0}
                                  onClick={() => openParticipantEmail(s, "all")}
                                >
                                  <Mail className="mr-1 h-3.5 w-3.5" />
                                  Email all
                                </Button>
                              </div>
                            </div>
                            {participants.length === 0 ? (
                              <p className="text-xs text-slate-400">No participants assigned to this session yet.</p>
                            ) : (
                              <div className="max-h-96 overflow-y-auto pr-1">
                                {participants.map((p) => (
                                  <div
                                    key={p.training_session_attendance_id}
                                    className={`grid gap-2 rounded px-2 py-2 text-xs shadow-sm ring-1 ring-slate-100 md:grid-cols-[28px_minmax(0,1.7fr)_120px_120px_auto] ${
                                      String(p.billing_status || "").toLowerCase() === "paid" || String(p.billing_status || "").toLowerCase() === "included" || String(p.billing_status || "").toLowerCase() === "waived"
                                        ? "bg-white"
                                        : "bg-amber-50/80 ring-amber-200"
                                    }`}
                                  >
                                    <label className="flex items-start justify-center pt-0.5">
                                      <input
                                        type="checkbox"
                                        checked={participantSelection.has(p.training_session_attendance_id)}
                                        onChange={(e) => {
                                          setParticipantSelection((prev) => {
                                            const next = new Set(prev);
                                            if (e.target.checked) next.add(p.training_session_attendance_id);
                                            else next.delete(p.training_session_attendance_id);
                                            return next;
                                          });
                                        }}
                                        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                                      />
                                    </label>
                                    <div className="min-w-0">
                                      <div className="font-medium text-slate-800">{p.person_name}</div>
                                      <div className="text-[11px] text-slate-400">
                                        {p.client_name || "No company"}
                                        {p.client_addr_city ? ` · ${p.client_addr_city}` : ""}
                                        {p.client_addr_country ? ` · ${p.client_addr_country}` : ""}
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[10px] uppercase tracking-wide text-slate-400">Booking</span>
                                      <Select
                                        value={p.booking_attendance_status}
                                      onValueChange={(v) => void quickUpdateSessionAttendanceStatus(p, v)}
                                      >
                                        <SelectTrigger className="h-6 w-[110px] border-0 p-0 text-[10px] focus:ring-0">
                                          <Badge className={`text-[10px] ${attendanceColor(p.attendance_status)}`} variant="outline">
                                            {p.attendance_status.replace(/_/g, " ")}
                                          </Badge>
                                        </SelectTrigger>
                                        <SelectContent>
                                          {TRAINING_ATTENDANCE_STATUS_OPTIONS.map((o) => (
                                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[10px] uppercase tracking-wide text-slate-400">Billing</span>
                                      <Select
                                        value={p.billing_status}
                                        onValueChange={(v) => void quickUpdateBookingBilling(p, v)}
                                      >
                                        <SelectTrigger className="h-6 w-[110px] border-0 p-0 text-[10px] focus:ring-0">
                                          <Badge className={`text-[10px] ${billingColor(p.billing_status)}`} variant="outline">
                                            {formatTrainingBillingStatus(p.billing_status)}
                                          </Badge>
                                        </SelectTrigger>
                                        <SelectContent>
                                          {TRAINING_BILLING_STATUS_OPTIONS.map((o) => (
                                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="flex items-center gap-2 justify-self-end">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2 text-emerald-600 hover:text-emerald-700"
                                        onClick={() => {
                                          setParticipantSelection(new Set([p.training_session_attendance_id]));
                                          openParticipantEmail(s, "selected");
                                        }}
                                        title="Email participant"
                                      >
                                        <Mail className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2 text-blue-600 hover:text-blue-700"
                                        onClick={() => openReassignParticipant(s, p)}
                                      >
                                        <ArrowLeftRight className="mr-1 h-3 w-3" />
                                        Move
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
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

      <Dialog open={!!assignTarget} onOpenChange={(o) => !o && setAssignTarget(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-emerald-500" />
              Assign Participant to Session
            </DialogTitle>
          </DialogHeader>
          {assignSession && (
            <div className="space-y-4 py-1">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <div className="font-medium text-slate-900">
                  {assignSession.session_title || `Session #${assignSession.training_course_session_id}`}
                </div>
                <div className="text-xs text-slate-500">
                  {assignSession.session_date ? formatDisplayDate(assignSession.session_date) : "No date"}
                  {assignSession.start_time ? ` · ${assignSession.start_time}` : ""}
                  {assignSession.end_time ? ` - ${assignSession.end_time}` : ""}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Showing participants booked on this cohort only.
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <Label className="flex items-center gap-1.5"><Search className="h-3.5 w-3.5 text-slate-400" /> Search name / email</Label>
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
                                  {b.participant_type.replace(/_/g, " ")} · {formatTrainingBookingStatus(b.attendance_status)}
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
                                  <Badge className="text-xs" variant="outline">
                                    {formatTrainingBillingStatus(b.billing_status)}
                                  </Badge>
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
                        {assignSelectedBooking.person_phone ? ` · ${assignSelectedBooking.person_phone}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={`text-xs ${attendanceColor(assignSelectedBooking.attendance_status)}`} variant="outline">
                        {assignSelectedBooking.attendance_status.replace(/_/g, " ")}
                      </Badge>
                      <Badge className="text-xs" variant="outline">
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
                              {session.status ? ` · ${session.status.replace(/_/g, " ")}` : ""}
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
                This creates or updates the participant’s attendance record for the selected session.
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

      <Dialog open={!!emailTargetSession} onOpenChange={(o) => !o && closeParticipantEmail()}>
        <DialogContent className="max-h-[90vh] w-[min(98vw,1600px)] max-w-none overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-emerald-600" />
              Email Participants
            </DialogTitle>
          </DialogHeader>
          {emailTargetSession && (
            <div className="grid gap-5 py-1 lg:grid-cols-[minmax(0,2fr)_320px]">
              <div className="space-y-4">
                <div className="grid gap-3">
                  <div>
                    <Label>Subject</Label>
                    <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Session update" />
                  </div>
                  <div>
                    <Label>Message</Label>
                    <Textarea rows={12} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder="Write your email..." className="min-h-[18rem]" />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session</div>
                  <div className="mt-2 font-medium text-slate-900">{emailTargetSession.session_title || `Session #${emailTargetSession.training_course_session_id}`}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {emailTargetMode === "all" ? "All participants in this session" : `${emailRecipients.length} selected participant${emailRecipients.length === 1 ? "" : "s"}`}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recipients</div>
                  <div className="flex flex-wrap gap-2">
                    {emailRecipients.length === 0 ? (
                      <span className="text-xs text-slate-400">No selected participants with email addresses.</span>
                    ) : (
                      emailRecipients.map((attendance) => (
                        <Badge key={attendance.training_session_attendance_id} variant="outline" className="text-xs">
                          {attendance.person_name}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={closeParticipantEmail} disabled={emailSending}>Cancel</Button>
            <Button onClick={() => void sendParticipantEmail()} disabled={emailSending || emailRecipients.length === 0}>
              {emailSending ? "Sending..." : "Send email"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                <span className="font-medium">
                  {reassignSelectedParticipant?.person_name || reassignSourceSession?.session_title || "Select participant"}
                </span>
                {reassignSelectedParticipant ? (
                  <span className="ml-2 text-slate-500">
                    currently in {runs.find((r) => r.training_course_run_id === reassignSourceSession?.training_course_run_id)?.run_name || `Cohort #${reassignSourceSession?.training_course_run_id ?? ""}`} / {reassignSourceSession?.session_title || `Session #${reassignSourceSession?.training_course_session_id}`}
                  </span>
                ) : (
                  <span className="ml-2 text-slate-500">choose a participant from this session first</span>
                )}
              </div>

              <div>
                {reassignSourceSession && reassignSourceParticipants.length > 0 && (
                  <div className="mb-3">
                    <Label>Participant</Label>
                    <Select value={reassignSelectedAttendanceId} onValueChange={setReassignSelectedAttendanceId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose participant..." />
                      </SelectTrigger>
                      <SelectContent>
                        {reassignSourceParticipants.map((p) => (
                          <SelectItem key={p.training_session_attendance_id} value={String(p.training_session_attendance_id)}>
                            {p.person_name}{p.client_name ? ` · ${p.client_name}` : ""} · {p.attendance_status.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Label>Move to Cohort</Label>
                <Select
                  value={reassignRunId}
                  onValueChange={(v) => {
                    setReassignRunId(v);
                    setReassignSessionIds(new Set());
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a different cohort..." />
                  </SelectTrigger>
                  <SelectContent>
                    {runs
                      .filter((r) => r.training_course_run_id !== reassignSourceSession?.training_course_run_id)
                      .map((r) => (
                        <SelectItem key={r.training_course_run_id} value={String(r.training_course_run_id)}>
                          {r.run_name || r.product_name || `Cohort #${r.training_course_run_id}`}
                          {r.start_date ? ` · ${new Date(r.start_date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {reassignTargetRun && (
                <div>
                  <Label className="mb-2 block">Move to sessions (optional)</Label>
                  {reassignTargetSessions.length > 0 ? (
                    <div className="space-y-1.5 rounded-lg border border-slate-200 p-2">
                      {reassignTargetSessions.map((s) => {
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
                  ) : (
                    <p className="text-xs text-slate-400">No sessions in this cohort yet.</p>
                  )}
                  <p className="mt-1.5 text-xs text-slate-400">This will move only the selected session attendance row and keep other sessions on the original cohort.</p>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setReassignBooking(null)}>Cancel</Button>
            <Button onClick={() => void submitReassign()} disabled={reassigning || !reassignRunId}>
              {reassigning ? "Moving..." : "Confirm Reassignment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
