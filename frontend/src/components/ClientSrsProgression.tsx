"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ProgressionSection = {
  section: string;
  avg_score: number | null;
  maturity_label: string | null;
  questions_scored: number;
};

type ProgressionPeriod = {
  assessment_id: number;
  label: string | null;
  period_year: number | null;
  period_label: string | null;
  conducted_on: string | null;
  is_baseline: boolean;
  sections: ProgressionSection[];
  overall_avg_score: number | null;
  overall_maturity_label: string | null;
};

type QuestionSeries = {
  question_id: number;
  question_code: string;
  question_text: string;
  section: string;
  points: { conducted_on: string | null; score: number | null }[];
  delta_vs_previous: number | null;
  delta_vs_baseline: number | null;
};

type Progression = {
  periods: ProgressionPeriod[];
  question_series: QuestionSeries[];
};

const SECTIONS = ["Governance", "Strategy", "Risk Management", "Metrics & Targets"] as const;

function periodTitle(p: ProgressionPeriod): string {
  const tag = p.period_label ? ` ${p.period_label}` : "";
  return `${p.label ?? p.period_year ?? p.conducted_on}${tag}`;
}

function maturityBadgeVariant(label: string | null): string {
  if (label === "Cultural") return "bg-green-100 text-green-800 border-green-200";
  if (label === "Maturing") return "bg-amber-100 text-amber-800 border-amber-200";
  if (label === "Compliance") return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-gray-50 text-gray-400 border-gray-200";
}

function delta(text: number | null): { label: string; className: string } {
  if (text === null) return { label: "—", className: "text-gray-400" };
  if (text > 0) return { label: `▲ +${text}`, className: "text-green-700" };
  if (text < 0) return { label: `▼ ${text}`, className: "text-red-600" };
  return { label: "– 0", className: "text-gray-400" };
}

function sectionDelta(curr: number | null, prev: number | null): { label: string; className: string } {
  if (curr == null || prev == null) return { label: "", className: "" };
  const d = Number((curr - prev).toFixed(2));
  if (d > 0) return { label: `▲ +${d}`, className: "text-green-700" };
  if (d < 0) return { label: `▼ ${d}`, className: "text-red-600" };
  return { label: "±0", className: "text-gray-400" };
}

export default function ClientSrsProgression({ clientDbId, baseUrl }: { clientDbId: number; baseUrl?: string }) {
  const base = baseUrl || "/api/backend";
  const [data, setData] = useState<Progression | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${base}/clients/${clientDbId}/srs-readiness/progression`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
        const json = (await res.json()) as Progression;
        if (!cancelled) setData(json);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load progression");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [base, clientDbId]);

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading progression…</div>;
  if (error) return <div className="py-8 text-center text-sm text-red-600">{error}</div>;

  const periods = data?.periods ?? [];
  if (periods.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No finalised survey rounds yet. Start an assessment, score it with the client, then
        <span className="font-medium"> Finalise &amp; timestamp</span> it — progression appears from the first
        finalised round.
      </div>
    );
  }

  const prevPeriod = periods.length >= 2 ? periods[periods.length - 2] : null;
  const prevBySection = new Map((prevPeriod?.sections ?? []).map((s) => [s.section, s.avg_score]));

  const bySection = new Map<string, QuestionSeries[]>();
  for (const qs of data?.question_series ?? []) {
    const list = bySection.get(qs.section) ?? [];
    list.push(qs);
    bySection.set(qs.section, list);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Section maturity by round</CardTitle>
          <CardDescription>
            Section averages (0–3) at each finalised survey round — {periods.length} to date.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Round</th>
                <th className="py-2 pr-4">Date</th>
                {SECTIONS.map((s) => (
                  <th key={s} className="py-2 pr-4">{s}</th>
                ))}
                <th className="py-2 pr-4">Overall</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const secMap = new Map(p.sections.map((s) => [s.section, s]));
                return (
                  <tr key={p.assessment_id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">
                      {periodTitle(p)}
                      {p.is_baseline && <Badge variant="outline" className="ml-1.5 text-[10px]">baseline</Badge>}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{p.conducted_on}</td>
                    {SECTIONS.map((s) => {
                      const sec = secMap.get(s);
                      return (
                        <td key={s} className="py-2 pr-4">
                          {sec?.avg_score != null ? (
                            <span className="inline-flex items-center gap-1.5">
                              {sec.avg_score.toFixed(2)}
                              <Badge variant="outline" className={maturityBadgeVariant(sec.maturity_label)}>
                                {sec.maturity_label}
                              </Badge>
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-4 font-semibold">
                      {p.overall_avg_score != null ? p.overall_avg_score.toFixed(2) : "—"}
                    </td>
                  </tr>
                );
              })}
              {prevPeriod && (
                <tr className="border-t-2 text-xs">
                  <td className="py-2 pr-4 font-medium text-muted-foreground" colSpan={2}>
                    Change, latest vs previous round
                  </td>
                  {SECTIONS.map((s) => {
                    const latest = periods[periods.length - 1].sections.find((x) => x.section === s)?.avg_score ?? null;
                    const d = sectionDelta(latest, prevBySection.get(s) ?? null);
                    return (
                      <td key={s} className={`py-2 pr-4 font-medium ${d.className}`}>{d.label}</td>
                    );
                  })}
                  <td className="py-2 pr-4" />
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {periods.length >= 2 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Question movement</CardTitle>
            <CardDescription>Score change at the latest round vs the previous round, and vs baseline.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {SECTIONS.map((s) => {
              const items = bySection.get(s) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={s}>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s}</div>
                  <div className="space-y-1">
                    {items.map((qs) => {
                      const prev = delta(qs.delta_vs_previous);
                      const bl = delta(qs.delta_vs_baseline);
                      return (
                        <div
                          key={qs.question_id}
                          className="flex items-start justify-between gap-3 rounded border px-3 py-1.5"
                        >
                          <span className="text-sm">{qs.question_text}</span>
                          <span className="flex shrink-0 gap-3 text-xs font-medium">
                            <span className={prev.className} title="vs previous round">{prev.label}</span>
                            <span className={bl.className} title="vs baseline">{bl.label}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
