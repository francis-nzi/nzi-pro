"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import JobOverviewLetter from "@/components/JobOverviewLetter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import TaskAssigneePicker, { type TaskAssigneeOption } from "@/components/TaskAssigneePicker";
import { Edit } from "lucide-react";

type Communication = {
  communication_id: number;
  direction: string;
  channel: string;
  subject: string;
  message_text: string;
  to_email: string;
  status: string;
  event_at: string | null;
  created_by: string;
  created_at: string | null;
  updated_by?: string | null;
  archived?: boolean;
  archived_at?: string | null;
  archived_by?: string | null;
};

type Task = {
  task_id: number;
  title: string;
  details: string;
  assigned_to: string;
  priority: string;
  status: string;
  due_date: string | null;
  created_by: string;
  created_at?: string | null;
  completed_at?: string | null;
};

type UserLookup = { email: string; full_name: string };
type ContactLookup = { contact_id: number; full_name: string; email: string; is_primary: boolean };

type CommunicationsResponse = {
  communications: Communication[];
  tasks: Task[];
  lookups: {
    users: UserLookup[];
    contacts: ContactLookup[];
  };
  summary: {
    communications_count: number;
    open_tasks_count: number;
    overdue_tasks_count: number;
  };
};

type Props = {
  jobId: number;
  baseUrl: string;
  mode?: "all" | "inbox" | "timeline" | "notes" | "email" | "tasks" | "automation";
};

type InboxItem = {
  kind: "communication" | "task";
  id: string;
  timestamp: string;
  title: string;
  subtitle: string;
  body: string;
  direction: string;
  channel: string;
  status: string;
  owner: string;
  taskId?: number;
};

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function JobCommunications({ jobId, baseUrl, mode = "all" }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [data, setData] = useState<CommunicationsResponse | null>(null);

  const [channel, setChannel] = useState("note");
  const [direction, setDirection] = useState("internal");
  const [subject, setSubject] = useState("");
  const [messageText, setMessageText] = useState("");
  const [editingNote, setEditingNote] = useState<Communication | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editMessageText, setEditMessageText] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskAssignees, setTaskAssignees] = useState<string[]>([]);
  const [taskPriority, setTaskPriority] = useState("normal");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskStatus, setTaskStatus] = useState("open");
  const [taskEditingId, setTaskEditingId] = useState<number | null>(null);

  const [automationRecipient, setAutomationRecipient] = useState("");
  const [sendingAlerts, setSendingAlerts] = useState(false);

  const [inboxQuery, setInboxQuery] = useState("");
  const [inboxType, setInboxType] = useState("all");
  const [inboxDirection, setInboxDirection] = useState("all");
  const [inboxTaskStatus, setInboxTaskStatus] = useState("open");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/communications`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to load communications: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      const json = await res.json();
      setData(json);
      const primary = (json?.lookups?.contacts || []).find((c: ContactLookup) => c.is_primary && c.email);
      if (primary?.email) {
        setEmailTo((prev) => prev || primary.email);
      }
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const teamUsers = useMemo(() => data?.lookups?.users || [], [data]);
  const contacts = useMemo(() => data?.lookups?.contacts || [], [data]);
  const communications = useMemo(() => data?.communications || [], [data]);
  const tasks = useMemo(() => data?.tasks || [], [data]);
  const taskAssigneeOptions = useMemo<TaskAssigneeOption[]>(() => {
    const options: TaskAssigneeOption[] = [];
    const seen = new Set<string>();

    teamUsers.forEach((user) => {
      const label = String(user.full_name || user.email || "").trim();
      if (!label) return;
      const value = `team:${String(user.email || user.full_name || "").trim().toLowerCase()}`;
      if (seen.has(value)) return;
      seen.add(value);
      options.push({
        value,
        label,
        meta: [user.email, "Team member"].filter(Boolean).join(" • "),
      });
    });

    contacts.forEach((contact) => {
      const label = String(contact.full_name || contact.email || "").trim();
      if (!label) return;
      const value = `contact:${contact.contact_id}`;
      if (seen.has(value)) return;
      seen.add(value);
      options.push({
        value,
        label,
        meta: [contact.email, "Client contact"].filter(Boolean).join(" • "),
      });
    });

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [teamUsers, contacts]);

  const taskAssigneeLabels = useMemo(
    () =>
      taskAssignees
        .map((value) => taskAssigneeOptions.find((option) => option.value === value)?.label)
        .filter((value): value is string => Boolean(value)),
    [taskAssignees, taskAssigneeOptions]
  );

  function resetTaskForm() {
    setTaskTitle("");
    setTaskDetails("");
    setTaskAssignees([]);
    setTaskPriority("normal");
    setTaskDueDate("");
    setTaskStatus("open");
    setTaskEditingId(null);
  }

  function parseTaskAssignees(raw: string): string[] {
    const labels = String(raw || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const byLabel = new Map(taskAssigneeOptions.map((option) => [option.label.toLowerCase(), option.value]));
    return labels.map((label) => byLabel.get(label.toLowerCase()) || "").filter(Boolean);
  }

  function openTaskEditor(task: Task) {
    setTaskEditingId(task.task_id);
    setTaskTitle(task.title || "");
    setTaskDetails(task.details || "");
    setTaskAssignees(parseTaskAssignees(task.assigned_to || ""));
    setTaskPriority(task.priority || "normal");
    setTaskDueDate(task.due_date || "");
    setTaskStatus(task.status || "open");
    setStatus(`Editing task ${task.task_id}.`);
  }

  const showInbox = mode === "all" || mode === "inbox";
  const showTimeline = mode === "all" || mode === "timeline" || mode === "notes";
  const showNotes = mode === "notes";
  const showEmail = mode === "all" || mode === "email";
  const showTasks = mode === "all" || mode === "tasks";
  const showAutomation = mode === "all" || mode === "automation";
  const showLogCard = mode === "all" || mode === "timeline" || mode === "notes";
  const mainPanelGridClass = showTimeline && showTasks ? "grid gap-6 lg:grid-cols-2" : "grid gap-6 grid-cols-1";

  const inboxItems = useMemo<InboxItem[]>(() => {
    const commItems: InboxItem[] = communications.map((c) => ({
      kind: "communication",
      id: `comm-${c.communication_id}`,
      timestamp: c.event_at || c.created_at || "",
      title: c.subject || "(No subject)",
      subtitle: `${c.channel} | ${c.direction} | ${c.status}`,
      body: c.message_text || "",
      direction: c.direction || "",
      channel: c.channel || "",
      status: c.status || "",
      owner: c.created_by || "",
    }));

    const taskItems: InboxItem[] = tasks.map((t) => ({
      kind: "task",
      id: `task-${t.task_id}`,
      timestamp: t.created_at || t.due_date || "",
      title: t.title || "(Untitled task)",
      subtitle: `task | ${t.priority || "normal"} | ${t.status || "open"}`,
      body: t.details || "",
      direction: "internal",
      channel: "task",
      status: t.status || "",
      owner: t.assigned_to || t.created_by || "",
      taskId: t.task_id,
    }));

    return [...commItems, ...taskItems].sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  }, [communications, tasks]);

  const filteredInboxItems = useMemo(() => {
    const q = inboxQuery.trim().toLowerCase();
    return inboxItems.filter((item) => {
      if (inboxType !== "all" && item.kind !== inboxType) return false;
      if (inboxDirection !== "all" && item.direction !== inboxDirection) return false;
      if (item.kind === "task" && inboxTaskStatus !== "all" && item.status !== inboxTaskStatus) return false;
      if (!q) return true;
      const haystack = `${item.title} ${item.subtitle} ${item.body} ${item.owner}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [inboxItems, inboxQuery, inboxType, inboxDirection, inboxTaskStatus]);

  const noteOnlyCommunications = useMemo(() => {
    if (!showNotes) return communications;
    return communications.filter((c) => String(c.channel || "").toLowerCase() === "note");
  }, [communications, showNotes]);

  async function addCommunication() {
    if (!messageText.trim()) {
      setStatus("Message is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channel,
          direction,
          subject: subject.trim(),
          message_text: messageText.trim(),
          status: "logged",
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Save failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      setSubject("");
      setMessageText("");
      setStatus("Communication logged.");
      await load();
    } catch (e) {
      setStatus(`Error saving communication: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const openEditNote = useCallback((note: Communication) => {
    setEditingNote(note);
    setEditSubject(note.subject || "");
    setEditMessageText(note.message_text || "");
    setEditError("");
  }, []);

  const saveEditNote = useCallback(async () => {
    if (!editingNote) return;
    setEditBusy(true);
    setEditError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/communications/${editingNote.communication_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: editSubject,
          message_text: editMessageText,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Save failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      setEditingNote(null);
      await load();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditBusy(false);
    }
  }, [baseUrl, editMessageText, editSubject, editingNote, jobId, load]);

  const archiveNote = useCallback(async (note: Communication) => {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/communications/${note.communication_id}/archive`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Archive failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      await load();
    } catch (e) {
      setStatus(`Error archiving note: ${(e as Error).message}`);
    }
  }, [baseUrl, jobId, load]);

  async function sendEmail() {
    if (!emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) {
      setStatus("Email To, Subject, and Message are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/communications/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          to_email: emailTo.trim(),
          subject: emailSubject.trim(),
          message_text: emailBody.trim(),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Email failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      setEmailSubject("");
      setEmailBody("");
      setStatus("Email sent and logged.");
      await load();
    } catch (e) {
      setStatus(`Error sending email: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveTask() {
    if (!taskTitle.trim()) {
      setStatus("Task title is required.");
      return;
    }
    setSaving(true);
    try {
      const isEditing = taskEditingId !== null;
      const res = await fetch(
        `${baseUrl}/jobs/${jobId}/communications/tasks${isEditing ? `/${taskEditingId}` : ""}`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: taskTitle.trim(),
            details: taskDetails.trim(),
            assigned_to: taskAssigneeLabels.join(", ") || null,
            // extract email from "team:email" values so /tasks/my can match by email
            assignee_user_id: taskAssignees
              .filter((v) => v.startsWith("team:"))
              .map((v) => v.replace(/^team:/, ""))
              .join(", ") || null,
            priority: taskPriority,
            due_date: taskDueDate || null,
            status: taskStatus,
          }),
        },
      );
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`${isEditing ? "Task update" : "Task save"} failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      resetTaskForm();
      setStatus(isEditing ? "Task updated." : "Task created.");
      await load();
    } catch (e) {
      setStatus(`Error saving task: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function updateTaskStatus(taskId: number, nextStatus: string) {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/communications/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Task update failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      await load();
    } catch (e) {
      setStatus(`Error updating task: ${(e as Error).message}`);
    }
  }

  async function runMilestoneAutomation(nextMode: "preview" | "send") {
    setSendingAlerts(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/communications/automations/milestone-alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: nextMode,
          notify_to: automationRecipient.trim() || undefined,
          include_amber: true,
          include_red: true,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Automation failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      const json = await res.json();
      setStatus(
        nextMode === "send"
          ? `Milestone automation complete. Logged ${json.logged_count || 0}, emailed ${json.sent_count || 0}.`
          : `Milestone preview complete. Potential alerts: ${(json.alerts || []).length}.`
      );
      await load();
    } catch (e) {
      setStatus(`Error running automation: ${(e as Error).message}`);
    } finally {
      setSendingAlerts(false);
    }
  }

  return (
    <div className="space-y-6">
      {status ? <div className="rounded-md bg-muted p-3 text-sm">{status}</div> : null}

      {showEmail ? (
        <Card>
          <CardHeader><CardTitle>Email Client / Contact</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Contact</Label>
              <Select value={emailTo} onValueChange={(v) => setEmailTo(v)}>
                <SelectTrigger><SelectValue placeholder="Select contact email" /></SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={`contact-${c.contact_id}`} value={c.email || `contact-${c.contact_id}`}>
                      {c.full_name}{c.email ? ` (${c.email})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Email To</Label>
              <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="name@client.com" />
            </div>
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={5} />
            </div>
            <Button onClick={sendEmail} disabled={saving}>Send Email</Button>
          </CardContent>
        </Card>
      ) : null}

      {showEmail ? <JobOverviewLetter jobId={jobId} baseUrl={baseUrl} /> : null}

      {showInbox ? (
        <Card>
          <CardHeader>
            <CardTitle>Communications Inbox ({filteredInboxItems.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Search</Label>
                <Input
                  value={inboxQuery}
                  onChange={(e) => setInboxQuery(e.target.value)}
                  placeholder="Search subject, message, task, owner..."
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={inboxType} onValueChange={setInboxType}>
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
                <Select value={inboxDirection} onValueChange={setInboxDirection}>
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

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border p-3 text-sm">
                <div className="text-muted-foreground">Communications</div>
                <div className="text-lg font-semibold">{data?.summary?.communications_count ?? 0}</div>
              </div>
              <div className="rounded-md border p-3 text-sm">
                <div className="text-muted-foreground">Open Tasks</div>
                <div className="text-lg font-semibold">{data?.summary?.open_tasks_count ?? 0}</div>
              </div>
              <div className="rounded-md border p-3 text-sm">
                <div className="text-muted-foreground">Overdue Tasks</div>
                <div className="text-lg font-semibold">{data?.summary?.overdue_tasks_count ?? 0}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Feed</Label>
                <Select value={inboxTaskStatus} onValueChange={setInboxTaskStatus}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Task Statuses</SelectItem>
                    <SelectItem value="open">Open Tasks</SelectItem>
                    <SelectItem value="in_progress">In Progress Tasks</SelectItem>
                    <SelectItem value="done">Done Tasks</SelectItem>
                    <SelectItem value="closed">Closed Tasks</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : filteredInboxItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">No inbox items match the current filters.</div>
              ) : (
                <div className="space-y-2">
                  {filteredInboxItems.map((item) => (
                    <div key={item.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">[{item.kind === "task" ? "task" : item.channel}] {item.title}</div>
                        <div className="text-xs text-muted-foreground">{item.status || "-"}</div>
                      </div>
                      {item.body ? (
                        <div className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</div>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">{item.subtitle} | {item.owner || "-"} | {item.timestamp || "-"}</div>
                        {item.kind === "task" && item.taskId ? (
                          <Select value={item.status || "open"} onValueChange={(v) => void updateTaskStatus(item.taskId as number, v)}>
                            <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="done">Done</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showNotes ? (
        <div className="space-y-6">
          {showLogCard ? (
            <Card className="w-full">
              <CardHeader>
                <CardTitle>{showNotes ? "Add Note" : "Log Communication"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                  Notes are saved as internal communications and will appear in the job timeline and inbox.
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Direction</Label>
                    <Select value={direction} onValueChange={setDirection}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="internal">Internal</SelectItem>
                        <SelectItem value="inbound">Inbound</SelectItem>
                        <SelectItem value="outbound">Outbound</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Channel</Label>
                    <Select value={channel} onValueChange={setChannel}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full" />
                </div>
                <div className="space-y-2">
                  <Label>Message</Label>
                  <Textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={6} className="w-full" />
                </div>
                <Button onClick={addCommunication} disabled={saving}>Log Entry</Button>
              </CardContent>
            </Card>
          ) : null}

          {showTimeline ? (
            <Card className="w-full">
              <CardHeader>
                <CardTitle>
                  {showNotes ? `Notes Timeline (${noteOnlyCommunications.length})` : `Communication Timeline (${data?.summary?.communications_count ?? 0})`}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : noteOnlyCommunications.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No notes yet.</div>
                ) : (
                  noteOnlyCommunications.map((c) => (
                    <div key={c.communication_id} className="w-full rounded-md border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium break-words">[{c.channel}] {c.subject || "(No subject)"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {c.direction} | {c.created_by || "-"} | {c.event_at || c.created_at || "-"}
                          </div>
                        </div>
                        <Badge variant={c.archived ? "secondary" : "outline"} className="shrink-0">
                          {c.archived ? "Archived" : c.status || "logged"}
                        </Badge>
                      </div>
                      {c.message_text ? (
                        <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{c.message_text}</div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditNote(c)}
                          disabled={Boolean(c.archived)}
                          title={c.archived ? "Archived notes are read-only" : "Edit note"}
                        >
                          Edit
                        </Button>
                        {!c.archived ? (
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void archiveNote(c)}>
                            Archive
                          </Button>
                        ) : null}
                      </div>
                      {c.archived ? (
                        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          Archived notes are read-only.
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
        {showLogCard ? (
          <Card>
            <CardHeader>
              <CardTitle>{showNotes ? "Add Note" : "Log Communication"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {showNotes ? (
                <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                  Notes are saved as internal communications and will appear in the job timeline and inbox.
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Direction</Label>
                  <Select value={direction} onValueChange={setDirection}>
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
                  <Select value={channel} onValueChange={setChannel}>
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
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={5} />
              </div>
              <Button onClick={addCommunication} disabled={saving}>Log Entry</Button>
            </CardContent>
          </Card>
        ) : null}

      {showTasks ? (
          <Card className="w-full">
            <CardHeader><CardTitle>Internal Tasks</CardTitle></CardHeader>
            <CardContent className="space-y-3 w-full">
              <div className="space-y-2">
                <Label>Task Title</Label>
                <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="w-full" />
              </div>
              <div className="space-y-2">
                <Label>Details</Label>
                <Textarea value={taskDetails} onChange={(e) => setTaskDetails(e.target.value)} rows={5} className="w-full" />
              </div>
              <div className="space-y-2">
                <Label>Assign To</Label>
                <TaskAssigneePicker
                  value={taskAssignees}
                  options={taskAssigneeOptions}
                  onChange={setTaskAssignees}
                  placeholder="Search team members or contacts..."
                  emptyMessage="No assignees match your search."
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={taskPriority} onValueChange={setTaskPriority}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} className="w-full" />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={taskStatus} onValueChange={setTaskStatus}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveTask()} disabled={saving}>
                  {taskEditingId ? "Update Task" : "Create Task"}
                </Button>
                {taskEditingId ? (
                  <Button variant="outline" onClick={resetTaskForm} disabled={saving}>
                    Cancel Edit
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
        </div>
      )}

      {showAutomation ? (
        <Card>
          <CardHeader><CardTitle>Milestone Alert Automation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Generate communication alerts when job milestones move to amber/red. Use Preview first, then Send to email notifications.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Alert Recipient (optional, required for Send)</Label>
                <Input value={automationRecipient} onChange={(e) => setAutomationRecipient(e.target.value)} placeholder="crm@company.com" />
              </div>
              <div className="flex items-end gap-2">
                <Button variant="outline" onClick={() => void runMilestoneAutomation("preview")} disabled={sendingAlerts}>
                  Preview
                </Button>
                <Button onClick={() => void runMilestoneAutomation("send")} disabled={sendingAlerts}>
                  Send Alerts
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Uses SMTP settings if configured. All automation events are logged in the communication timeline.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!showNotes ? (
        <div className={mainPanelGridClass}>
          {showTimeline ? (
            <Card>
              <CardHeader>
                <CardTitle>Communication Timeline ({data?.summary?.communications_count ?? 0})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : communications.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No communication entries yet.</div>
                ) : (
                  communications.map((c) => (
                    <div key={c.communication_id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">[{c.channel}] {c.subject || "(No subject)"}</div>
                        <div className="text-xs text-muted-foreground">{c.status}</div>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{c.message_text}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {c.direction} | {c.to_email || "-"} | {c.created_by || "-"} | {c.event_at || c.created_at || "-"}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}

          {showTasks ? (
            <Card>
              <CardHeader>
                <CardTitle>Task Monitor (Open: {data?.summary?.open_tasks_count ?? 0}, Overdue: {data?.summary?.overdue_tasks_count ?? 0})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : tasks.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No tasks yet.</div>
                ) : (
                  tasks.map((t) => (
                    <div key={t.task_id} className="w-full rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{t.title}</div>
                        <div className="text-xs text-muted-foreground">{t.priority}</div>
                      </div>
                      {t.details ? <div className="mt-1 text-sm text-muted-foreground">{t.details}</div> : null}
                      {t.completed_at ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Completed: {formatDateTime(t.completed_at)}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">
                          Assigned: {t.assigned_to || "-"} | Due: {t.due_date || "-"} | By: {t.created_by || "-"}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => openTaskEditor(t)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Select value={t.status} onValueChange={(v) => void updateTaskStatus(t.task_id, v)}>
                            <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="done">Done</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Dialog open={editingNote !== null} onOpenChange={(open) => { if (!open) setEditingNote(null); }}>
        <DialogContent className="!w-[min(98vw,1600px)] !max-w-none">
          <DialogHeader>
            <DialogTitle>Edit Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-1">
              <Label htmlFor="editJobNoteSubject">Subject</Label>
              <Input
                id="editJobNoteSubject"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="Subject (optional)"
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editJobNoteText">Message</Label>
              <Textarea
                id="editJobNoteText"
                value={editMessageText}
                onChange={(e) => setEditMessageText(e.target.value)}
                rows={14}
                placeholder="Note text..."
                className="min-h-[24rem] w-full"
              />
            </div>
            {editError ? <p className="text-sm text-destructive">{editError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingNote(null)} disabled={editBusy}>
              Cancel
            </Button>
            <Button onClick={() => void saveEditNote()} disabled={editBusy || !editMessageText.trim()}>
              {editBusy ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
