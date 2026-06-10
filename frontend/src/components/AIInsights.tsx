"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface AIInsightsProps {
  clientId: number;
  baseUrl: string;
}

type InsightItem = {
  title?: string;
  detail?: string;
  metric?: string;
  citation?: string;
  source?: string;
};

type ActionItem = {
  title?: string;
  owner?: string;
  effort?: string;
  expected_impact?: string;
  timeframe?: string;
  rationale?: string;
  citation?: string;
};

type Roadmap = {
  short_term?: string[];
  medium_term?: string[];
  long_term?: string[];
};

type StructuredInsights = {
  summary?: string;
  confidence?: string;
  top_drivers?: InsightItem[];
  risks?: InsightItem[];
  recommended_actions?: ActionItem[];
  regulatory_context?: InsightItem[];
  reduction_roadmap?: Roadmap;
  data_gaps?: string[];
};

type InsightResponse = {
  insights?: string;
  structured?: StructuredInsights;
  citations?: Array<{ label?: string; value?: string; source?: string }>;
};

type SavedInsight = {
  saved_client_insight_id: number;
  client_db_id?: number | null;
  user_id?: string | null;
  org_id?: string | null;
  provider?: string | null;
  insights?: string | null;
  structured?: StructuredInsights | null;
  citations?: Array<{ label?: string; value?: string; source?: string }>;
  preview?: string | null;
  created_at?: string | null;
};

type SavedInsightDraft = {
  saved_client_insight_id: number;
  provider: string;
  insights: string;
  structured: StructuredInsights | null;
  citations: Array<{ label?: string; value?: string; source?: string }>;
};

type AiPromptProfile = {
  profile_id: number;
  profile_name: string;
  industry_context?: string | null;
  company_context?: string | null;
  tone?: string | null;
  audience_notes?: string | null;
  preferred_terms_json?: Record<string, unknown> | unknown[] | null;
  forbidden_terms_json?: Record<string, unknown> | unknown[] | null;
  narrative_notes?: string | null;
  section_notes_json?: Record<string, unknown> | null;
  status?: string | null;
  version?: number | null;
  updated_at?: string | null;
};

type PromptRun = {
  run_id: number;
  report_family_key?: string | null;
  section_key?: string | null;
  provider?: string | null;
  model_name?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  resolved_system_prompt?: string | null;
  resolved_user_prompt?: string | null;
  status?: string | null;
  created_at?: string | null;
  prompt_template_id?: number | null;
  client_prompt_profile_id?: number | null;
  job_prompt_override_id?: number | null;
};

type InsightState = {
  insights: string | null;
  structured: StructuredInsights | null;
  citations: Array<{ label?: string; value?: string; source?: string }>;
  loading: boolean;
  error: string | null;
};

type SetInsightState = (value: InsightState | ((prev: InsightState) => InsightState)) => void;

const EMPTY_STATE: InsightState = {
  insights: null,
  structured: null,
  citations: [],
  loading: false,
  error: null,
};

function providerLabel(provider?: string | null): string {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "anthropic") return "Anthropic";
  if (value === "openai") return "OpenAI";
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Insight";
}

function normalizeProvider(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function previewText(insights?: string | null, structured?: StructuredInsights | null): string {
  const text = String(structured?.summary || insights || "").trim();
  if (!text) return "Saved insight";
  if (text.length <= 240) return text;
  return `${text.slice(0, 237).trimEnd()}...`;
}

function formatCount(value?: number | null): string {
  if (value === null || value === undefined) return "n/a";
  return String(value);
}

function InsightPanel({
  title,
  subtitle,
  state,
  onGenerate,
  onSave,
  canSave,
  saving,
}: {
  title: string;
  subtitle: string;
  state: InsightState;
  onGenerate: () => void;
  onSave: () => void;
  canSave: boolean;
  saving: boolean;
}) {
  const structured = state.structured;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          </div>
          {structured?.confidence ? <Badge variant="secondary">Confidence: {structured.confidence}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {structured?.summary ? (
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</div>
              <p className="text-sm">{structured.summary}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Generate insights to review client, industry, country, and reduction options.</p>
          )}

          {structured?.regulatory_context && structured.regulatory_context.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm font-semibold">Regulatory Context</div>
              {structured.regulatory_context.map((item, idx) => (
                <div key={idx} className="rounded-md border p-3">
                  <div className="text-sm font-medium">{item.title || "Regulation"}</div>
                  {item.detail ? <div className="mt-1 text-sm text-muted-foreground">{item.detail}</div> : null}
                  {item.source ? <div className="mt-2 text-xs text-muted-foreground">Source: {item.source}</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          {structured?.top_drivers && structured.top_drivers.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm font-semibold">Top Drivers</div>
              {structured.top_drivers.map((item, idx) => (
                <div key={idx} className="rounded-md border p-3">
                  <div className="text-sm font-medium">{item.title || "Driver"}</div>
                  {item.detail ? <div className="mt-1 text-sm text-muted-foreground">{item.detail}</div> : null}
                  {item.metric ? <div className="mt-2 text-xs">Metric: {item.metric}</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          {structured?.reduction_roadmap ? (
            <div className="space-y-2">
              <div className="text-sm font-semibold">Reduction Roadmap</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Short Term</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {(structured.reduction_roadmap.short_term || []).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Medium Term</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {(structured.reduction_roadmap.medium_term || []).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Long Term</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {(structured.reduction_roadmap.long_term || []).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

          {state.error ? <p className="text-sm text-red-600">Error: {state.error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={onGenerate} disabled={state.loading} variant="outline">
              {state.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {state.insights ? "Refresh insights" : "Generate insights"}
            </Button>
            <Button onClick={onSave} disabled={!canSave || saving} variant="secondary">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save insight
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AIInsights({ clientId, baseUrl }: AIInsightsProps) {
  const [anthropic, setAnthropic] = useState<InsightState>(EMPTY_STATE);
  const [alternative, setAlternative] = useState<InsightState>(EMPTY_STATE);
  const [savedInsights, setSavedInsights] = useState<SavedInsight[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState("");
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [editingInsight, setEditingInsight] = useState<SavedInsightDraft | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);
  const [promptProfile, setPromptProfile] = useState<AiPromptProfile | null>(null);
  const [promptRuns, setPromptRuns] = useState<PromptRun[]>([]);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState("");

  async function loadSavedInsights() {
    setSavedLoading(true);
    setSavedError("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/saved-insights`, {
        credentials: "include",
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Unable to load saved insights (${res.status}).`);
      }
      const json = (await res.json()) as { saved_insights?: SavedInsight[] };
      setSavedInsights(Array.isArray(json.saved_insights) ? json.saved_insights : []);
    } catch (e) {
      setSavedError((e as Error).message);
      setSavedInsights([]);
    } finally {
      setSavedLoading(false);
    }
  }

  async function loadPromptContext() {
    setPromptLoading(true);
    setPromptError("");
    try {
      const [profileRes, runsRes] = await Promise.all([
        fetch(`${baseUrl}/clients/${clientId}/ai-prompt-profile`, { credentials: "include" }),
        fetch(`${baseUrl}/ai-prompts/runs?client_db_id=${clientId}&section_key=executive_summary&limit=5`, {
          credentials: "include",
        }),
      ]);

      if (profileRes.ok) {
        const profileJson = (await profileRes.json()) as { profile?: AiPromptProfile | null };
        setPromptProfile(profileJson.profile || null);
      } else {
        setPromptProfile(null);
      }

      if (runsRes.ok) {
        const runsJson = (await runsRes.json()) as { runs?: PromptRun[] };
        setPromptRuns(Array.isArray(runsJson.runs) ? runsJson.runs : []);
      } else {
        setPromptRuns([]);
      }
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Unable to load prompt context");
      setPromptProfile(null);
      setPromptRuns([]);
    } finally {
      setPromptLoading(false);
    }
  }

  async function fetchFor(endpoint: string, setState: SetInsightState) {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const res = await fetch(`${baseUrl}/clients/${clientId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        let detail = "";
        try {
          const payload = (await res.json()) as { detail?: string };
          detail = payload?.detail || "";
        } catch {
          detail = await res.text().catch(() => "");
        }
        throw new Error(detail || `Unable to generate insights (${res.status}).`);
      }
      const json = (await res.json()) as InsightResponse;
      setState({
        insights: json.insights || null,
        structured: json.structured || null,
        citations: Array.isArray(json.citations) ? json.citations : [],
        loading: false,
        error: null,
      });
    } catch (e) {
      setState((prev) => ({ ...prev, loading: false, error: (e as Error).message }));
    }
  }

  async function saveInsight(provider: string, state: InsightState) {
    if (!state.insights) return;
    setSavingProvider(provider);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/saved-insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider,
          insights: state.insights,
          structured: state.structured,
          citations: state.citations,
        }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const payload = (await res.json()) as { detail?: string };
          detail = payload?.detail || "";
        } catch {
          detail = await res.text().catch(() => "");
        }
        throw new Error(detail || `Unable to save insight (${res.status}).`);
      }
      await loadSavedInsights();
    } catch (e) {
      const message = (e as Error).message;
      if (provider === "anthropic") {
        setAnthropic((prev) => ({ ...prev, error: message }));
      } else {
        setAlternative((prev) => ({ ...prev, error: message }));
      }
    } finally {
      setSavingProvider(null);
    }
  }

  function startEditing(item: SavedInsight) {
    setEditingInsight({
      saved_client_insight_id: item.saved_client_insight_id,
      provider: String(item.provider || "anthropic"),
      insights: String(item.insights || item.structured?.summary || item.preview || "").trim(),
      structured: item.structured || null,
      citations: Array.isArray(item.citations) ? item.citations : [],
    });
  }

  async function updateSavedInsight() {
    if (!editingInsight) return;
    setEditingSaving(true);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/saved-insights/${editingInsight.saved_client_insight_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider: editingInsight.provider,
          insights: editingInsight.insights,
          structured: editingInsight.structured,
          citations: editingInsight.citations,
        }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const payload = (await res.json()) as { detail?: string };
          detail = payload?.detail || "";
        } catch {
          detail = await res.text().catch(() => "");
        }
        throw new Error(detail || `Unable to update insight (${res.status}).`);
      }
      setEditingInsight(null);
      await loadSavedInsights();
    } catch (e) {
      setSavedError((e as Error).message);
    } finally {
      setEditingSaving(false);
    }
  }

  async function deleteSavedInsight(item: SavedInsight) {
    const confirmed = window.confirm("Delete this saved insight?");
    if (!confirmed) return;
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/saved-insights/${item.saved_client_insight_id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        let detail = "";
        try {
          const payload = (await res.json()) as { detail?: string };
          detail = payload?.detail || "";
        } catch {
          detail = await res.text().catch(() => "");
        }
        throw new Error(detail || `Unable to delete insight (${res.status}).`);
      }
      if (editingInsight?.saved_client_insight_id === item.saved_client_insight_id) {
        setEditingInsight(null);
      }
      await loadSavedInsights();
    } catch (e) {
      setSavedError((e as Error).message);
    }
  }

  useEffect(() => {
    void loadSavedInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, baseUrl]);

  useEffect(() => {
    void loadPromptContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, baseUrl]);

  const latestSaved = useMemo(() => {
    const map = new Map<string, SavedInsight>();
    for (const item of savedInsights) {
      const key = String(item.provider || "").trim().toLowerCase();
      if (key && !map.has(key)) {
        map.set(key, item);
      }
    }
    return map;
  }, [savedInsights]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Prompt Context</CardTitle>
              <div className="text-xs text-muted-foreground">
                This client uses the governed AI prompt stack behind the insight and report generators.
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/ai-prompts?client=${clientId}`}>Open AI Prompts</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {promptLoading ? (
            <p className="text-sm text-muted-foreground">Loading prompt context...</p>
          ) : promptError ? (
            <p className="text-sm text-red-600">Error: {promptError}</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border bg-muted/20 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active profile</div>
                {promptProfile ? (
                  <div className="mt-2 space-y-2">
                    <div className="text-sm font-semibold">{promptProfile.profile_name}</div>
                    <div className="text-xs text-muted-foreground">
                      Status: {promptProfile.status || "unknown"} · Version {promptProfile.version || "n/a"}
                    </div>
                    {promptProfile.tone ? <div className="text-sm">Tone: {promptProfile.tone}</div> : null}
                    {promptProfile.industry_context ? (
                      <div className="text-sm">Industry: {promptProfile.industry_context}</div>
                    ) : null}
                    {promptProfile.audience_notes ? (
                      <div className="text-sm text-muted-foreground">Audience: {promptProfile.audience_notes}</div>
                    ) : null}
                    {promptProfile.narrative_notes ? (
                      <div className="text-sm text-muted-foreground">Notes: {promptProfile.narrative_notes}</div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      Updated {promptProfile.updated_at ? new Date(promptProfile.updated_at).toLocaleString() : "unknown"}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No saved prompt profile found for this client yet.</p>
                )}
              </div>

              <div className="rounded-md border bg-muted/20 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent runs</div>
                {promptRuns.length > 0 ? (
                  <div className="mt-2 space-y-3">
                    {promptRuns.slice(0, 3).map((run) => (
                      <div key={run.run_id} className="rounded-md border bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium">
                            {run.report_family_key || "prompt"} · {run.section_key || "section"}
                          </div>
                          <Badge variant="secondary">{run.provider || "unknown"}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {run.model_name || "model n/a"} · {run.status || "status n/a"} ·{" "}
                          {run.created_at ? new Date(run.created_at).toLocaleString() : "time n/a"}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Tokens: in {formatCount(run.input_tokens)} / out {formatCount(run.output_tokens)} / total{" "}
                          {formatCount(run.total_tokens)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No prompt runs found yet for this client.</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <InsightPanel
          title="Insights"
          subtitle="Provider: Anthropic"
          state={anthropic}
          onGenerate={() => void fetchFor("insights", setAnthropic)}
          onSave={() => void saveInsight("anthropic", anthropic)}
          canSave={Boolean(anthropic.insights)}
          saving={savingProvider === "anthropic"}
        />
        <InsightPanel
          title="Insights"
          subtitle="Provider: OpenAI (with rule-based fallback)"
          state={alternative}
          onGenerate={() => void fetchFor("insights-openai", setAlternative)}
          onSave={() => void saveInsight("openai", alternative)}
          canSave={Boolean(alternative.insights)}
          saving={savingProvider === "openai"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Saved Insights</CardTitle>
        </CardHeader>
        <CardContent>
          {savedLoading ? (
            <p className="text-sm text-muted-foreground">Loading saved insights...</p>
          ) : savedError ? (
            <p className="text-sm text-red-600">Error: {savedError}</p>
          ) : savedInsights.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved insights yet. Generate one and save it to keep it here.</p>
          ) : (
            <div className="space-y-3">
              {savedInsights.map((item) => (
                <div key={item.saved_client_insight_id} className="rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{providerLabel(item.provider)}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.created_at ? new Date(item.created_at).toLocaleString() : "Timestamp unavailable"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {item.citations?.length ? `${item.citations.length} citation${item.citations.length === 1 ? "" : "s"}` : "Saved"}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => startEditing(item)}>
                        Edit
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => void deleteSavedInsight(item)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                    {item.preview || previewText(item.insights, item.structured)}
                  </p>
                  {item.structured?.summary ? (
                    <p className="mt-2 text-xs text-muted-foreground">Summary: {item.structured.summary}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {latestSaved.size > 0 ? (
            <div className="mt-4 text-xs text-muted-foreground">
              Latest saved by provider:{" "}
              {Array.from(latestSaved.entries())
                .map(([provider, item]) => `${providerLabel(provider)} ${item.created_at ? new Date(item.created_at).toLocaleDateString() : ""}`.trim())
                .join(" | ")}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingInsight)} onOpenChange={(open) => !open && setEditingInsight(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Saved Insight</DialogTitle>
            <DialogDescription>Update the stored insight text, then save the revised version.</DialogDescription>
          </DialogHeader>
          {editingInsight ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Provider</label>
                <Input
                  value={editingInsight.provider}
                  onChange={(e) =>
                    setEditingInsight((prev) => (prev ? { ...prev, provider: normalizeProvider(e.target.value) } : prev))
                  }
                  placeholder="anthropic"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Insight text</label>
                <Textarea
                  rows={14}
                  value={editingInsight.insights}
                  onChange={(e) =>
                    setEditingInsight((prev) => (prev ? { ...prev, insights: e.target.value } : prev))
                  }
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingInsight(null)} disabled={editingSaving}>
              Cancel
            </Button>
            <Button onClick={() => void updateSavedInsight()} disabled={!editingInsight?.insights?.trim() || editingSaving}>
              {editingSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
