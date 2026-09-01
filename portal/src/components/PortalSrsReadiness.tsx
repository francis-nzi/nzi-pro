"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";
import GaugeChart from "@/components/GaugeChart";

type SrsQuestion = {
  question_id: number;
  question_code: string;
  theme?: string | null;
  question_text: string;
  score: number | null;
  score_label: string | null;
};

type SrsSection = {
  section: string;
  questions: SrsQuestion[];
  suggested_action?: string | null;
};

type SrsSummarySection = {
  section: string;
  active_questions: number;
  questions_scored: number;
  avg_score: number | null;
  maturity_label: string | null;
  maturity_description: string | null;
};

type SrsSummary = {
  sections: SrsSummarySection[];
  overall_avg_score: number | null;
  overall_maturity_label: string | null;
  overall_maturity_description: string | null;
};

type LastAssessment = {
  label: string | null;
  conducted_on: string | null;
  period_year: number | null;
  period_label: string | null;
};

type ProgressionPeriod = {
  assessment_id: number;
  label: string | null;
  period_year: number | null;
  period_label: string | null;
  conducted_on: string | null;
  is_baseline: boolean;
  sections: { section: string; avg_score: number | null }[];
  overall_avg_score: number | null;
};

type Progression = { periods: ProgressionPeriod[] };

const SECTION_ORDER = ["Governance", "Strategy", "Risk Management", "Metrics & Targets"] as const;
const SERIES_COLORS: Record<string, string> = {
  Overall: "#1c5026",
  Governance: "#2563eb",
  Strategy: "#7c3aed",
  "Risk Management": "#dc2626",
  "Metrics & Targets": "#d97706",
};

function periodTick(p: ProgressionPeriod): string {
  if (p.period_label) return `${p.period_label} ${p.period_year ?? ""}`.trim();
  return String(p.period_year ?? p.conducted_on ?? p.label ?? "");
}

function scoreBadgeClass(label: string | null): string {
  if (label === "Cultural") return "bg-green-100 text-green-800";
  if (label === "Maturing") return "bg-amber-100 text-amber-800";
  if (label === "Compliance") return "bg-slate-100 text-slate-700";
  return "bg-gray-100 text-gray-400";
}

export default function PortalSrsReadiness() {
  const [sections, setSections] = useState<SrsSection[]>([]);
  const [summary, setSummary] = useState<SrsSummary | null>(null);
  const [lastAssessment, setLastAssessment] = useState<LastAssessment | null>(null);
  const [progression, setProgression] = useState<Progression | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const [mainRes, progRes] = await Promise.all([
        apiFetch("/portal/srs-readiness"),
        apiFetch("/portal/srs-readiness/progression"),
      ]);
      if (!mainRes.ok) throw new Error("Failed to load SRS Readiness");
      const data = (await mainRes.json()) as {
        sections?: SrsSection[];
        summary?: SrsSummary;
        last_assessment?: LastAssessment | null;
      };
      setSections(Array.isArray(data.sections) ? data.sections : []);
      setSummary(data.summary ?? null);
      setLastAssessment(data.last_assessment ?? null);
      setProgression(progRes.ok ? ((await progRes.json()) as Progression) : null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const periods = useMemo(() => progression?.periods ?? [], [progression]);

  const chartData = useMemo(
    () =>
      periods.map((p) => {
        const row: Record<string, number | string | null> = { name: periodTick(p), Overall: p.overall_avg_score };
        for (const s of p.sections) row[s.section] = s.avg_score;
        return row;
      }),
    [periods],
  );

  const baselineDeltaBySection = useMemo(() => {
    const map = new Map<string, string>();
    if (periods.length < 2) return map;
    const first = periods[0];
    const latest = periods[periods.length - 1];
    const firstBy = new Map(first.sections.map((s) => [s.section, s.avg_score]));
    for (const s of latest.sections) {
      const b = firstBy.get(s.section);
      if (b == null || s.avg_score == null) continue;
      const d = Number((s.avg_score - b).toFixed(2));
      map.set(s.section, d > 0 ? `▲ +${d} vs baseline` : d < 0 ? `▼ ${d} vs baseline` : "no change vs baseline");
    }
    return map;
  }, [periods]);

  if (loading) return <SkeletonLoader rows={4} />;
  if (error) return <ErrorPanel title="Couldn't load SRS Readiness" description="Please try again." onRetry={() => void load()} />;

  const summaryBySection = new Map((summary?.sections || []).map((s) => [s.section, s]));
  const hasAnyQuestions = sections.some((s) => s.questions.length > 0);

  if (!hasAnyQuestions) {
    return (
      <EmptyStatePanel
        title="SRS Readiness not set up yet"
        description="Your NZI consultant will complete this assessment with you."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>UK SRS Readiness</CardTitle>
          {lastAssessment?.conducted_on && (
            <p className="text-sm text-gray-500">
              Assessed {lastAssessment.conducted_on}
              {lastAssessment.label ? ` · ${lastAssessment.label}` : ""}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {sections.map((section) => {
              const s = summaryBySection.get(section.section);
              return (
                <GaugeChart
                  key={section.section}
                  value={s?.avg_score ?? null}
                  label={section.section}
                  maturityLabel={s?.maturity_label}
                  maturityDescription={s?.maturity_description}
                  deltaLabel={baselineDeltaBySection.get(section.section) ?? null}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {periods.length >= 2 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Progression</CardTitle>
            <p className="text-sm text-gray-500">Your readiness at each review, on a 0–3 scale.</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 3]} ticks={[0, 1, 1.5, 2, 2.4, 3]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <ReferenceLine y={1.5} stroke="#fbbf24" strokeDasharray="4 4" />
                <ReferenceLine y={2.4} stroke="#22c55e" strokeDasharray="4 4" />
                {["Overall", ...SECTION_ORDER].map((k) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    stroke={SERIES_COLORS[k]}
                    strokeWidth={k === "Overall" ? 3 : 1.75}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {sections.map((section) => (
        <Card key={section.section}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{section.section}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {section.questions.length === 0 ? (
              <div className="text-sm text-gray-400">No questions in this section yet.</div>
            ) : (
              section.questions.map((q) => (
                <div key={q.question_id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 p-3">
                  <div>
                    {q.theme && <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{q.theme}</div>}
                    <div className="text-sm text-gray-800">{q.question_text}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${scoreBadgeClass(q.score_label)}`}>
                    {q.score_label || "Not scored"}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
