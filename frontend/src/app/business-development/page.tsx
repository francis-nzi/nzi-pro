"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function apiBaseUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  if (!envBase) {
    return "/api/backend";
  }
  if (envBase === "/api/backend") {
    return "/api/backend";
  }
  return envBase;
}

type Stage = {
  stage_id: number;
  stage_key: string;
  stage_name: string;
  stage_order: number;
  probability_pct: number;
  opportunity_count?: number;
  pipeline_value?: number;
};

type Lead = {
  lead_id: number;
  lead_name: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  country: string;
  industry: string;
  status: string;
};

type Opportunity = {
  opportunity_id: number;
  opportunity_name: string;
  company_name: string;
  contact_name: string;
  email: string;
  stage_id: number;
  stage_name: string;
  estimated_value: number;
  currency: string;
  status: string;
  client_db_id: number | null;
  quote_id: number | null;
  job_id: number | null;
};

type LeadGenService = {
  service_key: string;
  service_name: string;
};

type GeneratedLead = {
  generated_lead_id: number;
  bin_date: string;
  service_key: string;
  service_name: string;
  company_name: string;
  industry: string;
  country: string;
  city: string;
  website: string;
  contact_name: string;
  contact_role: string;
  contact_email: string;
  contact_phone: string;
  revenue_gbp_millions: number;
  likelihood_score: number;
  why_good_lead: string;
  trigger_reason: string;
  source_references: string;
  qualification_status: "new" | "funnel" | "binned";
  bin_reason_id?: number | null;
  bin_reason_name?: string;
  qualification_notes?: string;
  bd_lead_id: number | null;
};

type LeadBinSummary = {
  service_key: string;
  service_name: string;
  total: number;
  new: number;
  funnel: number;
  binned: number;
};

type BinReason = {
  bin_reason_id: number;
  name: string;
  is_active?: boolean;
};

type BdSection = "overview" | "lead-generator" | "leads" | "opportunities" | "funnel-settings";

export default function BusinessDevelopmentPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [leadServices, setLeadServices] = useState<LeadGenService[]>([]);
  const [serviceKeys, setServiceKeys] = useState<string[]>([]);
  const [binDate, setBinDate] = useState(todayIso);
  const [regions, setRegions] = useState("United Kingdom, Europe");
  const [revenueMin, setRevenueMin] = useState("2");
  const [revenueMax, setRevenueMax] = useState("150");
  const [leadsPerService, setLeadsPerService] = useState("10");
  const [generatingLeads, setGeneratingLeads] = useState(false);
  const [generatedLeads, setGeneratedLeads] = useState<GeneratedLead[]>([]);
  const [leadBinSummary, setLeadBinSummary] = useState<LeadBinSummary[]>([]);
  const [binReasons, setBinReasons] = useState<BinReason[]>([]);
  const [binReasonByLead, setBinReasonByLead] = useState<Record<number, string>>({});
  const [binNoteByLead, setBinNoteByLead] = useState<Record<number, string>>({});
  const [activeServiceFilter, setActiveServiceFilter] = useState("all");
  const [activeSection, setActiveSection] = useState<BdSection>("overview");
  const [focusLeadId, setFocusLeadId] = useState<number | null>(null);
  const [totals, setTotals] = useState({ lead_count: 0, open_opportunities: 0, pipeline_value: 0 });

  const [leadForm, setLeadForm] = useState({
    lead_name: "",
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    country: "",
    industry: "",
    source: "website",
    notes: "",
  });
  const [oppForm, setOppForm] = useState({
    opportunity_name: "",
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    country: "",
    industry: "",
    stage_id: "",
    expected_close_date: "",
    estimated_value: "",
    currency: "GBP",
    notes: "",
  });
  const [stageForm, setStageForm] = useState({
    stage_name: "",
    stage_key: "",
    stage_order: "",
    probability_pct: "",
  });

  const loadLeadGeneratorServices = useCallback(async () => {
    const res = await fetch(`${baseUrl}/bd/lead-generator/services`, { credentials: "include" });
    if (!res.ok) {
      throw new Error(`Failed to load lead-generator services (${res.status})`);
    }
    const json = await res.json();
    const items: LeadGenService[] = Array.isArray(json?.items) ? json.items : [];
    setLeadServices(items);
    setServiceKeys((prev) => {
      if (prev.length > 0) return prev;
      return items.map((item) => item.service_key);
    });
  }, [baseUrl]);

  const loadLeadBins = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("bin_date", binDate || todayIso);
    params.set("include_fallback", "false");
    const res = await fetch(`${baseUrl}/bd/lead-generator/bins?${params.toString()}`, { credentials: "include" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Failed to load daily lead bins (${res.status})${t ? `: ${t}` : ""}`);
    }
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    setGeneratedLeads(items);
    setBinReasonByLead((prev) => {
      const next = { ...prev };
      for (const row of items) {
        const leadId = Number(row?.generated_lead_id || 0);
        if (!leadId) continue;
        const reasonId = row?.bin_reason_id;
        if ((reasonId ?? null) !== null && reasonId !== undefined) {
          next[leadId] = String(reasonId);
        }
      }
      return next;
    });
    setLeadBinSummary(Array.isArray(json?.services) ? json.services : []);
    return items.length;
  }, [baseUrl, binDate, todayIso]);

  const loadBinReasons = useCallback(async () => {
    const res = await fetch(`${baseUrl}/bd/lead-generator/bin-reasons`, { credentials: "include" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Failed to load bin reasons (${res.status})${t ? `: ${t}` : ""}`);
    }
    const json = await res.json();
    const items: BinReason[] = Array.isArray(json?.items) ? json.items : [];
    setBinReasons(items);
  }, [baseUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, leadsRes, oppsRes, stagesRes] = await Promise.all([
        fetch(`${baseUrl}/bd/overview`, { credentials: "include" }),
        fetch(`${baseUrl}/bd/leads?limit=200&offset=0`, { credentials: "include" }),
        fetch(`${baseUrl}/bd/opportunities?limit=300&offset=0`, { credentials: "include" }),
        fetch(`${baseUrl}/bd/funnel/stages`, { credentials: "include" }),
      ]);
      if (!overviewRes.ok) throw new Error(`Failed to load overview (${overviewRes.status})`);
      if (!leadsRes.ok) throw new Error(`Failed to load leads (${leadsRes.status})`);
      if (!oppsRes.ok) throw new Error(`Failed to load opportunities (${oppsRes.status})`);
      if (!stagesRes.ok) throw new Error(`Failed to load stages (${stagesRes.status})`);

      const overview = await overviewRes.json();
      const leadsJson = await leadsRes.json();
      const oppsJson = await oppsRes.json();
      const stagesJson = await stagesRes.json();

      const stageItems = Array.isArray(stagesJson?.items) ? stagesJson.items : [];
      const overviewStages = Array.isArray(overview?.stages) ? overview.stages : [];
      const byId = new Map<number, Stage>();
      stageItems.forEach((s: Stage) => byId.set(Number(s.stage_id), s));
      overviewStages.forEach((s: Stage) => byId.set(Number(s.stage_id), { ...(byId.get(Number(s.stage_id)) || s), ...s }));

      setStages(Array.from(byId.values()).sort((a, b) => Number(a.stage_order || 0) - Number(b.stage_order || 0)));
      setLeads(Array.isArray(leadsJson?.items) ? leadsJson.items : []);
      setOpportunities(Array.isArray(oppsJson?.items) ? oppsJson.items : []);
      setTotals({
        lead_count: Number(overview?.totals?.lead_count || 0),
        open_opportunities: Number(overview?.totals?.open_opportunities || 0),
        pipeline_value: Number(overview?.totals?.pipeline_value || 0),
      });
      await loadLeadGeneratorServices();
      await loadBinReasons();
      await loadLeadBins();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, loadLeadBins, loadLeadGeneratorServices, loadBinReasons]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadLeadBins();
  }, [loadLeadBins]);

  async function createLead() {
    try {
      const res = await fetch(`${baseUrl}/bd/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(leadForm),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to create lead (${res.status})${txt ? `: ${txt}` : ""}`);
      setLeadForm({
        lead_name: "",
        company_name: "",
        contact_name: "",
        email: "",
        phone: "",
        country: "",
        industry: "",
        source: "website",
        notes: "",
      });
      setStatus("Lead created.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function createOpportunity() {
    try {
      const payload = {
        ...oppForm,
        stage_id: oppForm.stage_id ? Number(oppForm.stage_id) : undefined,
        estimated_value: oppForm.estimated_value ? Number(oppForm.estimated_value) : 0,
      };
      const res = await fetch(`${baseUrl}/bd/opportunities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to create opportunity (${res.status})${txt ? `: ${txt}` : ""}`);
      setOppForm({
        opportunity_name: "",
        company_name: "",
        contact_name: "",
        email: "",
        phone: "",
        country: "",
        industry: "",
        stage_id: "",
        expected_close_date: "",
        estimated_value: "",
        currency: "GBP",
        notes: "",
      });
      setStatus("Opportunity created.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function createStage() {
    try {
      const payload = {
        stage_name: stageForm.stage_name,
        stage_key: stageForm.stage_key || stageForm.stage_name.toLowerCase().replace(/\s+/g, "-"),
        stage_order: stageForm.stage_order ? Number(stageForm.stage_order) : undefined,
        probability_pct: stageForm.probability_pct ? Number(stageForm.probability_pct) : 0,
      };
      const res = await fetch(`${baseUrl}/bd/funnel/stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to create stage (${res.status})${txt ? `: ${txt}` : ""}`);
      setStageForm({ stage_name: "", stage_key: "", stage_order: "", probability_pct: "" });
      setStatus("Funnel stage created.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function convertLead(leadId: number) {
    try {
      const res = await fetch(`${baseUrl}/bd/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to convert lead (${res.status})${txt ? `: ${txt}` : ""}`);
      setStatus("Lead converted to opportunity.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function moveOpportunity(opportunityId: number, stageId: number) {
    try {
      const res = await fetch(`${baseUrl}/bd/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stage_id: stageId }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to move opportunity (${res.status})${txt ? `: ${txt}` : ""}`);
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function convertToClient(opportunityId: number) {
    try {
      const res = await fetch(`${baseUrl}/bd/opportunities/${opportunityId}/convert-client`, {
        method: "POST",
        credentials: "include",
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to convert to client (${res.status})${txt ? `: ${txt}` : ""}`);
      setStatus("Opportunity converted to client.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function createQuote(opportunityId: number) {
    try {
      const res = await fetch(`${baseUrl}/bd/opportunities/${opportunityId}/create-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to create quote (${res.status})${txt ? `: ${txt}` : ""}`);
      setStatus("Quote created from opportunity.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function createJob(opportunityId: number) {
    try {
      const res = await fetch(`${baseUrl}/bd/opportunities/${opportunityId}/create-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to create job (${res.status})${txt ? `: ${txt}` : ""}`);
      setStatus("Job created from opportunity.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  function toggleService(serviceKey: string) {
    setServiceKeys((prev) => {
      if (prev.includes(serviceKey)) return prev.filter((x) => x !== serviceKey);
      return [...prev, serviceKey];
    });
  }

  async function generateAIDailyLeads() {
    try {
      setGeneratingLeads(true);
      const payload = {
        bin_date: binDate || todayIso,
        regions: regions.split(",").map((x) => x.trim()).filter(Boolean),
        revenue_min_m_gbp: Number(revenueMin || 2),
        revenue_max_m_gbp: Number(revenueMax || 150),
        leads_per_service: Number(leadsPerService || 10),
        service_keys: serviceKeys,
        replace_existing: true,
        allow_fallback: false,
      };
      const res = await fetch(`${baseUrl}/bd/lead-generator/generate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to generate leads (${res.status})${txt ? `: ${txt}` : ""}`);
      let responsePayload: { inserted_or_updated?: number; services?: Record<string, number> } = {};
      if (txt && txt.trim()) {
        try {
          responsePayload = JSON.parse(txt) as { inserted_or_updated?: number; services?: Record<string, number> };
        } catch {
          responsePayload = {};
        }
      }
      const inserted = Number(responsePayload?.inserted_or_updated || 0);
      setStatus(`AI daily leads generated: ${inserted} verifiable leads added to today's bin.`);
      await loadLeadBins();
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setGeneratingLeads(false);
    }
  }

  async function qualifyAIGeneratedLead(generatedLeadId: number, action: "funnel" | "binned") {
    try {
      setStatus(action === "funnel" ? "Sending lead to funnel..." : "Binning lead...");
      const selectedReasonId = binReasonByLead[generatedLeadId] || "";
      const selectedReason = binReasons.find((r) => String(r.bin_reason_id) === String(selectedReasonId));
      const selectedNote = (binNoteByLead[generatedLeadId] || "").trim();
      if (action === "binned" && !selectedReasonId) {
        throw new Error("Please select a bin reason before binning this lead.");
      }
      if (action === "binned" && selectedReason?.name?.toLowerCase() === "other" && !selectedNote) {
        throw new Error("Please add a short note when bin reason is 'Other'.");
      }
      const payloadBody =
        action === "binned"
          ? { action, bin_reason_id: Number(selectedReasonId), notes: selectedNote || undefined }
          : { action };
      const res = await fetch(`${baseUrl}/bd/lead-generator/leads/${generatedLeadId}/qualify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadBody),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to qualify lead (${res.status})${txt ? `: ${txt}` : ""}`);
      let payload: { bd_lead_id?: number; bin_reason_id?: number; bin_reason_name?: string } = {};
      if (txt && txt.trim()) {
        try {
          payload = JSON.parse(txt) as { bd_lead_id?: number };
        } catch {
          payload = {};
        }
      }
      setGeneratedLeads((prev) =>
        prev.map((row) =>
          row.generated_lead_id === generatedLeadId
            ? {
                ...row,
                qualification_status: action,
                bin_reason_id: action === "binned" ? Number(payload?.bin_reason_id || selectedReasonId || 0) || null : null,
                bin_reason_name: action === "binned" ? String(payload?.bin_reason_name || selectedReason?.name || "") : "",
                bd_lead_id: action === "funnel" ? Number(payload?.bd_lead_id || row.bd_lead_id || 0) || null : row.bd_lead_id,
              }
            : row
        )
      );
      await loadLeadBins();
      if (action === "funnel") {
        await load();
      }
      setStatus(action === "funnel" ? "Lead sent to funnel." : "Lead binned with reason.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function refreshBinWithStatus() {
    try {
      const count = await loadLeadBins();
      const now = new Date();
      setStatus(`Bin refreshed at ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ${count} leads loaded.`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  const visibleGeneratedLeads = generatedLeads.filter((item) => {
    if (activeServiceFilter !== "all" && item.service_key !== activeServiceFilter) return false;
    return true;
  });

  const sectionButtons: { key: BdSection; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "lead-generator", label: "AI Lead Generator" },
    { key: "leads", label: "Leads" },
    { key: "opportunities", label: "Opportunities" },
    { key: "funnel-settings", label: "Funnel Settings" },
  ];

  function extractUrls(text: string): string[] {
    const re = /(https?:\/\/[^\s|,]+)/gi;
    const matches = text.match(re) || [];
    return Array.from(new Set(matches.map((m) => m.trim())));
  }

  function openLeadInSection(leadId: number | null | undefined) {
    if (!leadId) return;
    setActiveSection("leads");
    setFocusLeadId(leadId);
    setTimeout(() => {
      const el = document.getElementById(`lead-${leadId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: "#F26624" }}>Business Development</h1>
            <p className="text-sm text-muted-foreground">Sales funnel from lead to quote to job</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/">Back to Hub</Link>
          </Button>
        </div>

        {status ? <div className="rounded-md bg-muted p-3 text-sm">{status}</div> : null}

        <Card>
          <CardHeader><CardTitle className="text-base">Business Development Sections</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {sectionButtons.map((section) => (
                <Button
                  key={section.key}
                  size="sm"
                  variant={activeSection === section.key ? "default" : "outline"}
                  onClick={() => setActiveSection(section.key)}
                >
                  {section.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {(activeSection === "overview" || activeSection === "funnel-settings") ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardHeader><CardTitle className="text-base">Leads</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{totals.lead_count}</div></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Open Opportunities</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{totals.open_opportunities}</div></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Pipeline Value</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(totals.pipeline_value)}</div></CardContent></Card>
        </div>
        ) : null}

        {(activeSection === "overview" || activeSection === "funnel-settings") ? (
        <Card>
          <CardHeader><CardTitle>Funnel (4 Stages)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stages.map((s, idx) => (
                <div key={s.stage_id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{idx + 1}. {s.stage_name}</div>
                    <div className="text-xs text-muted-foreground">{s.probability_pct}% probability</div>
                  </div>
                  <div className="mt-2 h-3 w-full rounded bg-muted">
                    <div className="h-3 rounded bg-[#1c5026]" style={{ width: `${Math.max(5, Math.min(100, Number(s.probability_pct || 0)))}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Opportunities: {Number(s.opportunity_count || 0)} | Value: {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(s.pipeline_value || 0))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        ) : null}

        {activeSection === "lead-generator" ? (
        <Card>
          <CardHeader>
            <CardTitle>AI Lead Generator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Bin Date</label>
                <Input type="date" value={binDate} onChange={(e) => setBinDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Regions</label>
                <Input value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="United Kingdom, Europe" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Revenue Min (GBP m)</label>
                <Input type="number" value={revenueMin} onChange={(e) => setRevenueMin(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Revenue Max (GBP m)</label>
                <Input type="number" value={revenueMax} onChange={(e) => setRevenueMax(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Leads / service / day</label>
                <Input type="number" value={leadsPerService} onChange={(e) => setLeadsPerService(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Services</div>
              <div className="flex flex-wrap gap-2">
                {leadServices.map((svc) => {
                  const active = serviceKeys.includes(svc.service_key);
                  return (
                    <button
                      key={svc.service_key}
                      type="button"
                      onClick={() => toggleService(svc.service_key)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        active ? "border-[#1c5026] bg-[#1c5026] text-white" : "border-border bg-background text-foreground"
                      }`}
                    >
                      {svc.service_name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => void generateAIDailyLeads()} disabled={generatingLeads || serviceKeys.length === 0}>
                {generatingLeads ? "Generating..." : "Generate Daily Leads"}
              </Button>
              <Button variant="outline" onClick={() => void refreshBinWithStatus()}>
                Refresh Bin
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Generates candidate leads for Carbon Reduction Plans, Net Zero support, consultancy, and training/workshops, then stores them in daily bins for team qualification.
            </div>

            {leadBinSummary.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-4">
                {leadBinSummary.map((s) => (
                  <div key={s.service_key} className="rounded-md border p-2">
                    <div className="text-sm font-medium">{s.service_name}</div>
                    <div className="text-xs text-muted-foreground">Total {s.total} | New {s.new} | Funnel {s.funnel} | Binned {s.binned}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={activeServiceFilter === "all" ? "default" : "outline"}
                onClick={() => setActiveServiceFilter("all")}
              >
                All Services
              </Button>
              {leadServices.map((svc) => (
                <Button
                  key={svc.service_key}
                  size="sm"
                  variant={activeServiceFilter === svc.service_key ? "default" : "outline"}
                  onClick={() => setActiveServiceFilter(svc.service_key)}
                >
                  {svc.service_name}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              {visibleGeneratedLeads.length === 0 ? (
                <div className="text-sm text-muted-foreground">No generated leads in this bin yet.</div>
              ) : (
                visibleGeneratedLeads.map((item) => (
                  <div key={item.generated_lead_id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{item.company_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.service_name} | {item.industry || "-"} | {item.city ? `${item.city}, ` : ""}{item.country || "-"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Likelihood</div>
                        <div className="font-semibold">{Number(item.likelihood_score || 0).toFixed(1)}%</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs">
                      <span className="font-medium">Contact: </span>
                      {item.contact_name || "-"} {item.contact_role ? `(${item.contact_role})` : ""} {item.contact_email ? `| ${item.contact_email}` : ""} {item.contact_phone ? `| ${item.contact_phone}` : ""}
                    </div>
                    <div className="text-xs">
                      <span className="font-medium">Revenue: </span>
                      {item.revenue_gbp_millions ? `GBP ${item.revenue_gbp_millions.toFixed(1)}m` : "-"}
                    </div>
                    <div className="text-xs">
                      <span className="font-medium">Website: </span>
                      {item.website ? (
                        <a className="text-[#1c5026] underline" href={item.website} target="_blank" rel="noreferrer">
                          {item.website}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No website returned</span>
                      )}
                    </div>
                    <div className="mt-2 text-xs"><span className="font-medium">Why good lead: </span>{item.why_good_lead || "-"}</div>
                    <div className="text-xs"><span className="font-medium">Trigger: </span>{item.trigger_reason || "-"}</div>
                    <div className="text-xs">
                      <span className="font-medium">Evidence: </span>
                      {extractUrls(item.source_references).length > 0 ? (
                        <span className="space-x-2">
                          {extractUrls(item.source_references).map((url) => (
                            <a key={url} className="text-[#1c5026] underline" href={url} target="_blank" rel="noreferrer">
                              source
                            </a>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No source links returned</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="text-xs text-muted-foreground">Status: {item.qualification_status}</div>
                      {item.qualification_status === "binned" && item.bin_reason_name ? (
                        <div className="text-xs text-muted-foreground">Reason: {item.bin_reason_name}</div>
                      ) : null}
                      {item.qualification_status === "new" ? (
                        <>
                          <select
                            className="rounded border px-2 py-1 text-xs"
                            value={binReasonByLead[item.generated_lead_id] || ""}
                            onChange={(e) =>
                              setBinReasonByLead((prev) => ({ ...prev, [item.generated_lead_id]: e.target.value }))
                            }
                          >
                            <option value="">Bin reason...</option>
                            {binReasons.map((reason) => (
                              <option key={reason.bin_reason_id} value={String(reason.bin_reason_id)}>
                                {reason.name}
                              </option>
                            ))}
                          </select>
                          {(() => {
                            const selectedReasonId = binReasonByLead[item.generated_lead_id] || "";
                            const selectedReason = binReasons.find((r) => String(r.bin_reason_id) === String(selectedReasonId));
                            if (selectedReason?.name?.toLowerCase() !== "other") return null;
                            return (
                              <Input
                                className="max-w-xs"
                                placeholder="Reason note"
                                value={binNoteByLead[item.generated_lead_id] || ""}
                                onChange={(e) =>
                                  setBinNoteByLead((prev) => ({ ...prev, [item.generated_lead_id]: e.target.value }))
                                }
                              />
                            );
                          })()}
                          <Button size="sm" onClick={() => void qualifyAIGeneratedLead(item.generated_lead_id, "funnel")}>
                            Send to Funnel
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void qualifyAIGeneratedLead(item.generated_lead_id, "binned")}>
                            Bin
                          </Button>
                        </>
                      ) : null}
                      {item.bd_lead_id ? (
                        <>
                          <div className="text-xs text-muted-foreground">Lead ID: {item.bd_lead_id}</div>
                          <Button size="sm" variant="outline" onClick={() => openLeadInSection(item.bd_lead_id)}>
                            Go to Lead
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        ) : null}

        {(activeSection === "leads" || activeSection === "opportunities" || activeSection === "funnel-settings") ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {activeSection === "leads" ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Create Lead</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Lead Name *" value={leadForm.lead_name} onChange={(e) => setLeadForm((p) => ({ ...p, lead_name: e.target.value }))} />
              <Input placeholder="Company" value={leadForm.company_name} onChange={(e) => setLeadForm((p) => ({ ...p, company_name: e.target.value }))} />
              <Input placeholder="Contact Name" value={leadForm.contact_name} onChange={(e) => setLeadForm((p) => ({ ...p, contact_name: e.target.value }))} />
              <Input placeholder="Email" value={leadForm.email} onChange={(e) => setLeadForm((p) => ({ ...p, email: e.target.value }))} />
              <Input placeholder="Phone" value={leadForm.phone} onChange={(e) => setLeadForm((p) => ({ ...p, phone: e.target.value }))} />
              <Input placeholder="Country" value={leadForm.country} onChange={(e) => setLeadForm((p) => ({ ...p, country: e.target.value }))} />
              <Input placeholder="Industry" value={leadForm.industry} onChange={(e) => setLeadForm((p) => ({ ...p, industry: e.target.value }))} />
              <Textarea placeholder="Notes" value={leadForm.notes} onChange={(e) => setLeadForm((p) => ({ ...p, notes: e.target.value }))} rows={3} />
              <Button onClick={() => void createLead()} disabled={loading}>Add Lead</Button>
            </CardContent>
          </Card>
          ) : null}

          {activeSection === "opportunities" ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Create Opportunity</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Opportunity Name *" value={oppForm.opportunity_name} onChange={(e) => setOppForm((p) => ({ ...p, opportunity_name: e.target.value }))} />
              <Input placeholder="Company" value={oppForm.company_name} onChange={(e) => setOppForm((p) => ({ ...p, company_name: e.target.value }))} />
              <Input placeholder="Contact Name" value={oppForm.contact_name} onChange={(e) => setOppForm((p) => ({ ...p, contact_name: e.target.value }))} />
              <Input placeholder="Email" value={oppForm.email} onChange={(e) => setOppForm((p) => ({ ...p, email: e.target.value }))} />
              <Input placeholder="Estimated Value" type="number" value={oppForm.estimated_value} onChange={(e) => setOppForm((p) => ({ ...p, estimated_value: e.target.value }))} />
              <label className="text-xs text-muted-foreground">Stage</label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={oppForm.stage_id} onChange={(e) => setOppForm((p) => ({ ...p, stage_id: e.target.value }))}>
                <option value="">Auto</option>
                {stages.map((s) => <option key={s.stage_id} value={String(s.stage_id)}>{s.stage_name}</option>)}
              </select>
              <Button onClick={() => void createOpportunity()} disabled={loading}>Add Opportunity</Button>
            </CardContent>
          </Card>
          ) : null}

          {activeSection === "funnel-settings" ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Create Funnel Stage</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Stage Name" value={stageForm.stage_name} onChange={(e) => setStageForm((p) => ({ ...p, stage_name: e.target.value }))} />
              <Input placeholder="Stage Key (optional)" value={stageForm.stage_key} onChange={(e) => setStageForm((p) => ({ ...p, stage_key: e.target.value }))} />
              <Input placeholder="Order (optional)" type="number" value={stageForm.stage_order} onChange={(e) => setStageForm((p) => ({ ...p, stage_order: e.target.value }))} />
              <Input placeholder="Probability %" type="number" value={stageForm.probability_pct} onChange={(e) => setStageForm((p) => ({ ...p, probability_pct: e.target.value }))} />
              <Button variant="outline" onClick={() => void createStage()} disabled={loading}>Add Stage</Button>
            </CardContent>
          </Card>
          ) : null}
        </div>
        ) : null}

        {(activeSection === "leads" || activeSection === "opportunities") ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {activeSection === "leads" ? (
          <Card>
            <CardHeader><CardTitle>Leads</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {leads.length === 0 ? <div className="text-sm text-muted-foreground">No leads yet.</div> : leads.map((lead) => (
                <div id={`lead-${lead.lead_id}`} key={lead.lead_id} className={`rounded-md border p-3 ${focusLeadId === lead.lead_id ? "border-[#1c5026] ring-1 ring-[#1c5026]" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{lead.lead_name}</div>
                    <div className="text-xs text-muted-foreground">{lead.status}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{lead.company_name || "-"} | {lead.contact_name || "-"} | {lead.email || "-"}</div>
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => void convertLead(lead.lead_id)}>Convert to Opportunity</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          ) : null}

          {activeSection === "opportunities" ? (
          <Card>
            <CardHeader><CardTitle>Opportunities</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {opportunities.length === 0 ? <div className="text-sm text-muted-foreground">No opportunities yet.</div> : opportunities.map((opp) => (
                <div key={opp.opportunity_id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{opp.opportunity_name}</div>
                    <div className="text-xs text-muted-foreground">{opp.stage_name}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{opp.company_name || "-"} | {opp.contact_name || "-"} | {opp.email || "-"}</div>
                  <div className="text-xs text-muted-foreground">Value: {new Intl.NumberFormat("en-GB", { style: "currency", currency: opp.currency || "GBP", maximumFractionDigits: 0 }).format(Number(opp.estimated_value || 0))}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select className="rounded border px-2 py-1 text-xs" value={String(opp.stage_id)} onChange={(e) => void moveOpportunity(opp.opportunity_id, Number(e.target.value))}>
                      {stages.map((s) => <option key={s.stage_id} value={String(s.stage_id)}>{s.stage_name}</option>)}
                    </select>
                    <Button size="sm" variant="outline" onClick={() => void convertToClient(opp.opportunity_id)}>Client</Button>
                    <Button size="sm" variant="outline" onClick={() => void createQuote(opp.opportunity_id)}>Quote</Button>
                    <Button size="sm" onClick={() => void createJob(opp.opportunity_id)}>Job</Button>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Client ID: {opp.client_db_id ?? "-"} | Quote ID: {opp.quote_id ?? "-"} | Job ID: {opp.job_id ?? "-"}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          ) : null}
        </div>
        ) : null}
      </div>
    </div>
  );
}
