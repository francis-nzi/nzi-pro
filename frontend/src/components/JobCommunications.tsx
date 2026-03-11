"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
  mode?: "all" | "inbox" | "timeline" | "email" | "tasks" | "automation";
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

export default function JobCommunications({ jobId, baseUrl, mode = "all" }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [data, setData] = useState<CommunicationsResponse | null>(null);

  const [channel, setChannel] = useState("note");
  const [direction, setDirection] = useState("internal");
  const [subject, setSubject] = useState("");
  const [messageText, setMessageText] = useState("");

  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [taskDueDate, setTaskDueDate] = useState("");

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

  const showInbox = mode === "all" || mode === "inbox";
  const showTimeline = mode === "all" || mode === "timeline";
  const showEmail = mode === "all" || mode === "email";
  const showTasks = mode === "all" || mode === "tasks";
  const showAutomation = mode === "all" || mode === "automation";
  const showLogCard = mode === "all" || mode === "timeline";

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

  async function addTask() {
    if (!taskTitle.trim()) {
      setStatus("Task title is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/communications/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: taskTitle.trim(),
          details: taskDetails.trim(),
          assigned_to: taskAssignee || null,
          priority: taskPriority,
          due_date: taskDueDate || null,
          status: "open",
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Task save failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      setTaskTitle("");
      setTaskDetails("");
      setTaskAssignee("");
      setTaskPriority("normal");
      setTaskDueDate("");
      setStatus("Task created.");
      await load();
    } catch (e) {
      setStatus(`Error creating task: ${(e as Error).message}`);
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

      <div className="grid gap-6 lg:grid-cols-3">
        {showLogCard ? (
          <Card>
            <CardHeader><CardTitle>Log Communication</CardTitle></CardHeader>
            <CardContent className="space-y-3">
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

        {showTasks ? (
          <Card>
            <CardHeader><CardTitle>Internal Tasks</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Task Title</Label>
                <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Details</Label>
                <Textarea value={taskDetails} onChange={(e) => setTaskDetails(e.target.value)} rows={4} />
              </div>
              <div className="space-y-2">
                <Label>Assign To</Label>
                <Select value={taskAssignee} onValueChange={setTaskAssignee}>
                  <SelectTrigger><SelectValue placeholder="Select team member" /></SelectTrigger>
                  <SelectContent>
                    {teamUsers.map((u) => (
                      <SelectItem key={u.email || u.full_name} value={u.email || u.full_name}>
                        {u.full_name || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} />
                </div>
              </div>
              <Button onClick={addTask} disabled={saving}>Create Task</Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

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

      <div className="grid gap-6 lg:grid-cols-2">
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
                  <div key={t.task_id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">{t.priority}</div>
                    </div>
                    {t.details ? <div className="mt-1 text-sm text-muted-foreground">{t.details}</div> : null}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">Assigned: {t.assigned_to || "-"} | Due: {t.due_date || "-"} | By: {t.created_by || "-"}</div>
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
                ))
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
