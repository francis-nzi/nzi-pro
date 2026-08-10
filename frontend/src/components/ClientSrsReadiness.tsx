"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Save, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type SrsQuestion = {
  question_id: number;
  question_code: string;
  section: string;
  theme?: string | null;
  question_text: string;
  evidence_examples?: string | null;
  sort_order: number;
  score: number | null;
  score_label: string | null;
  evidence_notes: string | null;
  priority: string | null;
  owner: string | null;
  target_date: string | null;
  status: string;
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
  suggested_action?: string | null;
};

type SrsSummary = {
  sections: SrsSummarySection[];
  overall_avg_score: number | null;
  overall_maturity_label: string | null;
  overall_maturity_description: string | null;
};

type ResponseEdit = {
  score: number | null;
  evidence_notes: string;
  priority: string;
  owner: string;
  target_date: string;
  status: string;
};

const SCORE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Compliance" },
  { value: 2, label: "Maturing" },
  { value: 3, label: "Cultural" },
];

const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" },
];

const PRIORITY_OPTIONS = ["High", "Medium", "Low"];

const SCOPE_FILTERS = [
  { value: "all", label: "All questions" },
  { value: "unscored", label: "Not scored" },
  { value: "scored", label: "Scored" },
] as const;

type ScopeFilter = (typeof SCOPE_FILTERS)[number]["value"];

function maturityBadgeVariant(label: string | null): string {
  if (label === "Cultural") return "bg-green-100 text-green-800 border-green-200";
  if (label === "Maturing") return "bg-amber-100 text-amber-800 border-amber-200";
  if (label === "Compliance") return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-gray-50 text-gray-400 border-gray-200";
}

function editsEqual(a: ResponseEdit, b: ResponseEdit): boolean {
  return (
    a.score === b.score &&
    a.evidence_notes === b.evidence_notes &&
    a.priority === b.priority &&
    a.owner === b.owner &&
    a.target_date === b.target_date &&
    a.status === b.status
  );
}

function apiBaseUrl() {
  return "/api/backend";
}

export default function ClientSrsReadiness({ clientDbId, baseUrl }: { clientDbId: number; baseUrl?: string }) {
  const base = baseUrl || apiBaseUrl();
  const [sections, setSections] = useState<SrsSection[]>([]);
  const [summary, setSummary] = useState<SrsSummary | null>(null);
  const [edits, setEdits] = useState<Record<number, ResponseEdit>>({});
  const [savedEdits, setSavedEdits] = useState<Record<number, ResponseEdit>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedFlashId, setSavedFlashId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rowError, setRowError] = useState<Record<number, string>>({});

  const [searchQuery, setSearchQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientDbId]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${base}/clients/${clientDbId}/srs-readiness`, { credentials: "include" });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to load SRS Readiness (${res.status})`);
      }
      const payload = (await res.json()) as { sections?: SrsSection[]; summary?: SrsSummary };
      const loadedSections = Array.isArray(payload.sections) ? payload.sections : [];
      setSections(loadedSections);
      setSummary(payload.summary ?? null);
      const nextEdits: Record<number, ResponseEdit> = {};
      for (const section of loadedSections) {
        for (const q of section.questions) {
          nextEdits[q.question_id] = {
            score: q.score,
            evidence_notes: q.evidence_notes || "",
            priority: q.priority || "",
            owner: q.owner || "",
            target_date: q.target_date || "",
            status: q.status || "not_started",
          };
        }
      }
      setEdits(nextEdits);
      setSavedEdits(nextEdits);
      // Collapse every section by default except the first, so the tab opens
      // as a manageable list rather than 24 open cards.
      setCollapsed(
        Object.fromEntries(loadedSections.map((s, i) => [s.section, i !== 0]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SRS Readiness");
    } finally {
      setLoading(false);
    }
  }

  function updateEdit(questionId: number, patch: Partial<ResponseEdit>) {
    setEdits((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], ...patch },
    }));
  }

  const summaryBySection = useMemo(() => {
    const map: Record<string, SrsSummarySection> = {};
    for (const s of summary?.sections || []) map[s.section] = s;
    return map;
  }, [summary]);

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sections.map((section) => ({
      ...section,
      questions: section.questions.filter((question) => {
        if (scopeFilter === "unscored" && question.score !== null) return false;
        if (scopeFilter === "scored" && question.score === null) return false;
        if (!q) return true;
        const target = `${question.question_text} ${question.theme || ""}`.toLowerCase();
        return target.includes(q);
      }),
    }));
  }, [sections, searchQuery, scopeFilter]);

  const isFiltering = searchQuery.trim().length > 0 || scopeFilter !== "all";

  function toggleSection(section: string) {
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  async function saveQuestion(questionId: number) {
    const edit = edits[questionId];
    if (!edit) return;
    setSavingId(questionId);
    setRowError((prev) => ({ ...prev, [questionId]: "" }));
    try {
      const res = await fetch(`${base}/clients/${clientDbId}/srs-readiness`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          items: [
            {
              question_id: questionId,
              score: edit.score,
              evidence_notes: edit.evidence_notes.trim() || null,
              priority: edit.priority.trim() || null,
              owner: edit.owner.trim() || null,
              target_date: edit.target_date.trim() || null,
              status: edit.status,
            },
          ],
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to save (${res.status})`);
      }
      const payload = (await res.json()) as { sections?: SrsSection[]; summary?: SrsSummary };
      if (Array.isArray(payload.sections)) setSections(payload.sections);
      if (payload.summary) setSummary(payload.summary);
      setSavedEdits((prev) => ({ ...prev, [questionId]: edit }));
      setSavedFlashId(questionId);
      window.setTimeout(() => setSavedFlashId((id) => (id === questionId ? null : id)), 1800);
    } catch (err) {
      setRowError((prev) => ({ ...prev, [questionId]: err instanceof Error ? err.message : "Failed to save" }));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading SRS Readiness...</div>;
  }

  if (error) {
    return <div className="py-8 text-center text-sm text-red-600">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: "#F26624" }}>UK SRS Readiness</h2>
          <p className="text-sm text-muted-foreground">
            Score each active question 1 (Compliance) to 3 (Cultural) with the client, ideally in a workshop.
            Results drive the four readiness gauges shown in the client portal.
          </p>
        </div>
        {summary?.overall_maturity_label && (
          <Badge variant="outline" className={maturityBadgeVariant(summary.overall_maturity_label)}>
            Overall: {summary.overall_maturity_label} ({summary.overall_avg_score?.toFixed(2)})
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search questions or themes..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          {SCOPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setScopeFilter(f.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                scopeFilter === f.value
                  ? "bg-[#1c5026] text-white border-[#1c5026]"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filteredSections.map((section) => {
        const sectionSummary = summaryBySection[section.section];
        const isCollapsed = !isFiltering && !!collapsed[section.section];
        return (
          <Card key={section.section}>
            <CardHeader
              className="cursor-pointer pb-3 select-none"
              onClick={() => toggleSection(section.section)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  <CardTitle>{section.section}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  {sectionSummary?.maturity_label ? (
                    <Badge variant="outline" className={maturityBadgeVariant(sectionSummary.maturity_label)}>
                      {sectionSummary.maturity_label} · avg {sectionSummary.avg_score?.toFixed(2)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-gray-50 text-gray-400 border-gray-200">Not scored yet</Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {sectionSummary?.questions_scored ?? 0} / {sectionSummary?.active_questions ?? section.questions.length} scored
                  </span>
                </div>
              </div>
              {!isCollapsed && section.suggested_action && (
                <CardDescription>{section.suggested_action}</CardDescription>
              )}
            </CardHeader>
            {!isCollapsed && (
              <CardContent className="space-y-5">
                {section.questions.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No questions match the current filters.</div>
                ) : (
                  section.questions.map((q) => {
                    const edit = edits[q.question_id];
                    if (!edit) return null;
                    const baseline = savedEdits[q.question_id];
                    const dirty = !baseline || !editsEqual(edit, baseline);
                    const isSaving = savingId === q.question_id;
                    const justSaved = savedFlashId === q.question_id;
                    return (
                      <div key={q.question_id} className="rounded-lg border p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              {q.theme && <Badge variant="outline" className="text-xs">{q.theme}</Badge>}
                            </div>
                            <p className="text-sm font-medium mt-1">{q.question_text}</p>
                            {q.evidence_examples && (
                              <p className="text-xs text-muted-foreground mt-1">Evidence: {q.evidence_examples}</p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant={dirty ? "default" : "outline"}
                            disabled={!dirty || isSaving}
                            onClick={() => void saveQuestion(q.question_id)}
                            className="shrink-0"
                          >
                            {isSaving ? (
                              "Saving..."
                            ) : justSaved ? (
                              <><Check className="mr-1.5 h-3.5 w-3.5" />Saved</>
                            ) : (
                              <><Save className="mr-1.5 h-3.5 w-3.5" />Save</>
                            )}
                          </Button>
                        </div>
                        {rowError[q.question_id] && (
                          <div className="text-xs text-red-600">{rowError[q.question_id]}</div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          {SCORE_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => updateEdit(q.question_id, { score: edit.score === opt.value ? null : opt.value })}
                              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                edit.score === opt.value
                                  ? "bg-[#1c5026] text-white border-[#1c5026]"
                                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                              }`}
                            >
                              {opt.value}. {opt.label}
                            </button>
                          ))}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Evidence notes</Label>
                            <Textarea
                              rows={2}
                              value={edit.evidence_notes}
                              onChange={(e) => updateEdit(q.question_id, { evidence_notes: e.target.value })}
                              placeholder="Document, process, owner, or example that supports the score."
                              className="text-sm"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3 content-start">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Priority</Label>
                              <Select
                                value={edit.priority || "__none__"}
                                onValueChange={(v) => updateEdit(q.question_id, { priority: v === "__none__" ? "" : v })}
                              >
                                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">—</SelectItem>
                                  {PRIORITY_OPTIONS.map((p) => (
                                    <SelectItem key={p} value={p}>{p}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Status</Label>
                              <Select value={edit.status} onValueChange={(v) => updateEdit(q.question_id, { status: v })}>
                                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {STATUS_OPTIONS.map((s) => (
                                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Owner</Label>
                              <Input
                                className="h-9 text-sm"
                                value={edit.owner}
                                onChange={(e) => updateEdit(q.question_id, { owner: e.target.value })}
                                placeholder="e.g. Leadership"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Target date</Label>
                              <Input
                                type="date"
                                className="h-9 text-sm"
                                value={edit.target_date}
                                onChange={(e) => updateEdit(q.question_id, { target_date: e.target.value })}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
