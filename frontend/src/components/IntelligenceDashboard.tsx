"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckSquare, Pencil, RefreshCcw, Search, ShieldCheck, Sparkles, Trash2, TrendingUp, Users, X } from "lucide-react";
import CallPrepPanel from "@/components/CallPrepPanel";
import LogTouchpointModal from "@/components/LogTouchpointModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatNumber } from "@/lib/format";

type MyTask = {
  task_id: number;
  client_db_id: number;
  job_id: number | null;
  title: string;
  details: string;
  priority: string;
  due_at: string | null;
  status: string;
  client_name: string;
  job_number: string;
  job_title: string;
  assignee_user_id: string;
  created_by: string;
  created_at: string | null;
};

type Assignee = {
  name: string;
  email: string;
  group: string;
};

const EMPTY_EDIT_FORM = {
  title: "",
  details: "",
  assignee_user_id: "",
  assignee_label: "",
  priority: "normal",
  due_at: "",
  status: "open",
};

function ragBadge(priority: string) {
  switch (priority?.toLowerCase()) {
    case "urgent": return <Badge className="bg-rose-100 text-rose-700 border-rose-200 font-medium">Urgent</Badge>;
    case "high": return <Badge className="bg-amber-100 text-amber-700 border-amber-200 font-medium">High</Badge>;
    case "normal": return <Badge className="bg-sky-100 text-sky-700 border-sky-200 font-medium">Normal</Badge>;
    case "low": return <Badge className="bg-slate-100 text-slate-600 border-slate-200 font-medium">Low</Badge>;
    default: return <Badge variant="outline">{priority || "Normal"}</Badge>;
  }
}

function taskStatusBadge(status: string) {
  switch (status?.toLowerCase()) {
    case "done": return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Done</Badge>;
    case "in_progress": return <Badge className="bg-blue-100 text-blue-700 border-blue-200">In Progress</Badge>;
    case "blocked": return <Badge className="bg-rose-100 text-rose-700 border-rose-200">Blocked</Badge>;
    case "cancelled": return <Badge className="bg-slate-100 text-slate-500 border-slate-200">Cancelled</Badge>;
    default: return <Badge variant="outline">Open</Badge>;
  }
}

function shortEmail(assignee: string) {
  if (!assignee) return null;
  if (assignee.includes("@")) return assignee.split("@")[0];
  return assignee;
}

type IntelligenceDashboardProps = {
  baseUrl: string;
  crmOwner: string | null;
};

type IntelligenceResponse = {
  action_queue: Array<{
    action_type: string;
    priority: number;
    client_db_id: number;
    client_name: string;
    crm_owner: string;
    headline: string;
    detail: string;
    due_date: string | null;
  }>;
  portfolio_summary: {
    total_clients: number;
    healthy: number;
    needs_attention: number;
    at_risk: number;
    avg_health_score: number;
  };
  upcoming_touchpoints: Array<{
    client_db_id: number;
    client_name: string;
    crm_owner: string;
    last_touchpoint_date: string | null;
    next_touchpoint_due: string | null;
    days_overdue: number;
    days_remaining: number;
  }>;
  renewal_pipeline: Array<{
    client_db_id: number;
    client_name: string;
    crm_owner: string;
    engagement_end_date: string | null;
    days_remaining: number;
    health_score: number;
  }>;
  generated_at: string;
  crm_owner: string;
};

function scopeLabel(value: string | null) {
  return value?.trim() || "All CRMs";
}

function scoreTone(score: number) {
  if (score >= 70) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 40) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function scoreAccent(score: number) {
  if (score >= 70) return "from-emerald-50 to-emerald-100/40";
  if (score >= 40) return "from-amber-50 to-amber-100/40";
  return "from-rose-50 to-rose-100/40";
}

function queueTone(priority: number) {
  if (priority <= 1) return "border-rose-200 bg-rose-50";
  if (priority === 2) return "border-amber-200 bg-amber-50";
  return "border-sky-200 bg-sky-50";
}

export default function IntelligenceDashboard({ baseUrl, crmOwner }: IntelligenceDashboardProps) {
  const [scopeOwner, setScopeOwner] = useState<string | null>(crmOwner);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [viewMode, setViewMode] = useState<"personal" | "all">("personal");
  const [ready, setReady] = useState(Boolean(crmOwner));
  const [data, setData] = useState<IntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [callPrepClient, setCallPrepClient] = useState<{ id: number; name: string } | null>(null);
  const [logClient, setLogClient] = useState<{ id: number; name: string } | null>(null);
  const [myTasks, setMyTasks] = useState<MyTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskDetail, setTaskDetail] = useState<MyTask | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_EDIT_FORM });
  const [deleting, setDeleting] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveScope() {
      try {
        const res = await fetch(`${baseUrl}/auth/me`, { cache: "no-store", credentials: "include" });
        if (!res.ok) {
          if (!crmOwner || !crmOwner.trim()) {
            setScopeOwner(null);
          }
          return;
        }
        const payload = await res.json().catch(() => ({})) as {
          user?: {
            full_name?: string | null;
            email?: string | null;
            user_id?: string | null;
            is_super_admin?: boolean | null;
          };
        };
        const user = payload?.user || {};
        const defaultOwner = String(user.full_name || user.email || user.user_id || "").trim();
        if (!cancelled) {
          setIsSuperAdmin(Boolean(user.is_super_admin));
          setScopeOwner((crmOwner && crmOwner.trim()) || defaultOwner || null);
        }
      } catch {
        if (!cancelled && !crmOwner) setScopeOwner(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void resolveScope();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, crmOwner]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const query = viewMode === "all" && isSuperAdmin
          ? "?all_crms=true"
          : scopeOwner
            ? `?crm_owner=${encodeURIComponent(scopeOwner)}`
            : "";
        const res = await fetch(`${baseUrl}/intelligence/dashboard${query}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) {
          let detail = "Failed to load intelligence dashboard.";
          try {
            const payload = await res.json();
            if (payload?.detail) detail = String(payload.detail);
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }
        const payload = (await res.json()) as IntelligenceResponse;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Failed to load intelligence dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, ready, scopeOwner, refreshToken, viewMode, isSuperAdmin]);

  const hasHealthData = (data?.portfolio_summary.avg_health_score ?? 0) > 0;

  const summaryCards = useMemo(() => {
    if (!data) return [];
    if (hasHealthData) {
      return [
        { label: "Total Clients", value: data.portfolio_summary.total_clients, icon: <Users className="h-4 w-4" /> },
        { label: "Healthy", value: data.portfolio_summary.healthy, icon: <ShieldCheck className="h-4 w-4" /> },
        { label: "Needs Attention", value: data.portfolio_summary.needs_attention, icon: <AlertCircle className="h-4 w-4" /> },
        { label: "At Risk", value: data.portfolio_summary.at_risk, icon: <AlertCircle className="h-4 w-4" /> },
        { label: "Avg Health Score", value: formatNumber(data.portfolio_summary.avg_health_score, 1), icon: <TrendingUp className="h-4 w-4" /> },
      ];
    }
    return [
      { label: "Total Clients", value: data.portfolio_summary.total_clients, icon: <Users className="h-4 w-4" /> },
      { label: "Actions Required", value: data.action_queue.length, icon: <AlertCircle className="h-4 w-4" /> },
      { label: "Touchpoints Due", value: data.upcoming_touchpoints.length, icon: <AlertCircle className="h-4 w-4" /> },
      { label: "Renewals (90 days)", value: data.renewal_pipeline.length, icon: <TrendingUp className="h-4 w-4" /> },
    ];
  }, [data, hasHealthData]);

  const openCallPrep = (clientId: number, clientName: string) => {
    setCallPrepClient({ id: clientId, name: clientName });
  };

  const openLogContact = (clientId: number, clientName: string) => {
    setLogClient({ id: clientId, name: clientName });
  };

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function loadMyTasks() {
      setTasksLoading(true);
      try {
        const res = await fetch(`${baseUrl}/tasks/my`, { cache: "no-store", credentials: "include" });
        if (res.ok) {
          const payload = (await res.json()) as { items: MyTask[] };
          if (!cancelled) setMyTasks(payload.items || []);
        }
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    }
    void loadMyTasks();
    return () => { cancelled = true; };
  }, [baseUrl, ready, refreshToken]);

  const refresh = () => setRefreshToken((value) => value + 1);

  const filteredAssignees = assigneeQuery.trim()
    ? assignees.filter((a) =>
        (a.name || a.email).toLowerCase().includes(assigneeQuery.toLowerCase()) ||
        a.email.toLowerCase().includes(assigneeQuery.toLowerCase())
      )
    : assignees.slice(0, 20);

  function selectAssignee(a: Assignee) {
    setEditForm((f) => ({ ...f, assignee_user_id: a.email, assignee_label: a.name || a.email }));
    setAssigneeQuery("");
    setAssigneeOpen(false);
  }

  function clearAssignee() {
    setEditForm((f) => ({ ...f, assignee_user_id: "", assignee_label: "" }));
    setAssigneeQuery("");
  }

  const loadAssignees = useCallback(async (clientId: number) => {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/email-recipients`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { contacts: Assignee[]; team: Assignee[] };
      setAssignees([...(data.team || []), ...(data.contacts || [])]);
    } catch {
      // non-fatal
    }
  }, [baseUrl]);

  function openEdit(task: MyTask) {
    setEditingTaskId(task.task_id);
    setEditForm({
      title: task.title || "",
      details: task.details || "",
      assignee_user_id: task.assignee_user_id || "",
      assignee_label: task.assignee_user_id || "",
      priority: task.priority || "normal",
      due_at: task.due_at ? task.due_at.slice(0, 10) : "",
      status: task.status || "open",
    });
    setAssigneeQuery("");
    setTaskDetail(null);
    void loadAssignees(task.client_db_id);
    setEditModalOpen(true);
  }

  async function handleDeleteTask(task: MyTask) {
    if (!confirm("Delete this task?")) return;
    setDeleting(task.task_id);
    try {
      const res = await fetch(`${baseUrl}/tasks/${task.task_id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete task");
      setMyTasks((prev) => prev.filter((t) => t.task_id !== task.task_id));
      setTaskDetail(null);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleSaveTask() {
    if (!editForm.title.trim()) { alert("Title is required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/tasks/${editingTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: editForm.title.trim(),
          details: editForm.details.trim() || null,
          assignee_user_id: editForm.assignee_user_id || null,
          priority: editForm.priority,
          due_at: editForm.due_at || null,
          status: editForm.status,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail || "Failed to save task");
      }
      setMyTasks((prev) => prev.map((t) =>
        t.task_id === editingTaskId
          ? { ...t, title: editForm.title.trim(), details: editForm.details.trim(), assignee_user_id: editForm.assignee_user_id, priority: editForm.priority, due_at: editForm.due_at || null, status: editForm.status }
          : t
      ));
      setEditModalOpen(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function quickStatus(task: MyTask, nextStatus: string) {
    try {
      const res = await fetch(`${baseUrl}/tasks/${task.task_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      setMyTasks((prev) => prev.map((t) => t.task_id === task.task_id ? { ...t, status: nextStatus } : t));
      setTaskDetail((d) => d ? { ...d, status: nextStatus } : d);
    } catch {
      // non-fatal
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Insights</div>
          <h2 className="text-3xl font-semibold text-foreground">
            {viewMode === "all" && isSuperAdmin ? "All CRM dashboard" : "Personal CRM dashboard"}
          </h2>
          <div className="mt-1 text-sm text-muted-foreground">
            {viewMode === "all" && isSuperAdmin
              ? "Viewing all CRMs"
              : scopeOwner
                ? `Viewing ${scopeLabel(scopeOwner)}`
                : "Loading your CRM scope..."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <div className="flex items-center rounded-full border bg-muted/20 p-1">
              <button
                type="button"
                onClick={() => setViewMode("personal")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${viewMode === "personal" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Personal
              </button>
              <button
                type="button"
                onClick={() => setViewMode("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${viewMode === "all" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                All CRMs
              </button>
            </div>
          )}
          {data && <Badge variant="outline" className="rounded-full">{formatDate(data.generated_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Badge>}
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {loading && !data ? (
        <div className="rounded-xl border bg-card/60 p-6 text-sm text-muted-foreground">Loading intelligence dashboard...</div>
      ) : null}

      {data ? (
        <>
          <Card className="overflow-hidden border-border/70 bg-gradient-to-r from-background via-background to-muted/25 shadow-sm">
            <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Personal insights feed</span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Prioritised actions, touchpoints, and renewals for the current CRM scope. Use the cards below to jump straight into call prep or logging contact.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full">{scopeOwner ? scopeLabel(scopeOwner) : "All CRMs"}</Badge>
                <Badge variant="secondary" className="rounded-full">{data.action_queue.length} actions</Badge>
                <Badge variant="secondary" className="rounded-full">{data.upcoming_touchpoints.length} touchpoints</Badge>
              </div>
            </CardContent>
          </Card>

          <div className={`grid gap-4 ${hasHealthData ? "md:grid-cols-2 xl:grid-cols-5" : "md:grid-cols-2 xl:grid-cols-4"}`}>
            {summaryCards.map((card) => (
              <Card key={card.label} className="overflow-hidden border-border/70">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{card.label}</div>
                    <div className="mt-1 text-2xl font-semibold">{card.value}</div>
                  </div>
                  <div className="rounded-full border bg-background/80 p-2 text-muted-foreground shadow-sm">{card.icon}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">My Tasks</CardTitle>
                </div>
                <Badge variant="secondary">{myTasks.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {tasksLoading ? (
                <div className="px-6 py-4 text-sm text-muted-foreground">Loading tasks...</div>
              ) : myTasks.length === 0 ? (
                <div className="px-6 py-4 text-sm text-muted-foreground">No open tasks assigned to you.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 text-left font-medium">Priority</th>
                        <th className="px-4 py-2 text-left font-medium">Task</th>
                        <th className="px-4 py-2 text-left font-medium">Client</th>
                        <th className="px-4 py-2 text-left font-medium">Due</th>
                        <th className="px-4 py-2 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myTasks.map((task) => {
                        const dueStr = task.due_at
                          ? new Date(task.due_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                          : "—";
                        const isOverdue = task.due_at && new Date(task.due_at) < new Date();
                        return (
                          <tr
                            key={task.task_id}
                            className="border-b cursor-pointer hover:bg-muted/20 transition-colors"
                            onClick={() => setTaskDetail(task)}
                          >
                            <td className="px-4 py-3">
                              {task.priority === "urgent" && <Badge className="bg-rose-100 text-rose-700 border-rose-200">Urgent</Badge>}
                              {task.priority === "high" && <Badge className="bg-amber-100 text-amber-700 border-amber-200">High</Badge>}
                              {task.priority === "normal" && <Badge className="bg-sky-100 text-sky-700 border-sky-200">Normal</Badge>}
                              {task.priority === "low" && <Badge className="bg-slate-100 text-slate-600 border-slate-200">Low</Badge>}
                            </td>
                            <td className="px-4 py-3 font-medium max-w-[200px] truncate">{task.title}</td>
                            <td className="px-4 py-3 text-muted-foreground text-xs max-w-[140px] truncate">
                              {task.client_name || "—"}
                            </td>
                            <td className={`px-4 py-3 text-xs whitespace-nowrap ${isOverdue ? "text-rose-600 font-medium" : ""}`}>
                              {dueStr}
                            </td>
                            <td className="px-4 py-3">
                              {task.status === "in_progress" && <Badge className="bg-blue-100 text-blue-700 border-blue-200">In Progress</Badge>}
                              {task.status === "blocked" && <Badge className="bg-rose-100 text-rose-700 border-rose-200">Blocked</Badge>}
                              {task.status === "open" && <Badge variant="outline">Open</Badge>}
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

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Action Queue</CardTitle>
                  <Badge variant="secondary">{data.action_queue.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.action_queue.length === 0 ? (
                  <EmptyState title="No urgent actions" description="This CRM looks healthy right now." />
                ) : (
                  data.action_queue.slice(0, 8).map((item) => (
                    <div key={`${item.client_db_id}-${item.action_type}-${item.priority}`} className={`rounded-xl border px-4 py-3 ${queueTone(item.priority)}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{item.client_name}</div>
                            <Badge variant="outline" className="text-[10px] uppercase tracking-[0.18em]">{item.action_type.replace(/_/g, " ")}</Badge>
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">{item.headline}</div>
                          {item.detail && <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>}
                          {item.due_date && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              Due: {formatDate(item.due_date, { day: "numeric", month: "short" })}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" variant="outline" onClick={() => openCallPrep(item.client_db_id, item.client_name)}>
                            Call Prep
                          </Button>
                          <Button size="sm" onClick={() => openLogContact(item.client_db_id, item.client_name)}>
                            Log Contact
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Upcoming Touchpoints</CardTitle>
                  <Badge variant="secondary">{data.upcoming_touchpoints.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.upcoming_touchpoints.length === 0 ? (
                  <EmptyState title="No touchpoints due soon" description="Touchpoint cadence is under control for now." />
                ) : (
                  data.upcoming_touchpoints.slice(0, 8).map((item) => (
                    <div key={`${item.client_db_id}-${item.next_touchpoint_due ?? item.last_touchpoint_date ?? "touch"}`} className="rounded-xl border bg-card p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{item.client_name}</div>
                          <div className="text-xs text-muted-foreground">CRM: {item.crm_owner}</div>
                        </div>
                        <Badge variant={item.days_remaining <= 0 ? "destructive" : item.days_remaining <= 7 ? "secondary" : "outline"}>
                          {item.days_remaining <= 0 ? `${Math.abs(item.days_remaining)}d overdue` : `${item.days_remaining}d left`}
                        </Badge>
                      </div>
                      <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                        <div>Last contact: {item.last_touchpoint_date ? formatDate(item.last_touchpoint_date, { day: "numeric", month: "short" }) : "No contact yet"}</div>
                        <div>Due: {item.next_touchpoint_due ? formatDate(item.next_touchpoint_due, { day: "numeric", month: "short" }) : "Unscheduled"}</div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => openCallPrep(item.client_db_id, item.client_name)}>
                          Call Prep
                        </Button>
                        <Button size="sm" onClick={() => openLogContact(item.client_db_id, item.client_name)}>
                          Log Contact
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Renewal Pipeline</CardTitle>
                <Badge variant="secondary">{data.renewal_pipeline.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.renewal_pipeline.length === 0 ? (
                <div className="col-span-full">
                  <EmptyState title="No renewals due soon" description="There are no active renewals inside the next 90 days." />
                </div>
              ) : (
                data.renewal_pipeline.slice(0, 9).map((item) => (
                  <div key={`${item.client_db_id}-${item.engagement_end_date ?? "renewal"}`} className="rounded-xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{item.client_name}</div>
                        <div className="text-xs text-muted-foreground">CRM: {item.crm_owner}</div>
                      </div>
                      {item.health_score > 0 && (
                        <Badge className={scoreTone(item.health_score)}>{item.health_score}/100</Badge>
                      )}
                    </div>
                    <div className="mt-3 text-sm text-muted-foreground">
                      Renewal due: {item.engagement_end_date ? formatDate(item.engagement_end_date, { day: "numeric", month: "short", year: "numeric" }) : "Not set"}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {item.days_remaining <= 0 ? "Expired or due now" : `${item.days_remaining} days remaining`}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openCallPrep(item.client_db_id, item.client_name)}>
                        Call Prep
                      </Button>
                      <Button size="sm" onClick={() => openLogContact(item.client_db_id, item.client_name)}>
                        Log Contact
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog open={!!taskDetail} onOpenChange={(open) => !open && setTaskDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {taskDetail && ragBadge(taskDetail.priority)}
              <span className="truncate">{taskDetail?.title}</span>
            </DialogTitle>
          </DialogHeader>
          {taskDetail && (
            <div className="space-y-4 py-1">
              <div className="flex flex-wrap gap-2">
                {taskStatusBadge(taskDetail.status)}
                <Badge variant="outline" className="text-xs">
                  {taskDetail.due_at
                    ? `Due: ${new Date(taskDetail.due_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
                    : "No due date"}
                </Badge>
                {taskDetail.assignee_user_id && (
                  <Badge variant="outline" className="text-xs">Assigned: {shortEmail(taskDetail.assignee_user_id)}</Badge>
                )}
                {taskDetail.job_id && taskDetail.job_number && (
                  <a
                    href={`/jobs/${taskDetail.job_id}/tasks`}
                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                  >
                    Job {taskDetail.job_number}
                  </a>
                )}
                {taskDetail.client_name && (
                  <a
                    href={`/clients/${taskDetail.client_db_id}?section=tasks`}
                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground border-border bg-muted/30 hover:bg-muted/60 transition-colors"
                  >
                    {taskDetail.client_name}
                  </a>
                )}
              </div>
              {taskDetail.details && (
                <div className="rounded-lg bg-muted/30 p-3 text-sm whitespace-pre-wrap">{taskDetail.details}</div>
              )}
              <div>
                <Label className="mb-2 block text-xs text-muted-foreground">Update Status</Label>
                <div className="flex flex-wrap gap-2">
                  {(["open", "in_progress", "blocked", "done", "cancelled"] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={taskDetail.status === s ? "default" : "outline"}
                      className="text-xs capitalize"
                      onClick={() => void quickStatus(taskDetail, s)}
                    >
                      {s.replace("_", " ")}
                    </Button>
                  ))}
                </div>
              </div>
              {taskDetail.created_by && (
                <div className="text-xs text-muted-foreground">
                  Created by {taskDetail.created_by}
                  {taskDetail.created_at && ` on ${new Date(taskDetail.created_at).toLocaleDateString("en-GB")}`}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { if (taskDetail) openEdit(taskDetail); }}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting === taskDetail?.task_id}
              onClick={() => { if (taskDetail) void handleDeleteTask(taskDetail); }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="dash-task-title">Title *</Label>
              <Input
                id="dash-task-title"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Task title"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="dash-task-details">Details</Label>
              <Textarea
                id="dash-task-details"
                value={editForm.details}
                onChange={(e) => setEditForm((f) => ({ ...f, details: e.target.value }))}
                placeholder="Additional details..."
                rows={3}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Priority</Label>
                <Select value={editForm.priority} onValueChange={(v) => setEditForm((f) => ({ ...f, priority: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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
                <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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
                <Label htmlFor="dash-task-due">Due Date</Label>
                <Input
                  id="dash-task-due"
                  type="date"
                  value={editForm.due_at}
                  onChange={(e) => setEditForm((f) => ({ ...f, due_at: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Assign To</Label>
                {editForm.assignee_user_id ? (
                  <div className="mt-1 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                    <span className="flex-1 font-medium text-emerald-900">{editForm.assignee_label || editForm.assignee_user_id}</span>
                    <button type="button" onClick={clearAssignee} className="text-slate-400 hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      className="pl-8"
                      placeholder="Search by name or email…"
                      value={assigneeQuery}
                      onChange={(e) => { setAssigneeQuery(e.target.value); setAssigneeOpen(true); }}
                      onFocus={() => setAssigneeOpen(true)}
                      onBlur={() => { assigneeBlurRef.current = setTimeout(() => setAssigneeOpen(false), 150); }}
                    />
                    {assigneeOpen && (
                      <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                        {filteredAssignees.length === 0 ? (
                          <p className="px-3 py-2 text-sm text-slate-400">No matches</p>
                        ) : (
                          filteredAssignees.map((a) => (
                            <button
                              key={a.email}
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); if (assigneeBlurRef.current) clearTimeout(assigneeBlurRef.current); selectAssignee(a); }}
                              className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50"
                            >
                              <span className="text-sm font-medium text-slate-800">{a.name || a.email}</span>
                              {a.name && <span className="text-xs text-slate-400">{a.email}</span>}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSaveTask()} disabled={saving}>
              {saving ? "Saving..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CallPrepPanel
        open={Boolean(callPrepClient)}
        onOpenChange={(open) => {
          if (!open) setCallPrepClient(null);
        }}
        baseUrl={baseUrl}
        clientDbId={callPrepClient?.id ?? null}
        clientName={callPrepClient?.name}
        onRefresh={refresh}
      />

      <LogTouchpointModal
        open={Boolean(logClient)}
        onOpenChange={(open) => {
          if (!open) setLogClient(null);
        }}
        baseUrl={baseUrl}
        clientDbId={logClient?.id ?? null}
        clientName={logClient?.name}
        onSaved={refresh}
      />
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border bg-background shadow-sm">
        <AlertCircle className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-3 text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </div>
  );
}
