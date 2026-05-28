"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type JobFile = { file_id: number; file_name: string; mime_type: string | null; file_size: number | null };
type JobRef = { job_id: number; job_number: string; job_name?: string };

type EventItem = {
  event_id: number;
  client_db_id: number;
  job_id: number | null;
  event_type: string;
  channel: string;
  direction: string;
  subject: string;
  body_text: string;
  source?: string;
  source_ref?: string;
  status: string;
  created_by: string;
  created_at: string | null;
  event_at?: string | null;
};

type TaskItem = {
  task_id: number;
  client_db_id: number;
  job_id: number | null;
  title: string;
  details: string;
  assignee_user_id: string;
  priority: string;
  due_at: string | null;
  status: string;
  created_by: string;
  created_at: string | null;
};

type Props = { clientId: number; baseUrl: string; jobs?: JobRef[] };

type InboxItem = {
  kind: "communication" | "task";
  id: string;
  title: string;
  body: string;
  status: string;
  direction: string;
  timestamp: string;
  createdBy: string;
  jobRef: string | null;
  channel?: string;
  source?: string;
  source_ref?: string;
  taskId?: number;
  eventId?: number;
  priority?: string;
  dueAt?: string | null;
  assignee?: string;
};

type SortCol = "type" | "title" | "contact" | "job" | "due" | "status";

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveDisplayName(
  value: string | null | undefined,
  contacts: Array<{ name: string; email: string }>,
  team: Array<{ name: string; email: string }>,
): string {
  if (!value) return "—";
  const bare = value.trim().replace(/^(team:|client:)/, "");
  const found = [...contacts, ...team].find((p) => p.email === bare || p.email === value.trim());
  return found?.name || bare || "—";
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 2) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  if (Math.floor(diffHours / 24) === 1) return "yesterday";
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function fmtDatetime(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtAbsolute(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function itemBorderColor(item: InboxItem): string {
  if (item.kind === "task") {
    const overdue =
      item.dueAt &&
      new Date(item.dueAt).getTime() < Date.now() &&
      item.status !== "done" &&
      item.status !== "closed";
    if (overdue) return "border-l-red-500";
    if (item.priority === "urgent") return "border-l-red-400";
    if (item.priority === "high") return "border-l-orange-400";
    if (item.status === "done" || item.status === "closed") return "border-l-slate-300";
    return "border-l-blue-400";
  }
  const isTp =
    (item.source || "").toLowerCase() === "intelligence" ||
    (item.source_ref || "").toLowerCase().startsWith("touchpoint:");
  if (isTp) return "border-l-amber-400";
  const ch = (item.channel || "email").toLowerCase();
  if (ch === "email") return item.direction === "inbound" ? "border-l-violet-400" : "border-l-emerald-400";
  if (ch === "call") return "border-l-cyan-400";
  if (ch === "meeting") return "border-l-teal-400";
  return "border-l-slate-300";
}

function TypeCell({ item }: { item: InboxItem }) {
  const isTp =
    (item.source || "").toLowerCase() === "intelligence" ||
    (item.source_ref || "").toLowerCase().startsWith("touchpoint:");

  if (item.kind === "task") {
    const cls =
      item.priority === "urgent"
        ? "bg-red-100 text-red-700"
        : item.priority === "high"
        ? "bg-orange-100 text-orange-700"
        : "bg-blue-100 text-blue-700";
    return (
      <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
        Task
      </span>
    );
  }
  if (isTp) return <span className="inline-flex items-center rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Touchpoint</span>;
  const ch = (item.channel || "email").toLowerCase();
  const map: Record<string, [string, string]> = {
    email: ["bg-emerald-100 text-emerald-700", "Email"],
    call: ["bg-cyan-100 text-cyan-700", "Call"],
    meeting: ["bg-teal-100 text-teal-700", "Meeting"],
    chat: ["bg-sky-100 text-sky-700", "Chat"],
    message: ["bg-sky-100 text-sky-700", "Message"],
    note: ["bg-slate-100 text-slate-600", "Note"],
  };
  const [cls, label] = map[ch] ?? ["bg-slate-100 text-slate-600", ch];
  return <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>;
}

function StatusPill({ status, kind }: { status: string; kind: "communication" | "task" }) {
  const map: Record<string, string> = {
    sent: "bg-emerald-100 text-emerald-700",
    logged: "bg-slate-100 text-slate-600",
    open: "bg-blue-100 text-blue-700",
    in_progress: "bg-amber-100 text-amber-700",
    done: "bg-green-100 text-green-700",
    closed: "bg-slate-100 text-slate-500",
    draft: "bg-yellow-100 text-yellow-700",
    archived: "bg-slate-100 text-slate-400",
  };
  if (!status) return null;
  const cls = map[status] ?? "bg-slate-100 text-slate-600";
  const label =
    kind === "task" && status === "in_progress"
      ? "In Progress"
      : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${cls}`}>{label}</span>;
}

function SortIcon({ col, active, dir }: { col: string; active: string; dir: "asc" | "desc" }) {
  if (col !== active) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/40" />;
  return dir === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3" />
    : <ArrowDown className="ml-1 inline h-3 w-3" />;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ClientCommunications({ clientId, baseUrl, jobs = [] }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  const [jobFilter, setJobFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [feedFilter, setFeedFilter] = useState<"all" | "touchpoints" | "communications">("all");
  const [sortCol, setSortCol] = useState<SortCol>("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editAssignee, setEditAssignee] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editPriority, setEditPriority] = useState("normal");
  const [taskHistory, setTaskHistory] = useState<Array<{ history_id: number; changed_at: string; changed_by: string; changes: Array<{ field: string; from: string | null; to: string | null }> }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [newJobId, setNewJobId] = useState<string>("none");
  const [newDirection, setNewDirection] = useState("internal");
  const [newChannel, setNewChannel] = useState("email");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");

  const [taskJobId, setTaskJobId] = useState<string>("none");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskNotifyAssignee, setTaskNotifyAssignee] = useState(false);
  const [taskPriority, setTaskPriority] = useState("normal");
  const [taskDueAt, setTaskDueAt] = useState("");

  const [emailJobId, setEmailJobId] = useState<string>("none");
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailBcc, setEmailBcc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailErrors, setEmailErrors] = useState<{ job?: string; to?: string; subject?: string; message?: string }>({});
  const [clientContacts, setClientContacts] = useState<Array<{ name: string; email: string; group: string }>>([]);
  const [teamMembers, setTeamMembers] = useState<Array<{ name: string; email: string; group: string }>>([]);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [jobFiles, setJobFiles] = useState<JobFile[]>([]);
  const [selectedJobFileIds, setSelectedJobFileIds] = useState<Set<number>>(new Set());
  const [showJobFiles, setShowJobFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [automationTrigger, setAutomationTrigger] = useState("milestone_status");
  const [automationMode, setAutomationMode] = useState("preview");
  const [automationJobId, setAutomationJobId] = useState<string>("none");
  const [automationResult, setAutomationResult] = useState("");
  const [activeModal, setActiveModal] = useState<"log" | "task" | "email" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const tp = new URLSearchParams({ limit: "200", offset: "0" });
      const tk = new URLSearchParams({ limit: "200", offset: "0" });
      if (jobFilter !== "all") { tp.set("job_id", jobFilter); tk.set("job_id", jobFilter); }

      const [eventsRes, tasksRes] = await Promise.all([
        fetch(`${baseUrl}/clients/${clientId}/timeline?${tp.toString()}`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/tasks?${tk.toString()}`, { credentials: "include" }),
      ]);
      if (!eventsRes.ok) throw new Error(`Failed to load communications (${eventsRes.status})`);
      if (!tasksRes.ok) throw new Error(`Failed to load tasks (${tasksRes.status})`);
      const eventsJson = await eventsRes.json();
      const tasksJson = await tasksRes.json();
      setEvents(Array.isArray(eventsJson?.items) ? eventsJson.items : []);
      setTasks(Array.isArray(tasksJson?.items) ? tasksJson.items : []);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId, jobFilter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    fetch(`${baseUrl}/clients/${clientId}/email-recipients`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setClientContacts(Array.isArray(data.contacts) ? data.contacts : []);
        setTeamMembers(Array.isArray(data.team) ? data.team : []);
      })
      .catch(() => {});
  }, [baseUrl, clientId]);

  useEffect(() => {
    if (clientContacts.length > 0 && !emailTo) setEmailTo(clientContacts[0].email);
  }, [clientContacts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (emailJobId === "none") { setJobFiles([]); setSelectedJobFileIds(new Set()); setShowJobFiles(false); return; }
    fetch(`${baseUrl}/jobs/${emailJobId}/files`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setJobFiles(Array.isArray(data?.files) ? data.files : []))
      .catch(() => setJobFiles([]));
  }, [baseUrl, emailJobId]);

  const communicationEvents = useMemo(
    () => events.filter((ev) => (ev.event_type || "").toLowerCase() !== "note"),
    [events],
  );

  const jobMap = useMemo(
    () => Object.fromEntries(jobs.map((j) => [j.job_id, j.job_number || `Job ${j.job_id}`])),
    [jobs],
  );

  const resolve = useCallback(
    (v: string | null | undefined) => resolveDisplayName(v, clientContacts, teamMembers),
    [clientContacts, teamMembers],
  );

  const inboxItems = useMemo<InboxItem[]>(() => {
    const evs: InboxItem[] = communicationEvents.map((ev) => ({
      kind: "communication",
      id: `event-${ev.event_id}`,
      title: ev.subject || "(No subject)",
      body: ev.body_text || "",
      status: ev.status || "logged",
      direction: ev.direction || "internal",
      timestamp: ev.event_at || ev.created_at || "",
      createdBy: ev.created_by || "",
      jobRef: ev.job_id != null ? (jobMap[ev.job_id] ?? `Job ${ev.job_id}`) : null,
      channel: ev.channel || "email",
      source: ev.source,
      source_ref: ev.source_ref,
      eventId: ev.event_id,
    }));
    const tks: InboxItem[] = tasks.map((t) => ({
      kind: "task",
      id: `task-${t.task_id}`,
      title: t.title || "(Untitled task)",
      body: t.details || "",
      status: t.status || "open",
      direction: "internal",
      timestamp: t.created_at || "",
      createdBy: t.created_by || "",
      jobRef: t.job_id != null ? (jobMap[t.job_id] ?? `Job ${t.job_id}`) : null,
      taskId: t.task_id,
      priority: t.priority || "normal",
      dueAt: t.due_at ?? null,
      assignee: t.assignee_user_id || "",
    }));
    return [...evs, ...tks];
  }, [communicationEvents, tasks, jobMap]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inboxItems.filter((item) => {
      if (typeFilter !== "all" && item.kind !== typeFilter) return false;
      if (directionFilter !== "all" && item.direction !== directionFilter) return false;
      if (feedFilter === "touchpoints" &&
        (item.source || "").toLowerCase() !== "intelligence" &&
        !(item.source_ref || "").toLowerCase().startsWith("touchpoint:")) return false;
      if (feedFilter === "communications" &&
        ((item.source || "").toLowerCase() === "intelligence" ||
          (item.source_ref || "").toLowerCase().startsWith("touchpoint:"))) return false;
      if (item.kind === "task" && taskStatusFilter !== "all" && item.status !== taskStatusFilter) return false;
      if (!q) return true;
      return `${item.title} ${item.channel ?? ""} ${item.direction} ${item.body} ${item.createdBy} ${item.assignee ?? ""}`.toLowerCase().includes(q);
    });
  }, [inboxItems, query, typeFilter, directionFilter, taskStatusFilter, feedFilter]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let av = "", bv = "";
      switch (sortCol) {
        case "type":
          av = a.kind + (a.channel || ""); bv = b.kind + (b.channel || ""); break;
        case "title":
          av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
        case "contact":
          av = resolve(a.assignee || a.createdBy).toLowerCase();
          bv = resolve(b.assignee || b.createdBy).toLowerCase();
          break;
        case "job":
          av = a.jobRef || ""; bv = b.jobRef || ""; break;
        case "due":
          av = a.kind === "task" && a.dueAt ? a.dueAt : (a.timestamp || "9999");
          bv = b.kind === "task" && b.dueAt ? b.dueAt : (b.timestamp || "9999");
          break;
        case "status":
          av = a.status; bv = b.status; break;
      }
      const cmp = av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredItems, sortCol, sortDir, resolve]);

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  async function createEvent() {
    if (!newBody.trim()) { setStatus("Message is required."); return; }
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/timeline/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          job_id: newJobId !== "none" ? Number(newJobId) : null,
          event_type: "note",
          channel: newChannel,
          direction: newDirection,
          subject: newSubject.trim(),
          body_text: newBody.trim(),
          status: "logged",
        }),
      });
      if (!res.ok) throw new Error(`Failed to save communication (${res.status})`);
      setNewSubject(""); setNewBody(""); setActiveModal(null);
      setStatus(newChannel === "note" ? "Note logged. Open the Notes tab to view it." : "Communication logged.");
      await load();
    } catch (e) { setStatus((e as Error).message); }
  }

  async function createTask() {
    if (!taskTitle.trim()) { setStatus("Task title is required."); return; }
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          job_id: taskJobId !== "none" ? Number(taskJobId) : null,
          title: taskTitle.trim(),
          details: taskDetails.trim(),
          assignee_user_id: taskAssignee.trim() || null,
          notify_assignee: taskNotifyAssignee && !!taskAssignee.trim(),
          priority: taskPriority,
          due_at: taskDueAt || null,
          status: "open",
        }),
      });
      if (!res.ok) throw new Error(`Failed to create task (${res.status})`);
      const notified = taskNotifyAssignee && !!taskAssignee.trim();
      setTaskTitle(""); setTaskDetails(""); setTaskAssignee(""); setTaskNotifyAssignee(false); setTaskPriority("normal"); setTaskDueAt("");
      setActiveModal(null);
      setStatus(`Task created.${notified ? " Assignee notified by email." : ""}`);
      await load();
    } catch (e) { setStatus((e as Error).message); }
  }

  async function updateTaskStatus(taskId: number, nextStatus: string) {
    try {
      const res = await fetch(`${baseUrl}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error(`Failed to update task (${res.status})`);
      setSelectedItem((prev) => prev ? { ...prev, status: nextStatus } : null);
      // Refresh history after status change
      if (selectedItem?.taskId) {
        fetch(`${baseUrl}/tasks/${selectedItem.taskId}/history`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => setTaskHistory(Array.isArray(data?.items) ? data.items : []))
          .catch(() => {});
      }
      await load();
    } catch (e) { setStatus((e as Error).message); }
  }

  function openDetail(item: InboxItem) {
    setSelectedItem(item);
    setEditMode(false);
    setEditTitle(item.title);
    setEditDetails(item.body);
    setEditAssignee(item.assignee || "");
    setEditDueAt(item.dueAt ? item.dueAt.slice(0, 10) : "");
    setEditPriority(item.priority || "normal");
    setTaskHistory([]);
    if (item.kind === "task" && item.taskId) {
      setHistoryLoading(true);
      fetch(`${baseUrl}/tasks/${item.taskId}/history`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setTaskHistory(Array.isArray(data?.items) ? data.items : []))
        .catch(() => setTaskHistory([]))
        .finally(() => setHistoryLoading(false));
    }
  }

  async function saveTaskEdit() {
    if (!selectedItem?.taskId) return;
    try {
      const res = await fetch(`${baseUrl}/tasks/${selectedItem.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: editTitle.trim(),
          details: editDetails.trim(),
          assignee_user_id: editAssignee.trim() || null,
          due_at: editDueAt || null,
          priority: editPriority,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setEditMode(false);
      setSelectedItem((prev) =>
        prev
          ? {
              ...prev,
              title: editTitle.trim(),
              body: editDetails.trim(),
              assignee: editAssignee.trim() || "",
              dueAt: editDueAt || null,
              priority: editPriority,
            }
          : null,
      );
      // Reload history
      setHistoryLoading(true);
      fetch(`${baseUrl}/tasks/${selectedItem.taskId}/history`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setTaskHistory(Array.isArray(data?.items) ? data.items : []))
        .catch(() => setTaskHistory([]))
        .finally(() => setHistoryLoading(false));
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function archiveItem(item: InboxItem) {
    try {
      let res: Response;
      if (item.kind === "task" && item.taskId) {
        res = await fetch(`${baseUrl}/tasks/${item.taskId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ status: "closed" }),
        });
      } else if (item.eventId) {
        res = await fetch(`${baseUrl}/clients/${clientId}/timeline/events/${item.eventId}/archive`, {
          method: "PATCH", credentials: "include",
        });
      } else return;
      if (!res.ok) throw new Error(`Archive failed (${res.status})`);
      setSelectedItem(null);
      await load();
    } catch (e) { setStatus((e as Error).message); }
  }

  async function sendEmail() {
    const errs: { job?: string; to?: string; subject?: string; message?: string } = {};
    if (emailJobId === "none") errs.job = "Please select a job.";
    if (!emailTo.trim()) errs.to = "Recipient email is required.";
    if (!emailSubject.trim()) errs.subject = "Subject is required.";
    if (!emailBody.trim()) errs.message = "Message is required.";
    if (Object.keys(errs).length > 0) { setEmailErrors(errs); return; }
    setEmailErrors({});
    const parseCsv = (s: string) => s.split(",").map((e) => e.trim()).filter(Boolean);
    if (localFiles.reduce((s, f) => s + f.size, 0) > 25 * 1024 * 1024) { setStatus("Total attachment size exceeds 25 MB."); return; }
    setEmailSending(true);
    try {
      const fd = new FormData();
      fd.append("to_email", emailTo.trim());
      fd.append("subject", emailSubject.trim());
      fd.append("message_text", emailBody.trim());
      fd.append("cc", JSON.stringify(emailCc.trim() ? parseCsv(emailCc) : []));
      fd.append("bcc", JSON.stringify(emailBcc.trim() ? parseCsv(emailBcc) : []));
      fd.append("job_file_ids", JSON.stringify([...selectedJobFileIds]));
      for (const f of localFiles) fd.append("files", f);
      const res = await fetch(`${baseUrl}/jobs/${Number(emailJobId)}/communications/email`, { method: "POST", credentials: "include", body: fd });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail || `Failed to send email (${res.status})`);
      }
      setEmailSubject(""); setEmailBody(""); setEmailCc(""); setEmailBcc("");
      setLocalFiles([]); setSelectedJobFileIds(new Set()); setShowJobFiles(false);
      setActiveModal(null); setStatus("Email sent and logged."); await load();
    } catch (e) { setStatus((e as Error).message); }
    finally { setEmailSending(false); }
  }

  async function runAutomation() {
    setAutomationResult("");
    try {
      const res = await fetch(`${baseUrl}/automation/test-run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ trigger_key: automationTrigger, client_db_id: clientId, job_id: automationJobId !== "none" ? Number(automationJobId) : null, mode: automationMode }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Automation failed (${res.status}): ${txt}`);
      setAutomationResult(txt); setStatus(`Automation ${automationMode} run complete.`); await load();
    } catch (e) { setStatus((e as Error).message); }
  }

  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "closed").length;
  const overdueTasks = tasks.filter((t) => {
    if (!t.due_at) return false;
    const d = new Date(t.due_at);
    return !Number.isNaN(d.getTime()) && d.getTime() < Date.now() && t.status !== "done" && t.status !== "closed";
  }).length;

  // ── Render ──────────────────────────────────────────────────────────────

  const thCls = "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none whitespace-nowrap";
  const thBtn = "flex items-center hover:text-foreground transition-colors";

  return (
    <div className="space-y-6">
      {status ? <div className="rounded-md bg-muted p-3 text-sm">{status}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Communications Inbox ({sortedItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Search</Label>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject, message, assignee..." />
            </div>
            <div className="space-y-1.5">
              <Label>Job</Label>
              <Select value={jobFilter} onValueChange={setJobFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Jobs</SelectItem>
                  {jobs.map((j) => <SelectItem key={j.job_id} value={String(j.job_id)}>{j.job_number || `Job ${j.job_id}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="communication">Communications</SelectItem>
                  <SelectItem value="task">Tasks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Direction</Label>
              <Select value={directionFilter} onValueChange={setDirectionFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="internal">Internal</SelectItem>
                  <SelectItem value="inbound">Inbound</SelectItem>
                  <SelectItem value="outbound">Outbound</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">Communications</div>
              <div className="text-lg font-semibold">{communicationEvents.length}</div>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">Open Tasks</div>
              <div className="text-lg font-semibold">{openTasks}</div>
            </div>
            <div className={`rounded-md border p-3 text-sm ${overdueTasks > 0 ? "border-red-200 bg-red-50/40" : ""}`}>
              <div className="text-muted-foreground">Overdue Tasks</div>
              <div className={`text-lg font-semibold ${overdueTasks > 0 ? "text-red-600" : ""}`}>{overdueTasks}</div>
            </div>
          </div>

          {/* Feed filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "touchpoints", "communications"] as const).map((f) => (
              <Button key={f} type="button" variant={feedFilter === f ? "default" : "outline"} size="sm" onClick={() => setFeedFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
            <Select value={taskStatusFilter} onValueChange={setTaskStatusFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Task Statuses</SelectItem>
                <SelectItem value="open">Open Tasks</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="closed">Closed / Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : sortedItems.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No inbox items match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className={thCls} style={{ width: "90px" }}>
                      <button className={thBtn} onClick={() => handleSort("type")}>
                        Type <SortIcon col="type" active={sortCol} dir={sortDir} />
                      </button>
                    </th>
                    <th className={thCls}>
                      <button className={thBtn} onClick={() => handleSort("title")}>
                        Subject / Title <SortIcon col="title" active={sortCol} dir={sortDir} />
                      </button>
                    </th>
                    <th className={thCls} style={{ width: "170px" }}>
                      <button className={thBtn} onClick={() => handleSort("contact")}>
                        Contact / Assignee <SortIcon col="contact" active={sortCol} dir={sortDir} />
                      </button>
                    </th>
                    <th className={thCls} style={{ width: "110px" }}>
                      <button className={thBtn} onClick={() => handleSort("job")}>
                        Job <SortIcon col="job" active={sortCol} dir={sortDir} />
                      </button>
                    </th>
                    <th className={thCls} style={{ width: "120px" }}>
                      <button className={thBtn} onClick={() => handleSort("due")}>
                        Due / Date <SortIcon col="due" active={sortCol} dir={sortDir} />
                      </button>
                    </th>
                    <th className={thCls} style={{ width: "110px" }}>
                      <button className={thBtn} onClick={() => handleSort("status")}>
                        Status <SortIcon col="status" active={sortCol} dir={sortDir} />
                      </button>
                    </th>
                    <th className={thCls} style={{ width: "40px" }} />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortedItems.map((item, idx) => {
                    const isOverdue =
                      item.kind === "task" &&
                      !!item.dueAt &&
                      new Date(item.dueAt).getTime() < Date.now() &&
                      item.status !== "done" &&
                      item.status !== "closed";
                    const contactDisplay =
                      item.kind === "task"
                        ? resolve(item.assignee || item.createdBy)
                        : resolve(item.createdBy);
                    const dueDisplay =
                      item.kind === "task" && item.dueAt
                        ? fmtAbsolute(item.dueAt)
                        : fmtTs(item.timestamp);

                    return (
                      <tr
                        key={item.id}
                        className={`cursor-pointer transition-colors hover:bg-muted/50 ${idx % 2 === 1 ? "bg-muted/10" : ""}`}
                        onClick={() => openDetail(item)}
                      >
                        <td className={`border-l-4 ${itemBorderColor(item)} px-3 py-2.5`}>
                          <TypeCell item={item} />
                        </td>
                        <td className="px-3 py-2.5 font-medium">
                          <div className="flex items-center gap-1.5 truncate max-w-[320px]">
                            <span className="truncate">{item.title}</span>
                            {isOverdue && (
                              <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                OVERDUE
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="truncate px-3 py-2.5 text-muted-foreground max-w-[170px]">
                          <span className="truncate block max-w-[160px]" title={contactDisplay}>
                            {contactDisplay}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {item.jobRef || "—"}
                        </td>
                        <td className={`px-3 py-2.5 whitespace-nowrap text-xs ${isOverdue ? "font-medium text-red-600" : "text-muted-foreground"}`}>
                          {dueDisplay}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusPill status={item.status} kind={item.kind} />
                        </td>
                        <td
                          className="px-2 py-2.5 text-center"
                          onClick={(e) => { e.stopPropagation(); void archiveItem(item); }}
                        >
                          <button
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Archive"
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => setActiveModal("log")}>Log Communication</Button>
        <Button variant="outline" onClick={() => setActiveModal("task")}>Create Task</Button>
        <Button onClick={() => setActiveModal("email")}>Email Client / Contact</Button>
      </div>

      {/* Recipient datalist */}
      <datalist id={`recipients-${clientId}`}>
        {clientContacts.map((r) => <option key={`c-${r.email}`} value={r.email} label={`${r.name} (Client)`} />)}
        {teamMembers.map((r) => <option key={`t-${r.email}`} value={r.email} label={`${r.name} (Team)`} />)}
      </datalist>

      {/* ── Detail modal ─────────────────────────────────────────────────── */}
      <Dialog open={!!selectedItem} onOpenChange={(o) => { if (!o) { setSelectedItem(null); setEditMode(false); } }}>
        <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {selectedItem && (() => {
            const item = selectedItem;
            const isOverdue =
              item.kind === "task" &&
              !!item.dueAt &&
              new Date(item.dueAt).getTime() < Date.now() &&
              item.status !== "done" &&
              item.status !== "closed";
            const isTp =
              (item.source || "").toLowerCase() === "intelligence" ||
              (item.source_ref || "").toLowerCase().startsWith("touchpoint:");
            const contactDisplay =
              item.kind === "task"
                ? resolve(item.assignee || item.createdBy)
                : resolve(item.createdBy);

            const fieldLabel: Record<string, string> = {
              title: "Title", details: "Details", assignee_user_id: "Assignee",
              priority: "Priority", due_at: "Due date", sla_due_at: "SLA due", status: "Status",
            };

            return (
              <>
                <DialogHeader>
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <TypeCell item={item} />
                    {item.kind === "communication" && item.direction && item.direction !== "internal" && (
                      <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${item.direction === "inbound" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {item.direction === "inbound" ? "↓ Inbound" : "↑ Outbound"}
                      </span>
                    )}
                    {isTp && <span className="inline-flex items-center rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Touchpoint</span>}
                    {isOverdue && <span className="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">OVERDUE</span>}
                  </div>
                  <DialogTitle className="leading-snug text-lg">
                    {editMode ? (
                      <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="text-base font-semibold" />
                    ) : item.title}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-5 mt-2">
                  {/* Meta grid */}
                  <div className="grid grid-cols-3 gap-x-6 gap-y-3 rounded-md bg-muted/30 p-4 text-sm">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                        {item.kind === "task" ? "Assignee" : "Logged by"}
                      </div>
                      {editMode && item.kind === "task" ? (
                        <Input list={`recipients-${clientId}`} value={editAssignee} onChange={(e) => setEditAssignee(e.target.value)} className="h-7 text-xs" />
                      ) : (
                        <div className="font-medium">{contactDisplay}</div>
                      )}
                    </div>
                    {item.jobRef && (
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Job</div>
                        <div className="font-medium">{item.jobRef}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Created</div>
                      <div>{fmtDatetime(item.timestamp)}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{resolve(item.createdBy)}</div>
                    </div>
                    {item.kind === "task" && (
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Due date</div>
                        {editMode ? (
                          <Input type="date" value={editDueAt} onChange={(e) => setEditDueAt(e.target.value)} className="h-7 text-xs" />
                        ) : (
                          <div className={isOverdue ? "font-semibold text-red-600" : ""}>
                            {item.dueAt ? fmtAbsolute(item.dueAt) : "—"}
                          </div>
                        )}
                      </div>
                    )}
                    {item.kind === "task" && (
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Priority</div>
                        {editMode ? (
                          <Select value={editPriority} onValueChange={setEditPriority}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="normal">Normal</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="capitalize">{item.priority || "normal"}</div>
                        )}
                      </div>
                    )}
                    {item.kind === "communication" && item.channel && (
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Channel</div>
                        <div className="capitalize">{item.channel}</div>
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-3">
                    <Label className="text-xs uppercase tracking-wide shrink-0">Status</Label>
                    {item.kind === "task" && item.taskId ? (
                      <Select value={item.status || "open"} onValueChange={(v) => void updateTaskStatus(item.taskId as number, v)}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <StatusPill status={item.status} kind={item.kind} />
                    )}
                  </div>

                  {/* Body / details */}
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wide">{item.kind === "task" ? "Details" : "Message"}</Label>
                    {editMode && item.kind === "task" ? (
                      <Textarea value={editDetails} onChange={(e) => setEditDetails(e.target.value)} rows={4} />
                    ) : item.body ? (
                      <div className="max-h-48 overflow-y-auto rounded-md bg-muted/30 p-3 text-sm whitespace-pre-wrap">{item.body}</div>
                    ) : (
                      <div className="text-sm text-muted-foreground italic">No details.</div>
                    )}
                  </div>

                  {/* Edit action row */}
                  {item.kind === "task" && (
                    <div className="flex items-center gap-2">
                      {editMode ? (
                        <>
                          <Button size="sm" onClick={() => void saveTaskEdit()}>Save changes</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>Edit task</Button>
                      )}
                    </div>
                  )}

                  {/* Audit history */}
                  {item.kind === "task" && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Change history</div>
                      {historyLoading ? (
                        <div className="text-xs text-muted-foreground">Loading...</div>
                      ) : taskHistory.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic">No changes recorded yet.</div>
                      ) : (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {taskHistory.map((h) => (
                            <div key={h.history_id} className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="font-medium">{resolve(h.changed_by)}</span>
                                <span className="text-muted-foreground">{fmtDatetime(h.changed_at)}</span>
                              </div>
                              <div className="space-y-0.5">
                                {h.changes.map((c, i) => (
                                  <div key={i} className="flex items-baseline gap-1 text-muted-foreground">
                                    <span className="font-medium text-foreground">{fieldLabel[c.field] ?? c.field}:</span>
                                    {c.from ? <><span className="line-through opacity-60">{c.from}</span><span>→</span></> : null}
                                    <span className="text-foreground">{c.to ?? "—"}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between gap-2 border-t pt-3">
                    <Button variant="outline" size="sm" onClick={() => void archiveItem(item)}>
                      <Archive className="mr-1.5 h-3.5 w-3.5" />
                      {item.kind === "task" ? "Close task" : "Archive"}
                    </Button>
                    <Button variant="ghost" onClick={() => { setSelectedItem(null); setEditMode(false); }}>Close</Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Log Communication modal ───────────────────────────────────────── */}
      <Dialog open={activeModal === "log"} onOpenChange={(o) => { if (!o) setActiveModal(null); }}>
        <DialogContent className="max-w-xl w-full">
          <DialogHeader><DialogTitle>Log Communication</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Job</Label>
                <Select value={newJobId} onValueChange={setNewJobId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No job</SelectItem>
                    {jobs.map((j) => <SelectItem key={j.job_id} value={String(j.job_id)}>{j.job_number || `Job ${j.job_id}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Direction</Label>
                <Select value={newDirection} onValueChange={setNewDirection}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal</SelectItem>
                    <SelectItem value="inbound">Inbound</SelectItem>
                    <SelectItem value="outbound">Outbound</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={newChannel} onValueChange={setNewChannel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Note</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="chat">Chat</SelectItem>
                    <SelectItem value="message">Message</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={5} />
            </div>
            <p className="text-xs text-muted-foreground">Notes logged here appear in the Notes tab rather than this inbox.</p>
            <div className="flex gap-2 pt-1">
              <Button onClick={() => void createEvent()}>Log Entry</Button>
              <Button variant="ghost" onClick={() => setActiveModal(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create Task modal ──────────────────────────────────────────────── */}
      <Dialog open={activeModal === "task"} onOpenChange={(o) => { if (!o) setActiveModal(null); }}>
        <DialogContent className="max-w-xl w-full">
          <DialogHeader><DialogTitle>Create Task</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Job</Label>
                <Select value={taskJobId} onValueChange={setTaskJobId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No job</SelectItem>
                    {jobs.map((j) => <SelectItem key={j.job_id} value={String(j.job_id)}>{j.job_number || `Job ${j.job_id}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={taskPriority} onValueChange={setTaskPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Task Title</Label>
              <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Details</Label>
              <Textarea value={taskDetails} onChange={(e) => setTaskDetails(e.target.value)} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Assignee <span className="text-xs font-normal text-muted-foreground">team or contact</span></Label>
                <Input list={`recipients-${clientId}`} value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)} placeholder="Search team or contacts..." />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={taskDueAt} onChange={(e) => setTaskDueAt(e.target.value)} />
              </div>
            </div>
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
              <input type="checkbox" checked={taskNotifyAssignee} onChange={(e) => setTaskNotifyAssignee(e.target.checked)} disabled={!taskAssignee.trim()} className="h-4 w-4" />
              Notify assignee by email when task is created
              {!taskAssignee.trim() && <span className="text-xs text-muted-foreground">(select assignee first)</span>}
            </label>
            <div className="flex gap-2 pt-1">
              <Button onClick={() => void createTask()}>Create Task</Button>
              <Button variant="ghost" onClick={() => setActiveModal(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Email modal ────────────────────────────────────────────────────── */}
      <Dialog open={activeModal === "email"} onOpenChange={(o) => { if (!o) { setActiveModal(null); setEmailErrors({}); } }}>
        <DialogContent className="max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle>Email Client / Contact</DialogTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">Sent via admin@netzero.international · your name and signature auto-applied</p>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label>Job (required)</Label>
                <Select value={emailJobId} onValueChange={(v) => { setEmailJobId(v); if (v !== "none") setEmailErrors((p) => ({ ...p, job: undefined })); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select job</SelectItem>
                    {jobs.map((j) => <SelectItem key={j.job_id} value={String(j.job_id)}>{j.job_number || `Job ${j.job_id}`}</SelectItem>)}
                  </SelectContent>
                </Select>
                {emailErrors.job && <p className="text-xs font-medium text-red-600">{emailErrors.job}</p>}
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label>To</Label>
                <Input list={`recipients-${clientId}`} value={emailTo} onChange={(e) => { setEmailTo(e.target.value); if (e.target.value.trim()) setEmailErrors((p) => ({ ...p, to: undefined })); }} placeholder="name@client.com" className="min-w-0 w-full" />
                {emailErrors.to && <p className="text-xs font-medium text-red-600">{emailErrors.to}</p>}
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label>CC <span className="text-xs font-normal text-muted-foreground">comma-separated</span></Label>
                <Input list={`recipients-${clientId}`} value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="cc@example.com" className="min-w-0 w-full" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label>BCC <span className="text-xs font-normal text-muted-foreground">comma-separated</span></Label>
                <Input list={`recipients-${clientId}`} value={emailBcc} onChange={(e) => setEmailBcc(e.target.value)} placeholder="bcc@example.com" className="min-w-0 w-full" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={emailSubject} onChange={(e) => { setEmailSubject(e.target.value); if (e.target.value.trim()) setEmailErrors((p) => ({ ...p, subject: undefined })); }} placeholder="Re: Carbon report..." />
              {emailErrors.subject && <p className="text-xs font-medium text-red-600">{emailErrors.subject}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea value={emailBody} onChange={(e) => { setEmailBody(e.target.value); if (e.target.value.trim()) setEmailErrors((p) => ({ ...p, message: undefined })); }} rows={5} placeholder="Type your message here..." />
              {emailErrors.message && <p className="text-xs font-medium text-red-600">{emailErrors.message}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Attachments</Label>
                <span className="text-xs text-muted-foreground">
                  {localFiles.length + selectedJobFileIds.size > 0 ? `${localFiles.length + selectedJobFileIds.size} file(s) · ${(localFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB` : "None"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>+ Upload from computer</Button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { setLocalFiles((prev) => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
                {emailJobId !== "none" && jobFiles.length > 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowJobFiles((v) => !v)}>
                    {showJobFiles ? "Hide job files" : `Attach from job (${jobFiles.length})`}
                  </Button>
                )}
              </div>
              {showJobFiles && jobFiles.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                  {jobFiles.map((jf) => (
                    <label key={jf.file_id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                      <input type="checkbox" checked={selectedJobFileIds.has(jf.file_id)} onChange={(e) => { setSelectedJobFileIds((prev) => { const n = new Set(prev); e.target.checked ? n.add(jf.file_id) : n.delete(jf.file_id); return n; }); }} className="shrink-0" />
                      <span className="truncate">{jf.file_name}</span>
                      {jf.file_size ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{(jf.file_size / 1024).toFixed(0)} KB</span> : null}
                    </label>
                  ))}
                </div>
              )}
              {(localFiles.length > 0 || selectedJobFileIds.size > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {localFiles.map((f, i) => (
                    <span key={`local-${i}`} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs">
                      {f.name}
                      <button type="button" className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={() => setLocalFiles((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                    </span>
                  ))}
                  {jobFiles.filter((jf) => selectedJobFileIds.has(jf.file_id)).map((jf) => (
                    <span key={`job-${jf.file_id}`} className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      {jf.file_name}
                      <button type="button" className="ml-0.5 opacity-70 hover:opacity-100" onClick={() => setSelectedJobFileIds((prev) => { const n = new Set(prev); n.delete(jf.file_id); return n; })}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex gap-2">
                <Button onClick={() => void sendEmail()} disabled={emailSending}>
                  {emailSending ? "Sending…" : "Send Email"}
                </Button>
                <Button variant="ghost" onClick={() => setActiveModal(null)} disabled={emailSending}>Cancel</Button>
              </div>
              {emailTo && emailSubject && <span className="text-xs text-muted-foreground">To: {emailTo}{emailCc ? ` · CC: ${emailCc}` : ""}</span>}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Automation Runner ──────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Automation Runner</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Trigger</Label>
                <Select value={automationTrigger} onValueChange={setAutomationTrigger}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="milestone_status">milestone_status</SelectItem>
                    <SelectItem value="no_client_reply">no_client_reply</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select value={automationMode} onValueChange={setAutomationMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="preview">preview</SelectItem>
                    <SelectItem value="send">send</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Job (optional)</Label>
              <Select value={automationJobId} onValueChange={setAutomationJobId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All jobs for client</SelectItem>
                  {jobs.map((j) => <SelectItem key={j.job_id} value={String(j.job_id)}>{j.job_number || `Job ${j.job_id}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => void runAutomation()}>Run Automation</Button>
            <Textarea value={automationResult} readOnly rows={8} placeholder="Automation run output..." />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
