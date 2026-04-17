"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Clock3, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type TaskLike = {
  job_id?: number;
  title?: string;
  client_name?: string;
  status?: string;
  milestone_status?: string;
  next_due_date?: string | null;
  next_due_name?: string | null;
  days_to_next_due?: number | null;
  crm_name?: string;
};

type OperationsOverview = {
  jobs_needing_attention?: TaskLike[];
  recent_activity?: TaskLike[];
};

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "No due date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TaskCalendar({ baseUrl, crmOwner }: { baseUrl: string; crmOwner: string | null }) {
  const api = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl]);
  const [items, setItems] = useState<TaskLike[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!api) return;
    const ac = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const params = crmOwner ? `?crm_owner=${encodeURIComponent(crmOwner)}` : "";
        const res = await fetch(`${api}/dashboard/operations-overview${params}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (!res.ok) throw new Error("Unable to load task data");
        const data = (await res.json()) as OperationsOverview;
        const nextItems = Array.isArray(data.jobs_needing_attention) && data.jobs_needing_attention.length > 0
          ? data.jobs_needing_attention
          : Array.isArray(data.recent_activity)
            ? data.recent_activity
            : [];
        setItems(nextItems);
      } catch (e) {
        if (!ac.signal.aborted) setError((e as Error).message || "Unable to load task data");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => ac.abort();
  }, [api, crmOwner]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="h-4 w-4" />
          Task Calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {!api ? (
          <div className="text-sm text-muted-foreground">No API base URL configured.</div>
        ) : loading ? (
          <div className="text-sm text-muted-foreground">Loading tasks…</div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-rose-600">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No tasks found for the current filter.</div>
        ) : (
          <div className="space-y-3">
            {items.slice(0, 12).map((task, index) => {
              const days = task.days_to_next_due;
              const dueClass =
                days == null ? "bg-slate-100 text-slate-700"
                  : days < 0 ? "bg-rose-100 text-rose-700"
                  : days <= 7 ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700";
              return (
                <div key={`${task.job_id ?? "task"}-${index}`} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium truncate">{task.title || `Job ${task.job_id ?? "Task"}`}</div>
                        {task.status ? <Badge variant="secondary">{task.status}</Badge> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {task.client_name || task.crm_name || "Unassigned"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {task.next_due_name || "Due"}: {formatDate(task.next_due_date)}
                        </span>
                      </div>
                    </div>
                    <Badge className={dueClass}>
                      {days == null ? "No due date" : days < 0 ? `${Math.abs(days)}d late` : `${days}d`}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <a href={api ? `${api}/dashboard` : "#"}>Open dashboard</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
