"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

function InsightPanel({
  title,
  subtitle,
  state,
  onGenerate,
}: {
  title: string;
  subtitle: string;
  state: InsightState;
  onGenerate: () => void;
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
          <div>
            <Button onClick={onGenerate} disabled={state.loading} variant="outline">
              {state.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {state.insights ? "Refresh insights" : "Generate insights"}
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

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <InsightPanel
        title="AI Insights (Anthropic)"
        subtitle="Provider: Anthropic"
        state={anthropic}
        onGenerate={() => void fetchFor("insights", setAnthropic)}
      />
      <InsightPanel
        title="AI Insights (Alternative)"
        subtitle="Provider: OpenAI (with rule-based fallback)"
        state={alternative}
        onGenerate={() => void fetchFor("insights-openai", setAlternative)}
      />
    </div>
  );
}
