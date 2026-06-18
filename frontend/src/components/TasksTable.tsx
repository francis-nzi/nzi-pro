"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Task = {
  task_id: number;
  client_db_id: number;
  job_id: number | null;
  title: string;
  details: string;
  assignee_user_id: string;
  priority: string;
  due_at: string | null;
  sla_due_at: string | null;
  status: string;
  completed_at: string | null;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;
};

type Assignee = {
  name: string;
  email: string;
  group: string;
};

type TasksTableProps = {
  clientId: number;
  jobId?: number;
  baseUrl: string;
  title?: string;
  compact?: boolean;
};

function ragBadge(priority: string) {
  switch (priority?.toLowerCase()) {
    case "urgent":
      return <Badge className="bg-rose-100 text-rose-700 border-rose-200 font-medium">Urgent</Badge>;
    case "high":
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200 font-medium">High</Badge>;
    case "normal":
      return <Badge className="bg-sky-100 text-sky-700 border-sky-200 font-medium">Normal</Badge>;
    case "low":
      return <Badge className="bg-slate-100 text-slate-600 border-slate-200 font-medium">Low</Badge>;
    default:
      return <Badge variant="outline">{priority || "Normal"}</Badge>;
  }
}

function statusBadge(status: string) {
  switch (status?.toLowerCase()) {
    case "done":
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Done</Badge>;
    case "in_progress":
      return <Badge className="bg-blue-100 text-blue-700 border-blue-200">In Progress</Badge>;
    case "blocked":
      return <Badge className="bg-rose-100 text-rose-700 border-rose-200">Blocked</Badge>;
    case "cancelled":
      return <Badge className="bg-slate-100 text-slate-500 border-slate-200">Cancelled</Badge>;
    default:
      return <Badge variant="outline">Open</Badge>;
  }
}

function formatDue(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  const formatted = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  if (diff < 0) return <span className="text-rose-600 font-medium">{formatted} ({Math.abs(diff)}d overdue)</span>;
  if (diff === 0) return <span className="text-amber-600 font-medium">{formatted} (today)</span>;
  if (diff <= 3) return <span className="text-amber-600">{formatted}</span>;
  return formatted;
}

function shortEmail(assignee: string) {
  if (!assignee) return "—";
  if (assignee.includes("@")) return assignee.split("@")[0];
  return assignee;
}

const EMPTY_FORM = {
  title: "",
  details: "",
  assignee_user_id: "",
  priority: "normal",
  due_at: "",
  status: "open",
  notify_assignee: false,
};

export default function TasksTable({ clientId, jobId, baseUrl, title, compact = false }: TasksTableProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignees, setAssignees] = useState<Assignee[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = jobId != null ? `?job_id=${jobId}&limit=200` : "?limit=200";
      const res = await fetch(`${baseUrl}/clients/${clientId}/tasks${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = (await res.json()) as { items: Task[] };
      setTasks(data.items || []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId, jobId]);

  const loadAssignees = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/email-recipients`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { contacts: Assignee[]; team: Assignee[] };
      setAssignees([...(data.team || []), ...(data.contacts || [])]);
    } catch {
      // non-fatal
    }
  }, [baseUrl, clientId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadAssignees(); }, [loadAssignees]);

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  }

  function openEdit(task: Task, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(task.task_id);
    setForm({
      title: task.title || "",
      details: task.details || "",
      assignee_user_id: task.assignee_user_id || "",
      priority: task.priority || "normal",
      due_at: task.due_at ? task.due_at.slice(0, 10) : "",
      status: task.status || "open",
      notify_assignee: false,
    });
    setModalOpen(true);
  }

  async function handleDelete(taskId: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this task?")) return;
    setDeleting(taskId);
    try {
      const res = await fetch(`${baseUrl}/tasks/${taskId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete task");
      toast.success("Task deleted");
      setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
      if (detailTask?.task_id === taskId) setDetailTask(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleSave() {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      const isEditing = editingId !== null;
      const url = isEditing ? `${baseUrl}/tasks/${editingId}` : `${baseUrl}/clients/${clientId}/tasks`;
      const method = isEditing ? "PATCH" : "POST";
      const body = {
        title: form.title.trim(),
        details: form.details.trim() || null,
        assignee_user_id: form.assignee_user_id || null,
        priority: form.priority,
        due_at: form.due_at || null,
        status: form.status,
        ...(isEditing ? {} : { job_id: jobId ?? null, notify_assignee: form.notify_assignee }),
      };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail || "Failed to save task");
      }
      toast.success(isEditing ? "Task updated" : "Task created");
      setModalOpen(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function quickStatus(task: Task, nextStatus: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const res = await fetch(`${baseUrl}/tasks/${task.task_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      setTasks((prev) => prev.map((t) => t.task_id === task.task_id ? { ...t, status: nextStatus } : t));
      if (detailTask?.task_id === task.task_id) setDetailTask((d) => d ? { ...d, status: nextStatus } : d);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const openTasks = tasks.filter((t) => !["done", "cancelled"].includes(t.status?.toLowerCase()));
  const doneTasks = tasks.filter((t) => ["done", "cancelled"].includes(t.status?.toLowerCase()));

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-base">{title ?? "Tasks"}</CardTitle>
          <Button size="sm" onClick={openAdd} className="gap-1">
            <Plus className="h-4 w-4" /> Add Task
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">Loading tasks...</div>
          ) : tasks.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">No tasks yet. Click Add Task to create one.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Priority</th>
                    <th className="px-4 py-2 text-left font-medium">Title</th>
                    {!compact && <th className="px-4 py-2 text-left font-medium">Assigned To</th>}
                    <th className="px-4 py-2 text-left font-medium">Due</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {openTasks.map((task) => (
                    <tr
                      key={task.task_id}
                      className="border-b cursor-pointer hover:bg-muted/20 transition-colors"
                      onClick={() => setDetailTask(task)}
                    >
                      <td className="px-4 py-3">{ragBadge(task.priority)}</td>
                      <td className="px-4 py-3 font-medium max-w-[220px] truncate">{task.title}</td>
                      {!compact && <td className="px-4 py-3 text-muted-foreground">{shortEmail(task.assignee_user_id)}</td>}
                      <td className="px-4 py-3 whitespace-nowrap text-xs">{formatDue(task.due_at)}</td>
                      <td className="px-4 py-3">{statusBadge(task.status)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Edit"
                            onClick={(e) => openEdit(task, e)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                            title="Delete"
                            disabled={deleting === task.task_id}
                            onClick={(e) => void handleDelete(task.task_id, e)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {doneTasks.length > 0 && (
                    <>
                      <tr>
                        <td colSpan={compact ? 5 : 6} className="px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground bg-muted/10 border-b">
                          Completed / Cancelled
                        </td>
                      </tr>
                      {doneTasks.map((task) => (
                        <tr
                          key={task.task_id}
                          className="border-b cursor-pointer hover:bg-muted/20 opacity-60 transition-colors"
                          onClick={() => setDetailTask(task)}
                        >
                          <td className="px-4 py-3">{ragBadge(task.priority)}</td>
                          <td className="px-4 py-3 line-through text-muted-foreground">{task.title}</td>
                          {!compact && <td className="px-4 py-3 text-muted-foreground">{shortEmail(task.assignee_user_id)}</td>}
                          <td className="px-4 py-3 whitespace-nowrap text-xs">{formatDue(task.due_at)}</td>
                          <td className="px-4 py-3">{statusBadge(task.status)}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="Edit"
                                onClick={(e) => openEdit(task, e)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                                title="Delete"
                                disabled={deleting === task.task_id}
                                onClick={(e) => void handleDelete(task.task_id, e)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Task" : "Add Task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="task-title">Title *</Label>
              <Input
                id="task-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Task title"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="task-details">Details</Label>
              <Textarea
                id="task-details"
                value={form.details}
                onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))}
                placeholder="Additional details..."
                rows={3}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="task-due">Due Date</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={form.due_at}
                  onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Assign To</Label>
                <Select
                  value={form.assignee_user_id || "__none__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, assignee_user_id: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select person..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {assignees.map((a) => (
                      <SelectItem key={a.email} value={a.email}>
                        {a.name || a.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!editingId && form.assignee_user_id && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.notify_assignee}
                  onChange={(e) => setForm((f) => ({ ...f, notify_assignee: e.target.checked }))}
                  className="rounded"
                />
                Notify assignee by email
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Update" : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <Dialog open={!!detailTask} onOpenChange={(open) => !open && setDetailTask(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailTask && ragBadge(detailTask.priority)}
              <span className="truncate">{detailTask?.title}</span>
            </DialogTitle>
          </DialogHeader>
          {detailTask && (
            <div className="space-y-4 py-1">
              <div className="flex flex-wrap gap-2">
                {statusBadge(detailTask.status)}
                <Badge variant="outline" className="text-xs">{detailTask.due_at ? `Due: ${new Date(detailTask.due_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : "No due date"}</Badge>
                {detailTask.assignee_user_id && (
                  <Badge variant="outline" className="text-xs">Assigned: {shortEmail(detailTask.assignee_user_id)}</Badge>
                )}
              </div>
              {detailTask.details && (
                <div className="rounded-lg bg-muted/30 p-3 text-sm whitespace-pre-wrap">{detailTask.details}</div>
              )}
              <div>
                <Label className="mb-2 block text-xs text-muted-foreground">Update Status</Label>
                <div className="flex flex-wrap gap-2">
                  {(["open", "in_progress", "blocked", "done", "cancelled"] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={detailTask.status === s ? "default" : "outline"}
                      className="text-xs capitalize"
                      onClick={(e) => void quickStatus(detailTask, s, e)}
                    >
                      {s.replace("_", " ")}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Created by {detailTask.created_by || "unknown"}
                {detailTask.created_at && ` on ${new Date(detailTask.created_at).toLocaleDateString("en-GB")}`}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { if (detailTask) { setDetailTask(null); openEdit(detailTask, { stopPropagation: () => {} } as React.MouseEvent); } }}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting === detailTask?.task_id}
              onClick={(e) => { if (detailTask) void handleDelete(detailTask.task_id, e); setDetailTask(null); }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
