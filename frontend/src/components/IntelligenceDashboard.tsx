"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Briefcase, CheckSquare, Pencil, RefreshCcw, Search, ShieldCheck, Trash2, TrendingUp, Users, X } from "lucide-react";
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
    case "normal": return <Badge variant="outline" className="font-medium">Normal</Badge>;
    case "low": return <Badge className="bg-slate-100 text-slate-600 border-slate-200 font-medium">Low</Badge>;
    default: return <Badge variant="outline">{priority || "Normal"}</Badge>;
  }
}

function taskStatusBadge(status: string) {
  switch (status?.toLowerCase()) {
    case "done": return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Done</Badge>;
    case "in_progress": return <Badge className="bg-amber-100 text-amber-700 border-amber-200">In Progress</Badge>;
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

type JobNeedingAttention = {
  job_id: number;
  job_number: string;
  title: string;
  client_name: string;
  crm_name: string;
  milestone_status: string;
  next_due_date: string | null;
  next_due_name: string;
  days_to_next_due: number | null;
  reason: string;
};

type CurrentJob = {
  job_id: number;
  client_db_id: number | null;
  job_number: string;
  title: string;
  client_name: string;
  crm_name: string;
  status: string;
  milestone_status: string | null;
  due_date: string | null;
  final_report_due: string | null;
  final_report_completed_at: string | null;
  days_to_final_report_due: number | null;
  next_due_date: string | null;
  next_due_name: string | null;
  days_to_next_due: number | null;
};

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
  const [opsJobs, setOpsJobs] = useState<{ needing_attention: JobNeedingAttention[]; current_jobs: CurrentJob[]; overdue: number; due_soon: number } | null>(null);
  const [followUpSearch, setFollowUpSearch] = useState("");
  const [followUpPage, setFollowUpPage] = useState(0);
  const [jobRagFilter, setJobRagFilter] = useState<"all" | "red" | "amber" | "green" | "none">("all");

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
    async function fetchOps() {
      try {
        const p = new URLSearchParams();
        if (viewMode !== "all" && scopeOwner) p.set("crm_owner", scopeOwner);
        const res = await fetch(`${baseUrl}/dashboard/operations-overview?${p}`, { credentials: "include", cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as {
          metrics?: { overdue_jobs?: number; due_soon_jobs?: number };
          jobs_needing_attention?: JobNeedingAttention[];
          current_jobs?: CurrentJob[];
        };
        if (!cancelled) setOpsJobs({
          needing_attention: json.jobs_needing_attention ?? [],
          current_jobs: json.current_jobs ?? [],
          overdue: json.metrics?.overdue_jobs ?? 0,
          due_soon: json.metrics?.due_soon_jobs ?? 0,
        });
      } catch { /* non-fatal */ }
    }
    void fetchOps();
    return () => { cancelled = true; };
  }, [baseUrl, ready, scopeOwner, viewMode, refreshToken]);

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

  // Derive client-level milestone risk from current_jobs (worst status per client)
  const clientRisk = useMemo(() => {
    if (!opsJobs || !data) return null;
    const rank: Record<string, number> = { red: 3, amber: 2, green: 1, none: 0 };
    const clientWorst = new Map<number, string>();
    for (const job of opsJobs.current_jobs) {
      const cid = job.client_db_id;
      if (cid == null) continue;
      const ms = job.milestone_status ?? "none";
      const cur = clientWorst.get(cid) ?? "none";
      if ((rank[ms] ?? 0) > (rank[cur] ?? 0)) clientWorst.set(cid, ms);
    }
    let overdue = 0, due = 0;
    for (const s of clientWorst.values()) {
      if (s === "red") overdue++;
      else if (s === "amber") due++;
    }
    const healthy = Math.max(0, data.portfolio_summary.total_clients - overdue - due);
    return { overdue, due, healthy };
  }, [opsJobs, data]);

  const summaryCards = useMemo(() => {
    if (!data) return [];
    const atRiskJobs = opsJobs ? opsJobs.overdue + opsJobs.due_soon : null;
    if (hasHealthData) {
      return [
        { label: "Healthy", value: data.portfolio_summary.healthy, icon: <ShieldCheck className="h-4 w-4" /> },
        { label: "Needs Attention", value: data.portfolio_summary.needs_attention, icon: <AlertCircle className="h-4 w-4" /> },
        { label: "At Risk", value: data.portfolio_summary.at_risk, icon: <AlertCircle className="h-4 w-4" /> },
        { label: "Avg Health Score", value: formatNumber(data.portfolio_summary.avg_health_score, 1), icon: <TrendingUp className="h-4 w-4" /> },
      ];
    }
    return [
      { label: "Follow-up Reminders", value: data.action_queue.length, icon: <AlertCircle className="h-4 w-4" /> },
      { label: "Renewals (90 days)", value: data.renewal_pipeline.length, icon: <TrendingUp className="h-4 w-4" /> },
    ];
  }, [data, hasHealthData, opsJobs]);

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
      <div className="flex flex-wrap items-center justify-end gap-2">
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
        {data && <Badge variant="outline" className="rounded-full text-xs font-normal text-muted-foreground">Updated {formatDate(data.generated_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Badge>}
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCcw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {loading && !data ? (
        <div className="rounded-xl border bg-card/60 p-6 text-sm text-muted-foreground">Loading intelligence dashboard...</div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {/* Total Clients — special card with traffic-light breakdown */}
            {data && (() => {
              // crm_person matches clients where this CRM is either the owner or the
              // client_manager, since most staff are set up as manager rather than owner.
              const ownerParam = (viewMode !== "all" && scopeOwner)
                ? `&crm_person=${encodeURIComponent(scopeOwner)}`
                : "";
              return (
                <Link href={`/clients?${ownerParam ? ownerParam.slice(1) : ""}`} className="block">
                  <Card className="overflow-hidden border-border/70 hover:bg-muted/30 transition-colors cursor-pointer h-full">
                    <CardContent className="p-4 flex flex-col justify-between h-full">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total Clients</div>
                          <div className="mt-1 text-2xl font-semibold">{data.portfolio_summary.total_clients}</div>
                        </div>
                        <div className="rounded-full border bg-background/80 p-2 text-muted-foreground shadow-sm">
                          <Users className="h-4 w-4" />
                        </div>
                      </div>
                      {clientRisk && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Link
                            href={`/clients?risk=Overdue${ownerParam}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800 hover:bg-rose-200 transition-colors"
                          >
                            <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                            {clientRisk.overdue}
                          </Link>
                          <Link
                            href={`/clients?risk=Due${ownerParam}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-200 transition-colors"
                          >
                            <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                            {clientRisk.due}
                          </Link>
                          <Link
                            href={`/clients?risk=Healthy${ownerParam}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-200 transition-colors"
                          >
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                            {clientRisk.healthy}
                          </Link>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })()}

            {/* Total Jobs — special card with traffic-light breakdown */}
            {(() => {
              const totalJobs = opsJobs?.current_jobs.length ?? null;
              const jobsOverdue = opsJobs?.current_jobs.filter((j) => j.milestone_status === "red").length ?? 0;
              const jobsDue = opsJobs?.current_jobs.filter((j) => j.milestone_status === "amber").length ?? 0;
              const jobsHealthy = opsJobs?.current_jobs.filter((j) => j.milestone_status === "green").length ?? 0;
              return (
                <Link href="/jobs" className="block">
                  <Card className="overflow-hidden border-border/70 hover:bg-muted/30 transition-colors cursor-pointer h-full">
                    <CardContent className="p-4 flex flex-col justify-between h-full">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total Jobs</div>
                          <div className="mt-1 text-2xl font-semibold">{totalJobs ?? "—"}</div>
                        </div>
                        <div className="rounded-full border bg-background/80 p-2 text-muted-foreground shadow-sm">
                          <Briefcase className="h-4 w-4" />
                        </div>
                      </div>
                      {opsJobs && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800">
                            <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                            {jobsOverdue}
                          </span>
                          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                            <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                            {jobsDue}
                          </span>
                          <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                            {jobsHealthy}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })()}

            {summaryCards.map((card) => {
              const inner = (
                <Card key={card.label} className={`overflow-hidden border-border/70 h-full ${"href" in card ? "hover:bg-muted/30 transition-colors cursor-pointer" : ""}`}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{card.label}</div>
                      <div className="mt-1 text-2xl font-semibold">{card.value}</div>
                    </div>
                    <div className="rounded-full border bg-background/80 p-2 text-muted-foreground shadow-sm">{card.icon}</div>
                  </CardContent>
                </Card>
              );
              return "href" in card && card.href
                ? <Link key={card.label} href={card.href} className="block">{inner}</Link>
                : inner;
            })}
          </div>

          {(tasksLoading || myTasks.length > 0) && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">My Open Tasks</CardTitle>
                </div>
                <Badge variant="secondary">{myTasks.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {tasksLoading ? (
                <div className="px-6 py-4 text-sm text-muted-foreground">Loading tasks...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 text-left font-medium">Priority</th>
                        <th className="px-4 py-2 text-left font-medium">Task</th>
                        <th className="px-4 py-2 text-left font-medium">Job No.</th>
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
                              {ragBadge(task.priority)}
                            </td>
                            <td className="px-4 py-3 font-medium max-w-[200px] truncate">{task.title}</td>
                            <td className="px-4 py-3 text-xs" onClick={(e) => e.stopPropagation()}>
                              {task.job_id && task.job_number ? (
                                <a href={`/jobs/${task.job_id}/tasks`} className="text-foreground hover:underline font-medium">
                                  {task.job_number}
                                </a>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs max-w-[140px] truncate">
                              {task.client_name || "—"}
                            </td>
                            <td className={`px-4 py-3 text-xs whitespace-nowrap ${isOverdue ? "text-rose-600 font-medium" : ""}`}>
                              {dueStr}
                            </td>
                            <td className="px-4 py-3">
                              {taskStatusBadge(task.status)}
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
          )}

          {/* Jobs */}
          {(() => {
            if (opsJobs && opsJobs.current_jobs.length === 0) return null;
            const allJobs = opsJobs?.current_jobs ?? [];
            const filtered = jobRagFilter === "all"
              ? allJobs
              : allJobs.filter((j) => (j.milestone_status ?? "none") === jobRagFilter);
            const redCount = allJobs.filter((j) => j.milestone_status === "red").length;
            const amberCount = allJobs.filter((j) => j.milestone_status === "amber").length;
            const greenCount = allJobs.filter((j) => j.milestone_status === "green").length;
            const noneCount = allJobs.filter((j) => !j.milestone_status).length;
            const ragFilters: Array<{ key: typeof jobRagFilter; label: string; count: number; cls: string; activeCls: string }> = [
              { key: "all", label: "All", count: allJobs.length, cls: "border-border text-muted-foreground hover:bg-muted/50", activeCls: "bg-muted text-foreground border-border" },
              { key: "red", label: "Overdue", count: redCount, cls: "border-rose-200 text-rose-700 hover:bg-rose-50", activeCls: "bg-rose-100 text-rose-800 border-rose-300" },
              { key: "amber", label: "Due Soon", count: amberCount, cls: "border-amber-200 text-amber-700 hover:bg-amber-50", activeCls: "bg-amber-100 text-amber-800 border-amber-300" },
              { key: "green", label: "On Track", count: greenCount, cls: "border-emerald-200 text-emerald-700 hover:bg-emerald-50", activeCls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
              { key: "none", label: "No Milestones", count: noneCount, cls: "border-slate-200 text-slate-500 hover:bg-slate-50", activeCls: "bg-slate-100 text-slate-700 border-slate-300" },
            ];
            return (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">Jobs</CardTitle>
                    </div>
                    <Badge variant="secondary">{filtered.length}{jobRagFilter !== "all" ? ` of ${allJobs.length}` : ""}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ragFilters.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setJobRagFilter(f.key)}
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${jobRagFilter === f.key ? f.activeCls : f.cls}`}
                      >
                        {f.label} {f.count > 0 && <span className="ml-0.5 opacity-70">({f.count})</span>}
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {!opsJobs ? (
                    <div className="px-6 py-4 text-sm text-muted-foreground">Loading jobs...</div>
                  ) : filtered.length === 0 ? (
                    <div className="px-6 py-4 text-sm text-muted-foreground">No jobs match this filter.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-4 py-2 text-left font-medium w-6"></th>
                            <th className="px-4 py-2 text-left font-medium">Job</th>
                            <th className="px-4 py-2 text-left font-medium">Client</th>
                            <th className="px-4 py-2 text-left font-medium">Next Milestone</th>
                            <th className="px-4 py-2 text-left font-medium">Due</th>
                            <th className="px-4 py-2 text-left font-medium">Days</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((job) => {
                            const ms = job.milestone_status;
                            const dotCls = ms === "red" ? "bg-rose-500" : ms === "amber" ? "bg-amber-400" : ms === "green" ? "bg-emerald-500" : "bg-slate-300";
                            const dueDate = job.next_due_date ?? job.final_report_due;
                            const daysLeft = job.days_to_next_due ?? job.days_to_final_report_due;
                            return (
                              <tr key={job.job_id} className="border-b hover:bg-muted/20 transition-colors">
                                <td className="px-4 py-3">
                                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotCls}`} title={ms ?? "No milestones"} />
                                </td>
                                <td className="px-4 py-3 text-xs font-medium">
                                  <Link href={`/jobs/${job.job_id}`} className="text-foreground hover:underline">
                                    {job.job_number}
                                  </Link>
                                </td>
                                <td className="px-4 py-3 max-w-[160px] truncate font-medium">{job.client_name}</td>
                                <td className="px-4 py-3 text-xs text-muted-foreground">{job.next_due_name || "—"}</td>
                                <td className="px-4 py-3 text-xs whitespace-nowrap">
                                  {dueDate
                                    ? new Date(dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                                    : "—"}
                                </td>
                                <td className="px-4 py-3 text-xs whitespace-nowrap">
                                  {daysLeft != null ? (
                                    <span className={daysLeft < 0 ? "text-rose-600 font-medium" : daysLeft <= 14 ? "text-amber-600" : "text-muted-foreground"}>
                                      {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d`}
                                    </span>
                                  ) : "—"}
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
            );
          })()}

          {/* Follow-up Reminders + Renewals side by side */}
          {(data.action_queue.length > 0 || data.renewal_pipeline.length > 0) && (
          <div className="grid gap-6 xl:grid-cols-2">
            {(() => {
              if (data.action_queue.length === 0) return null;
              const FOLLOW_UP_PAGE_SIZE = 10;
              const searchLower = followUpSearch.trim().toLowerCase();
              // Sort: priority ascending (1 = most urgent), then by due_date ascending (oldest first)
              const sorted = [...data.action_queue].sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                const aDate = a.due_date ?? "9999";
                const bDate = b.due_date ?? "9999";
                return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
              });
              const filtered = searchLower
                ? sorted.filter((item) => item.client_name.toLowerCase().includes(searchLower))
                : sorted;
              const totalPages = Math.max(1, Math.ceil(filtered.length / FOLLOW_UP_PAGE_SIZE));
              const safePage = Math.min(followUpPage, totalPages - 1);
              const pageItems = filtered.slice(safePage * FOLLOW_UP_PAGE_SIZE, (safePage + 1) * FOLLOW_UP_PAGE_SIZE);
              return (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">Follow-up Reminders</CardTitle>
                      <Badge variant="secondary">{filtered.length}{searchLower ? ` of ${data.action_queue.length}` : ""}</Badge>
                    </div>
                    <div className="relative mt-2">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Filter by client name..."
                        value={followUpSearch}
                        onChange={(e) => { setFollowUpSearch(e.target.value); setFollowUpPage(0); }}
                        className="pl-8 h-8 text-sm"
                      />
                      {followUpSearch && (
                        <button onClick={() => { setFollowUpSearch(""); setFollowUpPage(0); }} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    {filtered.length === 0 ? (
                      <EmptyState title="No matches" description="Try a different client name." />
                    ) : (
                      <>
                        {pageItems.map((item) => (
                          <div key={`${item.client_db_id}-${item.action_type}-${item.priority}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Link href={`/clients/${item.client_db_id}`} className="font-medium hover:underline text-sm truncate">
                                  {item.client_name}
                                </Link>
                                <Badge variant="outline" className="text-[10px] shrink-0">
                                  {item.action_type === "overdue_call" ? "Call overdue" :
                                   item.action_type === "no_recent_contact" ? "No recent contact" :
                                   item.action_type.replace(/_/g, " ")}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.detail}</div>
                            </div>
                            <Button size="sm" variant="outline" className="shrink-0" onClick={() => openLogContact(item.client_db_id, item.client_name)}>
                              Log Contact
                            </Button>
                          </div>
                        ))}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                            <span>Page {safePage + 1} of {totalPages}</span>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={safePage === 0} onClick={() => setFollowUpPage((p) => Math.max(0, p - 1))}>Prev</Button>
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={safePage >= totalPages - 1} onClick={() => setFollowUpPage((p) => p + 1)}>Next</Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {data.renewal_pipeline.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Renewals (90 days)</CardTitle>
                  <Badge variant="secondary">{data.renewal_pipeline.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.renewal_pipeline.slice(0, 8).map((item) => (
                    <div key={`${item.client_db_id}-${item.engagement_end_date ?? "renewal"}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                      <div className="min-w-0">
                        <Link href={`/clients/${item.client_db_id}`} className="font-medium hover:underline text-sm truncate block">
                          {item.client_name}
                        </Link>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {item.engagement_end_date
                            ? `Ends ${new Date(item.engagement_end_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
                            : "End date not set"}
                        </div>
                      </div>
                      <Badge className={`shrink-0 ${item.days_remaining <= 14 ? "bg-rose-100 text-rose-700 border-rose-200" : item.days_remaining <= 30 ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-muted text-muted-foreground"}`}>
                        {item.days_remaining <= 0 ? "Expired" : `${item.days_remaining}d`}
                      </Badge>
                    </div>
                ))}
              </CardContent>
            </Card>
            )}
          </div>
          )}
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
                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground border-border bg-muted/30 hover:bg-muted/60 transition-colors"
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
