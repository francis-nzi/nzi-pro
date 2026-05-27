"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  User,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import TaskAssigneePicker, { type TaskAssigneeOption } from "@/components/TaskAssigneePicker";
import { getToken } from "@/lib/auth-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type TaskPriority = "low" | "normal" | "high" | "urgent";
type TaskStatus = "open" | "in_progress" | "done" | "closed";

type CalendarTask = {
  id: string;
  task_id: number;
  job_id?: number | null;
  title: string;
  details?: string | null;
  assignee?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null; // YYYY-MM-DD
  job_number?: string | null;
  job_title?: string | null;
  client_name?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  source: "job_communication" | "crm";
};

type TaskEditDraft = {
  title: string;
  details: string;
  assignees: string[];
  assigneeLabels: Record<string, string>;
  priority: TaskPriority;
  dueDate: string;
  status: TaskStatus;
};

type UserLookup = {
  user_id: string;
  full_name: string;
  email: string;
  role?: string | null;
  position?: string | null;
  status?: string | null;
};

type Props = {
  /** Omit for company-wide (dashboard) mode */
  clientId?: number;
  baseUrl: string;
  /** CRM owner filter — only used in global mode */
  crmOwner?: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_CHIP: Record<TaskPriority, string> = {
  urgent: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  normal: "bg-blue-600 text-white",
  low: "bg-slate-400 text-white",
};

const PRIORITY_RING: Record<TaskPriority, string> = {
  urgent: "ring-red-500",
  high: "ring-orange-500",
  normal: "ring-blue-500",
  low: "ring-slate-400",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  done: "Done",
  closed: "Closed",
};

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  open: "in_progress",
  in_progress: "done",
  done: "open",
  closed: "open",
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function formatShortDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
}

function shortTaskTitle(title: string, maxLength = 32): string {
  const cleaned = String(title || "").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

function splitAssigneeText(raw: string): string[] {
  return String(raw || "")
    .split(/[,;\n]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLookupText(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TaskCalendar({ clientId, baseUrl, crmOwner }: Props) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"month" | "agenda">("month");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<CalendarTask | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TaskEditDraft | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [users, setUsers] = useState<UserLookup[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const now = todayStr();

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const headers = authHeaders();
      const normalized: CalendarTask[] = [];

      if (clientId !== undefined) {
        // ── Per-client mode ──────────────────────────────────────────────
        const [jcRes, crmRes] = await Promise.all([
          fetch(`${baseUrl}/clients/${clientId}/communication-tasks?include_done=true`, {
            credentials: "include", headers,
          }),
          fetch(`${baseUrl}/clients/${clientId}/tasks?limit=300`, {
            credentials: "include", headers,
          }),
        ]);

        if (jcRes.ok) {
          const data = (await jcRes.json()) as { items: Array<Record<string, unknown>> };
          for (const t of data.items ?? []) {
            normalized.push({
              id: `jc-${t.task_id as number}`,
              task_id: t.task_id as number,
              job_id: t.job_id as number | null,
              title: String(t.title ?? ""),
              details: t.details ? String(t.details) : null,
              assignee: t.assigned_to ? String(t.assigned_to) : null,
              priority: (t.priority as TaskPriority) ?? "normal",
              status: (t.status as TaskStatus) ?? "open",
              due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
              job_number: t.job_number ? String(t.job_number) : null,
              job_title: t.job_title ? String(t.job_title) : null,
              client_name: t.client_name ? String(t.client_name) : null,
              created_by: t.created_by ? String(t.created_by) : null,
              created_at: t.created_at ? String(t.created_at) : null,
              completed_at: t.completed_at ? String(t.completed_at) : null,
              source: "job_communication",
            });
          }
        }

        if (crmRes.ok) {
          const data = (await crmRes.json()) as { items: Array<Record<string, unknown>> };
          for (const t of data.items ?? []) {
            const dueRaw = (t.due_at ?? t.due_date) as string | null;
            normalized.push({
              id: `crm-${t.task_id as number}`,
              task_id: t.task_id as number,
              job_id: t.job_id as number | null,
              title: String(t.title ?? ""),
              details: t.details ? String(t.details) : null,
              assignee: t.assignee_user_id ? String(t.assignee_user_id) : null,
              priority: (t.priority as TaskPriority) ?? "normal",
              status: (t.status as TaskStatus) ?? "open",
              due_date: dueRaw ? String(dueRaw).slice(0, 10) : null,
              job_number: null,
              job_title: null,
              client_name: null,
              created_by: t.created_by ? String(t.created_by) : null,
              created_at: t.created_at ? String(t.created_at) : null,
              completed_at: t.completed_at ? String(t.completed_at) : null,
              source: "crm",
            });
          }
        }
      } else {
        // ── Global (dashboard) mode ──────────────────────────────────────
        const params = new URLSearchParams({ include_done: "true" });
        if (crmOwner) params.set("crm_owner", crmOwner);
        const res = await fetch(`${baseUrl}/dashboard/tasks?${params.toString()}`, {
          credentials: "include", headers,
        });
        if (res.ok) {
          const data = (await res.json()) as { items: Array<Record<string, unknown>> };
          for (const t of data.items ?? []) {
            normalized.push({
              id: String(t.id ?? `${t.source}-${t.task_id}`),
              task_id: t.task_id as number,
              job_id: t.job_id as number | null,
              title: String(t.title ?? ""),
              details: t.details ? String(t.details) : null,
              assignee: t.assigned_to ? String(t.assigned_to) : null,
              priority: (t.priority as TaskPriority) ?? "normal",
              status: (t.status as TaskStatus) ?? "open",
              due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
              job_number: t.job_number ? String(t.job_number) : null,
              job_title: t.job_title ? String(t.job_title) : null,
              client_name: t.client_name ? String(t.client_name) : null,
              created_by: t.created_by ? String(t.created_by) : null,
              created_at: t.created_at ? String(t.created_at) : null,
              completed_at: t.completed_at ? String(t.completed_at) : null,
              source: (t.source as "job_communication" | "crm") ?? "job_communication",
            });
          }
        }
      }

      setTasks(normalized);
    } finally {
      setLoading(false);
    }
  }, [clientId, baseUrl, crmOwner]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    let alive = true;
    async function loadUsers() {
      setUsersLoading(true);
      try {
        const res = await fetch(`${baseUrl}/admin/users`, {
          credentials: "include",
          headers: authHeaders(),
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { items?: UserLookup[] };
        const activeUsers = (data.items ?? [])
          .filter((user) => String(user.status || "Active").toLowerCase() !== "inactive")
          .map((user) => ({
            user_id: String(user.user_id || ""),
            full_name: String(user.full_name || ""),
            email: String(user.email || ""),
            role: user.role || null,
            position: user.position || null,
            status: user.status || null,
          }))
          .filter((user) => user.user_id || user.full_name || user.email)
          .sort((a, b) => String(a.full_name || a.email || a.user_id).localeCompare(String(b.full_name || b.email || b.user_id)));
        if (alive) setUsers(activeUsers);
      } finally {
        if (alive) setUsersLoading(false);
      }
    }

    void loadUsers();
    return () => {
      alive = false;
    };
  }, [baseUrl]);

  // ─── Calendar grid ──────────────────────────────────────────────────────────

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const firstDow = (firstDay.getDay() + 6) % 7; // Mon=0 … Sun=6
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
    const days: Array<{ date: Date; isCurrentMonth: boolean; dateStr: string }> = [];
    for (let i = 0; i < totalCells; i++) {
      const date = new Date(viewYear, viewMonth, 1 + (i - firstDow));
      const isCurrentMonth = date.getMonth() === viewMonth;
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      days.push({ date, isCurrentMonth, dateStr: `${y}-${m}-${dd}` });
    }
    return days;
  }, [viewYear, viewMonth]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of tasks) {
      if (!task.due_date) continue;
      const arr = map.get(task.due_date) ?? [];
      arr.push(task);
      map.set(task.due_date, arr);
    }
    // Sort each day's tasks: incomplete first, then by priority weight
    const weight: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    for (const [key, arr] of map.entries()) {
      map.set(key, arr.sort((a, b) => {
        const aDone = a.status === "done" || a.status === "closed";
        const bDone = b.status === "done" || b.status === "closed";
        if (aDone !== bDone) return aDone ? 1 : -1;
        return weight[a.priority] - weight[b.priority];
      }));
    }
    return map;
  }, [tasks]);

  const agendaGroups = useMemo(() => {
    const seen = new Map<string, CalendarTask[]>();
    for (const t of tasks) {
      if (!t.due_date || t.status === "done" || t.status === "closed") continue;
      const arr = seen.get(t.due_date) ?? [];
      arr.push(t);
      seen.set(t.due_date, arr);
    }
    return [...seen.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateStr, ts]) => ({ dateStr, tasks: ts }));
  }, [tasks]);

  const priorityQueue = useMemo(() => {
    const weight: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return [...tasks]
      .filter((task) => task.status !== "done" && task.status !== "closed")
      .sort((a, b) => {
        const aOverdue = a.due_date && a.due_date < now;
        const bOverdue = b.due_date && b.due_date < now;
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
        const aDue = a.due_date || "9999-12-31";
        const bDue = b.due_date || "9999-12-31";
        if (aDue !== bDue) return aDue.localeCompare(bDue);
        const priorityDelta = weight[a.priority] - weight[b.priority];
        if (priorityDelta !== 0) return priorityDelta;
        return String(a.title || "").localeCompare(String(b.title || ""));
      })
      .slice(0, 8);
  }, [tasks, now]);

  // ─── Stats ──────────────────────────────────────────────────────────────────

  const statsOpen = tasks.filter(t => t.status === "open" || t.status === "in_progress").length;
  const statsDueToday = tasks.filter(t => t.due_date === now && t.status !== "done" && t.status !== "closed").length;
  const statsOverdue = tasks.filter(
    t => t.due_date && t.due_date < now && t.status !== "done" && t.status !== "closed",
  ).length;

  const assigneeOptions = useMemo<TaskAssigneeOption[]>(() => {
    return users.map((user) => ({
      value: user.user_id,
      label: String(user.full_name || user.email || user.user_id).trim() || user.user_id,
      meta: [user.role, user.position].filter(Boolean).join(" • ") || user.email || null,
    }));
  }, [users]);

  const assigneeOptionLookup = useMemo(() => {
    const byValue = new Map<string, TaskAssigneeOption>();
    const byLabel = new Map<string, TaskAssigneeOption>();
    for (const option of assigneeOptions) {
      byValue.set(normalizeLookupText(option.value), option);
      byLabel.set(normalizeLookupText(option.label), option);
      if (option.meta) {
        byLabel.set(normalizeLookupText(option.meta), option);
      }
    }
    return { byValue, byLabel };
  }, [assigneeOptions]);

  const editAssigneeOptions = useMemo<TaskAssigneeOption[]>(() => {
    if (!selectedTask || !editDraft) return assigneeOptions;
    const merged = [...assigneeOptions];
    for (const value of editDraft.assignees) {
      if (!value.startsWith("manual:")) continue;
      if (merged.some((option) => option.value === value)) continue;
      const label = editDraft.assigneeLabels[value] || value.replace(/^manual:\d+:/, "");
      merged.push({ value, label, meta: "Manual entry" });
    }
    return merged;
  }, [assigneeOptions, editDraft, selectedTask]);

  const resolveTaskAssigneeSelection = useCallback((task: CalendarTask): TaskEditDraft => {
    const currentText = String(task.assignee || "").trim();
    const assignees: string[] = [];
    const assigneeLabels: Record<string, string> = {};

    const addResolved = (rawValue: string, labelHint?: string) => {
      const token = normalizeLookupText(rawValue);
      const resolved = assigneeOptionLookup.byValue.get(token) || assigneeOptionLookup.byLabel.get(token);
      if (resolved) {
        assignees.push(resolved.value);
        assigneeLabels[resolved.value] = resolved.label;
        return;
      }
      if (labelHint) {
        assignees.push(rawValue);
        assigneeLabels[rawValue] = labelHint;
        return;
      }
      assignees.push(rawValue);
      assigneeLabels[rawValue] = rawValue;
    };

    if (task.source === "job_communication") {
      const parts = splitAssigneeText(currentText);
      if (parts.length === 0 && currentText) {
        addResolved(`manual:0:${currentText}`, currentText);
      } else {
        parts.forEach((part, index) => {
          const token = normalizeLookupText(part);
          const resolved = assigneeOptionLookup.byValue.get(token) || assigneeOptionLookup.byLabel.get(token);
          if (resolved) {
            assignees.push(resolved.value);
            assigneeLabels[resolved.value] = resolved.label;
            return;
          }
          const manualValue = `manual:${index}:${part}`;
          assignees.push(manualValue);
          assigneeLabels[manualValue] = part;
        });
      }
    } else {
      if (currentText) {
        const token = normalizeLookupText(currentText);
        const resolved = assigneeOptionLookup.byValue.get(token) || assigneeOptionLookup.byLabel.get(token);
        if (resolved) {
          assignees.push(resolved.value);
          assigneeLabels[resolved.value] = resolved.label;
        } else {
          assignees.push(`manual:0:${currentText}`);
          assigneeLabels[`manual:0:${currentText}`] = currentText;
        }
      }
    }

    return {
      title: task.title || "",
      details: task.details || "",
      assignees,
      assigneeLabels,
      priority: task.priority,
      dueDate: task.due_date || "",
      status: task.status,
    };
  }, [assigneeOptionLookup]);

  // ─── Task status update ─────────────────────────────────────────────────────

  const updateStatus = useCallback(async (task: CalendarTask, newStatus: TaskStatus) => {
    setUpdatingId(task.id);
    try {
      const headers = { ...authHeaders(), "Content-Type": "application/json" };
      const url = task.source === "job_communication"
        ? `${baseUrl}/jobs/${task.job_id}/communications/tasks/${task.task_id}`
        : `${baseUrl}/tasks/${task.task_id}`;
      await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchTasks();
      setSelectedTask(prev =>
        prev?.id === task.id ? { ...prev, status: newStatus } : prev,
      );
    } finally {
      setUpdatingId(null);
    }
  }, [baseUrl, fetchTasks]);

  const beginEditTask = useCallback((task: CalendarTask) => {
    setSelectedTask(task);
    setEditingTaskId(task.id);
    setEditDraft(resolveTaskAssigneeSelection(task));
    setEditError("");
  }, [resolveTaskAssigneeSelection]);

  const cancelEditTask = useCallback(() => {
    setEditingTaskId(null);
    setEditDraft(null);
    setEditError("");
  }, []);

  const saveTaskEdit = useCallback(async () => {
    if (!selectedTask || !editDraft) return;
    setEditBusy(true);
    setEditError("");
    try {
      const headers = { ...authHeaders(), "Content-Type": "application/json" };
      const selectedAssignees = editDraft.assignees;
      const selectedLabels = selectedAssignees.map((value) => {
        if (value.startsWith("manual:")) {
          return editDraft.assigneeLabels[value] || value.replace(/^manual:\d+:/, "");
        }
        const resolved = assigneeOptions.find((option) => option.value === value);
        return resolved?.label || editDraft.assigneeLabels[value] || value;
      }).filter(Boolean);
      const payload = selectedTask.source === "job_communication"
        ? {
            title: editDraft.title.trim(),
            details: editDraft.details.trim(),
            assigned_to: selectedLabels.join(", ") || null,
            priority: editDraft.priority,
            due_date: editDraft.dueDate || null,
            status: editDraft.status,
          }
        : {
            title: editDraft.title.trim(),
            details: editDraft.details.trim(),
            assignee_user_id: (() => {
              const selectedValue = selectedAssignees[0] || "";
              if (!selectedValue) return null;
              if (selectedValue.startsWith("manual:")) {
                return editDraft.assigneeLabels[selectedValue] || selectedValue.replace(/^manual:\d+:/, "");
              }
              const resolved = assigneeOptions.find((option) => option.value === selectedValue);
              return resolved?.value || editDraft.assigneeLabels[selectedValue] || selectedValue;
            })(),
            priority: editDraft.priority,
            due_at: editDraft.dueDate || null,
            status: editDraft.status,
          };
      const url = selectedTask.source === "job_communication"
        ? `${baseUrl}/jobs/${selectedTask.job_id}/communications/tasks/${selectedTask.task_id}`
        : `${baseUrl}/tasks/${selectedTask.task_id}`;
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Task update failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      await fetchTasks();
        if (json) {
          setSelectedTask((prev) => {
            if (!prev || prev.id !== selectedTask.id) return prev;
            const resolvedAssignee = selectedAssignees.length > 0
              ? (selectedTask.source === "job_communication"
                ? selectedLabels.join(", ") || null
                : (() => {
                    const selectedValue = selectedAssignees[0] || "";
                    if (!selectedValue) return null;
                    if (selectedValue.startsWith("manual:")) {
                      return editDraft.assigneeLabels[selectedValue] || selectedValue.replace(/^manual:\d+:/, "");
                    }
                    const resolved = assigneeOptions.find((option) => option.value === selectedValue);
                    return resolved?.label || editDraft.assigneeLabels[selectedValue] || selectedValue;
                  })())
              : null;
            return {
              ...prev,
              title: String(json.title ?? editDraft.title),
              details: String(json.details ?? editDraft.details),
              assignee: String((json.assigned_to ?? json.assignee_user_id) ?? resolvedAssignee ?? ""),
              priority: (json.priority as TaskPriority) ?? editDraft.priority,
              status: (json.status as TaskStatus) ?? editDraft.status,
              due_date: String((json.due_date ?? json.due_at) || editDraft.dueDate || "") || null,
              completed_at: (json.completed_at as string | null | undefined) ?? prev.completed_at ?? null,
            };
          });
        }
      setEditingTaskId(null);
      setEditDraft(null);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditBusy(false);
    }
  }, [baseUrl, editDraft, fetchTasks, selectedTask]);

  // ─── Navigation ────────────────────────────────────────────────────────────

  function navigateMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDate(null);
  }

  function goToToday() {
    const t = new Date();
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
    setSelectedDate(now);
    setView("month");
  }

  const selectedDateTasks = selectedDate ? (tasksByDate.get(selectedDate) ?? []) : [];

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {priorityQueue.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                Priority Queue
              </CardTitle>
              <Badge variant="outline" className="text-[10px] h-5 px-1.5">{priorityQueue.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {priorityQueue.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                now={now}
                onSelect={() => {
                  cancelEditTask();
                  setSelectedTask(task);
                }}
                onStatusChange={(s) => void updateStatus(task, s)}
                updating={updatingId === task.id}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard value={statsOpen} label="Open Tasks" accent="blue" />
        <StatCard value={statsDueToday} label="Due Today" accent="amber" />
        <StatCard value={statsOverdue} label="Overdue" accent="red" />
      </div>

      {/* Main calendar card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base font-semibold">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="text-xs h-8 px-3" onClick={goToToday}>
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                title={view === "month" ? "Agenda view" : "Month view"}
                onClick={() => setView(v => v === "month" ? "agenda" : "month")}
              >
                {view === "month"
                  ? <List className="h-3.5 w-3.5" />
                  : <CalendarDays className="h-3.5 w-3.5" />}
              </Button>
              <div className="flex items-center">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigateMonth(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigateMonth(1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
              <Clock className="h-4 w-4 animate-spin" />
              Loading tasks…
            </div>
          ) : view === "month" ? (
            <MonthGrid
              calendarDays={calendarDays}
              tasksByDate={tasksByDate}
              now={now}
              selectedDate={selectedDate}
              onSelectDate={d => setSelectedDate(prev => prev === d ? null : d)}
              onSelectTask={(task) => {
                cancelEditTask();
                setSelectedTask(task);
              }}
            />
          ) : (
            <AgendaView
              groups={agendaGroups}
              now={now}
              onSelectTask={(task) => {
                cancelEditTask();
                setSelectedTask(task);
              }}
              onStatusChange={updateStatus}
              updatingId={updatingId}
            />
          )}
        </CardContent>
      </Card>

      {/* Selected-date panel (month view) */}
      {view === "month" && selectedDate && selectedDateTasks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                {formatDisplayDate(selectedDate)}
              </CardTitle>
              <button
                onClick={() => setSelectedDate(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {selectedDateTasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                now={now}
                onSelect={() => {
                  cancelEditTask();
                  setSelectedTask(task);
                }}
                onStatusChange={s => void updateStatus(task, s)}
                updating={updatingId === task.id}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Task detail modal */}
      {selectedTask && (
      <TaskDetailModal
        task={selectedTask}
        now={now}
        isEditing={editingTaskId === selectedTask.id && Boolean(editDraft)}
        draft={editDraft}
        assigneeOptions={editAssigneeOptions}
        editError={editError}
        editBusy={editBusy}
        onClose={() => {
          setSelectedTask(null);
          cancelEditTask();
          }}
          onBeginEdit={() => beginEditTask(selectedTask)}
        onDraftChange={setEditDraft}
        onSaveEdit={() => void saveTaskEdit()}
        onCancelEdit={cancelEditTask}
        onStatusChange={s => void updateStatus(selectedTask, s)}
        updating={updatingId === selectedTask.id}
        usersLoading={usersLoading}
      />
      )}

      {/* Priority legend */}
      <div className="flex items-center gap-4 flex-wrap px-1">
        <span className="text-xs text-muted-foreground font-medium">Priority:</span>
        {(["urgent", "high", "normal", "low"] as TaskPriority[]).map(p => (
          <div key={p} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${PRIORITY_CHIP[p]}`} />
            <span className="text-xs text-muted-foreground">{PRIORITY_LABEL[p]}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

// ─── MonthGrid ────────────────────────────────────────────────────────────────

function MonthGrid({
  calendarDays,
  tasksByDate,
  now,
  selectedDate,
  onSelectDate,
  onSelectTask,
}: {
  calendarDays: Array<{ date: Date; isCurrentMonth: boolean; dateStr: string }>;
  tasksByDate: Map<string, CalendarTask[]>;
  now: string;
  selectedDate: string | null;
  onSelectDate: (d: string) => void;
  onSelectTask: (t: CalendarTask) => void;
}) {
  return (
    <div>
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b mb-0">
        {DAY_NAMES.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground tracking-wide">
            {d}
          </div>
        ))}
      </div>

      {/* Grid cells */}
      <div className="grid grid-cols-7 border-l border-t">
        {calendarDays.map(({ date, isCurrentMonth, dateStr }) => {
          const dayTasks = tasksByDate.get(dateStr) ?? [];
          const isToday = dateStr === now;
          const isSelected = dateStr === selectedDate;
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const hasOverdue = dayTasks.some(
            t => t.status !== "done" && t.status !== "closed" && dateStr < now,
          );
          const visibleTasks = dayTasks.slice(0, 3);
          const overflow = dayTasks.length - visibleTasks.length;

          return (
            <div
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={[
                "border-r border-b min-h-[88px] p-1 cursor-pointer select-none transition-colors",
                !isCurrentMonth ? "bg-muted/20" : isWeekend ? "bg-slate-50/60 dark:bg-slate-900/20" : "bg-background",
                isSelected ? "ring-2 ring-inset ring-primary/60" : "hover:bg-accent/40",
              ].filter(Boolean).join(" ")}
            >
              {/* Day number */}
              <div className="flex items-center justify-between mb-1">
                <span className={[
                  "text-xs font-medium h-6 w-6 flex items-center justify-center rounded-full",
                  isToday
                    ? "bg-primary text-primary-foreground font-bold"
                    : isCurrentMonth
                    ? "text-foreground"
                    : "text-muted-foreground/50",
                ].join(" ")}>
                  {date.getDate()}
                </span>
                {hasOverdue && isCurrentMonth && (
                  <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                )}
              </div>

              {/* Task chips */}
              <div className="space-y-0.5">
                {visibleTasks.map(task => {
                  const isDone = task.status === "done" || task.status === "closed";
                  return (
                    <button
                      key={task.id}
                      onClick={e => { e.stopPropagation(); onSelectTask(task); }}
                      className={[
                        "w-full text-left text-[10px] leading-[1.3] px-1.5 py-[2px] rounded truncate block",
                        isDone
                          ? "bg-muted text-muted-foreground line-through"
                          : PRIORITY_CHIP[task.priority],
                        "hover:opacity-80 transition-opacity",
                      ].join(" ")}
                      title={task.title}
                    >
                      {shortTaskTitle(task.title)}
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <div className="text-[10px] text-muted-foreground px-1.5 font-medium">
                    +{overflow} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AgendaView ───────────────────────────────────────────────────────────────

function AgendaView({
  groups,
  now,
  onSelectTask,
  onStatusChange,
  updatingId,
}: {
  groups: Array<{ dateStr: string; tasks: CalendarTask[] }>;
  now: string;
  onSelectTask: (t: CalendarTask) => void;
  onStatusChange: (task: CalendarTask, s: TaskStatus) => void;
  updatingId: string | null;
}) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <CalendarDays className="h-10 w-10 opacity-30" />
        <p className="text-sm">No upcoming tasks</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map(({ dateStr, tasks }) => {
        const isToday = dateStr === now;
        const isPast = dateStr < now;
        return (
          <div key={dateStr}>
            {/* Date label */}
            <div className="flex items-center gap-2 mb-2">
              <div className={[
                "text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider",
                isToday
                  ? "bg-primary text-primary-foreground"
                  : isPast
                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  : "bg-muted text-muted-foreground",
              ].join(" ")}>
                {isToday ? "TODAY" : isPast ? "OVERDUE" : formatShortDay(dateStr)}
              </div>
              <span className={[
                "text-sm font-medium",
                isPast && !isToday ? "text-red-600" : "text-foreground",
              ].join(" ")}>
                {formatShortDate(dateStr)}
              </span>
            </div>

            {/* Tasks */}
            <div className="space-y-2 pl-1">
              {tasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  now={now}
                  onSelect={() => onSelectTask(task)}
                  onStatusChange={s => onStatusChange(task, s)}
                  updating={updatingId === task.id}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  now,
  onSelect,
  onStatusChange,
  updating,
}: {
  task: CalendarTask;
  now: string;
  onSelect: () => void;
  onStatusChange: (s: TaskStatus) => void;
  updating: boolean;
}) {
  const isDone = task.status === "done" || task.status === "closed";
  const isOverdue = !isDone && task.due_date && task.due_date < now;
  const nextStatus = NEXT_STATUS[task.status];

  return (
    <div
      onClick={onSelect}
      className={[
        "group flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
        isOverdue ? "border-red-200 dark:border-red-900" : "border-border",
        isDone ? "opacity-60" : "",
        "hover:bg-accent/50",
      ].filter(Boolean).join(" ")}
    >
      {/* Status toggle button */}
      <button
        onClick={e => { e.stopPropagation(); onStatusChange(nextStatus); }}
        disabled={updating}
        title={isDone ? "Reopen task" : `Mark as ${STATUS_LABEL[nextStatus]}`}
        className={[
          "mt-0.5 h-4.5 w-4.5 min-w-[18px] rounded-full border-2 flex items-center justify-center transition-all",
          isDone
            ? "bg-green-500 border-green-500 text-white"
            : `border-current ${PRIORITY_RING[task.priority]} ring-offset-0`,
          "hover:opacity-70 disabled:cursor-not-allowed",
        ].join(" ")}
        style={{ height: 18, width: 18 }}
      >
        {isDone && <Check className="h-2.5 w-2.5" />}
        {task.status === "in_progress" && !isDone && (
          <Clock className="h-2 w-2 text-current opacity-70" />
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={[
          "text-sm font-medium leading-snug truncate",
          isDone ? "line-through text-muted-foreground" : "",
        ].join(" ")}>
          {shortTaskTitle(task.title, 36)}
        </p>
        <div className="flex items-center flex-wrap gap-2 mt-1">
          <span className={`text-[10px] font-semibold px-1.5 py-0 rounded ${PRIORITY_CHIP[task.priority]}`}>
            {PRIORITY_LABEL[task.priority]}
          </span>
          {task.client_name && (
            <span className="text-[10px] text-muted-foreground font-medium">{task.client_name}</span>
          )}
          {task.job_number && (
            <span className="text-[10px] text-muted-foreground">{task.job_number}</span>
          )}
          {task.assignee && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <User className="h-2.5 w-2.5" />
              {task.assignee}
            </span>
          )}
          {isOverdue && (
            <span className="text-[10px] text-red-600 dark:text-red-400 font-semibold">Overdue</span>
          )}
        </div>
      </div>

      {/* Status badge */}
      <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 flex-shrink-0 self-start mt-0.5">
        {STATUS_LABEL[task.status]}
      </Badge>
    </div>
  );
}

// ─── TaskDetailModal ──────────────────────────────────────────────────────────

function TaskDetailModal({
  task,
  now,
  isEditing,
  draft,
  assigneeOptions,
  editError,
  editBusy,
  onClose,
  onBeginEdit,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onStatusChange,
  updating,
  usersLoading,
}: {
  task: CalendarTask;
  now: string;
  isEditing: boolean;
  draft: TaskEditDraft | null;
  assigneeOptions: TaskAssigneeOption[];
  editError: string;
  editBusy: boolean;
  onClose: () => void;
  onBeginEdit: () => void;
  onDraftChange: (draft: TaskEditDraft | null) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStatusChange: (s: TaskStatus) => void;
  updating: boolean;
  usersLoading: boolean;
}) {
  const isDone = task.status === "done" || task.status === "closed";
  const isOverdue = !isDone && task.due_date && task.due_date < now;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[min(96vw,1100px)] max-w-none mx-4">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <DialogTitle className={["text-base leading-snug", isDone ? "line-through text-muted-foreground" : ""].join(" ")}>
              {task.title}
            </DialogTitle>
            <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
              {!isEditing ? (
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onBeginEdit}>
                  Edit
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={onCancelEdit}
                    disabled={editBusy}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={onSaveEdit}
                    disabled={editBusy}
                  >
                    {editBusy ? "Saving..." : "Save"}
                  </Button>
                </>
              )}
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </DialogHeader>

        {editError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {editError}
          </div>
        )}

        {/* Meta */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${PRIORITY_CHIP[task.priority]}`}>
              {PRIORITY_LABEL[task.priority]} priority
            </span>
            <Badge variant="outline" className="text-xs">
              {STATUS_LABEL[task.status]}
            </Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {task.source === "job_communication" ? "Job Task" : "CRM Task"}
            </Badge>
          </div>

          {/* Due date */}
          {task.due_date && (
            <div className={[
              "flex items-center gap-2 text-sm",
              isOverdue ? "text-red-600 dark:text-red-400" : "text-foreground",
            ].join(" ")}>
              <CalendarDays className="h-4 w-4 flex-shrink-0" />
              <span>
                Due {formatDisplayDate(task.due_date)}
                {isOverdue && <span className="ml-2 font-semibold">(Overdue)</span>}
              </span>
            </div>
          )}
          {!task.due_date && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4 flex-shrink-0" />
              <span>No due date</span>
            </div>
          )}

          {/* Client / job reference */}
          {task.client_name && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{task.client_name}</span>
            </div>
          )}
          {task.job_number && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{task.job_number}</span>
              {task.job_title && <span className="truncate">{task.job_title}</span>}
            </div>
          )}

          {isEditing && draft ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="task-edit-title">Title</Label>
                  <Input
                    id="task-edit-title"
                    value={draft.title}
                    onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
                    disabled={editBusy}
                    className="w-full"
                  />
                </div>

                <div className="md:col-span-2 space-y-2">
                  <Label>Assign To</Label>
                  <TaskAssigneePicker
                    value={draft.assignees}
                    options={assigneeOptions}
                    loading={usersLoading}
                    placeholder="Search team members..."
                    emptyMessage="No team members found"
                    onChange={(next) => {
                      const assignees = task.source === "crm" ? next.slice(-1) : next;
                      const assigneeLabels = { ...draft.assigneeLabels };
                      for (const value of assignees) {
                        if (!assigneeLabels[value]) {
                          const resolved = assigneeOptions.find((option) => option.value === value);
                          assigneeLabels[value] = resolved?.label || value.replace(/^manual:\d+:/, "");
                        }
                      }
                      onDraftChange({ ...draft, assignees, assigneeLabels });
                    }}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Search active team members. CRM tasks keep one assignee; job tasks can keep several.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select
                    value={draft.priority}
                    onValueChange={(value) => onDraftChange({ ...draft, priority: value as TaskPriority })}
                    disabled={editBusy}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      {(["low", "normal", "high", "urgent"] as TaskPriority[]).map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {PRIORITY_LABEL[priority]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={draft.status}
                    onValueChange={(value) => onDraftChange({ ...draft, status: value as TaskStatus })}
                    disabled={editBusy}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {(["open", "in_progress", "done", "closed"] as TaskStatus[]).map((status) => (
                        <SelectItem key={status} value={status}>
                          {STATUS_LABEL[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="task-edit-due">Due Date</Label>
                  <Input
                    id="task-edit-due"
                    type="date"
                    value={draft.dueDate}
                    onChange={(e) => onDraftChange({ ...draft, dueDate: e.target.value })}
                    disabled={editBusy}
                    className="w-full"
                  />
                </div>

                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="task-edit-details">Details</Label>
                  <Textarea
                    id="task-edit-details"
                    value={draft.details}
                    onChange={(e) => onDraftChange({ ...draft, details: e.target.value })}
                    disabled={editBusy}
                    className="min-h-48 w-full resize-y"
                    rows={10}
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Assignee */}
              {task.assignee && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4 flex-shrink-0" />
                  <span>{task.assignee}</span>
                </div>
              )}

              {/* Details */}
              {task.details && (
                <div className="rounded-md bg-muted/50 p-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {task.details}
                </div>
              )}
            </>
          )}

          {/* Completed at */}
          {task.completed_at && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-green-500" />
              <span>
                Completed{" "}
                {new Date(task.completed_at).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          )}
        </div>

        {/* Status actions */}
        {!isEditing && (
          <div className="flex flex-wrap gap-2 pt-4 border-t">
            {(["open", "in_progress", "done", "closed"] as TaskStatus[]).map(s => (
              <Button
                key={s}
                variant={task.status === s ? "default" : "outline"}
                size="sm"
                className="text-xs"
                disabled={updating || task.status === s}
                onClick={() => onStatusChange(s)}
              >
                {STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ value, label, accent }: { value: number; label: string; accent: "blue" | "amber" | "red" }) {
  const accentClass = {
    blue: "border-l-blue-500",
    amber: "border-l-amber-500",
    red: "border-l-red-500",
  }[accent];
  return (
    <Card className={`border-l-4 ${accentClass}`}>
      <CardContent className="pt-4 pb-3">
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}
