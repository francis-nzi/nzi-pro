"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarClock, CircleAlert, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LogTouchpointModal from "@/components/LogTouchpointModal";

type CallPrepPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseUrl: string;
  clientDbId: number | null;
  clientName?: string;
  onRefresh?: () => void | Promise<void>;
};

type CallPrepData = {
  client_name: string;
  crm_owner: string;
  last_touchpoint: {
    occurred_at: string;
    summary: string;
    outcome: string;
    next_action?: string | null;
  } | null;
  days_since_contact: number | null;
  health_score: number;
  risk_flags: string[];
  active_job: {
    job_id: number;
    title: string;
    status: string;
    milestone_status: string | null;
    next_milestone: string | null;
    days_to_milestone: number | null;
  } | null;
  emissions_summary: {
    latest_year: number | null;
    latest_tco2e: number | null;
    yoy_change_pct: number | null;
    vs_trajectory_pct: number | null;
  } | null;
  open_invoices: number;
  overdue_invoices: number;
  talking_points: string[];
  engagement_end_date: string | null;
};

function healthTone(score: number) {
  if (score >= 70) return "bg-green-100 text-green-700 border-green-200";
  if (score >= 40) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function pointTone(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("emissions") || lower.includes("overdue") || lower.includes("renewal due")) {
    return "border-red-400 bg-red-50";
  }
  if (lower.includes("check in") || lower.includes("outstanding invoice")) {
    return "border-amber-400 bg-amber-50";
  }
  return "border-blue-400 bg-blue-50";
}

function formatDaysAgo(value: string | null, daysSince: number | null) {
  if (daysSince == null) return value ? "Recent" : "No contact yet";
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
          } catch {
            /* ignore */
          }
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
    return () => {
      cancelled = true;
    };
  }, [open, clientDbId, baseUrl]);

  if (!open) return null;

  const talkingPoints = data?.talking_points ?? [];

  return (
    <>
      <div className="fixed inset-0 z-50">
        <button className="absolute inset-0 bg-black/40" aria-label="Close call prep" onClick={() => onOpenChange(false)} />
        <aside className="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto border-l bg-background shadow-2xl">
          <div className="border-b bg-gradient-to-r from-primary/5 via-background to-background px-6 py-4">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Call Prep</span>
              </div>
              <h2 className="mt-1 text-2xl font-semibold">{title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{data?.crm_owner || "Unassigned"}</span>
                {data && <Badge variant="outline">{data.health_score}/100 health</Badge>}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              {data && <Badge className={healthTone(data.health_score)}>{data.health_score}/100</Badge>}
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>

          <div className="space-y-5 px-6 py-5">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {loading && <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Loading call prep...</div>}

            {data && (
              <>
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
                        No talking points were generated for this client yet.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="grid gap-3 md:grid-cols-4">
                  <MiniStat label="Last Contact" value={formatDaysAgo(data.last_touchpoint?.occurred_at ?? null, data.days_since_contact)} />
                  <MiniStat label="Latest Emissions" value={data.emissions_summary?.latest_tco2e != null ? `${data.emissions_summary.latest_tco2e.toFixed(2)} tCO2e` : "N/A"} />
                  <MiniStat label="Vs Trajectory" value={data.emissions_summary?.vs_trajectory_pct != null ? `${data.emissions_summary.vs_trajectory_pct.toFixed(1)}%` : "N/A"} />
                  <MiniStat label="Open Invoices" value={`${data.open_invoices} / ${data.overdue_invoices} overdue`} />
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Active Job</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.active_job ? (
                      <div className="space-y-2">
                        <div className="font-medium">{data.active_job.title}</div>
                        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                          <Badge variant="outline">{data.active_job.status}</Badge>
                          {data.active_job.milestone_status && <Badge variant="secondary">{data.active_job.milestone_status}</Badge>}
                          {data.active_job.next_milestone && (
                            <Badge variant="outline">
                              {data.active_job.next_milestone}
                              {data.active_job.days_to_milestone != null ? ` · ${data.active_job.days_to_milestone}d` : ""}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No active job found.</div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Last Touchpoint</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.last_touchpoint ? (
                      <div className="space-y-2 text-sm">
                        <div className="text-muted-foreground">{data.last_touchpoint.occurred_at}</div>
                        <div>{data.last_touchpoint.summary}</div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{data.last_touchpoint.outcome}</Badge>
                          {data.last_touchpoint.next_action && <Badge variant="secondary">{data.last_touchpoint.next_action}</Badge>}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No touchpoints logged yet.</div>
                    )}
                  </CardContent>
                </Card>

                <div className="flex flex-wrap justify-end gap-2">
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
          if (clientDbId) {
            const res = await fetch(`${baseUrl}/intelligence/client/${clientDbId}/call-prep`, {
              credentials: "include",
              cache: "no-store",
            });
            if (res.ok) {
              const payload = (await res.json()) as CallPrepData;
              setData(payload);
            }
          }
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
