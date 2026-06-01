"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  formatTrainingBookingSource,
  formatTrainingBookingStatus,
  formatTrainingBillingStatus,
  formatTrainingCourseRunStatus,
  formatTrainingDeliveryMode,
  formatTrainingEntitlementStatus,
  formatTrainingParticipantType,
  TRAINING_BILLING_STATUS_OPTIONS,
  TRAINING_BOOKING_SOURCE_OPTIONS,
  TRAINING_BOOKING_STATUS_OPTIONS,
  TRAINING_COURSE_RUN_STATUS_OPTIONS,
  TRAINING_DELIVERY_MODE_OPTIONS,
  TRAINING_ENTITLEMENT_STATUS_OPTIONS,
  TRAINING_SESSION_STATUS_OPTIONS,
  TRAINING_ATTENDANCE_STATUS_OPTIONS,
  TRAINING_PARTICIPANT_TYPE_OPTIONS,
} from "@/lib/training-workflow";

type JobTrainingProps = {
  jobId: number;
  baseUrl: string;
  jobFamily?: string | null;
};

type TrainingDetails = {
  job_id: number | null;
  training_date: string | null;
  delivery_format: string | null;
  topic: string | null;
  audience: string | null;
  attendee_count: number | null;
  session_duration_hours: number | null;
  materials_link: string | null;
  location: string | null;
  notes: string | null;
};

type TrainingProduct = {
  training_product_id: number;
  org_id: string;
  product_code: string | null;
  product_name: string;
  description: string | null;
  default_hours: number | null;
  default_delivery_mode: string | null;
  default_capacity: number | null;
  default_min_attendees: number | null;
  certificate_policy: string | null;
  default_documents_json: string | null;
  is_active: boolean;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

type TrainingBooking = {
  training_booking_id: number;
  org_id: string;
  training_course_run_id: number;
  client_db_id: number | null;
  contact_id: number | null;
  participant_type: string;
  booking_source: string;
  person_name: string;
  person_email: string | null;
  person_phone: string | null;
  billing_status: string;
  attendance_status: string;
  special_requirements: string | null;
  consent_status: string;
  notes: string | null;
  entitlement_id: number | null;
  client_name: string | null;
  source_job_number: string | null;
  entitlement_status: string | null;
  allocated_booking_name: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

type TrainingCourseRun = {
  training_course_run_id: number;
  org_id: string;
  job_id: number;
  training_product_id: number | null;
  product_name: string | null;
  run_name: string | null;
  course_code: string | null;
  total_hours: number | null;
  delivery_mode: string | null;
  capacity: number | null;
  min_attendees: number | null;
  status: string;
  workflow_stage_key: string;
  start_date: string | null;
  end_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  online_meeting_url: string | null;
  online_meeting_id: string | null;
  online_passcode: string | null;
  notes: string | null;
  reminder_enabled: boolean;
  reminder_schedule_json: string | null;
  reminder_subject_template: string | null;
  reminder_body_template: string | null;
  completion_subject_template: string | null;
  completion_body_template: string | null;
  post_course_documents_json: string | null;
  auto_certificate: boolean;
  certificate_template_key: string | null;
  completed_at: string | null;
  booking_count: number;
  confirmed_count: number;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  bookings: TrainingBooking[];
  available_seats?: number | null;
};

type TrainingEntitlement = {
  training_entitlement_id: number;
  org_id: string;
  source_job_id: number | null;
  source_job_number: string | null;
  source_client_db_id: number | null;
  entitlement_type: string;
  status: string;
  allocated_to_booking_id: number | null;
  reserved_at: string | null;
  consumed_at: string | null;
  expires_at: string | null;
  notes: string | null;
  source_job_client_name: string | null;
  allocated_booking_name: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

type TrainingOverview = {
  job_id: number;
  details: TrainingDetails;
  products: TrainingProduct[];
  course_runs: TrainingCourseRun[];
  sessions: TrainingSession[];
  available_entitlements: TrainingEntitlement[];
  automation_log?: TrainingAutomationLog[];
};

type TrainingAutomationLog = {
  training_automation_log_id: number;
  org_id: string;
  training_course_run_id: number;
  training_course_session_id: number | null;
  training_booking_id: number | null;
  automation_key: string;
  trigger_key: string;
  action_type: string;
  recipient_name: string | null;
  recipient_email: string | null;
  subject: string | null;
  status: string;
  error_text: string | null;
  metadata_json: string | null;
  created_by: string | null;
  created_at: string | null;
  sent_at: string | null;
  updated_at: string | null;
};

type TrainingAttendance = {
  training_session_attendance_id: number;
  org_id: string;
  training_course_session_id: number;
  training_booking_id: number;
  attendance_status: string;
  attendance_minutes: number | null;
  notes: string | null;
  person_name: string;
  person_email: string | null;
  client_name: string | null;
  booking_source: string | null;
  participant_type: string | null;
  booking_attendance_status: string | null;
  entitlement_id: number | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

type TrainingSession = {
  training_course_session_id: number;
  org_id: string;
  training_course_run_id: number;
  session_title: string | null;
  session_date: string | null;
  start_time: string | null;
  end_time: string | null;
  session_hours: number | null;
  delivery_mode: string | null;
  venue_name: string | null;
  venue_address: string | null;
  online_meeting_url: string | null;
  online_meeting_id: string | null;
  online_passcode: string | null;
  status: string;
  notes: string | null;
  attendance_count: number;
  attended_count: number;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  attendance: TrainingAttendance[];
};

type ProductFormState = {
  product_code: string;
  product_name: string;
  description: string;
  default_hours: string;
  default_delivery_mode: string;
  default_capacity: string;
  default_min_attendees: string;
  certificate_policy: string;
  default_documents_json: string;
  is_active: boolean;
};

type RunFormState = {
  training_product_id: string;
  run_name: string;
  course_code: string;
  total_hours: string;
  delivery_mode: string;
  capacity: string;
  min_attendees: string;
  status: string;
  workflow_stage_key: string;
  start_date: string;
  end_date: string;
  venue_name: string;
  venue_address: string;
  online_meeting_url: string;
  online_meeting_id: string;
  online_passcode: string;
  notes: string;
};

type BookingFormState = {
  client_db_id: string;
  contact_id: string;
  participant_type: string;
  booking_source: string;
  person_name: string;
  person_email: string;
  person_phone: string;
  billing_status: string;
  attendance_status: string;
  special_requirements: string;
  consent_status: string;
  notes: string;
  entitlement_id: string;
};

type EntitlementFormState = {
  source_job_number: string;
  entitlement_type: string;
  status: string;
  expires_at: string;
  notes: string;
};

type SessionFormState = {
  session_title: string;
  session_date: string;
  start_time: string;
  end_time: string;
  session_hours: string;
  delivery_mode: string;
  venue_name: string;
  venue_address: string;
  online_meeting_url: string;
  online_meeting_id: string;
  online_passcode: string;
  status: string;
  notes: string;
};

type AutomationFormState = {
  reminder_enabled: boolean;
  reminder_schedule_json: string;
  reminder_subject_template: string;
  reminder_body_template: string;
  completion_subject_template: string;
  completion_body_template: string;
  post_course_documents_json: string;
  auto_certificate: boolean;
  certificate_template_key: string;
};

const EMPTY_DETAILS: TrainingDetails = {
  job_id: null,
  training_date: null,
  delivery_format: null,
  topic: null,
  audience: null,
  attendee_count: null,
  session_duration_hours: null,
  materials_link: null,
  location: null,
  notes: null,
};

const EMPTY_PRODUCT: ProductFormState = {
  product_code: "",
  product_name: "",
  description: "",
  default_hours: "",
  default_delivery_mode: "",
  default_capacity: "",
  default_min_attendees: "",
  certificate_policy: "",
  default_documents_json: "",
  is_active: true,
};

const EMPTY_RUN: RunFormState = {
  training_product_id: "__none__",
  run_name: "",
  course_code: "",
  total_hours: "",
  delivery_mode: "",
  capacity: "",
  min_attendees: "",
  status: "draft",
  workflow_stage_key: "setup",
  start_date: "",
  end_date: "",
  venue_name: "",
  venue_address: "",
  online_meeting_url: "",
  online_meeting_id: "",
  online_passcode: "",
  notes: "",
};

const EMPTY_BOOKING: BookingFormState = {
  client_db_id: "",
  contact_id: "",
  participant_type: "external_individual",
  booking_source: "manual",
  person_name: "",
  person_email: "",
  person_phone: "",
  billing_status: "pending",
  attendance_status: "booked",
  special_requirements: "",
  consent_status: "unknown",
  notes: "",
  entitlement_id: "__none__",
};

const EMPTY_ENTITLEMENT: EntitlementFormState = {
  source_job_number: "",
  entitlement_type: "free_place",
  status: "available",
  expires_at: "",
  notes: "",
};

const EMPTY_SESSION: SessionFormState = {
  session_title: "",
  session_date: "",
  start_time: "",
  end_time: "",
  session_hours: "",
  delivery_mode: "",
  venue_name: "",
  venue_address: "",
  online_meeting_url: "",
  online_meeting_id: "",
  online_passcode: "",
  status: "scheduled",
  notes: "",
};

const EMPTY_AUTOMATION: AutomationFormState = {
  reminder_enabled: true,
  reminder_schedule_json: "[7,1,0]",
  reminder_subject_template: "",
  reminder_body_template: "",
  completion_subject_template: "",
  completion_body_template: "",
  post_course_documents_json: "[\"questionnaire\"]",
  auto_certificate: true,
  certificate_template_key: "training_certificate",
};

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrEmpty(value: string | null | undefined): string {
  return value ?? "";
}

function toSelectValue(value: number | null | undefined): string {
  return value === null || value === undefined ? "__none__" : String(value);
}

function parseSelectNumber(value: string): number | null {
  if (!value || value === "__none__") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberArrayText(value: string | null | undefined, fallback: number[] = []): number[] {
  const text = String(value || "").trim();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
    }
  } catch {
    const parts = text
      .replace(/[\[\]]/g, "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((item) => Number.isFinite(item));
    if (parts.length) return parts;
  }
  return fallback;
}

function statusChipClass(value?: string | null): string {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (raw === "inactive") return "border-slate-200 bg-slate-50 text-slate-500";
  if (["completed", "attended", "consumed", "paid"].includes(raw)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["cancelled", "no_show", "expired"].includes(raw)) return "border-red-200 bg-red-50 text-red-700";
  if (["draft", "pending", "booked"].includes(raw)) return "border-slate-200 bg-slate-50 text-slate-700";
  if (["reserved", "confirmed", "scheduled", "open"].includes(raw)) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function JobTraining({ jobId, baseUrl, jobFamily }: JobTrainingProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [overview, setOverview] = useState<TrainingOverview | null>(null);
  const [automationLog, setAutomationLog] = useState<TrainingAutomationLog[]>([]);
  const [details, setDetails] = useState<TrainingDetails>(EMPTY_DETAILS);
  const [summarySaving, setSummarySaving] = useState(false);
  const [productSaving, setProductSaving] = useState(false);
  const [runSaving, setRunSaving] = useState(false);
  const [entitlementSaving, setEntitlementSaving] = useState(false);
  const [calendarMonthOffset, setCalendarMonthOffset] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [newProduct, setNewProduct] = useState<ProductFormState>(EMPTY_PRODUCT);
  const [newRun, setNewRun] = useState<RunFormState>(EMPTY_RUN);
  const [newEntitlement, setNewEntitlement] = useState<EntitlementFormState>(EMPTY_ENTITLEMENT);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [overviewRes, logRes] = await Promise.all([
          fetch(`${baseUrl}/jobs/${jobId}/training-overview`, { credentials: "include" }),
          fetch(`${baseUrl}/jobs/${jobId}/training-automation-log`, { credentials: "include" }),
        ]);
        if (!overviewRes.ok) {
          const text = await overviewRes.text().catch(() => "");
          throw new Error(`${overviewRes.status} ${overviewRes.statusText}${text ? ` - ${text}` : ""}`);
        }
        const json = (await overviewRes.json()) as TrainingOverview;
        if (cancelled) return;
        setOverview(json);
        setDetails(json.details || EMPTY_DETAILS);
        if (logRes.ok) {
          const logJson = (await logRes.json()) as { items?: TrainingAutomationLog[] };
          setAutomationLog(Array.isArray(logJson.items) ? logJson.items : []);
        } else {
          setAutomationLog([]);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(`Failed to load training overview: ${(err as Error).message}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (jobFamily === "training") {
      void load();
    }

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobFamily, jobId, refreshToken]);

  if (jobFamily !== "training") return null;

  const products = overview?.products ?? [];
  const courseRuns = overview?.course_runs ?? [];
  const entitlements = overview?.available_entitlements ?? [];
  const runById = useMemo(() => {
    const map = new Map<number, TrainingCourseRun>();
    courseRuns.forEach((run) => map.set(run.training_course_run_id, run));
    return map;
  }, [courseRuns]);
  const calendarSessions = useMemo(() => {
    return [...(overview?.sessions ?? [])].sort((a, b) => {
      const aDate = a.session_date || "";
      const bDate = b.session_date || "";
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      const aTime = `${a.start_time || ""}${a.end_time || ""}`;
      const bTime = `${b.start_time || ""}${b.end_time || ""}`;
      return aTime.localeCompare(bTime);
    });
  }, [overview?.sessions]);
  const calendarAnchor = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, [calendarSessions]);
  const calendarMonth = useMemo(() => {
    const base = new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth() + calendarMonthOffset, 1);
    return base;
  }, [calendarAnchor, calendarMonthOffset]);
  const calendarLabel = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(calendarMonth),
    [calendarMonth],
  );
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDay = new Date(firstDay);
    startDay.setDate(firstDay.getDate() - ((firstDay.getDay() + 6) % 7));
    const days: Array<{ date: Date; dateKey: string; isCurrentMonth: boolean }> = [];
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(startDay);
      date.setDate(startDay.getDate() + i);
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      days.push({ date, dateKey, isCurrentMonth: date.getMonth() === month });
    }
    return days;
  }, [calendarMonth]);
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, TrainingSession[]>();
    calendarSessions.forEach((session) => {
      if (!session.session_date) return;
      const list = map.get(session.session_date) || [];
      list.push(session);
      map.set(session.session_date, list);
    });
    return map;
  }, [calendarSessions]);
  const automationByRun = useMemo(() => {
    const map = new Map<number, TrainingAutomationLog[]>();
    automationLog.forEach((entry) => {
      const arr = map.get(entry.training_course_run_id) || [];
      arr.push(entry);
      map.set(entry.training_course_run_id, arr);
    });
    for (const arr of map.values()) {
      arr.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    }
    return map;
  }, [automationLog]);

  function openRun(runId: number) {
    setSelectedRunId(runId);
    setSelectedSessionId(null);
    window.requestAnimationFrame(() => {
      document.getElementById(`training-run-${runId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function openSession(session: TrainingSession) {
    setSelectedRunId(session.training_course_run_id);
    setSelectedSessionId(session.training_course_session_id);
    window.requestAnimationFrame(() => {
      document.getElementById(`training-session-${session.training_course_session_id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById(`training-run-${session.training_course_run_id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function refresh() {
    setRefreshToken((value) => value + 1);
  }

  async function saveSummary() {
    setSummarySaving(true);
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/training-details`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(details),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      const json = (await res.json()) as TrainingDetails;
      setDetails(json);
      setStatus("Training summary saved.");
      await refresh();
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`);
    } finally {
      setSummarySaving(false);
    }
  }

  async function createProduct() {
    setProductSaving(true);
    setStatus("");
    try {
      const payload = {
        ...newProduct,
        default_hours: toNumberOrNull(newProduct.default_hours),
        default_capacity: toNumberOrNull(newProduct.default_capacity),
        default_min_attendees: toNumberOrNull(newProduct.default_min_attendees),
        default_documents_json: newProduct.default_documents_json || null,
        is_active: newProduct.is_active,
      };
      const res = await fetch(`${baseUrl}/training-products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setNewProduct(EMPTY_PRODUCT);
      setStatus("Training product created.");
      await refresh();
    } catch (err) {
      setStatus(`Product save failed: ${(err as Error).message}`);
    } finally {
      setProductSaving(false);
    }
  }

  async function createRun() {
    setRunSaving(true);
    setStatus("");
    try {
      const payload = {
        ...newRun,
        training_product_id: parseSelectNumber(newRun.training_product_id),
        total_hours: toNumberOrNull(newRun.total_hours),
        capacity: toNumberOrNull(newRun.capacity),
        min_attendees: toNumberOrNull(newRun.min_attendees),
        start_date: newRun.start_date || null,
        end_date: newRun.end_date || null,
      };
      const res = await fetch(`${baseUrl}/jobs/${jobId}/training-course-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setNewRun(EMPTY_RUN);
      setStatus("Training course run created.");
      await refresh();
    } catch (err) {
      setStatus(`Course run save failed: ${(err as Error).message}`);
    } finally {
      setRunSaving(false);
    }
  }

  async function createEntitlement() {
    setEntitlementSaving(true);
    setStatus("");
    try {
      const payload = {
        ...newEntitlement,
        expires_at: newEntitlement.expires_at || null,
      };
      const res = await fetch(`${baseUrl}/training-entitlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setNewEntitlement(EMPTY_ENTITLEMENT);
      setStatus("Training entitlement created.");
      await refresh();
    } catch (err) {
      setStatus(`Entitlement save failed: ${(err as Error).message}`);
    } finally {
      setEntitlementSaving(false);
    }
  }

  async function createSession(runId: number, draft: SessionFormState) {
    setStatus("");
    try {
      const payload = {
        ...draft,
        session_hours: toNumberOrNull(draft.session_hours),
        session_date: draft.session_date || null,
        start_time: draft.start_time || null,
        end_time: draft.end_time || null,
      };
      const res = await fetch(`${baseUrl}/training-course-runs/${runId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setStatus("Training session created.");
      await refresh();
    } catch (err) {
      setStatus(`Session save failed: ${(err as Error).message}`);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle style={{ color: "#F26624" }}>Training Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Manage the training wrapper, reusable course products, scheduled runs, participant bookings, and free-place entitlements.
        </p>
        {status ? <div className="rounded-md bg-muted px-3 py-2 text-sm">{status}</div> : null}
        {loading ? <div className="text-sm text-muted-foreground">Loading training overview...</div> : null}

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Training Summary</h3>
              <p className="text-sm text-muted-foreground">Wrapper-level notes for the overall training job.</p>
            </div>
            <Button onClick={saveSummary} disabled={summarySaving}>
              {summarySaving ? "Saving..." : "Save Summary"}
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="trainingDate">Training Date</Label>
              <Input
                id="trainingDate"
                type="date"
                value={details.training_date || ""}
                onChange={(e) => setDetails((prev) => ({ ...prev, training_date: e.target.value || null }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deliveryFormat">Delivery Format</Label>
              <Input
                id="deliveryFormat"
                value={details.delivery_format || ""}
                onChange={(e) => setDetails((prev) => ({ ...prev, delivery_format: e.target.value || null }))}
                placeholder="Onsite / remote / hybrid"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="topic">Topic</Label>
              <Input
                id="topic"
                value={details.topic || ""}
                onChange={(e) => setDetails((prev) => ({ ...prev, topic: e.target.value || null }))}
                placeholder="Carbon literacy, leadership training..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audience">Audience</Label>
              <Input
                id="audience"
                value={details.audience || ""}
                onChange={(e) => setDetails((prev) => ({ ...prev, audience: e.target.value || null }))}
                placeholder="Leadership team, staff, suppliers..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attendees">Attendee Count</Label>
              <Input
                id="attendees"
                type="number"
                min="0"
                value={details.attendee_count ?? ""}
                onChange={(e) =>
                  setDetails((prev) => ({
                    ...prev,
                    attendee_count: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Session Hours</Label>
              <Input
                id="duration"
                type="number"
                min="0"
                step="0.25"
                value={details.session_duration_hours ?? ""}
                onChange={(e) =>
                  setDetails((prev) => ({
                    ...prev,
                    session_duration_hours: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="materialsLink">Materials Link</Label>
              <Input
                id="materialsLink"
                value={details.materials_link || ""}
                onChange={(e) => setDetails((prev) => ({ ...prev, materials_link: e.target.value || null }))}
                placeholder="Shared deck / folder link"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={details.location || ""}
                onChange={(e) => setDetails((prev) => ({ ...prev, location: e.target.value || null }))}
                placeholder="Onsite location or venue"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={details.notes || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, notes: e.target.value || null }))}
              rows={4}
              placeholder="Delivery notes, follow-ups, or feedback..."
            />
          </div>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Course Calendar</h3>
              <p className="text-sm text-muted-foreground">Sessions, capacity, and reminder status in one view.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCalendarMonthOffset((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCalendarMonthOffset(0)}>
                Current
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCalendarMonthOffset((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,0.95fr)]">
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{calendarLabel}</div>
                  <div className="text-xs text-muted-foreground">{calendarSessions.length} scheduled session{calendarSessions.length === 1 ? "" : "s"}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{courseRuns.length} runs</Badge>
                  <Badge variant="outline">{automationLog.filter((item) => item.status === "sent").length} sent</Badge>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                  <div key={day} className="px-1">
                    {day}
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-2">
                {calendarDays.map(({ date, dateKey, isCurrentMonth }) => {
                  const items = sessionsByDate.get(dateKey) || [];
                  const dayLabel = date.getDate();
                  return (
                    <div
                      key={dateKey}
                      className={`min-h-[120px] rounded-lg border p-2 transition ${
                        isCurrentMonth ? "bg-background" : "bg-muted/40 text-muted-foreground"
                      } ${items.length ? "cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (items.length) {
                          openSession(items[0]);
                        }
                      }}
                      onKeyDown={(event) => {
                        if ((event.key === "Enter" || event.key === " ") && items.length) {
                          event.preventDefault();
                          openSession(items[0]);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{dayLabel}</div>
                        {items.length ? <Badge variant="outline">{items.length}</Badge> : null}
                      </div>
                      <div className="mt-2 space-y-1">
                        {items.slice(0, 3).map((session) => {
                          const run = runById.get(session.training_course_run_id);
                          const bookings = run?.booking_count ?? session.attendance_count ?? 0;
                          const capacity = run?.capacity ?? null;
                          const reminderDays = (() => {
                            const schedule = parseNumberArrayText(run?.reminder_schedule_json, [7, 1, 0]);
                            if (!session.session_date) return null;
                            const sessionDate = new Date(`${session.session_date}T00:00:00`);
                            const now = new Date();
                            const diffMs = sessionDate.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
                            if (schedule.includes(diffDays)) return diffDays;
                            return null;
                          })();
                          return (
                            <button
                              key={session.training_course_session_id}
                              type="button"
                              className={`w-full rounded-md border bg-white p-2 text-left text-xs shadow-sm transition hover:border-emerald-300 hover:shadow-md ${
                                selectedSessionId === session.training_course_session_id ? "ring-2 ring-emerald-500 ring-offset-1" : ""
                              }`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openSession(session);
                              }}
                            >
                              <div className="font-medium text-slate-800">{session.session_title || run?.run_name || "Session"}</div>
                              <div className="text-muted-foreground">
                                {run?.run_name || run?.product_name || `Run ${session.training_course_run_id}`}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <Badge className={statusChipClass(session.status)} variant="outline">
                                  {session.status}
                                </Badge>
                                {session.session_hours !== null ? <span>{session.session_hours}h</span> : null}
                                {session.start_time || session.end_time ? (
                                  <span>
                                    {session.start_time || "?"}
                                    {session.end_time ? ` - ${session.end_time}` : ""}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {capacity !== null ? `${bookings}/${capacity} booked` : `${bookings} bookings`}
                                {run?.reminder_enabled ? " • reminders on" : " • reminders off"}
                                {reminderDays !== null ? ` • due in ${reminderDays}d` : ""}
                              </div>
                            </button>
                          );
                        })}
                        {items.length > 3 ? <div className="text-[11px] text-muted-foreground">+{items.length - 3} more</div> : null}
                        {!items.length ? <div className="pt-3 text-[11px] text-muted-foreground">No sessions</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="font-medium">Run Capacity & Reminders</h4>
                  <Badge variant="outline">{courseRuns.length} tracked</Badge>
                </div>
                <div className="space-y-2">
                  {courseRuns.length ? (
                    courseRuns.map((run) => (
                      <button
                        key={run.training_course_run_id}
                        type="button"
                        className={`w-full rounded-md border bg-white p-2 text-left text-sm transition hover:border-emerald-300 hover:shadow-sm ${
                          selectedRunId === run.training_course_run_id ? "ring-2 ring-emerald-500 ring-offset-1" : ""
                        }`}
                        onClick={() => openRun(run.training_course_run_id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{run.run_name || run.product_name || `Run ${run.training_course_run_id}`}</div>
                          <Badge className={statusChipClass(run.status)} variant="outline">
                            {formatTrainingCourseRunStatus(run.status)}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {run.capacity !== null ? `${run.booking_count}/${run.capacity} booked` : `${run.booking_count} bookings`}
                          {run.reminder_enabled ? " • reminders enabled" : " • reminders disabled"}
                          {run.reminder_schedule_json ? ` • ${run.reminder_schedule_json}` : ""}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {run.start_date || "No start date"}{run.end_date ? ` → ${run.end_date}` : ""}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">No runs yet.</div>
                  )}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="font-medium">Recent Automation</h4>
                  <Badge variant="outline">{automationLog.length}</Badge>
                </div>
                <div className="space-y-2">
                  {automationLog.length ? (
                    automationLog.slice(0, 6).map((entry) => (
                      <div key={entry.training_automation_log_id} className="rounded-md border bg-white p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{entry.action_type}</span>
                          <Badge className={statusChipClass(entry.status)} variant="outline">
                            {entry.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {entry.recipient_name || entry.recipient_email || "No recipient"}
                        </div>
                        <div className="mt-1 text-muted-foreground">{entry.subject || "No subject"}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">No automation activity yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Training Products</h3>
              <p className="text-sm text-muted-foreground">Reusable course templates and defaults.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <h4 className="font-medium">Create Product</h4>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Code</Label>
                  <Input value={newProduct.product_code} onChange={(e) => setNewProduct((p) => ({ ...p, product_code: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={newProduct.product_name}
                    onChange={(e) => setNewProduct((p) => ({ ...p, product_name: e.target.value }))}
                    placeholder="CPD Accredited Net Zero Leaders"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Description</Label>
                  <Textarea
                    value={newProduct.description}
                    onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Default Hours</Label>
                  <Input type="number" min="0" step="0.25" value={newProduct.default_hours} onChange={(e) => setNewProduct((p) => ({ ...p, default_hours: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Default Capacity</Label>
                  <Input type="number" min="0" value={newProduct.default_capacity} onChange={(e) => setNewProduct((p) => ({ ...p, default_capacity: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Min Attendees</Label>
                  <Input type="number" min="0" value={newProduct.default_min_attendees} onChange={(e) => setNewProduct((p) => ({ ...p, default_min_attendees: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Delivery Mode</Label>
                  <Select value={newProduct.default_delivery_mode || "__none__"} onValueChange={(v) => setNewProduct((p) => ({ ...p, default_delivery_mode: v === "__none__" ? "" : v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select mode..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No default</SelectItem>
                      {TRAINING_DELIVERY_MODE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Certificate Policy</Label>
                  <Input value={newProduct.certificate_policy} onChange={(e) => setNewProduct((p) => ({ ...p, certificate_policy: e.target.value }))} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Default Documents JSON</Label>
                  <Textarea
                    value={newProduct.default_documents_json}
                    onChange={(e) => setNewProduct((p) => ({ ...p, default_documents_json: e.target.value }))}
                    rows={3}
                    placeholder='["questionnaire", "join_link"]'
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="newProductActive"
                  type="checkbox"
                  checked={newProduct.is_active}
                  onChange={(e) => setNewProduct((p) => ({ ...p, is_active: e.target.checked }))}
                />
                <Label htmlFor="newProductActive">Active</Label>
              </div>
              <div className="flex justify-end">
                <Button onClick={createProduct} disabled={productSaving}>
                  {productSaving ? "Creating..." : "Create Product"}
                </Button>
              </div>
            </div>
            <div className="overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length ? (
                    products.map((product) => (
                      <TableRow key={product.training_product_id}>
                        <TableCell>{product.product_code || "—"}</TableCell>
                        <TableCell>{product.product_name}</TableCell>
                        <TableCell>{product.default_hours ?? "—"}</TableCell>
                        <TableCell>{formatTrainingDeliveryMode(product.default_delivery_mode)}</TableCell>
                        <TableCell>{product.default_capacity ?? "—"}</TableCell>
                        <TableCell>
                          <Badge className={statusChipClass(product.is_active ? "active" : "inactive")} variant="outline">
                            {product.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No training products yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Course Runs</h3>
              <p className="text-sm text-muted-foreground">Manage the scheduled delivery instances for this job.</p>
            </div>
            <Badge variant="outline">{courseRuns.length} run{courseRuns.length === 1 ? "" : "s"}</Badge>
          </div>

          <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
            <h4 className="font-medium">Create Course Run</h4>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Product</Label>
                <Select value={newRun.training_product_id} onValueChange={(v) => setNewRun((p) => ({ ...p, training_product_id: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select product..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No product</SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.training_product_id} value={String(product.training_product_id)}>
                        {product.product_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Run Name</Label>
                <Input value={newRun.run_name} onChange={(e) => setNewRun((p) => ({ ...p, run_name: e.target.value }))} placeholder="Net Zero Leaders - April cohort" />
              </div>
              <div className="space-y-2">
                <Label>Course Code</Label>
                <Input value={newRun.course_code} onChange={(e) => setNewRun((p) => ({ ...p, course_code: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Total Hours</Label>
                <Input type="number" min="0" step="0.25" value={newRun.total_hours} onChange={(e) => setNewRun((p) => ({ ...p, total_hours: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Delivery Mode</Label>
                <Select value={newRun.delivery_mode || "__none__"} onValueChange={(v) => setNewRun((p) => ({ ...p, delivery_mode: v === "__none__" ? "" : v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select mode..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No default</SelectItem>
                    {TRAINING_DELIVERY_MODE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Capacity</Label>
                <Input type="number" min="0" value={newRun.capacity} onChange={(e) => setNewRun((p) => ({ ...p, capacity: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Min Attendees</Label>
                <Input type="number" min="0" value={newRun.min_attendees} onChange={(e) => setNewRun((p) => ({ ...p, min_attendees: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={newRun.status} onValueChange={(v) => setNewRun((p) => ({ ...p, status: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAINING_COURSE_RUN_STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Workflow Stage</Label>
                <Input value={newRun.workflow_stage_key} onChange={(e) => setNewRun((p) => ({ ...p, workflow_stage_key: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={newRun.start_date} onChange={(e) => setNewRun((p) => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={newRun.end_date} onChange={(e) => setNewRun((p) => ({ ...p, end_date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Venue Name</Label>
                <Input value={newRun.venue_name} onChange={(e) => setNewRun((p) => ({ ...p, venue_name: e.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Venue / Location Notes</Label>
                <Input value={newRun.venue_address} onChange={(e) => setNewRun((p) => ({ ...p, venue_address: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Online Link</Label>
                <Input value={newRun.online_meeting_url} onChange={(e) => setNewRun((p) => ({ ...p, online_meeting_url: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Meeting ID</Label>
                <Input value={newRun.online_meeting_id} onChange={(e) => setNewRun((p) => ({ ...p, online_meeting_id: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Passcode</Label>
                <Input value={newRun.online_passcode} onChange={(e) => setNewRun((p) => ({ ...p, online_passcode: e.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-3">
                <Label>Notes</Label>
                <Textarea value={newRun.notes} onChange={(e) => setNewRun((p) => ({ ...p, notes: e.target.value }))} rows={3} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={createRun} disabled={runSaving}>
                {runSaving ? "Creating..." : "Create Course Run"}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {courseRuns.length ? (
              courseRuns.map((run) => (
                <CourseRunCard
                  key={run.training_course_run_id}
                  run={run}
                  products={products}
                  entitlements={entitlements}
                  sessions={(overview?.sessions ?? []).filter((session) => session.training_course_run_id === run.training_course_run_id)}
                  baseUrl={baseUrl}
                  automationEntries={automationByRun.get(run.training_course_run_id) || []}
                  isSelected={selectedRunId === run.training_course_run_id}
                  selectedSessionId={selectedSessionId}
                  onCreateSession={createSession}
                  onSaved={refresh}
                  onOpenRun={openRun}
                  onOpenSession={openSession}
                />
              ))
            ) : (
              <div className="rounded-lg border bg-muted/20 p-6 text-sm text-muted-foreground">No course runs have been created for this training job yet.</div>
            )}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Free Place Entitlements</h3>
              <p className="text-sm text-muted-foreground">Create and track free training places originating from CRP jobs.</p>
            </div>
            <Badge variant="outline">{entitlements.length} entitlement{entitlements.length === 1 ? "" : "s"}</Badge>
          </div>

          <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
            <h4 className="font-medium">Create Entitlement</h4>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Source Job Number</Label>
                <Input
                  value={newEntitlement.source_job_number}
                  onChange={(e) => setNewEntitlement((p) => ({ ...p, source_job_number: e.target.value }))}
                  placeholder="J000123"
                />
              </div>
              <div className="space-y-2">
                <Label>Entitlement Type</Label>
                <Input value={newEntitlement.entitlement_type} onChange={(e) => setNewEntitlement((p) => ({ ...p, entitlement_type: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={newEntitlement.status} onValueChange={(v) => setNewEntitlement((p) => ({ ...p, status: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAINING_ENTITLEMENT_STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Expires At</Label>
                <Input type="datetime-local" value={newEntitlement.expires_at} onChange={(e) => setNewEntitlement((p) => ({ ...p, expires_at: e.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea value={newEntitlement.notes} onChange={(e) => setNewEntitlement((p) => ({ ...p, notes: e.target.value }))} rows={3} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={createEntitlement} disabled={entitlementSaving}>
                {entitlementSaving ? "Creating..." : "Create Entitlement"}
              </Button>
            </div>
          </div>

          <div className="overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Allocated To</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entitlements.length ? (
                  entitlements.map((entitlement) => (
                    <TableRow key={entitlement.training_entitlement_id}>
                      <TableCell>
                        <div className="font-medium">{entitlement.source_job_number || `Job ${entitlement.source_job_id ?? "—"}`}</div>
                        {entitlement.source_job_client_name ? (
                          <div className="text-xs text-muted-foreground">{entitlement.source_job_client_name}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusChipClass(entitlement.status)} variant="outline">
                          {formatTrainingEntitlementStatus(entitlement.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{entitlement.allocated_booking_name || "—"}</TableCell>
                      <TableCell>{entitlement.expires_at ? new Date(entitlement.expires_at).toLocaleString() : "—"}</TableCell>
                      <TableCell>{entitlement.notes || "—"}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No entitlements recorded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function CourseRunCard({
  run,
  products,
  entitlements,
  sessions,
  baseUrl,
  automationEntries,
  isSelected,
  selectedSessionId,
  onCreateSession,
  onSaved,
  onOpenRun,
  onOpenSession,
}: {
  run: TrainingCourseRun;
  products: TrainingProduct[];
  entitlements: TrainingEntitlement[];
  sessions: TrainingSession[];
  baseUrl: string;
  automationEntries: TrainingAutomationLog[];
  isSelected: boolean;
  selectedSessionId: number | null;
  onCreateSession: (runId: number, draft: SessionFormState) => Promise<void>;
  onSaved: () => void;
  onOpenRun: (runId: number) => void;
  onOpenSession: (session: TrainingSession) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [automationResult, setAutomationResult] = useState("");
  const [sessionDraft, setSessionDraft] = useState<SessionFormState>(EMPTY_SESSION);
  const [automation, setAutomation] = useState<AutomationFormState>(() => ({
    reminder_enabled: run.reminder_enabled ?? true,
    reminder_schedule_json: run.reminder_schedule_json || "[7,1,0]",
    reminder_subject_template: run.reminder_subject_template || "",
    reminder_body_template: run.reminder_body_template || "",
    completion_subject_template: run.completion_subject_template || "",
    completion_body_template: run.completion_body_template || "",
    post_course_documents_json: run.post_course_documents_json || "[\"questionnaire\"]",
    auto_certificate: run.auto_certificate ?? true,
    certificate_template_key: run.certificate_template_key || "training_certificate",
  }));
  const [draft, setDraft] = useState<RunFormState>(() => ({
    training_product_id: toSelectValue(run.training_product_id),
    run_name: toStringOrEmpty(run.run_name),
    course_code: toStringOrEmpty(run.course_code),
    total_hours: run.total_hours === null ? "" : String(run.total_hours),
    delivery_mode: toStringOrEmpty(run.delivery_mode),
    capacity: run.capacity === null ? "" : String(run.capacity),
    min_attendees: run.min_attendees === null ? "" : String(run.min_attendees),
    status: run.status || "draft",
    workflow_stage_key: run.workflow_stage_key || "setup",
    start_date: toStringOrEmpty(run.start_date),
    end_date: toStringOrEmpty(run.end_date),
    venue_name: toStringOrEmpty(run.venue_name),
    venue_address: toStringOrEmpty(run.venue_address),
    online_meeting_url: toStringOrEmpty(run.online_meeting_url),
    online_meeting_id: toStringOrEmpty(run.online_meeting_id),
    online_passcode: toStringOrEmpty(run.online_passcode),
    notes: toStringOrEmpty(run.notes),
  }));
  const [newBooking, setNewBooking] = useState<BookingFormState>(EMPTY_BOOKING);

  useEffect(() => {
    setDraft({
      training_product_id: toSelectValue(run.training_product_id),
      run_name: toStringOrEmpty(run.run_name),
      course_code: toStringOrEmpty(run.course_code),
      total_hours: run.total_hours === null ? "" : String(run.total_hours),
      delivery_mode: toStringOrEmpty(run.delivery_mode),
      capacity: run.capacity === null ? "" : String(run.capacity),
      min_attendees: run.min_attendees === null ? "" : String(run.min_attendees),
      status: run.status || "draft",
      workflow_stage_key: run.workflow_stage_key || "setup",
      start_date: toStringOrEmpty(run.start_date),
      end_date: toStringOrEmpty(run.end_date),
      venue_name: toStringOrEmpty(run.venue_name),
      venue_address: toStringOrEmpty(run.venue_address),
      online_meeting_url: toStringOrEmpty(run.online_meeting_url),
      online_meeting_id: toStringOrEmpty(run.online_meeting_id),
      online_passcode: toStringOrEmpty(run.online_passcode),
      notes: toStringOrEmpty(run.notes),
    });
    setAutomation({
      reminder_enabled: run.reminder_enabled ?? true,
      reminder_schedule_json: run.reminder_schedule_json || "[7,1,0]",
      reminder_subject_template: run.reminder_subject_template || "",
      reminder_body_template: run.reminder_body_template || "",
      completion_subject_template: run.completion_subject_template || "",
      completion_body_template: run.completion_body_template || "",
      post_course_documents_json: run.post_course_documents_json || "[\"questionnaire\"]",
      auto_certificate: run.auto_certificate ?? true,
      certificate_template_key: run.certificate_template_key || "training_certificate",
    });
    setSessionDraft(EMPTY_SESSION);
    setAutomationResult("");
  }, [run]);

  async function saveRun() {
    setSaving(true);
    setStatus("");
    try {
      const payload = {
        ...draft,
        training_product_id: parseSelectNumber(draft.training_product_id),
        total_hours: toNumberOrNull(draft.total_hours),
        capacity: toNumberOrNull(draft.capacity),
        min_attendees: toNumberOrNull(draft.min_attendees),
        start_date: draft.start_date || null,
        end_date: draft.end_date || null,
      };
      const res = await fetch(`${baseUrl}/training-course-runs/${run.training_course_run_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setStatus("Course run saved.");
      onSaved();
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function createBooking() {
    if (!newBooking.person_name.trim()) {
      setStatus("Please enter a participant name.");
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      const payload = {
        ...newBooking,
        client_db_id: toNumberOrNull(newBooking.client_db_id),
        contact_id: toNumberOrNull(newBooking.contact_id),
        entitlement_id: parseSelectNumber(newBooking.entitlement_id),
      };
      const res = await fetch(`${baseUrl}/training-course-runs/${run.training_course_run_id}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setNewBooking(EMPTY_BOOKING);
      setStatus("Participant added.");
      onSaved();
    } catch (err) {
      setStatus(`Booking save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveAutomation() {
    setAutomationSaving(true);
    setStatus("");
    try {
      const payload = {
        ...automation,
        reminder_enabled: automation.reminder_enabled,
        auto_certificate: automation.auto_certificate,
      };
      const res = await fetch(`${baseUrl}/training-course-runs/${run.training_course_run_id}/automation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setStatus("Automation settings saved.");
      onSaved();
    } catch (err) {
      setStatus(`Automation save failed: ${(err as Error).message}`);
    } finally {
      setAutomationSaving(false);
    }
  }

  async function runAutomation(triggerKey: "reminders" | "completion_pack", mode: "preview" | "send") {
    setAutomationSaving(true);
    setStatus("");
    setAutomationResult("");
    try {
      const res = await fetch(`${baseUrl}/training-course-runs/${run.training_course_run_id}/automation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ trigger_key: triggerKey, mode }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setAutomationResult(text);
      setStatus(`${triggerKey === "reminders" ? "Reminder" : "Completion"} automation ${mode} complete.`);
      onSaved();
    } catch (err) {
      setAutomationResult(String((err as Error).message || ""));
      setStatus(`Automation failed: ${(err as Error).message}`);
    } finally {
      setAutomationSaving(false);
    }
  }

  return (
    <Card
      id={`training-run-${run.training_course_run_id}`}
      className={`scroll-mt-24 border-slate-200 ${isSelected ? "ring-2 ring-emerald-500 ring-offset-1" : ""}`}
    >
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">
              {run.run_name || run.product_name || `Run ${run.training_course_run_id}`}
            </CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge className={statusChipClass(run.status)} variant="outline">
                {formatTrainingCourseRunStatus(run.status)}
              </Badge>
              {run.delivery_mode ? <Badge variant="outline">{formatTrainingDeliveryMode(run.delivery_mode)}</Badge> : null}
              {run.start_date || run.end_date ? (
                <span>
                  {run.start_date || "?"}
                  {run.end_date ? ` → ${run.end_date}` : ""}
                </span>
              ) : null}
              {run.capacity !== null ? <span>{run.booking_count}/{run.capacity} booked</span> : <span>{run.booking_count} bookings</span>}
              {automationEntries.length ? (
                <span>
                  Latest automation: {automationEntries[0].action_type}
                  {automationEntries[0].created_at ? ` on ${new Date(automationEntries[0].created_at).toLocaleString()}` : ""}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => onOpenRun(run.training_course_run_id)} variant="ghost">
              Focus
            </Button>
            <Button onClick={saveRun} disabled={saving} variant="outline">
              {saving ? "Saving..." : "Save Run"}
            </Button>
          </div>
        </div>
        {status ? <div className="rounded-md bg-muted px-3 py-2 text-sm">{status}</div> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Product</Label>
            <Select value={draft.training_product_id} onValueChange={(v) => setDraft((p) => ({ ...p, training_product_id: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select product..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No product</SelectItem>
                {products.map((product) => (
                  <SelectItem key={product.training_product_id} value={String(product.training_product_id)}>
                    {product.product_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Course Code</Label>
            <Input value={draft.course_code} onChange={(e) => setDraft((p) => ({ ...p, course_code: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Run Name</Label>
            <Input value={draft.run_name} onChange={(e) => setDraft((p) => ({ ...p, run_name: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Total Hours</Label>
            <Input type="number" min="0" step="0.25" value={draft.total_hours} onChange={(e) => setDraft((p) => ({ ...p, total_hours: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Delivery Mode</Label>
            <Select value={draft.delivery_mode || "__none__"} onValueChange={(v) => setDraft((p) => ({ ...p, delivery_mode: v === "__none__" ? "" : v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select mode..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No default</SelectItem>
                {TRAINING_DELIVERY_MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Capacity</Label>
            <Input type="number" min="0" value={draft.capacity} onChange={(e) => setDraft((p) => ({ ...p, capacity: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Min Attendees</Label>
            <Input type="number" min="0" value={draft.min_attendees} onChange={(e) => setDraft((p) => ({ ...p, min_attendees: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={draft.status} onValueChange={(v) => setDraft((p) => ({ ...p, status: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRAINING_COURSE_RUN_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Workflow Stage</Label>
            <Input value={draft.workflow_stage_key} onChange={(e) => setDraft((p) => ({ ...p, workflow_stage_key: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Start Date</Label>
            <Input type="date" value={draft.start_date} onChange={(e) => setDraft((p) => ({ ...p, start_date: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>End Date</Label>
            <Input type="date" value={draft.end_date} onChange={(e) => setDraft((p) => ({ ...p, end_date: e.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-3">
            <Label>Venue / Address</Label>
            <Input value={draft.venue_name} onChange={(e) => setDraft((p) => ({ ...p, venue_name: e.target.value }))} placeholder="Venue name or online room label" />
          </div>
          <div className="space-y-2 md:col-span-3">
            <Label>Location Notes</Label>
            <Input value={draft.venue_address} onChange={(e) => setDraft((p) => ({ ...p, venue_address: e.target.value }))} placeholder="Address, access notes, or online instructions" />
          </div>
          <div className="space-y-2">
            <Label>Online Link</Label>
            <Input value={draft.online_meeting_url} onChange={(e) => setDraft((p) => ({ ...p, online_meeting_url: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Meeting ID</Label>
            <Input value={draft.online_meeting_id} onChange={(e) => setDraft((p) => ({ ...p, online_meeting_id: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Passcode</Label>
            <Input value={draft.online_passcode} onChange={(e) => setDraft((p) => ({ ...p, online_passcode: e.target.value }))} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea value={draft.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} rows={3} />
        </div>

        <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-medium">Automation</h4>
              <p className="text-xs text-muted-foreground">Configure reminders, completion packs, certificates, and post-course documents.</p>
            </div>
            <Button onClick={saveAutomation} disabled={automationSaving} variant="outline">
              {automationSaving ? "Saving..." : "Save Automation"}
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Reminder schedule (days before start)</Label>
              <Input
                value={automation.reminder_schedule_json}
                onChange={(e) => setAutomation((p) => ({ ...p, reminder_schedule_json: e.target.value }))}
                placeholder="[7, 1, 0]"
              />
            </div>
            <div className="space-y-2">
              <Label>Certificate template key</Label>
              <Input
                value={automation.certificate_template_key}
                onChange={(e) => setAutomation((p) => ({ ...p, certificate_template_key: e.target.value }))}
                placeholder="training_certificate"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Reminder subject template</Label>
              <Input
                value={automation.reminder_subject_template}
                onChange={(e) => setAutomation((p) => ({ ...p, reminder_subject_template: e.target.value }))}
                placeholder="Reminder: {{course_name}} starts {{start_date}}"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Reminder body template</Label>
              <Textarea
                value={automation.reminder_body_template}
                onChange={(e) => setAutomation((p) => ({ ...p, reminder_body_template: e.target.value }))}
                rows={3}
                placeholder="Optional custom HTML body for reminder emails."
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Completion subject template</Label>
              <Input
                value={automation.completion_subject_template}
                onChange={(e) => setAutomation((p) => ({ ...p, completion_subject_template: e.target.value }))}
                placeholder="Training completion pack: {{course_name}}"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Completion body template</Label>
              <Textarea
                value={automation.completion_body_template}
                onChange={(e) => setAutomation((p) => ({ ...p, completion_body_template: e.target.value }))}
                rows={3}
                placeholder="Optional custom HTML body for completion packs."
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Post-course documents JSON</Label>
              <Textarea
                value={automation.post_course_documents_json}
                onChange={(e) => setAutomation((p) => ({ ...p, post_course_documents_json: e.target.value }))}
                rows={3}
                placeholder='["questionnaire"]'
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={automation.reminder_enabled}
                onChange={(e) => setAutomation((p) => ({ ...p, reminder_enabled: e.target.checked }))}
              />
              Reminders enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={automation.auto_certificate}
                onChange={(e) => setAutomation((p) => ({ ...p, auto_certificate: e.target.checked }))}
              />
              Auto-issue certificate
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void runAutomation("reminders", "preview")} disabled={automationSaving}>
              Preview Reminders
            </Button>
            <Button variant="outline" onClick={() => void runAutomation("reminders", "send")} disabled={automationSaving}>
              Send Due Reminders
            </Button>
            <Button variant="outline" onClick={() => void runAutomation("completion_pack", "preview")} disabled={automationSaving}>
              Preview Completion Pack
            </Button>
            <Button onClick={() => void runAutomation("completion_pack", "send")} disabled={automationSaving}>
              Send Completion Pack
            </Button>
          </div>
          {automationResult ? <pre className="overflow-auto rounded-md bg-background p-3 text-xs text-muted-foreground">{automationResult}</pre> : null}
        </div>

        <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-medium">Sessions</h4>
              <p className="text-xs text-muted-foreground">Split a course run into one or more scheduled delivery sessions.</p>
            </div>
            <Button
              onClick={async () => {
                setSessionSaving(true);
                try {
                  await onCreateSession(run.training_course_run_id, sessionDraft);
                  setSessionDraft(EMPTY_SESSION);
                } finally {
                  setSessionSaving(false);
                }
              }}
              disabled={sessionSaving}
              variant="outline"
            >
              {sessionSaving ? "Creating..." : "Create Session"}
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Session Title</Label>
              <Input value={sessionDraft.session_title} onChange={(e) => setSessionDraft((p) => ({ ...p, session_title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Session Date</Label>
              <Input type="date" value={sessionDraft.session_date} onChange={(e) => setSessionDraft((p) => ({ ...p, session_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={sessionDraft.status} onValueChange={(v) => setSessionDraft((p) => ({ ...p, status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_SESSION_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input type="time" value={sessionDraft.start_time} onChange={(e) => setSessionDraft((p) => ({ ...p, start_time: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input type="time" value={sessionDraft.end_time} onChange={(e) => setSessionDraft((p) => ({ ...p, end_time: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Session Hours</Label>
              <Input type="number" min="0" step="0.25" value={sessionDraft.session_hours} onChange={(e) => setSessionDraft((p) => ({ ...p, session_hours: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Delivery Mode</Label>
              <Select value={sessionDraft.delivery_mode || "__none__"} onValueChange={(v) => setSessionDraft((p) => ({ ...p, delivery_mode: v === "__none__" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select mode..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No default</SelectItem>
                  {TRAINING_DELIVERY_MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Venue Name</Label>
              <Input value={sessionDraft.venue_name} onChange={(e) => setSessionDraft((p) => ({ ...p, venue_name: e.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Venue / Location Notes</Label>
              <Input value={sessionDraft.venue_address} onChange={(e) => setSessionDraft((p) => ({ ...p, venue_address: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Online Link</Label>
              <Input value={sessionDraft.online_meeting_url} onChange={(e) => setSessionDraft((p) => ({ ...p, online_meeting_url: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Meeting ID</Label>
              <Input value={sessionDraft.online_meeting_id} onChange={(e) => setSessionDraft((p) => ({ ...p, online_meeting_id: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Passcode</Label>
              <Input value={sessionDraft.online_passcode} onChange={(e) => setSessionDraft((p) => ({ ...p, online_passcode: e.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label>Notes</Label>
              <Textarea value={sessionDraft.notes} onChange={(e) => setSessionDraft((p) => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium">Scheduled Sessions</h4>
          {sessions.length ? (
            sessions.map((session) => (
              <SessionEditorCard
                key={session.training_course_session_id}
                session={session}
                runBookings={run.bookings}
                baseUrl={baseUrl}
                isSelected={selectedSessionId === session.training_course_session_id}
                onOpenSession={onOpenSession}
                onSaved={onSaved}
              />
            ))
          ) : (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">No sessions scheduled for this course run yet.</div>
          )}
        </div>

        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-medium">Add Participant</h4>
              <p className="text-xs text-muted-foreground">People can be linked to a client or booked as external individuals.</p>
            </div>
            <Button onClick={createBooking} disabled={saving}>
              {saving ? "Saving..." : "Add Participant"}
            </Button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={newBooking.person_name} onChange={(e) => setNewBooking((p) => ({ ...p, person_name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={newBooking.person_email} onChange={(e) => setNewBooking((p) => ({ ...p, person_email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={newBooking.person_phone} onChange={(e) => setNewBooking((p) => ({ ...p, person_phone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Participant Type</Label>
              <Select value={newBooking.participant_type} onValueChange={(v) => setNewBooking((p) => ({ ...p, participant_type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_PARTICIPANT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Booking Source</Label>
              <Select value={newBooking.booking_source} onValueChange={(v) => setNewBooking((p) => ({ ...p, booking_source: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_BOOKING_SOURCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Billing Status</Label>
              <Select value={newBooking.billing_status} onValueChange={(v) => setNewBooking((p) => ({ ...p, billing_status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_BILLING_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Attendance</Label>
              <Select value={newBooking.attendance_status} onValueChange={(v) => setNewBooking((p) => ({ ...p, attendance_status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_BOOKING_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Entitlement</Label>
              <Select value={newBooking.entitlement_id} onValueChange={(v) => setNewBooking((p) => ({ ...p, entitlement_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="No entitlement" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No entitlement</SelectItem>
                  {entitlements.map((entitlement) => (
                    <SelectItem key={entitlement.training_entitlement_id} value={String(entitlement.training_entitlement_id)}>
                      {entitlement.source_job_number || `Job ${entitlement.source_job_id ?? "—"}`} - {formatTrainingEntitlementStatus(entitlement.status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label>Client DB ID / Contact ID</Label>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  type="number"
                  min="0"
                  placeholder="Client DB ID"
                  value={newBooking.client_db_id}
                  onChange={(e) => setNewBooking((p) => ({ ...p, client_db_id: e.target.value }))}
                />
                <Input
                  type="number"
                  min="0"
                  placeholder="Contact ID"
                  value={newBooking.contact_id}
                  onChange={(e) => setNewBooking((p) => ({ ...p, contact_id: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label>Special Requirements</Label>
              <Input value={newBooking.special_requirements} onChange={(e) => setNewBooking((p) => ({ ...p, special_requirements: e.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label>Notes</Label>
              <Textarea value={newBooking.notes} onChange={(e) => setNewBooking((p) => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium">Participants</h4>
          {run.bookings.length ? (
            run.bookings.map((booking) => (
              <BookingEditorCard
                key={booking.training_booking_id}
                booking={booking}
                entitlements={entitlements}
                baseUrl={baseUrl}
                onSaved={onSaved}
              />
            ))
          ) : (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">No participants yet.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SessionEditorCard({
  session,
  runBookings,
  baseUrl,
  isSelected,
  onOpenSession,
  onSaved,
}: {
  session: TrainingSession;
  runBookings: TrainingBooking[];
  baseUrl: string;
  isSelected: boolean;
  onOpenSession: (session: TrainingSession) => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [sessionDraft, setSessionDraft] = useState<SessionFormState>(() => ({
    session_title: session.session_title || "",
    session_date: session.session_date || "",
    start_time: session.start_time || "",
    end_time: session.end_time || "",
    session_hours: session.session_hours === null ? "" : String(session.session_hours),
    delivery_mode: session.delivery_mode || "",
    venue_name: session.venue_name || "",
    venue_address: session.venue_address || "",
    online_meeting_url: session.online_meeting_url || "",
    online_meeting_id: session.online_meeting_id || "",
    online_passcode: session.online_passcode || "",
    status: session.status || "scheduled",
    notes: session.notes || "",
  }));
  const [attendanceDraft, setAttendanceDraft] = useState<Record<number, { attendance_status: string; attendance_minutes: string }>>(() => {
    const mapped: Record<number, { attendance_status: string; attendance_minutes: string }> = {};
    session.attendance.forEach((row) => {
      mapped[row.training_booking_id] = {
        attendance_status: row.attendance_status || "booked",
        attendance_minutes: row.attendance_minutes === null ? "" : String(row.attendance_minutes),
      };
    });
    return mapped;
  });

  useEffect(() => {
    setSessionDraft({
      session_title: session.session_title || "",
      session_date: session.session_date || "",
      start_time: session.start_time || "",
      end_time: session.end_time || "",
      session_hours: session.session_hours === null ? "" : String(session.session_hours),
      delivery_mode: session.delivery_mode || "",
      venue_name: session.venue_name || "",
      venue_address: session.venue_address || "",
      online_meeting_url: session.online_meeting_url || "",
      online_meeting_id: session.online_meeting_id || "",
      online_passcode: session.online_passcode || "",
      status: session.status || "scheduled",
      notes: session.notes || "",
    });
    const mapped: Record<number, { attendance_status: string; attendance_minutes: string }> = {};
    session.attendance.forEach((row) => {
      mapped[row.training_booking_id] = {
        attendance_status: row.attendance_status || "booked",
        attendance_minutes: row.attendance_minutes === null ? "" : String(row.attendance_minutes),
      };
    });
    setAttendanceDraft(mapped);
  }, [session]);

  async function saveSession() {
    setSaving(true);
    setStatus("");
    try {
      const payload = {
        ...sessionDraft,
        session_hours: toNumberOrNull(sessionDraft.session_hours),
        session_date: sessionDraft.session_date || null,
        start_time: sessionDraft.start_time || null,
        end_time: sessionDraft.end_time || null,
      };
      const res = await fetch(`${baseUrl}/training-course-sessions/${session.training_course_session_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setStatus("Session saved.");
      onSaved();
    } catch (err) {
      setStatus(`Session save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveAttendance() {
    setSaving(true);
    setStatus("");
    try {
      const payload = {
        items: runBookings.map((booking) => ({
          training_booking_id: booking.training_booking_id,
          attendance_status: attendanceDraft[booking.training_booking_id]?.attendance_status || booking.attendance_status || "booked",
          attendance_minutes: toNumberOrNull(attendanceDraft[booking.training_booking_id]?.attendance_minutes || ""),
        })),
      };
      const res = await fetch(`${baseUrl}/training-course-sessions/${session.training_course_session_id}/attendance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setStatus("Attendance saved.");
      onSaved();
    } catch (err) {
      setStatus(`Attendance save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      id={`training-session-${session.training_course_session_id}`}
      className={`scroll-mt-24 rounded-lg border bg-card p-3 ${isSelected ? "ring-2 ring-emerald-500 ring-offset-1" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{session.session_title || `Session ${session.training_course_session_id}`}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge className={statusChipClass(session.status)} variant="outline">
              {session.status}
            </Badge>
            {session.session_date ? <span>{session.session_date}</span> : null}
            {session.start_time || session.end_time ? (
              <span>
                {session.start_time || "?"}
                {session.end_time ? ` → ${session.end_time}` : ""}
              </span>
            ) : null}
            {session.session_hours !== null ? <span>{session.session_hours} hrs</span> : null}
            {session.delivery_mode ? <span>{formatTrainingDeliveryMode(session.delivery_mode)}</span> : null}
            <span>{session.attendance_count} attendance records</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onOpenSession(session)}>
            Focus
          </Button>
          <Button variant="outline" onClick={saveSession} disabled={saving}>
            {saving ? "Saving..." : "Save Session"}
          </Button>
          <Button onClick={saveAttendance} disabled={saving}>
            {saving ? "Saving..." : "Save Attendance"}
          </Button>
        </div>
      </div>
      {status ? <div className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">{status}</div> : null}

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <Label>Session Title</Label>
          <Input value={sessionDraft.session_title} onChange={(e) => setSessionDraft((p) => ({ ...p, session_title: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Date</Label>
          <Input type="date" value={sessionDraft.session_date} onChange={(e) => setSessionDraft((p) => ({ ...p, session_date: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={sessionDraft.status} onValueChange={(v) => setSessionDraft((p) => ({ ...p, status: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRAINING_SESSION_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Start Time</Label>
          <Input type="time" value={sessionDraft.start_time} onChange={(e) => setSessionDraft((p) => ({ ...p, start_time: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>End Time</Label>
          <Input type="time" value={sessionDraft.end_time} onChange={(e) => setSessionDraft((p) => ({ ...p, end_time: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Hours</Label>
          <Input type="number" min="0" step="0.25" value={sessionDraft.session_hours} onChange={(e) => setSessionDraft((p) => ({ ...p, session_hours: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Delivery Mode</Label>
          <Select value={sessionDraft.delivery_mode || "__none__"} onValueChange={(v) => setSessionDraft((p) => ({ ...p, delivery_mode: v === "__none__" ? "" : v }))}>
            <SelectTrigger>
              <SelectValue placeholder="Select mode..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No default</SelectItem>
              {TRAINING_DELIVERY_MODE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Venue</Label>
          <Input value={sessionDraft.venue_name} onChange={(e) => setSessionDraft((p) => ({ ...p, venue_name: e.target.value }))} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Location Notes</Label>
          <Input value={sessionDraft.venue_address} onChange={(e) => setSessionDraft((p) => ({ ...p, venue_address: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Online Link</Label>
          <Input value={sessionDraft.online_meeting_url} onChange={(e) => setSessionDraft((p) => ({ ...p, online_meeting_url: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Meeting ID</Label>
          <Input value={sessionDraft.online_meeting_id} onChange={(e) => setSessionDraft((p) => ({ ...p, online_meeting_id: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Passcode</Label>
          <Input value={sessionDraft.online_passcode} onChange={(e) => setSessionDraft((p) => ({ ...p, online_passcode: e.target.value }))} />
        </div>
        <div className="space-y-2 md:col-span-3">
          <Label>Notes</Label>
          <Textarea value={sessionDraft.notes} onChange={(e) => setSessionDraft((p) => ({ ...p, notes: e.target.value }))} rows={2} />
        </div>
      </div>

      <div className="mt-4 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Participant</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Attendance</TableHead>
              <TableHead>Minutes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runBookings.length ? (
              runBookings.map((booking) => {
                const current = attendanceDraft[booking.training_booking_id] || {
                  attendance_status: booking.attendance_status || "booked",
                  attendance_minutes: "",
                };
                return (
                  <TableRow key={booking.training_booking_id}>
                    <TableCell>
                      <div className="font-medium">{booking.person_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatTrainingParticipantType(booking.participant_type)} • {formatTrainingBookingSource(booking.booking_source)}
                      </div>
                    </TableCell>
                    <TableCell>{booking.client_name || "External"}</TableCell>
                    <TableCell>
                      <Select
                        value={current.attendance_status}
                        onValueChange={(v) =>
                          setAttendanceDraft((prev) => ({
                            ...prev,
                            [booking.training_booking_id]: {
                              ...current,
                              attendance_status: v,
                            },
                          }))
                        }
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRAINING_ATTENDANCE_STATUS_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        className="w-28"
                        value={current.attendance_minutes}
                        onChange={(e) =>
                          setAttendanceDraft((prev) => ({
                            ...prev,
                            [booking.training_booking_id]: {
                              ...current,
                              attendance_minutes: e.target.value,
                            },
                          }))
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  Add participants to record attendance.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function BookingEditorCard({
  booking,
  entitlements,
  baseUrl,
  onSaved,
}: {
  booking: TrainingBooking;
  entitlements: TrainingEntitlement[];
  baseUrl: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const entitlementOptions = (() => {
    if (booking.entitlement_id === null) return entitlements;
    const exists = entitlements.some((entitlement) => entitlement.training_entitlement_id === booking.entitlement_id);
    if (exists) return entitlements;
    return [
      ...entitlements,
      {
        training_entitlement_id: booking.entitlement_id,
        org_id: booking.org_id || "",
        source_job_id: null,
        source_job_number: booking.source_job_number || null,
        source_client_db_id: booking.client_db_id,
        entitlement_type: "free_place",
        status: booking.entitlement_status || "consumed",
        allocated_to_booking_id: booking.training_booking_id,
        reserved_at: null,
        consumed_at: null,
        expires_at: null,
        notes: null,
        source_job_client_name: booking.client_name,
        allocated_booking_name: booking.person_name,
        created_at: null,
        created_by: null,
        updated_at: null,
        updated_by: null,
      },
    ];
  })();
  const [draft, setDraft] = useState<BookingFormState>(() => ({
    client_db_id: booking.client_db_id === null ? "" : String(booking.client_db_id),
    contact_id: booking.contact_id === null ? "" : String(booking.contact_id),
    participant_type: booking.participant_type || "external_individual",
    booking_source: booking.booking_source || "manual",
    person_name: booking.person_name || "",
    person_email: booking.person_email || "",
    person_phone: booking.person_phone || "",
    billing_status: booking.billing_status || "pending",
    attendance_status: booking.attendance_status || "booked",
    special_requirements: booking.special_requirements || "",
    consent_status: booking.consent_status || "unknown",
    notes: booking.notes || "",
    entitlement_id: booking.entitlement_id === null ? "__none__" : String(booking.entitlement_id),
  }));

  useEffect(() => {
    setDraft({
      client_db_id: booking.client_db_id === null ? "" : String(booking.client_db_id),
      contact_id: booking.contact_id === null ? "" : String(booking.contact_id),
      participant_type: booking.participant_type || "external_individual",
      booking_source: booking.booking_source || "manual",
      person_name: booking.person_name || "",
      person_email: booking.person_email || "",
      person_phone: booking.person_phone || "",
      billing_status: booking.billing_status || "pending",
      attendance_status: booking.attendance_status || "booked",
      special_requirements: booking.special_requirements || "",
      consent_status: booking.consent_status || "unknown",
      notes: booking.notes || "",
      entitlement_id: booking.entitlement_id === null ? "__none__" : String(booking.entitlement_id),
    });
  }, [booking]);

  async function saveBooking() {
    setSaving(true);
    setStatus("");
    try {
      const payload = {
        ...draft,
        client_db_id: toNumberOrNull(draft.client_db_id),
        contact_id: toNumberOrNull(draft.contact_id),
        entitlement_id: parseSelectNumber(draft.entitlement_id),
      };
      const res = await fetch(`${baseUrl}/training-bookings/${booking.training_booking_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
      }
      setStatus("Participant saved.");
      onSaved();
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{booking.person_name}</div>
          <div className="text-xs text-muted-foreground">
            {booking.client_name ? `${booking.client_name} • ` : ""}
            {formatTrainingParticipantType(booking.participant_type)} • {formatTrainingBookingSource(booking.booking_source)}
          </div>
        </div>
        <Button onClick={saveBooking} disabled={saving} variant="outline" size="sm">
          {saving ? "Saving..." : "Save Participant"}
        </Button>
      </div>
      {status ? <div className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">{status}</div> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={draft.person_name} onChange={(e) => setDraft((p) => ({ ...p, person_name: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={draft.person_email} onChange={(e) => setDraft((p) => ({ ...p, person_email: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input value={draft.person_phone} onChange={(e) => setDraft((p) => ({ ...p, person_phone: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Participant Type</Label>
          <Select value={draft.participant_type} onValueChange={(v) => setDraft((p) => ({ ...p, participant_type: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRAINING_PARTICIPANT_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Booking Source</Label>
          <Select value={draft.booking_source} onValueChange={(v) => setDraft((p) => ({ ...p, booking_source: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRAINING_BOOKING_SOURCE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Billing Status</Label>
          <Select value={draft.billing_status} onValueChange={(v) => setDraft((p) => ({ ...p, billing_status: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRAINING_BILLING_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Attendance</Label>
          <Select value={draft.attendance_status} onValueChange={(v) => setDraft((p) => ({ ...p, attendance_status: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRAINING_BOOKING_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Entitlement</Label>
          <Select value={draft.entitlement_id} onValueChange={(v) => setDraft((p) => ({ ...p, entitlement_id: v }))}>
            <SelectTrigger>
              <SelectValue placeholder="No entitlement" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No entitlement</SelectItem>
              {entitlementOptions.map((entitlement) => (
                <SelectItem key={entitlement.training_entitlement_id} value={String(entitlement.training_entitlement_id)}>
                  {entitlement.source_job_number || `Job ${entitlement.source_job_id ?? "—"}`} - {formatTrainingEntitlementStatus(entitlement.status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Client DB ID</Label>
          <Input type="number" min="0" value={draft.client_db_id} onChange={(e) => setDraft((p) => ({ ...p, client_db_id: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Contact ID</Label>
          <Input type="number" min="0" value={draft.contact_id} onChange={(e) => setDraft((p) => ({ ...p, contact_id: e.target.value }))} />
        </div>
        <div className="space-y-2 md:col-span-3">
          <Label>Special Requirements</Label>
          <Input value={draft.special_requirements} onChange={(e) => setDraft((p) => ({ ...p, special_requirements: e.target.value }))} />
        </div>
        <div className="space-y-2 md:col-span-3">
          <Label>Notes</Label>
          <Textarea value={draft.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} rows={2} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge className={statusChipClass(booking.attendance_status)} variant="outline">
          {formatTrainingBookingStatus(booking.attendance_status)}
        </Badge>
        <Badge className={statusChipClass(booking.billing_status)} variant="outline">
          {formatTrainingBillingStatus(booking.billing_status)}
        </Badge>
        <span>{booking.entitlement_id ? `Linked entitlement ${booking.entitlement_id}` : "No entitlement linked"}</span>
      </div>
    </div>
  );
}
