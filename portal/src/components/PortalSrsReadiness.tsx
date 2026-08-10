"use client";

import { useEffect, useState } from "react";
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

function scoreBadgeClass(label: string | null): string {
  if (label === "Cultural") return "bg-green-100 text-green-800";
  if (label === "Maturing") return "bg-amber-100 text-amber-800";
  if (label === "Compliance") return "bg-slate-100 text-slate-700";
  return "bg-gray-100 text-gray-400";
}

export default function PortalSrsReadiness() {
  const [sections, setSections] = useState<SrsSection[]>([]);
  const [summary, setSummary] = useState<SrsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const res = await apiFetch("/portal/srs-readiness");
      if (!res.ok) throw new Error("Failed to load SRS Readiness");
      const data = (await res.json()) as { sections?: SrsSection[]; summary?: SrsSummary };
      setSections(Array.isArray(data.sections) ? data.sections : []);
      setSummary(data.summary ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

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
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

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
