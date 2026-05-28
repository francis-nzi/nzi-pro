"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

type Props = {
  clientId: number;
  baseUrl: string;
  jobs?: JobRef[];
};

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

// ── Helpers ────────────────────────────────────────────────────────────────

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
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function itemBorderColor(item: InboxItem): string {
  if (item.kind === "task") {
    const isOverdue =
      item.dueAt &&
      new Date(item.dueAt).getTime() < Date.now() &&
      item.status !== "done" &&
      item.status !== "closed";
    if (isOverdue) return "border-l-red-500";
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
  if (ch === "email")
    return item.direction === "inbound" ? "border-l-violet-400" : "border-l-emerald-400";
  if (ch === "call") return "border-l-cyan-400";
  if (ch === "meeting") return "border-l-teal-400";
  return "border-l-slate-300";
}

function TypeBadge({ item }: { item: InboxItem }) {
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
      <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
        Task
      </span>
    );
  }
  if (isTp) {
    return (
      <span className="shrink-0 rounded-sm bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        Touchpoint
      </span>
    );
  }
  const ch = (item.channel || "email").toLowerCase();
  const labels: Record<string, string> = {
    email: "Email",
    call: "Call",
    meeting: "Meeting",
    chat: "Chat",
    message: "Message",
    note: "Note",
  };
  const colors: Record<string, string> = {
    email: "bg-emerald-100 text-emerald-700",
    call: "bg-cyan-100 text-cyan-700",
    meeting: "bg-teal-100 text-teal-700",
    chat: "bg-sky-100 text-sky-700",
    message: "bg-sky-100 text-sky-700",
    note: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colors[ch] ?? "bg-slate-100 text-slate-600"}`}
    >
      {labels[ch] ?? ch}
    </span>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  if (!direction || direction === "internal") return null;
  const cfg: Record<string, { cls: string; label: string }> = {
    inbound: { cls: "bg-violet-100 text-violet-700", label: "↓ Inbound" },
    outbound: { cls: "bg-emerald-100 text-emerald-700", label: "↑ Outbound" },
  };
  const c = cfg[direction];
  if (!c) return null;
  return (
    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${c.cls}`}>
      {c.label}
    </span>
  );
}

function StatusBadge({ status, kind }: { status: string; kind: "communication" | "task" }) {
  const cfg: Record<string, string> = {
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
  const cls = cfg[status] ?? "bg-slate-100 text-slate-600";
  const label = kind === "task" && status === "in_progress" ? "In Progress" : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  );
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
  const [taskStatusFilter, setTaskStatusFilter] = useState("open");
  const [feedFilter, setFeedFilter] = useState<"all" | "touchpoints" | "communications">("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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
      const timelineParams = new URLSearchParams();
      timelineParams.set("limit", "200");
      timelineParams.set("offset", "0");
      if (jobFilter !== "all") timelineParams.set("job_id", jobFilter);

      const taskParams = new URLSearchParams();
      taskParams.set("limit", "200");
      taskParams.set("offset", "0");
      if (jobFilter !== "all") taskParams.set("job_id", jobFilter);

      const [eventsRes, tasksRes] = await Promise.all([
        fetch(`${baseUrl}/clients/${clientId}/timeline?${timelineParams.toString()}`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/tasks?${taskParams.toString()}`, { credentials: "include" }),
      ]);

      if (!eventsRes.ok) {
        const txt = await eventsRes.text().catch(() => "");
        throw new Error(`Failed to load communications (${eventsRes.status})${txt ? `: ${txt}` : ""}`);
      }
      if (!tasksRes.ok) {
        const txt = await tasksRes.text().catch(() => "");
        throw new Error(`Failed to load tasks (${tasksRes.status})${txt ? `: ${txt}` : ""}`);
      }

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

  useEffect(() => {
    void load();
  }, [load]);

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

  // Pre-set To field with primary contact when contacts load
  useEffect(() => {
    if (clientContacts.length > 0 && !emailTo) {
      setEmailTo(clientContacts[0].email);
    }
  }, [clientContacts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load job files when a job is selected for email
  useEffect(() => {
    if (emailJobId === "none") {
      setJobFiles([]);
      setSelectedJobFileIds(new Set());
      setShowJobFiles(false);
      return;
    }
    fetch(`${baseUrl}/jobs/${emailJobId}/files`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setJobFiles(Array.isArray(data?.files) ? data.files : []);
      })
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

  const inboxItems = useMemo<InboxItem[]>(() => {
    const eventItems: InboxItem[] = communicationEvents.map((ev) => ({
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

    const taskItems: InboxItem[] = tasks.map((t) => ({
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

    return [...eventItems, ...taskItems].sort((a, b) =>
      String(b.timestamp || "").localeCompare(String(a.timestamp || "")),
    );
  }, [communicationEvents, tasks, jobMap]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inboxItems.filter((item) => {
      if (typeFilter !== "all" && item.kind !== typeFilter) return false;
      if (directionFilter !== "all" && item.direction !== directionFilter) return false;
      if (
        feedFilter === "touchpoints" &&
        (item.source || "").toLowerCase() !== "intelligence" &&
        !(item.source_ref || "").toLowerCase().startsWith("touchpoint:")
      )
        return false;
      if (
        feedFilter === "communications" &&
        ((item.source || "").toLowerCase() === "intelligence" ||
          (item.source_ref || "").toLowerCase().startsWith("touchpoint:"))
      )
        return false;
      if (item.kind === "task" && taskStatusFilter !== "all" && item.status !== taskStatusFilter) return false;
      if (!q) return true;
      return `${item.title} ${item.channel ?? ""} ${item.direction} ${item.body} ${item.createdBy} ${item.assignee ?? ""}`.toLowerCase().includes(q);
    });
  }, [inboxItems, query, typeFilter, directionFilter, taskStatusFilter, feedFilter]);

  async function createEvent() {
    if (!newBody.trim()) {
      setStatus("Message is required.");
      return;
    }
    try {
      const body = {
        job_id: newJobId !== "none" ? Number(newJobId) : null,
        event_type: "note",
        channel: newChannel,
        direction: newDirection,
        subject: newSubject.trim(),
        body_text: newBody.trim(),
        status: "logged",
      };
      const res = await fetch(`${baseUrl}/clients/${clientId}/timeline/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to save communication (${res.status})${txt ? `: ${txt}` : ""}`);
      }
      setNewSubject("");
      setNewBody("");
      setActiveModal(null);
      setStatus(newChannel === "note" ? "Note logged. Open the Notes tab to view and manage it." : "Communication logged.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function createTask() {
    if (!taskTitle.trim()) {
      setStatus("Task title is required.");
      return;
    }
    try {
      const body = {
        job_id: taskJobId !== "none" ? Number(taskJobId) : null,
        title: taskTitle.trim(),
        details: taskDetails.trim(),
        assignee_user_id: taskAssignee.trim() || null,
        notify_assignee: taskNotifyAssignee && !!taskAssignee.trim(),
        priority: taskPriority,
        due_at: taskDueAt || null,
        status: "open",
      };
      const res = await fetch(`${baseUrl}/clients/${clientId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to create task (${res.status})${txt ? `: ${txt}` : ""}`);
      }
      const notified = taskNotifyAssignee && !!taskAssignee.trim();
      setTaskTitle("");
      setTaskDetails("");
      setTaskAssignee("");
      setTaskNotifyAssignee(false);
      setTaskPriority("normal");
      setTaskDueAt("");
      setActiveModal(null);
      setStatus(`Task created.${notified ? " Assignee notified by email." : ""}`);
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function updateTaskStatus(taskId: number, nextStatus: string) {
    try {
      const res = await fetch(`${baseUrl}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to update task (${res.status})${txt ? `: ${txt}` : ""}`);
      }
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
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: "closed" }),
        });
      } else if (item.eventId) {
        res = await fetch(`${baseUrl}/clients/${clientId}/timeline/events/${item.eventId}/archive`, {
          method: "PATCH",
          credentials: "include",
        });
      } else return;
      if (!res.ok) throw new Error(`Archive failed (${res.status})`);
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function sendEmail() {
    if (emailJobId === "none") {
      setStatus("Select a job to send email from.");
      return;
    }
    if (!emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) {
      setStatus("To, Subject, and Message are required.");
      return;
    }
    const parseCsv = (s: string) => s.split(",").map((e) => e.trim()).filter(Boolean);

    const totalBytes = localFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > 25 * 1024 * 1024) {
      setStatus("Total attachment size exceeds 25 MB. Please remove some files.");
      return;
    }

    try {
      const fd = new FormData();
      fd.append("to_email", emailTo.trim());
      fd.append("subject", emailSubject.trim());
      fd.append("message_text", emailBody.trim());
      fd.append("cc", JSON.stringify(emailCc.trim() ? parseCsv(emailCc) : []));
      fd.append("bcc", JSON.stringify(emailBcc.trim() ? parseCsv(emailBcc) : []));
      fd.append("job_file_ids", JSON.stringify([...selectedJobFileIds]));
      for (const f of localFiles) {
        fd.append("files", f);
      }

      const res = await fetch(`${baseUrl}/jobs/${Number(emailJobId)}/communications/email`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to send email (${res.status})${txt ? `: ${txt}` : ""}`);
      }
      setEmailSubject("");
      setEmailBody("");
      setEmailCc("");
      setEmailBcc("");
      setLocalFiles([]);
      setSelectedJobFileIds(new Set());
      setShowJobFiles(false);
      setActiveModal(null);
      setStatus("Email sent and logged.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function runAutomation() {
    setAutomationResult("");
    try {
      const payload = {
        trigger_key: automationTrigger,
        client_db_id: clientId,
        job_id: automationJobId !== "none" ? Number(automationJobId) : null,
        mode: automationMode,
      };
      const res = await fetch(`${baseUrl}/automation/test-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Automation failed (${res.status})${txt ? `: ${txt}` : ""}`);
      setAutomationResult(txt);
      setStatus(`Automation ${automationMode} run complete.`);
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const openTasks = tasks.filter(
    (t) => (t.status || "").toLowerCase() !== "done" && (t.status || "").toLowerCase() !== "closed",
  ).length;
  const overdueTasks = tasks.filter((t) => {
    if (!t.due_at) return false;
    const dueDate = new Date(t.due_at);
    return (
      !Number.isNaN(dueDate.getTime()) &&
      dueDate.getTime() < Date.now() &&
      (t.status || "").toLowerCase() !== "done" &&
      (t.status || "").toLowerCase() !== "closed"
    );
  }).length;

  return (
    <div className="space-y-6">
      {status ? <div className="rounded-md bg-muted p-3 text-sm">{status}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Communications Inbox ({filteredItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-2 md:col-span-2">
              <Label>Search</Label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search subject, message, assignee..."
              />
            </div>
            <div className="space-y-2">
              <Label>Job</Label>
              <Select value={jobFilter} onValueChange={setJobFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Jobs</SelectItem>
                  {jobs.map((j) => (
                    <SelectItem key={j.job_id} value={String(j.job_id)}>
                      {j.job_number || `Job ${j.job_id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
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
            <div className="space-y-2">
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
          <div className="flex items-center justify-between gap-3">
            <Label>Feed</Label>
            <div className="flex flex-wrap items-center gap-2">
              {(["all", "touchpoints", "communications"] as const).map((f) => (
                <Button
                  key={f}
                  type="button"
                  variant={feedFilter === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFeedFilter(f)}
                >
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
          </div>

          {/* Inbox list */}
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No inbox items match the current filters.
            </div>
          ) : (
            <div className="divide-y rounded-md border overflow-hidden">
              {filteredItems.map((item, idx) => {
                const isExpanded = expandedIds.has(item.id);
                const isOverdue =
                  item.kind === "task" &&
                  !!item.dueAt &&
                  new Date(item.dueAt).getTime() < Date.now() &&
                  item.status !== "done" &&
                  item.status !== "closed";

                return (
                  <div
                    key={item.id}
                    className={`border-l-4 ${itemBorderColor(item)} px-4 py-3 ${idx % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                  >
                    {/* Row 1: badges · title · status · timestamp */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        <TypeBadge item={item} />
                        {item.kind === "communication" && <DirectionBadge direction={item.direction} />}
                        {item.kind === "task" && item.priority && item.priority !== "normal" && (
                          <span
                            className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                              item.priority === "urgent"
                                ? "bg-red-100 text-red-700"
                                : "bg-orange-100 text-orange-700"
                            }`}
                          >
                            {item.priority}
                          </span>
                        )}
                        {isOverdue && (
                          <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            OVERDUE
                          </span>
                        )}
                        <button
                          className="min-w-0 truncate text-left text-sm font-medium hover:underline"
                          onClick={() => toggleExpand(item.id)}
                        >
                          {item.title}
                        </button>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={item.status} kind={item.kind} />
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtTs(item.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Row 2: meta · actions */}
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {item.createdBy && <span>{item.createdBy}</span>}
                        {item.jobRef && (
                          <>
                            <span>·</span>
                            <span className="font-medium text-foreground/60">{item.jobRef}</span>
                          </>
                        )}
                        {item.kind === "task" && item.dueAt && (
                          <>
                            <span>·</span>
                            <span className={isOverdue ? "font-medium text-red-600" : ""}>
                              Due {fmtTs(item.dueAt)}
                            </span>
                          </>
                        )}
                        {item.kind === "task" && item.assignee && (
                          <>
                            <span>·</span>
                            <span>→ {item.assignee}</span>
                          </>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {item.kind === "task" && item.taskId ? (
                          <Select
                            value={item.status || "open"}
                            onValueChange={(v) => void updateTaskStatus(item.taskId as number, v)}
                          >
                            <SelectTrigger className="h-7 w-[130px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="done">Done</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          title="Archive"
                          onClick={() => void archiveItem(item)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Expandable body */}
                    {item.body ? (
                      <div className="mt-2">
                        {isExpanded ? (
                          <>
                            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
                            <button
                              className="mt-1 flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => toggleExpand(item.id)}
                            >
                              <ChevronUp className="h-3 w-3" /> Collapse
                            </button>
                          </>
                        ) : (
                          <button
                            className="flex w-full items-center gap-0.5 truncate text-left text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => toggleExpand(item.id)}
                          >
                            <ChevronDown className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {item.body.slice(0, 120)}
                              {item.body.length > 120 ? "…" : ""}
                            </span>
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
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

      {/* Recipient datalist — always in DOM for autocomplete */}
      <datalist id={`recipients-${clientId}`}>
        {clientContacts.map((r) => (
          <option key={`c-${r.email}`} value={r.email} label={`${r.name} (Client)`} />
        ))}
        {teamMembers.map((r) => (
          <option key={`t-${r.email}`} value={r.email} label={`${r.name} (Team)`} />
        ))}
      </datalist>

      {/* Log Communication modal */}
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
                    {jobs.map((j) => (
                      <SelectItem key={j.job_id} value={String(j.job_id)}>
                        {j.job_number || `Job ${j.job_id}`}
                      </SelectItem>
                    ))}
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

      {/* Create Task modal */}
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
                    {jobs.map((j) => (
                      <SelectItem key={j.job_id} value={String(j.job_id)}>
                        {j.job_number || `Job ${j.job_id}`}
                      </SelectItem>
                    ))}
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
                <Input
                  list={`recipients-${clientId}`}
                  value={taskAssignee}
                  onChange={(e) => setTaskAssignee(e.target.value)}
                  placeholder="Search team or contacts..."
                />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={taskDueAt} onChange={(e) => setTaskDueAt(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={taskNotifyAssignee}
                onChange={(e) => setTaskNotifyAssignee(e.target.checked)}
                disabled={!taskAssignee.trim()}
                className="h-4 w-4"
              />
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

      {/* Email modal */}
      <Dialog open={activeModal === "email"} onOpenChange={(o) => { if (!o) setActiveModal(null); }}>
        <DialogContent className="max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle>Email Client / Contact</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Sent via admin@netzero.international · your name and signature auto-applied · client replies go to your inbox</p>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Job (required)</Label>
                <Select value={emailJobId} onValueChange={setEmailJobId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select job</SelectItem>
                    {jobs.map((j) => (
                      <SelectItem key={j.job_id} value={String(j.job_id)}>
                        {j.job_number || `Job ${j.job_id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <Input list={`recipients-${clientId}`} value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="name@client.com" />
              </div>
              <div className="space-y-1.5">
                <Label>CC <span className="text-xs font-normal text-muted-foreground">comma-separated</span></Label>
                <Input list={`recipients-${clientId}`} value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="cc@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label>BCC <span className="text-xs font-normal text-muted-foreground">comma-separated</span></Label>
                <Input list={`recipients-${clientId}`} value={emailBcc} onChange={(e) => setEmailBcc(e.target.value)} placeholder="bcc@example.com" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Re: Carbon report..." />
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={5} placeholder="Type your message here..." />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Attachments</Label>
                <span className="text-xs text-muted-foreground">
                  {localFiles.length + selectedJobFileIds.size > 0
                    ? `${localFiles.length + selectedJobFileIds.size} file(s) · ${(localFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB`
                    : "None"}
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
                <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                  {jobFiles.map((jf) => (
                    <label key={jf.file_id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 text-sm">
                      <input type="checkbox" checked={selectedJobFileIds.has(jf.file_id)} onChange={(e) => { setSelectedJobFileIds((prev) => { const n = new Set(prev); e.target.checked ? n.add(jf.file_id) : n.delete(jf.file_id); return n; }); }} className="shrink-0" />
                      <span className="truncate">{jf.file_name}</span>
                      {jf.file_size ? <span className="ml-auto text-xs text-muted-foreground shrink-0">{(jf.file_size / 1024).toFixed(0)} KB</span> : null}
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
                    <span key={`job-${jf.file_id}`} className="flex items-center gap-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2.5 py-0.5 text-xs">
                      {jf.file_name}
                      <button type="button" className="ml-0.5 opacity-70 hover:opacity-100" onClick={() => setSelectedJobFileIds((prev) => { const n = new Set(prev); n.delete(jf.file_id); return n; })}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex gap-2">
                <Button onClick={() => void sendEmail()}>Send Email</Button>
                <Button variant="ghost" onClick={() => setActiveModal(null)}>Cancel</Button>
              </div>
              {emailTo && emailSubject && (
                <span className="text-xs text-muted-foreground">To: {emailTo}{emailCc ? ` · CC: ${emailCc}` : ""}</span>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                  {jobs.map((j) => (
                    <SelectItem key={j.job_id} value={String(j.job_id)}>
                      {j.job_number || `Job ${j.job_id}`}
                    </SelectItem>
                  ))}
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
