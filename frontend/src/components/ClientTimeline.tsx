"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TimelineEvent = {
  event_id: number;
  client_db_id: number;
  job_id: number | null;
  event_type: string;
  channel: string;
  direction: string;
  subject: string;
  body_text: string;
  status: string;
  owner_user_id: string;
  due_at: string | null;
  created_by: string;
  created_at: string | null;
  tags?: string[];
};

type TimelineTask = {
  task_id: number;
  event_id: number | null;
  client_db_id: number;
  job_id: number | null;
  title: string;
  details: string;
  assignee_user_id: string;
  priority: string;
  due_at: string | null;
  status: string;
  created_at: string | null;
};

type Props = {
  clientId: number;
  baseUrl: string;
  jobId?: number | null;
};

export default function ClientTimeline({ clientId, baseUrl, jobId }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [tasks, setTasks] = useState<TimelineTask[]>([]);
  const [users, setUsers] = useState<Array<{ user_id: string; email: string; full_name: string }>>([]);
  const [newEvent, setNewEvent] = useState({
    event_type: "note",
    channel: "internal",
    direction: "internal",
    subject: "",
    body_text: "",
    status: "logged",
    owner_user_id: "",
    due_at: "",
    tags: "",
  });
  const [newTaskByEvent, setNewTaskByEvent] = useState<Record<number, { title: string; assignee_user_id: string; due_at: string }>>({});

  const filteredTasks = useMemo(() => {
    if (!jobId) return tasks;
    return tasks.filter((t) => Number(t.job_id || 0) === Number(jobId));
  }, [tasks, jobId]);

  const loadData = useCallback(async () => {
    if (!Number.isFinite(clientId) || clientId <= 0) return;
    setLoading(true);
    setStatus("");
    try {
      const timelineParams = new URLSearchParams();
      timelineParams.set("limit", "100");
      timelineParams.set("offset", "0");
      if (jobId) timelineParams.set("job_id", String(jobId));
      if (query.trim()) timelineParams.set("q", query.trim());
      if (eventTypeFilter !== "all") timelineParams.set("event_type", eventTypeFilter);

      const [eventsRes, tasksRes, usersRes] = await Promise.all([
        fetch(`${baseUrl}/clients/${clientId}/timeline?${timelineParams.toString()}`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/tasks?limit=100&offset=0${jobId ? `&job_id=${jobId}` : ""}`, { credentials: "include" }),
        fetch(`${baseUrl}/admin/users`, { credentials: "include" }),
      ]);

      if (!eventsRes.ok) {
        const text = await eventsRes.text().catch(() => "");
        throw new Error(`Failed to load timeline (${eventsRes.status})${text ? `: ${text}` : ""}`);
      }
      if (!tasksRes.ok) {
        const text = await tasksRes.text().catch(() => "");
        throw new Error(`Failed to load tasks (${tasksRes.status})${text ? `: ${text}` : ""}`);
      }

      const eventsJson = await eventsRes.json();
      const tasksJson = await tasksRes.json();
      setEvents(Array.isArray(eventsJson?.items) ? eventsJson.items : []);
      setTasks(Array.isArray(tasksJson?.items) ? tasksJson.items : []);
      if (usersRes.ok) {
        const usersJson = await usersRes.json();
        setUsers(Array.isArray(usersJson?.items) ? usersJson.items : []);
      }
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId, jobId, query, eventTypeFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function createEvent() {
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/timeline/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...newEvent,
          job_id: jobId ?? null,
          due_at: newEvent.due_at || null,
          tags: newEvent.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to create event (${res.status})${text ? `: ${text}` : ""}`);
      }
      setNewEvent({
        event_type: "note",
        channel: "internal",
        direction: "internal",
        subject: "",
        body_text: "",
        status: "logged",
        owner_user_id: "",
        due_at: "",
        tags: "",
      });
      await loadData();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function createTask(eventId: number) {
    const draft = newTaskByEvent[eventId];
    if (!draft?.title?.trim()) {
      setStatus("Task title is required.");
      return;
    }
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          event_id: eventId,
          job_id: jobId ?? null,
          title: draft.title.trim(),
          assignee_user_id: draft.assignee_user_id || null,
          due_at: draft.due_at || null,
          priority: "normal",
          status: "open",
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to create task (${res.status})${text ? `: ${text}` : ""}`);
      }
      setNewTaskByEvent((prev) => ({ ...prev, [eventId]: { title: "", assignee_user_id: "", due_at: "" } }));
      await loadData();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function markTaskDone(taskId: number) {
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to update task (${res.status})${text ? `: ${text}` : ""}`);
      }
      await loadData();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Timeline Event</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label>Type</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={newEvent.event_type}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, event_type: e.target.value }))}
              >
                {["note", "email", "call", "system", "file", "milestone"].map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Channel</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={newEvent.channel}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, channel: e.target.value }))}
              >
                {["internal", "email", "phone", "system", "portal"].map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Owner</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={newEvent.owner_user_id}
                onChange={(e) => setNewEvent((prev) => ({ ...prev, owner_user_id: e.target.value }))}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.user_id || u.email} value={u.email || u.user_id}>
                    {u.full_name || u.email || u.user_id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Due At</Label>
              <Input type="datetime-local" value={newEvent.due_at} onChange={(e) => setNewEvent((prev) => ({ ...prev, due_at: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Subject</Label>
            <Input value={newEvent.subject} onChange={(e) => setNewEvent((prev) => ({ ...prev, subject: e.target.value }))} />
          </div>
          <div>
            <Label>Message</Label>
            <Textarea rows={3} value={newEvent.body_text} onChange={(e) => setNewEvent((prev) => ({ ...prev, body_text: e.target.value }))} />
          </div>
          <div>
            <Label>Tags (comma-separated)</Label>
            <Input value={newEvent.tags} onChange={(e) => setNewEvent((prev) => ({ ...prev, tags: e.target.value }))} placeholder="follow-up, risk" />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void createEvent()} disabled={loading}>Add Event</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
            <Input placeholder="Search subject or message..." value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="rounded-md border px-3 py-2 text-sm" value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              <option value="note">Note</option>
              <option value="email">Email</option>
              <option value="call">Call</option>
              <option value="system">System</option>
              <option value="milestone">Milestone</option>
            </select>
            <Button variant="outline" onClick={() => void loadData()} disabled={loading}>Refresh</Button>
          </div>

          <div className="space-y-3">
            {events.map((evt) => (
              <div key={evt.event_id} className="rounded-md border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="font-medium">{evt.subject || `(No subject) #${evt.event_id}`}</div>
                  <div className="text-xs text-muted-foreground">
                    {evt.event_type} · {evt.channel} · {evt.created_at ? new Date(evt.created_at).toLocaleString("en-GB") : "-"}
                  </div>
                </div>
                {evt.body_text ? <div className="text-sm">{evt.body_text}</div> : null}
                <div className="mt-2 text-xs text-muted-foreground">Owner: {evt.owner_user_id || "Unassigned"} {evt.job_id ? `· Job ${evt.job_id}` : ""}</div>
                {Array.isArray(evt.tags) && evt.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {evt.tags.map((tag) => (
                      <span key={tag} className="rounded bg-muted px-2 py-0.5 text-xs">{tag}</span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 rounded border bg-muted/30 p-2">
                  <div className="mb-2 text-xs font-medium">Create task from this event</div>
                  <div className="grid gap-2 md:grid-cols-[1fr_220px_180px_auto]">
                    <Input
                      placeholder="Task title"
                      value={newTaskByEvent[evt.event_id]?.title || ""}
                      onChange={(e) =>
                        setNewTaskByEvent((prev) => ({
                          ...prev,
                          [evt.event_id]: {
                            title: e.target.value,
                            assignee_user_id: prev[evt.event_id]?.assignee_user_id || "",
                            due_at: prev[evt.event_id]?.due_at || "",
                          },
                        }))
                      }
                    />
                    <select
                      className="rounded-md border px-3 py-2 text-sm"
                      value={newTaskByEvent[evt.event_id]?.assignee_user_id || ""}
                      onChange={(e) =>
                        setNewTaskByEvent((prev) => ({
                          ...prev,
                          [evt.event_id]: {
                            title: prev[evt.event_id]?.title || "",
                            assignee_user_id: e.target.value,
                            due_at: prev[evt.event_id]?.due_at || "",
                          },
                        }))
                      }
                    >
                      <option value="">Assignee</option>
                      {users.map((u) => (
                        <option key={u.user_id || u.email} value={u.email || u.user_id}>
                          {u.full_name || u.email || u.user_id}
                        </option>
                      ))}
                    </select>
                    <Input
                      type="datetime-local"
                      value={newTaskByEvent[evt.event_id]?.due_at || ""}
                      onChange={(e) =>
                        setNewTaskByEvent((prev) => ({
                          ...prev,
                          [evt.event_id]: {
                            title: prev[evt.event_id]?.title || "",
                            assignee_user_id: prev[evt.event_id]?.assignee_user_id || "",
                            due_at: e.target.value,
                          },
                        }))
                      }
                    />
                    <Button size="sm" onClick={() => void createTask(evt.event_id)}>Add Task</Button>
                  </div>
                </div>
              </div>
            ))}
            {!loading && events.length === 0 ? <div className="text-sm text-muted-foreground">No timeline events found.</div> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredTasks.map((task) => (
            <div key={task.task_id} className="flex items-center justify-between gap-3 rounded border px-3 py-2">
              <div>
                <div className="font-medium">{task.title}</div>
                <div className="text-xs text-muted-foreground">
                  {task.status} · {task.priority} · {task.assignee_user_id || "Unassigned"} · {task.due_at ? new Date(task.due_at).toLocaleString("en-GB") : "No due date"}
                </div>
              </div>
              <div className="flex gap-2">
                {task.status !== "done" ? (
                  <Button size="sm" variant="outline" onClick={() => void markTaskDone(task.task_id)}>
                    Mark Done
                  </Button>
                ) : (
                  <span className="text-xs text-green-700">Done</span>
                )}
              </div>
            </div>
          ))}
          {!loading && filteredTasks.length === 0 ? <div className="text-sm text-muted-foreground">No tasks found.</div> : null}
          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
