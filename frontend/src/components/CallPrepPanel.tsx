"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Clock,
  FileText,
  MessageSquare,
  Phone,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LogTouchpointModal from "@/components/LogTouchpointModal";
import { formatDate } from "@/lib/format";

type Milestone = {
  name: string;
  due: string | null;
  completed: boolean;
  completed_at: string | null;
  status: "green" | "amber" | "red" | "none";
};

type ActiveJob = {
  job_id: number;
  job_number: string | null;
  title: string;
  status: string;
  reporting_year: number | null;
  milestone_status: string | null;
  milestones: Milestone[];
  next_milestone: string | null;
  next_milestone_due: string | null;
  days_to_milestone: number | null;
  due_date: string | null;
};

type Touchpoint = {
  touchpoint_id: number;
  occurred_at: string | null;
  touchpoint_type: string;
  summary: string;
  outcome: string;
  next_action: string | null;
  next_action_due: string | null;
  crm_owner: string;
};

type Task = {
  task_id: number;
  client_db_id: number;
  job_id: number | null;
  title: string;
  details: string;
  priority: string;
  due_at: string | null;
  status: string;
};

type Note = {
  source: string;
  source_label: string;
  note_id: number;
  subject: string | null;
  note_text: string;
  author: string;
  job_id: number | null;
  job_number: string | null;
  job_title: string | null;
  note_at: string | null;
};

type CallPrepData = {
  client_name: string;
  crm_owner: string;
  health_score: number;
  risk_flags: string[];
  engagement: {
    start_date: string | null;
    end_date: string | null;
    net_zero_year: number | null;
    benchmark_year: number | null;
    touchpoint_cadence: string | null;
  };
  recent_touchpoints: Touchpoint[];
  days_since_contact: number | null;
  active_job: ActiveJob | null;
  all_jobs: Array<{ job_id: number; title: string; status: string; reporting_year: number | null }>;
  open_tasks: Task[];
  emissions_summary: {
    latest_year: number | null;
    latest_tco2e: number | null;
    yoy_change_pct: number | null;
    vs_trajectory_pct: number | null;
  } | null;
  invoices: { open: number; overdue: number };
  recent_notes: Note[];
  talking_points: string[];
};

type CallPrepPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseUrl: string;
  clientDbId: number | null;
  clientName?: string;
  onRefresh?: () => void | Promise<void>;
};

function healthTone(score: number) {
  if (score >= 70) return "bg-green-100 text-green-700 border-green-200";
  if (score >= 40) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function pointTone(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("overdue") || lower.includes("renewal ends") || lower.includes("imminent")) {
    return "border-red-400 bg-red-50";
  }
  if (lower.includes("approaching") || lower.includes("outstanding") || lower.includes("invoice") || lower.includes("renewal")) {
    return "border-amber-400 bg-amber-50";
  }
  return "border-blue-400 bg-blue-50";
}

function milestoneDot(status: string) {
  if (status === "green") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "amber") return <CircleDot className="h-4 w-4 text-amber-500 shrink-0" />;
  if (status === "red") return <CircleDot className="h-4 w-4 text-red-500 shrink-0" />;
  return <CircleDot className="h-4 w-4 text-gray-300 shrink-0" />;
}

function milestoneDateLabel(m: Milestone) {
  if (m.completed && m.completed_at) {
    return <span className="text-green-600">Done {formatDate(m.completed_at, { day: "numeric", month: "short" })}</span>;
  }
  if (!m.due) return <span className="text-muted-foreground">No date set</span>;
  const tone = m.status === "red" ? "text-red-600 font-medium" : m.status === "amber" ? "text-amber-600" : "text-muted-foreground";
  return <span className={tone}>{formatDate(m.due, { day: "numeric", month: "short" })}</span>;
}

function touchpointIcon(type: string) {
  if (type === "call") return <Phone className="h-3.5 w-3.5" />;
  if (type === "meeting") return <Briefcase className="h-3.5 w-3.5" />;
  if (type === "email") return <MessageSquare className="h-3.5 w-3.5" />;
  return <MessageSquare className="h-3.5 w-3.5" />;
}

function outcomeTone(outcome: string) {
  if (outcome === "positive") return "bg-green-100 text-green-700";
  if (outcome === "concern_raised" || outcome === "escalation_needed") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-600";
}

function priorityTone(priority: string) {
  if (priority === "urgent") return "bg-red-100 text-red-700";
  if (priority === "high") return "bg-amber-100 text-amber-700";
  return "bg-gray-100 text-gray-600";
}

function daysAgoLabel(daysSince: number | null, occurredAt: string | null) {
  if (daysSince == null) return occurredAt ? "Recent" : "No contact yet";
  if (daysSince <= 0) return "Today";
  if (daysSince === 1) return "1 day ago";
  return `${daysSince} days ago`;
}

export default function CallPrepPanel({
  open,
  onOpenChange,
  baseUrl,
  clientDbId,
  clientName,
  onRefresh,
}: CallPrepPanelProps) {
  const [data, setData] = useState<CallPrepData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [logOpen, setLogOpen] = useState(false);

  const title = useMemo(() => data?.client_name || clientName || "Call Prep", [clientName, data?.client_name]);

  async function loadCallPrep() {
    if (!clientDbId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/intelligence/client/${clientDbId}/call-prep`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        let detail = "Failed to load call prep.";
        try {
          const payload = await res.json();
          if (payload?.detail) detail = String(payload.detail);
        } catch { /* ignore */ }
        throw new Error(detail);
      }
      const payload = (await res.json()) as CallPrepData;
      setData(payload);
    } catch (err) {
      setError((err as Error).message || "Failed to load call prep.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !clientDbId) {
      setData(null);
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/intelligence/client/${clientDbId}/call-prep`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          let detail = "Failed to load call prep.";
          try {
            const payload = await res.json();
            if (payload?.detail) detail = String(payload.detail);
          } catch { /* ignore */ }
          throw new Error(detail);
        }
        const payload = (await res.json()) as CallPrepData;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Failed to load call prep.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, clientDbId, baseUrl]);

  if (!open) return null;

  const talkingPoints = data?.talking_points ?? [];
  const engagement = data?.engagement;
  const recentTouchpoints = data?.recent_touchpoints ?? [];
  const openTasks = data?.open_tasks ?? [];
  const clientTasks = openTasks.filter(t => t.job_id == null);
  const jobTasks = openTasks.filter(t => t.job_id != null);
  const recentNotes = data?.recent_notes ?? [];

  return (
    <>
      <div className="fixed inset-0 z-50">
        <button className="absolute inset-0 bg-black/40" aria-label="Close call prep" onClick={() => onOpenChange(false)} />
        <aside className="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto border-l bg-background shadow-2xl">

          {/* Header */}
          <div className="sticky top-0 z-10 border-b bg-gradient-to-r from-primary/5 via-background to-background px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Call Prep</span>
                </div>
                <h2 className="mt-1 text-2xl font-semibold leading-tight">{title}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">{data?.crm_owner || "Unassigned"}</span>
                  {data && data.health_score > 0 && (
                    <Badge className={healthTone(data.health_score)}>{data.health_score}/100 health</Badge>
                  )}
                  {engagement?.end_date && (
                    <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
                      Engagement ends {formatDate(engagement.end_date, { day: "numeric", month: "short", year: "numeric" })}
                    </Badge>
                  )}
                </div>
              </div>
              <button
                onClick={() => onOpenChange(false)}
                className="mt-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="space-y-5 px-6 py-5">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {loading && <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Loading call prep...</div>}

            {data && (
              <>
                {/* Talking Points */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Talking Points</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {talkingPoints.length > 0 ? talkingPoints.map((point, idx) => (
                      <div key={`${idx}-${point}`} className={`rounded-lg border-l-4 px-4 py-3 ${pointTone(point)}`}>
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          <ArrowRight className="h-3.5 w-3.5" />
                          <span>Point {idx + 1}</span>
                        </div>
                        <div className="mt-1 text-sm leading-6">{point}</div>
                      </div>
                    )) : (
                      <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                        No talking points generated for this client yet.
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Recent Contacts */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Recent Contacts</CardTitle>
                      <Badge variant="secondary">{recentTouchpoints.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {recentTouchpoints.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No contacts logged yet.</div>
                    ) : recentTouchpoints.map((tp) => (
                      <div key={tp.touchpoint_id} className="rounded-lg border bg-muted/20 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {touchpointIcon(tp.touchpoint_type)}
                            <span className="capitalize">{tp.touchpoint_type.replace(/_/g, " ")}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {tp.occurred_at ? formatDate(tp.occurred_at, { day: "numeric", month: "short", year: "numeric" }) : "—"}
                          </span>
                          <Badge className={`text-[10px] ${outcomeTone(tp.outcome)}`}>
                            {tp.outcome.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        {tp.summary && <div className="mt-1.5 text-sm">{tp.summary}</div>}
                        {tp.next_action && (
                          <div className="mt-1.5 text-xs text-muted-foreground">
                            <span className="font-medium">Next: </span>{tp.next_action}
                            {tp.next_action_due && (
                              <span className="ml-1 text-amber-600">· due {formatDate(tp.next_action_due, { day: "numeric", month: "short" })}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Active Job + Milestones */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Active Job</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.active_job ? (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{data.active_job.title}</span>
                          {data.active_job.reporting_year && (
                            <Badge variant="outline">{data.active_job.reporting_year}</Badge>
                          )}
                          <Badge variant="secondary">{data.active_job.status}</Badge>
                        </div>
                        <div className="space-y-2">
                          {data.active_job.milestones.map((m) => (
                            <div key={m.name} className="flex items-center gap-3">
                              {milestoneDot(m.status)}
                              <span className="flex-1 text-sm">{m.name}</span>
                              <span className="text-xs">{milestoneDateLabel(m)}</span>
                            </div>
                          ))}
                        </div>
                        {data.active_job.next_milestone && (
                          <div className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            Next: <span className="font-medium text-foreground">{data.active_job.next_milestone}</span>
                            {data.active_job.days_to_milestone != null && (
                              <span className={data.active_job.days_to_milestone < 0 ? " text-red-600 font-medium" : data.active_job.days_to_milestone <= 7 ? " text-amber-600" : ""}>
                                {" · "}{Math.abs(data.active_job.days_to_milestone)}d {data.active_job.days_to_milestone < 0 ? "overdue" : "remaining"}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-sm text-muted-foreground">No active job.</div>
                        {data.all_jobs.length > 0 && (
                          <div className="space-y-1">
                            {data.all_jobs.slice(0, 3).map((j) => (
                              <div key={j.job_id} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="text-[10px]">{j.status}</Badge>
                                <span>{j.title}{j.reporting_year ? ` (${j.reporting_year})` : ""}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Open Tasks */}
                {openTasks.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">Open Tasks</CardTitle>
                        <Badge variant="secondary">{openTasks.length}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {clientTasks.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                            <ClipboardList className="h-3.5 w-3.5" />
                            <span>Client Tasks</span>
                          </div>
                          <div className="space-y-2">
                            {clientTasks.map((t) => (
                              <div key={t.task_id} className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium">{t.title}</div>
                                  {t.details && <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{t.details}</div>}
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  <Badge className={`text-[10px] ${priorityTone(t.priority)}`}>{t.priority}</Badge>
                                  {t.due_at && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      <Clock className="h-2.5 w-2.5" />
                                      {formatDate(t.due_at, { day: "numeric", month: "short" })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {jobTasks.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                            <Briefcase className="h-3.5 w-3.5" />
                            <span>Job Tasks</span>
                          </div>
                          <div className="space-y-2">
                            {jobTasks.map((t) => (
                              <div key={t.task_id} className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium">{t.title}</div>
                                  {t.details && <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{t.details}</div>}
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  <Badge className={`text-[10px] ${priorityTone(t.priority)}`}>{t.priority}</Badge>
                                  {t.due_at && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      <Clock className="h-2.5 w-2.5" />
                                      {formatDate(t.due_at, { day: "numeric", month: "short" })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Recent Notes */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Recent Notes</CardTitle>
                      <Badge variant="secondary">{recentNotes.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {recentNotes.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No notes logged yet.</div>
                    ) : recentNotes.map((note, idx) => (
                      <div key={`${note.source}-${note.note_id}-${idx}`} className="rounded-lg border bg-muted/20 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <FileText className="h-3.5 w-3.5" />
                            <span>{note.source_label}</span>
                          </div>
                          {note.job_number && (
                            <span className="text-xs text-muted-foreground">· Job {note.job_number}{note.job_title ? ` — ${note.job_title}` : ""}</span>
                          )}
                          {note.note_at && (
                            <span className="text-xs text-muted-foreground">
                              · {formatDate(note.note_at, { day: "numeric", month: "short", year: "numeric" })}
                            </span>
                          )}
                        </div>
                        {note.subject && (
                          <div className="mt-1.5 text-sm font-medium">{note.subject}</div>
                        )}
                        <div className="mt-1 text-sm leading-relaxed line-clamp-3">{note.note_text}</div>
                        {note.author && (
                          <div className="mt-1.5 text-xs text-muted-foreground">{note.author}</div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Snapshot Stats */}
                <div className="grid gap-3 md:grid-cols-4">
                  <MiniStat label="Last Contact" value={daysAgoLabel(data.days_since_contact, recentTouchpoints[0]?.occurred_at ?? null)} />
                  <MiniStat
                    label="Latest Emissions"
                    value={data.emissions_summary?.latest_tco2e != null
                      ? `${data.emissions_summary.latest_tco2e.toFixed(1)} tCO₂e (${data.emissions_summary.latest_year})`
                      : "N/A"}
                  />
                  <MiniStat
                    label="Vs Trajectory"
                    value={data.emissions_summary?.vs_trajectory_pct != null
                      ? `${data.emissions_summary.vs_trajectory_pct > 0 ? "+" : ""}${data.emissions_summary.vs_trajectory_pct.toFixed(1)}%`
                      : "N/A"}
                  />
                  <MiniStat
                    label="Invoices"
                    value={`${data.invoices.open} open${data.invoices.overdue > 0 ? ` / ${data.invoices.overdue} overdue` : ""}`}
                  />
                </div>

                {/* Engagement Info */}
                {engagement && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Engagement</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      {engagement.start_date && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Start</div>
                          <div>{formatDate(engagement.start_date, { day: "numeric", month: "short", year: "numeric" })}</div>
                        </div>
                      )}
                      {engagement.end_date && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">End</div>
                          <div>{formatDate(engagement.end_date, { day: "numeric", month: "short", year: "numeric" })}</div>
                        </div>
                      )}
                      {engagement.net_zero_year && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Net Zero Target</div>
                          <div>{engagement.net_zero_year}</div>
                        </div>
                      )}
                      {engagement.benchmark_year && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Benchmark Year</div>
                          <div>{engagement.benchmark_year}</div>
                        </div>
                      )}
                      {engagement.touchpoint_cadence && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Contact Cadence</div>
                          <div className="capitalize">{engagement.touchpoint_cadence}</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Actions */}
                <div className="flex flex-wrap justify-end gap-2 pb-2">
                  <Button variant="outline" onClick={() => setLogOpen(true)} disabled={!clientDbId}>
                    Log Contact
                  </Button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      <LogTouchpointModal
        open={logOpen}
        onOpenChange={setLogOpen}
        baseUrl={baseUrl}
        clientDbId={clientDbId}
        clientName={title}
        onSaved={async () => {
          await onRefresh?.();
          await loadCallPrep();
        }}
      />
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" />
          <span>{label}</span>
        </div>
        <div className="mt-2 text-sm font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
