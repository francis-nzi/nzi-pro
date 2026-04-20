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
  generated_lead_id: number | null;
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
  linkedin_url?: string;
  revenue_gbp_millions: number;
  likelihood_score: number;
  why_good_lead: string;
  trigger_reason: string;
  source_references: string;
  source_provider?: string;
  score_breakdown?: ScoreBreakdown | null;
  qualification_status: "new" | "funnel" | "binned";
  bin_reason_id?: number | null;
  bin_reason_name?: string;
  qualification_notes?: string;
  bd_lead_id: number | null;
};

type ScoreBreakdownComponent = {
  key: string;
  label: string;
  points: number;
  note: string;
};

type ScoreBreakdown = {
  base_score: number;
  bonus_points: number;
  source_provider: string;
  source_weight: number;
  source_adjustment: number;
  adjusted_score: number;
  summary: string;
  components: ScoreBreakdownComponent[];
};

type LeadGeneratorProfile = {
  name: string;
  binDate: string;
  generationMode: "market-scan" | "daily-leads";
  regions: string;
  revenueMin: string;
  revenueMax: string;
  targetIndustries: string;
  targetRoles: string;
  leadsPerService: string;
  includeKeywords: string;
  excludeKeywords: string;
  minLikelihoodScore: string;
  strictMode: boolean;
  sourceWeightOpenWeb: string;
  sourceWeightCompaniesHouse: string;
  sourceWeightFallback: string;
  serviceKeys: string[];
};

type MarketCompany = {
  market_company_id: number;
  scan_batch_id: number | null;
  source_provider: string;
  provider_org_id: string;
  service_key: string;
  company_name: string;
  normalized_company_key: string;
  website: string;
  domain: string;
  industry: string;
  subindustry: string;
  country: string;
  region: string;
  city: string;
  revenue_gbp_millions: number;
  revenue_band_label: string;
  employee_count: number | null;
  employee_band_label: string;
  qualification_status: string;
  created_at: string | null;
  updated_at: string | null;
};

type MarketDatabaseResponse = {
  items: MarketCompany[];
  total: number;
  limit: number;
  offset: number;
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

type ProviderStatus = {
  provider: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  status: "ok" | "error" | "unconfigured";
  detail: string;
  usage?: Record<string, unknown>;
};

type BdSection = "overview" | "lead-generator" | "market-database" | "leads" | "opportunities" | "funnel-settings";

const LEAD_GENERATOR_PROFILES_STORAGE_KEY = "nzi.business-development.lead-generator-profiles.v1";

const LEAD_GENERATOR_PROFILE_TEMPLATES: LeadGeneratorProfile[] = [
  {
    name: "Construction Mid-Market",
    binDate: "",
    generationMode: "market-scan",
    regions: "United Kingdom",
    revenueMin: "5",
    revenueMax: "50",
    targetIndustries: "Construction, Civil Engineering, Fit-Out",
    targetRoles: "Bid Manager, Commercial Director, Operations Director, Sustainability Manager",
    leadsPerService: "25",
    includeKeywords: "supplier, procurement, tender, carbon reduction plan",
    excludeKeywords: "consultancy, software, SaaS, outsourcing",
    minLikelihoodScore: "68",
    strictMode: true,
    sourceWeightOpenWeb: "1.1",
    sourceWeightCompaniesHouse: "1.0",
    sourceWeightFallback: "0.75",
    serviceKeys: ["market-targeting"],
  },
  {
    name: "Healthcare Supply Chain",
    binDate: "",
    generationMode: "daily-leads",
    regions: "United Kingdom, Ireland",
    revenueMin: "5",
    revenueMax: "40",
    targetIndustries: "Healthcare, Medical Supplies, Care, Facilities Management",
    targetRoles: "Procurement Manager, Estates Director, Sustainability Manager, Commercial Director",
    leadsPerService: "20",
    includeKeywords: "NHS, supplier, disclosure, emissions, tender",
    excludeKeywords: "consultancy, software, outsourcing",
    minLikelihoodScore: "66",
    strictMode: false,
    sourceWeightOpenWeb: "1.0",
    sourceWeightCompaniesHouse: "1.1",
    sourceWeightFallback: "0.8",
    serviceKeys: [],
  },
  {
    name: "Logistics Carbon Pressure",
    binDate: "",
    generationMode: "market-scan",
    regions: "United Kingdom, Europe",
    revenueMin: "10",
    revenueMax: "100",
    targetIndustries: "Logistics, Transport, Freight, Warehousing",
    targetRoles: "Operations Director, Fleet Manager, Sustainability Manager, Commercial Director",
    leadsPerService: "25",
    includeKeywords: "fleet, emissions, decarbonisation, customer reporting, supplier",
    excludeKeywords: "consultancy, software, outsourcing",
    minLikelihoodScore: "70",
    strictMode: true,
    sourceWeightOpenWeb: "1.1",
    sourceWeightCompaniesHouse: "1.0",
    sourceWeightFallback: "0.7",
    serviceKeys: ["market-targeting"],
  },
  {
    name: "Public Sector Suppliers",
    binDate: "",
    generationMode: "daily-leads",
    regions: "United Kingdom",
    revenueMin: "3",
    revenueMax: "35",
    targetIndustries: "Construction, Cleaning, Catering, Facilities Management, Logistics",
    targetRoles: "Bid Manager, Procurement Manager, Commercial Director, Sustainability Manager",
    leadsPerService: "20",
    includeKeywords: "tender, framework, supplier, carbon reduction, procurement",
    excludeKeywords: "consultancy, software, outsourcing",
    minLikelihoodScore: "67",
    strictMode: false,
    sourceWeightOpenWeb: "1.0",
    sourceWeightCompaniesHouse: "1.15",
    sourceWeightFallback: "0.75",
    serviceKeys: [],
  },
];

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
  const [generationMode, setGenerationMode] = useState<"market-scan" | "daily-leads">("market-scan");
  const [regions, setRegions] = useState("United Kingdom, Europe");
  const [revenueMin, setRevenueMin] = useState("5");
  const [revenueMax, setRevenueMax] = useState("15");
  const [targetIndustries, setTargetIndustries] = useState("Construction, Healthcare");
  const [targetRoles, setTargetRoles] = useState(
    "Business Development Manager, Business Development Director, Sales Manager, Sales Director, Sustainability Manager, ESG Manager, Social Value Manager, Bid Manager"
  );
  const [leadsPerService, setLeadsPerService] = useState("25");
  const [generatingLeads, setGeneratingLeads] = useState(false);
  const [previewingLeads, setPreviewingLeads] = useState(false);
  const [enrichingLeads, setEnrichingLeads] = useState(false);
  const [generatedLeads, setGeneratedLeads] = useState<GeneratedLead[]>([]);
  const [previewLeads, setPreviewLeads] = useState<GeneratedLead[]>([]);
  const [includeKeywords, setIncludeKeywords] = useState("supplier, procurement, disclosure, decarbonisation");
  const [excludeKeywords, setExcludeKeywords] = useState("consultancy, software, SaaS, outsourcing");
  const [minLikelihoodScore, setMinLikelihoodScore] = useState("65");
  const [strictMode, setStrictMode] = useState(true);
  const [sourceWeightOpenWeb, setSourceWeightOpenWeb] = useState("1.0");
  const [sourceWeightCompaniesHouse, setSourceWeightCompaniesHouse] = useState("1.1");
  const [sourceWeightFallback, setSourceWeightFallback] = useState("0.75");
  const [leadGeneratorProfiles, setLeadGeneratorProfiles] = useState<LeadGeneratorProfile[]>([]);
  const [leadGeneratorProfileName, setLeadGeneratorProfileName] = useState("Mid-market sustainability leads");
  const [selectedLeadGeneratorProfile, setSelectedLeadGeneratorProfile] = useState("");
  const [marketDatabase, setMarketDatabase] = useState<MarketDatabaseResponse>({ items: [], total: 0, limit: 50, offset: 0 });
  const [marketSearch, setMarketSearch] = useState("");
  const [marketIndustryFilter, setMarketIndustryFilter] = useState("");
  const [marketStatusFilter, setMarketStatusFilter] = useState("");
  const [marketPage, setMarketPage] = useState(1);
  const [leadBinSummary, setLeadBinSummary] = useState<LeadBinSummary[]>([]);
  const [binReasons, setBinReasons] = useState<BinReason[]>([]);
  const [binReasonByLead, setBinReasonByLead] = useState<Record<string, string>>({});
  const [binNoteByLead, setBinNoteByLead] = useState<Record<string, string>>({});
  const [activeServiceFilter, setActiveServiceFilter] = useState("all");
  const [activeSection, setActiveSection] = useState<BdSection>("overview");
  const [focusLeadId, setFocusLeadId] = useState<number | null>(null);
  const [totals, setTotals] = useState({ lead_count: 0, open_opportunities: 0, pipeline_value: 0 });
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [enabledProviders, setEnabledProviders] = useState<string[]>(["apollo", "openai", "gemini"]);
  const [loadingProviders, setLoadingProviders] = useState(false);

  function normalizeLeadGeneratorProfile(item: any): LeadGeneratorProfile {
    const generationMode: "market-scan" | "daily-leads" = item?.generationMode === "daily-leads" ? "daily-leads" : "market-scan";
    return {
      name: String(item?.name || "").trim(),
      binDate: String(item?.binDate || "").trim(),
      generationMode,
      regions: String(item?.regions || "").trim(),
      revenueMin: String(item?.revenueMin || "").trim(),
      revenueMax: String(item?.revenueMax || "").trim(),
      targetIndustries: String(item?.targetIndustries || "").trim(),
      targetRoles: String(item?.targetRoles || "").trim(),
      leadsPerService: String(item?.leadsPerService || "").trim(),
      includeKeywords: String(item?.includeKeywords || "").trim(),
      excludeKeywords: String(item?.excludeKeywords || "").trim(),
      minLikelihoodScore: String(item?.minLikelihoodScore || "").trim(),
      strictMode: Boolean(item?.strictMode),
      sourceWeightOpenWeb: String(item?.sourceWeightOpenWeb || item?.sourceWeightOpen || "1.0").trim(),
      sourceWeightCompaniesHouse: String(item?.sourceWeightCompaniesHouse || item?.sourceWeightCompanies || "1.1").trim(),
      sourceWeightFallback: String(item?.sourceWeightFallback || item?.sourceWeightFallbackCandidate || "0.75").trim(),
      serviceKeys: Array.isArray(item?.serviceKeys) ? item.serviceKeys.map((x: unknown) => String(x).trim()).filter(Boolean) : [],
    };
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEAD_GENERATOR_PROFILES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const items: LeadGeneratorProfile[] = parsed
          .map((item) => normalizeLeadGeneratorProfile(item))
          .filter((item) => item.name);
        setLeadGeneratorProfiles(items);
        if (items.length > 0) {
          setSelectedLeadGeneratorProfile((prev) => prev || items[0].name);
        }
      }
    } catch {
      // Ignore malformed saved profiles and start clean.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LEAD_GENERATOR_PROFILES_STORAGE_KEY, JSON.stringify(leadGeneratorProfiles));
    } catch {
      // Ignore storage errors in private/incognito contexts.
    }
  }, [leadGeneratorProfiles]);

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
    setServiceKeys((prev) => prev);
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
        const leadId = String(Number(row?.generated_lead_id || 0));
        if (leadId === "0") continue;
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

  const loadMarketDatabase = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("limit", "50");
    params.set("offset", String((marketPage - 1) * 50));
    if (marketSearch.trim()) params.set("q", marketSearch.trim());
    if (marketIndustryFilter.trim()) params.set("industry", marketIndustryFilter.trim());
    if (marketStatusFilter.trim()) params.set("status", marketStatusFilter.trim());
    const res = await fetch(`${baseUrl}/bd/market-companies?${params.toString()}`, { credentials: "include" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Failed to load market database (${res.status})${t ? `: ${t}` : ""}`);
    }
    const json = await res.json();
    setMarketDatabase({
      items: Array.isArray(json?.items) ? json.items : [],
      total: Number(json?.total || 0),
      limit: Number(json?.limit || 50),
      offset: Number(json?.offset || 0),
    });
  }, [baseUrl, marketIndustryFilter, marketPage, marketSearch, marketStatusFilter]);

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
      await loadMarketDatabase();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, loadBinReasons, loadLeadBins, loadLeadGeneratorServices, loadMarketDatabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadLeadBins();
  }, [loadLeadBins]);

  useEffect(() => {
    void loadMarketDatabase();
  }, [loadMarketDatabase]);

  const fetchProviderStatus = useCallback(async () => {
    try {
      setLoadingProviders(true);
      const res = await fetch(`${baseUrl}/bd/lead-generator/provider-status`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      const providers: ProviderStatus[] = Array.isArray(data?.providers) ? data.providers : [];
      setProviderStatuses(providers);
      const configured = providers.filter((p) => p.configured).map((p) => p.provider);
      if (configured.length > 0) {
        setEnabledProviders((prev) => {
          const still = prev.filter((p) => configured.includes(p));
          return still.length > 0 ? still : configured;
        });
      }
    } catch {
      // Provider status is optional — silently ignore.
    } finally {
      setLoadingProviders(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void fetchProviderStatus();
  }, [fetchProviderStatus]);

  function toggleProvider(provider: string) {
    setEnabledProviders((prev) => {
      if (prev.includes(provider)) {
        const next = prev.filter((p) => p !== provider);
        return next.length > 0 ? next : prev;
      }
      return [...prev, provider];
    });
  }

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

  function buildLeadGeneratorPayload(previewOnly = false) {
    return {
      bin_date: binDate || todayIso,
      generation_mode: generationMode,
      regions: regions.split(",").map((x) => x.trim()).filter(Boolean),
      revenue_min_m_gbp: Number(revenueMin || 5),
      revenue_max_m_gbp: Number(revenueMax || 15),
      target_industries: targetIndustries.split(",").map((x) => x.trim()).filter(Boolean),
      target_roles: targetRoles.split(",").map((x) => x.trim()).filter(Boolean),
      include_keywords: includeKeywords.split(",").map((x) => x.trim()).filter(Boolean),
      exclude_keywords: excludeKeywords.split(",").map((x) => x.trim()).filter(Boolean),
      min_likelihood_score: Number(minLikelihoodScore || 0),
      strict_mode: strictMode,
      source_weight_open_web: Number(sourceWeightOpenWeb || 1),
      source_weight_companies_house: Number(sourceWeightCompaniesHouse || 1),
      source_weight_fallback: Number(sourceWeightFallback || 1),
      leads_per_service: Number(leadsPerService || 10),
      service_keys: serviceKeys,
      providers: enabledProviders,
      replace_existing: true,
      allow_fallback: false,
      preview_only: previewOnly,
    };
  }

  function getLeadGeneratorProfileSnapshot(nameOverride?: string): LeadGeneratorProfile {
    return {
      name: (nameOverride || leadGeneratorProfileName || "").trim(),
      binDate: binDate || todayIso,
      generationMode,
      regions,
      revenueMin,
      revenueMax,
      targetIndustries,
      targetRoles,
      leadsPerService,
      includeKeywords,
      excludeKeywords,
      minLikelihoodScore,
      strictMode,
      sourceWeightOpenWeb,
      sourceWeightCompaniesHouse,
      sourceWeightFallback,
      serviceKeys: [...serviceKeys],
    };
  }

  function applyLeadGeneratorProfile(profile: LeadGeneratorProfile) {
    setLeadGeneratorProfileName(profile.name);
    setBinDate(profile.binDate || todayIso);
    setGenerationMode(profile.generationMode);
    setRegions(profile.regions);
    setRevenueMin(profile.revenueMin);
    setRevenueMax(profile.revenueMax);
    setTargetIndustries(profile.targetIndustries);
    setTargetRoles(profile.targetRoles);
    setLeadsPerService(profile.leadsPerService);
    setIncludeKeywords(profile.includeKeywords);
    setExcludeKeywords(profile.excludeKeywords);
    setMinLikelihoodScore(profile.minLikelihoodScore);
    setStrictMode(profile.strictMode);
    setSourceWeightOpenWeb(profile.sourceWeightOpenWeb);
    setSourceWeightCompaniesHouse(profile.sourceWeightCompaniesHouse);
    setSourceWeightFallback(profile.sourceWeightFallback);
    setServiceKeys(profile.serviceKeys);
  }

  function loadLeadGeneratorTemplate(templateName: string) {
    const template = LEAD_GENERATOR_PROFILE_TEMPLATES.find((item) => item.name === templateName);
    if (!template) {
      setStatus("Template not found.");
      return;
    }
    applyLeadGeneratorProfile(template);
    setSelectedLeadGeneratorProfile("");
    setLeadGeneratorProfileName(template.name);
    setStatus(`Loaded template "${template.name}".`);
  }

  function saveLeadGeneratorProfile() {
    const snapshot = getLeadGeneratorProfileSnapshot();
    if (!snapshot.name) {
      setStatus("Please enter a profile name before saving.");
      return;
    }
    setLeadGeneratorProfiles((prev) => {
      const next = [...prev.filter((item) => item.name.toLowerCase() !== snapshot.name.toLowerCase()), snapshot].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      return next;
    });
    setSelectedLeadGeneratorProfile(snapshot.name);
    setStatus(`Saved lead profile "${snapshot.name}".`);
  }

  function loadLeadGeneratorProfileByName(profileName: string) {
    const profile = leadGeneratorProfiles.find((item) => item.name === profileName);
    if (!profile) {
      setStatus("Select a saved profile first.");
      return;
    }
    applyLeadGeneratorProfile(profile);
    setSelectedLeadGeneratorProfile(profile.name);
    setStatus(`Loaded lead profile "${profile.name}".`);
  }

  function deleteLeadGeneratorProfile(profileName: string) {
    setLeadGeneratorProfiles((prev) => prev.filter((item) => item.name !== profileName));
    setSelectedLeadGeneratorProfile((prev) => (prev === profileName ? "" : prev));
    setStatus(`Deleted lead profile "${profileName}".`);
  }

  async function runLeadGenerator(previewOnly = false) {
    try {
      if (previewOnly) {
        setPreviewingLeads(true);
      } else {
        setGeneratingLeads(true);
      }
      const payload = buildLeadGeneratorPayload(previewOnly);
      const res = await fetch(`${baseUrl}/bd/lead-generator/generate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to generate leads (${res.status})${txt ? `: ${txt}` : ""}`);
      let responsePayload: { inserted_or_updated?: number; preview_count?: number; preview_items?: GeneratedLead[]; services?: Record<string, number>; diagnostics?: Record<string, string>; providers_used?: string[] } = {};
      if (txt && txt.trim()) {
        try {
          responsePayload = JSON.parse(txt) as {
            inserted_or_updated?: number;
            preview_count?: number;
            preview_items?: GeneratedLead[];
            services?: Record<string, number>;
            diagnostics?: Record<string, string>;
            providers_used?: string[];
          };
        } catch {
          responsePayload = {};
        }
      }
      const diagParts = Object.entries(responsePayload?.diagnostics || {}).map(([k, v]) => `${k}: ${v}`);
      const diagText = diagParts.length ? ` Diagnostics: ${diagParts.join("; ")}` : "";
      const providersText = Array.isArray(responsePayload?.providers_used) && responsePayload.providers_used.length
        ? ` [Providers: ${responsePayload.providers_used.join(", ")}]`
        : "";
      if (previewOnly) {
        const previewItems = Array.isArray(responsePayload?.preview_items) ? responsePayload.preview_items : [];
        setPreviewLeads(previewItems);
        setStatus(
          generationMode === "market-scan"
            ? `Preview complete: ${previewItems.length} companies match your criteria. Nothing was written to the bin.${providersText}${diagText}`
            : `Preview complete: ${previewItems.length} criteria-matched leads were found. Nothing was written to the bin.${providersText}${diagText}`
        );
      } else {
        const inserted = Number(responsePayload?.inserted_or_updated || 0);
        setPreviewLeads([]);
        setStatus(
          generationMode === "market-scan"
            ? `Market scan generated: ${inserted} companies matched your criteria and were added to today's bin.${providersText}${diagText}`
            : `Lead generation complete: ${inserted} criteria-matched leads added to today's bin.${providersText}${diagText}`
        );
        await loadLeadBins();
        await load();
      }
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setGeneratingLeads(false);
      setPreviewingLeads(false);
    }
  }

  async function enrichVisibleLeads() {
    try {
      setEnrichingLeads(true);
      const payload = {
        bin_date: binDate || todayIso,
        revenue_min_m_gbp: Number(revenueMin || 5),
        revenue_max_m_gbp: Number(revenueMax || 15),
        target_roles: targetRoles.split(",").map((x) => x.trim()).filter(Boolean),
        limit: Math.min(visibleGeneratedLeads.length || 15, 25),
      };
      const res = await fetch(`${baseUrl}/bd/lead-generator/enrich`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Failed to enrich leads (${res.status})${txt ? `: ${txt}` : ""}`);
      let responsePayload: { updated?: number } = {};
      if (txt && txt.trim()) {
        try {
          responsePayload = JSON.parse(txt) as { updated?: number };
        } catch {
          responsePayload = {};
        }
      }
      setStatus(`Lead enrichment complete: ${Number(responsePayload.updated || 0)} leads updated.`);
      await loadLeadBins();
      await loadMarketDatabase();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setEnrichingLeads(false);
    }
  }

  async function qualifyAIGeneratedLead(generatedLeadId: number, action: "funnel" | "binned") {
    try {
      setStatus(action === "funnel" ? "Sending lead to funnel..." : "Binning lead...");
      const generatedLeadKey = String(generatedLeadId);
      const selectedReasonId = binReasonByLead[generatedLeadKey] || "";
      const selectedReason = binReasons.find((r) => String(r.bin_reason_id) === String(selectedReasonId));
      const selectedNote = (binNoteByLead[generatedLeadKey] || "").trim();
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

  const visiblePreviewLeads = previewLeads.filter((item) => {
    if (activeServiceFilter !== "all" && item.service_key !== activeServiceFilter) return false;
    return true;
  });

  const sectionButtons: { key: BdSection; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "lead-generator", label: "Lead Generator" },
    { key: "market-database", label: "Market Database" },
    { key: "leads", label: "Leads" },
    { key: "opportunities", label: "Opportunities" },
    { key: "funnel-settings", label: "Funnel Settings" },
  ];

  function extractUrls(text: string): string[] {
    const re = /(https?:\/\/[^\s|,]+)/gi;
    const matches = text.match(re) || [];
    return Array.from(new Set(matches.map((m) => m.trim())));
  }

  function formatScoreBreakdown(breakdown?: ScoreBreakdown | null): string {
    if (!breakdown) return "Unavailable";
    const parts = [
      `Base ${Number(breakdown.base_score || 0).toFixed(1)}`,
      `Bonus ${Number(breakdown.bonus_points || 0).toFixed(1)}`,
      `Source ${breakdown.source_provider || "open_web"} x${Number(breakdown.source_weight || 1).toFixed(2)}`,
      `Final ${Number(breakdown.adjusted_score || 0).toFixed(1)}`,
    ];
    return parts.join(" | ");
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
            <CardTitle>Lead Generator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={generationMode === "market-scan" ? "default" : "outline"}
                onClick={() => setGenerationMode("market-scan")}
              >
                Market Scan
              </Button>
              <Button
                type="button"
                variant={generationMode === "daily-leads" ? "default" : "outline"}
                onClick={() => setGenerationMode("daily-leads")}
              >
                Daily Lead Batch
              </Button>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Sector Templates</div>
              <div className="flex flex-wrap gap-2">
                {LEAD_GENERATOR_PROFILE_TEMPLATES.map((template) => (
                  <Button
                    key={template.name}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => loadLeadGeneratorTemplate(template.name)}
                  >
                    {template.name}
                  </Button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                Templates give you a fast starting point. Load one, review the criteria, then save it as a reusable profile if it fits your campaign.
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs text-muted-foreground">Saved Profiles</label>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="min-w-[240px] rounded-md border bg-background px-3 py-2 text-sm"
                    value={selectedLeadGeneratorProfile}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSelectedLeadGeneratorProfile(next);
                      if (next) {
                        loadLeadGeneratorProfileByName(next);
                      }
                    }}
                  >
                    <option value="">Select a saved profile</option>
                    {leadGeneratorProfiles.map((profile) => (
                      <option key={profile.name} value={profile.name}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!selectedLeadGeneratorProfile) {
                        setStatus("Select a saved profile first.");
                        return;
                      }
                      loadLeadGeneratorProfileByName(selectedLeadGeneratorProfile);
                    }}
                    disabled={!leadGeneratorProfiles.length}
                  >
                    Load Profile
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!selectedLeadGeneratorProfile) {
                        setStatus("Select a saved profile first.");
                        return;
                      }
                      deleteLeadGeneratorProfile(selectedLeadGeneratorProfile);
                    }}
                    disabled={!selectedLeadGeneratorProfile}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Profile Name</label>
                <div className="flex gap-2">
                  <Input value={leadGeneratorProfileName} onChange={(e) => setLeadGeneratorProfileName(e.target.value)} placeholder="Mid-market sustainability leads" />
                  <Button type="button" onClick={saveLeadGeneratorProfile}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
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
                <label className="text-xs text-muted-foreground">
                  {generationMode === "market-scan" ? "Companies per scan" : "Matches / service / day"}
                </label>
                <Input type="number" value={leadsPerService} onChange={(e) => setLeadsPerService(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Target Industries</label>
                <Input value={targetIndustries} onChange={(e) => setTargetIndustries(e.target.value)} placeholder="Construction, Healthcare" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Preferred Contact Roles</label>
                <Input
                  value={targetRoles}
                  onChange={(e) => setTargetRoles(e.target.value)}
                  placeholder="Business Development Manager, Sales Director, ESG Manager, Bid Manager"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs text-muted-foreground">Include Keywords</label>
                <Input
                  value={includeKeywords}
                  onChange={(e) => setIncludeKeywords(e.target.value)}
                  placeholder="supplier, procurement, disclosure, decarbonisation"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs text-muted-foreground">Exclude Keywords</label>
                <Input
                  value={excludeKeywords}
                  onChange={(e) => setExcludeKeywords(e.target.value)}
                  placeholder="consultancy, software, outsourcing"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Minimum Score</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={minLikelihoodScore}
                  onChange={(e) => setMinLikelihoodScore(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={strictMode}
                    onChange={(e) => setStrictMode(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Strict region matching
                </label>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Open Web Weight</label>
                <Input type="number" step="0.05" min="0.5" max="1.5" value={sourceWeightOpenWeb} onChange={(e) => setSourceWeightOpenWeb(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Companies House Weight</label>
                <Input
                  type="number"
                  step="0.05"
                  min="0.5"
                  max="1.5"
                  value={sourceWeightCompaniesHouse}
                  onChange={(e) => setSourceWeightCompaniesHouse(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Fallback Weight</label>
                <Input type="number" step="0.05" min="0.5" max="1.5" value={sourceWeightFallback} onChange={(e) => setSourceWeightFallback(e.target.value)} />
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              These criteria are used by both generation modes to filter, score, and explain the leads that get added to the bin. Source weighting nudges the final score
              toward better evidence sources.
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Data Providers</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => void fetchProviderStatus()}
                  disabled={loadingProviders}
                >
                  {loadingProviders ? "Checking..." : "Refresh Status"}
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                {providerStatuses.map((p) => {
                  const isOn = enabledProviders.includes(p.provider);
                  const statusColor =
                    p.status === "ok" ? "text-green-600" : p.status === "error" ? "text-red-500" : "text-yellow-500";
                  const statusDot =
                    p.status === "ok" ? "bg-green-500" : p.status === "error" ? "bg-red-500" : "bg-yellow-500";
                  return (
                    <button
                      key={p.provider}
                      type="button"
                      onClick={() => p.configured && toggleProvider(p.provider)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        isOn && p.configured
                          ? "border-[#1c5026] bg-[#1c5026]/5"
                          : "border-border bg-background opacity-60"
                      } ${p.configured ? "cursor-pointer hover:border-[#1c5026]/50" : "cursor-not-allowed"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{p.label}</span>
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot}`} />
                      </div>
                      <div className={`mt-1 text-xs ${statusColor}`}>
                        {p.status === "ok" ? "Connected" : p.status === "error" ? "Error" : "Not configured"}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground" title={p.detail}>
                        {p.detail.length > 60 ? p.detail.slice(0, 60) + "..." : p.detail}
                      </div>
                      {p.configured && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span
                            className={`inline-block h-3 w-6 rounded-full transition-colors ${
                              isOn ? "bg-[#1c5026]" : "bg-gray-300"
                            }`}
                          >
                            <span
                              className={`block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                                isOn ? "translate-x-3" : "translate-x-0"
                              }`}
                            />
                          </span>
                          <span className="text-xs text-muted-foreground">{isOn ? "Enabled" : "Disabled"}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
                {providerStatuses.length === 0 && !loadingProviders && (
                  <div className="col-span-full text-xs text-muted-foreground">
                    Click &quot;Refresh Status&quot; to check provider availability.
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Toggle providers on/off. Apollo is the primary source. OpenAI and Gemini are used as fallbacks when Apollo returns no results or is disabled.
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
              <div className="text-xs text-muted-foreground">
                Optional. In Market Scan mode, service selection is ignored and the scan is driven by your criteria, revenue band, target industries and preferred contact roles.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => void runLeadGenerator(false)} disabled={generatingLeads || previewingLeads}>
                {generatingLeads ? "Generating..." : generationMode === "market-scan" ? "Generate Market Scan" : "Generate Daily Leads"}
              </Button>
              <Button variant="outline" onClick={() => void runLeadGenerator(true)} disabled={previewingLeads || generatingLeads}>
                {previewingLeads ? "Previewing..." : "Preview Matches"}
              </Button>
              <Button variant="outline" onClick={() => void enrichVisibleLeads()} disabled={enrichingLeads || visibleGeneratedLeads.length === 0}>
                {enrichingLeads ? "Enriching..." : "Enrich Visible Leads"}
              </Button>
              <Button variant="outline" onClick={() => void refreshBinWithStatus()}>
                Refresh Bin
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {generationMode === "market-scan"
                ? "Market Scan builds a broader pool of companies first, based on your criteria. Use Enrich Visible Leads as a second pass to improve buyer-role and contact detail."
                : "Daily Lead Batch generates a smaller, more targeted set using the selected criteria, keywords, score threshold, and optional service context."}
            </div>

            {previewLeads.length > 0 ? (
              <Card className="border-dashed">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Preview Matches</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    Preview results are not written to the bin. They show what would be generated using the current criteria.
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full bg-muted px-3 py-1 text-xs">
                      {visiblePreviewLeads.length} visible of {previewLeads.length} matched
                    </div>
                    <Button size="sm" onClick={() => void runLeadGenerator(false)} disabled={generatingLeads || previewingLeads}>
                      Generate These Leads
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPreviewLeads([])}>
                      Clear Preview
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {visiblePreviewLeads.slice(0, 10).map((item, index) => (
                      <div key={`${item.service_key}-${item.company_name}-${index}`} className="rounded-md border p-3">
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
                          {item.contact_name || "-"} {item.contact_role ? `(${item.contact_role})` : ""} {item.contact_email ? `| ${item.contact_email}` : ""}{" "}
                          {item.contact_phone ? `| ${item.contact_phone}` : ""}
                          {item.linkedin_url ? (
                            <>{" "}| <a href={item.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">LinkedIn</a></>
                          ) : null}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          <span className="font-medium">Why good lead: </span>
                          {item.why_good_lead || "-"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium">Trigger: </span>
                          {item.trigger_reason || "-"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium">Source: </span>
                          {item.source_provider || "open_web"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium">Score breakdown: </span>
                          {formatScoreBreakdown(item.score_breakdown)}
                        </div>
                        {item.score_breakdown?.components?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.score_breakdown.components.map((component) => (
                              <span key={component.key} className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                                {component.label}: +{Number(component.points || 0).toFixed(1)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {visiblePreviewLeads.length > 10 ? (
                      <div className="text-xs text-muted-foreground">
                        Showing first 10 preview matches. Run generation to write the full set to today&apos;s bin.
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

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
                visibleGeneratedLeads.map((item) => {
                  const generatedLeadId = item.generated_lead_id;
                  const generatedLeadKey =
                    generatedLeadId !== null && generatedLeadId !== undefined ? String(generatedLeadId) : "";
                  return (
                  <div key={item.generated_lead_id ?? item.company_name} className="rounded-md border p-3">
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
                      {item.linkedin_url ? (
                        <>{" "}| <a href={item.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">LinkedIn</a></>
                      ) : null}
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
                      <span className="font-medium">Source: </span>
                      {item.source_provider || "open_web"}
                    </div>
                    <div className="text-xs">
                      <span className="font-medium">Score breakdown: </span>
                      {formatScoreBreakdown(item.score_breakdown)}
                    </div>
                    {item.score_breakdown?.components?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.score_breakdown.components.map((component) => (
                          <span key={component.key} className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                            {component.label}: +{Number(component.points || 0).toFixed(1)}
                          </span>
                        ))}
                      </div>
                    ) : null}
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
                      {item.qualification_status === "new" && generatedLeadId !== null && generatedLeadId !== undefined ? (
                        <>
                          <select
                            className="rounded border px-2 py-1 text-xs"
                            value={binReasonByLead[generatedLeadKey] || ""}
                             onChange={(e) =>
                               setBinReasonByLead((prev) => ({ ...prev, [generatedLeadKey]: e.target.value }))
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
                            const selectedReasonId = binReasonByLead[generatedLeadKey] || "";
                            const selectedReason = binReasons.find((r) => String(r.bin_reason_id) === String(selectedReasonId));
                            if (selectedReason?.name?.toLowerCase() !== "other") return null;
                            return (
                              <Input
                                className="max-w-xs"
                                placeholder="Reason note"
                                value={binNoteByLead[generatedLeadKey] || ""}
                                onChange={(e) =>
                                  setBinNoteByLead((prev) => ({ ...prev, [generatedLeadKey]: e.target.value }))
                                }
                              />
                            );
                          })()}
                          <Button size="sm" onClick={() => void qualifyAIGeneratedLead(generatedLeadId, "funnel")}>
                            Send to Funnel
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void qualifyAIGeneratedLead(generatedLeadId, "binned")}>
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
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
        ) : null}

        {activeSection === "market-database" ? (
        <Card>
          <CardHeader>
            <CardTitle>Market Database</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs text-muted-foreground">Search</label>
                <Input
                  value={marketSearch}
                  onChange={(e) => {
                    setMarketSearch(e.target.value);
                    setMarketPage(1);
                  }}
                  placeholder="Company, role, website, industry..."
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Industry Filter</label>
                <Input
                  value={marketIndustryFilter}
                  onChange={(e) => {
                    setMarketIndustryFilter(e.target.value);
                    setMarketPage(1);
                  }}
                  placeholder="Construction"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Status Filter</label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={marketStatusFilter}
                  onChange={(e) => {
                    setMarketStatusFilter(e.target.value);
                    setMarketPage(1);
                  }}
                >
                  <option value="">All</option>
                  <option value="new">New</option>
                  <option value="funnel">Funnel</option>
                  <option value="binned">Binned</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <div>{marketDatabase.total} total records</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setMarketPage((p) => Math.max(1, p - 1))} disabled={marketPage <= 1}>
                  Previous
                </Button>
                <span>Page {marketPage}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMarketPage((p) => p + 1)}
                  disabled={marketDatabase.offset + marketDatabase.limit >= marketDatabase.total}
                >
                  Next
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {marketDatabase.items.length === 0 ? (
                <div className="text-sm text-muted-foreground">No market database records match the current filters.</div>
              ) : (
                marketDatabase.items.map((item) => (
                  <div key={`db-${item.market_company_id}`} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{item.company_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.service_key || "market-scan"} | {item.industry || "-"} | {item.city ? `${item.city}, ` : ""}{item.country || "-"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Revenue band</div>
                        <div className="font-semibold">{item.revenue_band_label || "-"}</div>
                      </div>
                    </div>
                    <div className="text-xs">
                      <span className="font-medium">Revenue: </span>
                      {item.revenue_gbp_millions ? `GBP ${item.revenue_gbp_millions.toFixed(1)}m` : "-"}
                    </div>
                    <div className="text-xs">
                      <span className="font-medium">Region: </span>
                      {item.region || item.country || "-"}
                    </div>
                    <div className="text-xs">
                      <span className="font-medium">Status: </span>
                      {item.qualification_status}
                    </div>
                    {item.domain ? (
                      <div className="text-xs">
                        <span className="font-medium">Domain: </span>
                        {item.domain}
                      </div>
                    ) : null}
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
