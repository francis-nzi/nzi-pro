"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
  subtitle: string;
  body: string;
  status: string;
  direction: string;
  timestamp: string;
  source?: string;
  source_ref?: string;
  taskId?: number;
};

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

  const [newJobId, setNewJobId] = useState<string>("none");
  const [newDirection, setNewDirection] = useState("internal");
  const [newChannel, setNewChannel] = useState("note");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");

  const [taskJobId, setTaskJobId] = useState<string>("none");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [emailJobId, setEmailJobId] = useState<string>("none");
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [automationTrigger, setAutomationTrigger] = useState("milestone_status");
  const [automationMode, setAutomationMode] = useState("preview");
  const [automationJobId, setAutomationJobId] = useState<string>("none");
  const [automationResult, setAutomationResult] = useState("");

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

  const inboxItems = useMemo<InboxItem[]>(() => {
    const eventItems: InboxItem[] = events.map((ev) => ({
      kind: "communication",
      id: `event-${ev.event_id}`,
      title: ev.subject || "(No subject)",
      subtitle: `${ev.channel} | ${ev.direction || "internal"} | ${ev.status || "logged"}`,
      body: ev.body_text || "",
      status: ev.status || "logged",
      direction: ev.direction || "internal",
      timestamp: ev.event_at || ev.created_at || "",
      source: ev.source,
      source_ref: ev.source_ref,
    }));

    const taskItems: InboxItem[] = tasks.map((t) => ({
      kind: "task",
      id: `task-${t.task_id}`,
      title: t.title || "(Untitled task)",
      subtitle: `task | ${t.priority || "normal"} | ${t.status || "open"}`,
      body: t.details || "",
      status: t.status || "open",
      direction: "internal",
      timestamp: t.created_at || t.due_at || "",
      taskId: t.task_id,
    }));

    return [...eventItems, ...taskItems].sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  }, [events, tasks]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inboxItems.filter((item) => {
      if (typeFilter !== "all" && item.kind !== typeFilter) return false;
      if (directionFilter !== "all" && item.direction !== directionFilter) return false;
      if (feedFilter === "touchpoints" && (item.source || "").toLowerCase() !== "intelligence" && !(item.source_ref || "").toLowerCase().startsWith("touchpoint:")) return false;
      if (feedFilter === "communications" && ((item.source || "").toLowerCase() === "intelligence" || (item.source_ref || "").toLowerCase().startsWith("touchpoint:"))) return false;
      if (item.kind === "task" && taskStatusFilter !== "all" && item.status !== taskStatusFilter) return false;
      if (!q) return true;
      return `${item.title} ${item.subtitle} ${item.body}`.toLowerCase().includes(q);
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
      setStatus("Communication logged.");
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
      setTaskTitle("");
      setTaskDetails("");
      setTaskAssignee("");
      setTaskPriority("normal");
      setTaskDueAt("");
      setStatus("Task created.");
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

  async function sendEmail() {
    if (emailJobId === "none") {
      setStatus("Select a job to send email from.");
      return;
    }
    if (!emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) {
      setStatus("Email To, Subject, and Message are required.");
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/jobs/${Number(emailJobId)}/communications/email`, {
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
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to send email (${res.status})${txt ? `: ${txt}` : ""}`);
      }
      setEmailSubject("");
      setEmailBody("");
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

  const openTasks = tasks.filter((t) => (t.status || "").toLowerCase() !== "done" && (t.status || "").toLowerCase() !== "closed").length;
  const overdueTasks = tasks.filter((t) => {
    if (!t.due_at) return false;
    const dueDate = new Date(t.due_at);
    return !Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now() && (t.status || "").toLowerCase() !== "done" && (t.status || "").toLowerCase() !== "closed";
  }).length;

  return (
    <div className="space-y-6">
      {status ? <div className="rounded-md bg-muted p-3 text-sm">{status}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Communications Inbox ({filteredItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-2 md:col-span-2">
              <Label>Search</Label>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject, messages, and tasks..." />
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

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">Communications</div>
              <div className="text-lg font-semibold">{events.length}</div>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">Open Tasks</div>
              <div className="text-lg font-semibold">{openTasks}</div>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">Overdue Tasks</div>
              <div className="text-lg font-semibold">{overdueTasks}</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label>Feed</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={feedFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFeedFilter("all")}
              >
                All
              </Button>
              <Button
                type="button"
                variant={feedFilter === "touchpoints" ? "default" : "outline"}
                size="sm"
                onClick={() => setFeedFilter("touchpoints")}
              >
                Touchpoints
              </Button>
              <Button
                type="button"
                variant={feedFilter === "communications" ? "default" : "outline"}
                size="sm"
                onClick={() => setFeedFilter("communications")}
              >
                Communications
              </Button>
              <Select value={taskStatusFilter} onValueChange={setTaskStatusFilter}>
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
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : filteredItems.length === 0 ? (
            <div className="text-sm text-muted-foreground">No inbox items match the current filters.</div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">[{item.kind === "task" ? "task" : "comm"}] {item.title}</div>
                      {item.kind === "communication" && (
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.18em]">
                          {(item.source || "").toLowerCase() === "intelligence" || (item.source_ref || "").toLowerCase().startsWith("touchpoint:")
                            ? "Touchpoint"
                            : "Communication"}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{item.status || "-"}</div>
                  </div>
                  {item.body ? <div className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</div> : null}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">{item.subtitle} | {item.timestamp || "-"}</div>
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
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Log Communication</CardTitle></CardHeader>
          <CardContent className="space-y-3">
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
            <Button onClick={() => void createEvent()}>Log Entry</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Create Task</CardTitle></CardHeader>
          <CardContent className="space-y-3">
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
              <Textarea value={taskDetails} onChange={(e) => setTaskDetails(e.target.value)} rows={4} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Assignee</Label>
                <Input value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)} placeholder="user email or name" />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={taskDueAt} onChange={(e) => setTaskDueAt(e.target.value)} />
              </div>
            </div>
            <Button onClick={() => void createTask()}>Create Task</Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Email Client / Contact</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Job (required for email logging)</Label>
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
            <Button onClick={() => void sendEmail()}>Send Email</Button>
          </CardContent>
        </Card>

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
