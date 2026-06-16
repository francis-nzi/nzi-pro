"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, Loader2, Play, RefreshCw, Save, Search, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl } from "@/lib/auth-client";
import {
  PROMPT_FAMILIES,
  promptFamilyLabel,
  promptKeyFor,
  promptSectionLabel,
  type PromptFamilyKey,
  type PromptSectionKey,
} from "@/lib/ai-prompts";

type TemplateRow = {
  template_id: number;
  org_id: string;
  prompt_key: string;
  report_family_key: string;
  section_key: string;
  name: string;
  description: string;
  scope: string;
  system_prompt: string;
  user_prompt: string;
  variables_json: Record<string, unknown>;
  model_hint: string;
  temperature: number | null;
  status: string;
  version: number;
  parent_template_id: number | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type ClientOption = {
  client_db_id: number;
  client_name: string;
  industry?: string | null;
  status?: string | null;
  crm_owner?: string | null;
};

type ClientProfile = {
  profile_id: number;
  org_id: string;
  client_db_id: number;
  profile_name: string;
  industry_context: string;
  company_context: string;
  tone: string;
  audience_notes: string;
  preferred_terms_json: Record<string, unknown> | unknown[];
  forbidden_terms_json: Record<string, unknown> | unknown[];
  narrative_notes: string;
  section_notes_json: Record<string, unknown>;
  status: string;
  version: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

type JobOption = {
  job_id: number;
  job_number?: string | null;
  title?: string | null;
  client_name?: string | null;
  crm_name?: string | null;
};

type JobOverride = {
  override_id: number;
  org_id: string;
  job_id: number;
  report_family_key: string;
  section_key: string;
  override_title: string;
  instruction_text: string;
  variables_json: Record<string, unknown>;
  status: string;
  version: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

type PromptRun = {
  run_id: number;
  client_db_id: number | null;
  job_id: number | null;
  prompt_template_id: number | null;
  client_prompt_profile_id: number | null;
  job_prompt_override_id: number | null;
  report_family_key: string;
  section_key: string;
  provider: string | null;
  model_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_estimate: string | null;
  resolved_system_prompt: string | null;
  resolved_user_prompt: string | null;
  input_facts_json: Record<string, unknown> | null;
  output_text: string | null;
  output_json: unknown;
  status: string | null;
  started_at: string | null;
  streaming_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type PromptPreviewResult = {
  system_prompt: string;
  user_prompt: string;
  metadata: Record<string, unknown>;
  warnings: string[];
  resolved_versions: Record<string, unknown>;
};

type RunOutput = {
  run: {
    insights?: string;
    structured?: {
      summary?: string;
      confidence?: string;
      top_drivers?: Array<Record<string, string>>;
      risks?: Array<Record<string, string>>;
      recommended_actions?: Array<Record<string, string>>;
      data_gaps?: string[];
    };
    citations?: Array<{ label: string; value: string; source: string }>;
    prompt_warnings?: string[];
  };
  report_family_key: string;
  section_key: string;
};

const DEFAULT_TEMPLATE_FORM = {
  promptKey: "",
  reportFamilyKey: "crp" as PromptFamilyKey,
  sectionKey: "executive_summary" as PromptSectionKey,
  name: "",
  description: "",
  scope: "global",
  systemPrompt: "",
  userPrompt: "",
  variablesJson: "{}",
  modelHint: "",
  temperature: "0.4",
  status: "draft",
};

const DEFAULT_PROFILE_FORM = {
  profileName: "",
  industryContext: "",
  companyContext: "",
  tone: "",
  audienceNotes: "",
  preferredTermsJson: "{}",
  forbiddenTermsJson: "{}",
  narrativeNotes: "",
  sectionNotesJson: "{}",
  status: "draft",
};

const DEFAULT_OVERRIDE_FORM = {
  reportFamilyKey: "crp" as PromptFamilyKey,
  sectionKey: "executive_summary" as PromptSectionKey,
  overrideTitle: "",
  instructionText: "",
  variablesJson: "{}",
  status: "draft",
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function parseJsonField(text: string): { value: unknown; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: {}, error: null };
  }
  try {
    return { value: JSON.parse(trimmed), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : "Invalid JSON" };
  }
}

function groupLatestTemplates(rows: TemplateRow[]): TemplateRow[] {
  const grouped = new Map<string, TemplateRow>();
  for (const row of rows) {
    const groupKey = `${row.org_id}::${row.prompt_key}`;
    const current = grouped.get(groupKey);
    if (!current) {
      grouped.set(groupKey, row);
      continue;
    }
    const rowIsActive = row.status.toLowerCase() === "active";
    const currentIsActive = current.status.toLowerCase() === "active";
    if (
      (rowIsActive && !currentIsActive) ||
      (rowIsActive === currentIsActive && (row.version > current.version || (row.version === current.version && row.template_id > current.template_id)))
    ) {
      grouped.set(groupKey, row);
    }
  }
  return Array.from(grouped.values()).sort((a, b) =>
    `${a.org_id}:${a.prompt_key}`.localeCompare(`${b.org_id}:${b.prompt_key}`)
  );
}

function familySections(familyKey: string): PromptSectionKey[] {
  return PROMPT_FAMILIES.find((family) => family.key === familyKey)?.sections || PROMPT_FAMILIES[0].sections;
}

export default function AiPromptsAdminPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("templates");

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateVersions, setTemplateVersions] = useState<TemplateRow[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateStatus, setTemplateStatus] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templateForm, setTemplateForm] = useState(DEFAULT_TEMPLATE_FORM);

  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  const [profileForm, setProfileForm] = useState(DEFAULT_PROFILE_FORM);
  const [clientStatus, setClientStatus] = useState("");
  const [clientLoading, setClientLoading] = useState(false);

  const [jobSearch, setJobSearch] = useState("");
  const [jobResults, setJobResults] = useState<JobOption[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [jobOverrides, setJobOverrides] = useState<JobOverride[]>([]);
  const [overrideForm, setOverrideForm] = useState(DEFAULT_OVERRIDE_FORM);
  const [jobStatus, setJobStatus] = useState("");
  const [jobLoading, setJobLoading] = useState(false);

  const [previewFamilyKey, setPreviewFamilyKey] = useState<PromptFamilyKey>("crp");
  const [previewSectionKey, setPreviewSectionKey] = useState<PromptSectionKey>("executive_summary");
  const [previewTemplateId, setPreviewTemplateId] = useState<string>("");
  const [previewClientId, setPreviewClientId] = useState<string>("");
  const [previewJobId, setPreviewJobId] = useState<string>("");
  const [previewFacts, setPreviewFacts] = useState("{}");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("");
  const [previewResult, setPreviewResult] = useState<PromptPreviewResult | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [runResult, setRunResult] = useState<RunOutput | null>(null);
  const [runProvider, setRunProvider] = useState<string>("anthropic");

  const [runs, setRuns] = useState<PromptRun[]>([]);
  const [runFilters, setRunFilters] = useState({
    clientDbId: "",
    jobId: "",
    sectionKey: "",
    limit: "25",
  });
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsStatus, setRunsStatus] = useState("");

  const activeFamilySections = useMemo(() => familySections(templateForm.reportFamilyKey), [templateForm.reportFamilyKey]);
  const activePreviewSections = useMemo(() => familySections(previewFamilyKey), [previewFamilyKey]);

  const loadTemplates = useCallback(async () => {
    setTemplateLoading(true);
    try {
      const res = await fetch(apiUrl("/ai-prompts/templates"), { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load templates (${res.status})`);
      const json = await res.json();
      setTemplates(Array.isArray(json?.templates) ? json.templates : []);
    } catch (err) {
      setTemplateStatus(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  const loadTemplateVersions = useCallback(async (templateId: number) => {
    try {
      const res = await fetch(apiUrl(`/ai-prompts/templates/${templateId}/versions`), { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load template versions (${res.status})`);
      const json = await res.json();
      setTemplateVersions(Array.isArray(json?.templates) ? json.templates : []);
    } catch (err) {
      setTemplateStatus(err instanceof Error ? err.message : "Failed to load template versions");
      setTemplateVersions([]);
    }
  }, []);

  const loadClientProfile = useCallback(async (clientDbId: number) => {
    setClientLoading(true);
    try {
      const res = await fetch(apiUrl(`/clients/${clientDbId}/ai-prompt-profile`), { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load client profile (${res.status})`);
      const json = await res.json();
      const profile: ClientProfile | null = json?.profile || null;
      setClientProfile(profile);
      if (profile) {
        setProfileForm({
          profileName: profile.profile_name || "",
          industryContext: profile.industry_context || "",
          companyContext: profile.company_context || "",
          tone: profile.tone || "",
          audienceNotes: profile.audience_notes || "",
          preferredTermsJson: prettyJson(profile.preferred_terms_json),
          forbiddenTermsJson: prettyJson(profile.forbidden_terms_json),
          narrativeNotes: profile.narrative_notes || "",
          sectionNotesJson: prettyJson(profile.section_notes_json),
          status: profile.status || "draft",
        });
      } else {
        setProfileForm(DEFAULT_PROFILE_FORM);
      }
      setClientStatus(profile ? `Loaded profile version ${profile.version}` : "No profile found. Create one to seed client context.");
    } catch (err) {
      setClientStatus(err instanceof Error ? err.message : "Failed to load client profile");
      setClientProfile(null);
      setProfileForm(DEFAULT_PROFILE_FORM);
    } finally {
      setClientLoading(false);
    }
  }, []);

  const loadJobOverrides = useCallback(async (jobId: number) => {
    setJobLoading(true);
    try {
      const res = await fetch(apiUrl(`/jobs/${jobId}/ai-prompt-overrides`), { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load job overrides (${res.status})`);
      const json = await res.json();
      const overrides: JobOverride[] = Array.isArray(json?.overrides) ? json.overrides : [];
      setJobOverrides(overrides);
      setJobStatus(overrides.length ? `Loaded ${overrides.length} overrides` : "No overrides found for this job.");
    } catch (err) {
      setJobStatus(err instanceof Error ? err.message : "Failed to load job overrides");
      setJobOverrides([]);
    } finally {
      setJobLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (filters = { clientDbId: "", jobId: "", sectionKey: "", limit: "25" }) => {
    setRunsLoading(true);
    setRunsStatus("");
    try {
      const params = new URLSearchParams();
      if (filters.clientDbId.trim()) params.set("client_db_id", filters.clientDbId.trim());
      if (filters.jobId.trim()) params.set("job_id", filters.jobId.trim());
      if (filters.sectionKey.trim()) params.set("section_key", filters.sectionKey.trim());
      if (filters.limit.trim()) params.set("limit", filters.limit.trim());
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(apiUrl(`/ai-prompts/runs${suffix}`), { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load runs (${res.status})`);
      const json = await res.json();
      setRuns(Array.isArray(json?.runs) ? json.runs : []);
    } catch (err) {
      setRunsStatus(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    const clientParam = searchParams.get("client");
    const jobParam = searchParams.get("job");

    if (clientParam) {
      const id = Number(clientParam);
      if (!Number.isNaN(id)) {
        setActiveTab("clients");
        setSelectedClientId(id);
        setRunFilters((prev) => ({ ...prev, clientDbId: String(id) }));
        void loadClientProfile(id);
      }
    }

    if (jobParam) {
      const id = Number(jobParam);
      if (!Number.isNaN(id)) {
        setActiveTab("jobs");
        setSelectedJobId(id);
        setRunFilters((prev) => ({ ...prev, jobId: String(id) }));
        void loadJobOverrides(id);
      }
    }
  }, [loadClientProfile, loadJobOverrides, searchParams]);

  useEffect(() => {
    if (!selectedTemplateId) return;
    void loadTemplateVersions(selectedTemplateId);
  }, [loadTemplateVersions, selectedTemplateId]);

  const latestTemplates = useMemo(() => groupLatestTemplates(templates), [templates]);

  async function searchClients() {
    setClientStatus("");
    try {
      const params = new URLSearchParams();
      if (clientSearch.trim()) params.set("q", clientSearch.trim());
      params.set("limit", "20");
      const res = await fetch(apiUrl(`/clients?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to search clients (${res.status})`);
      const json = await res.json();
      setClientResults(Array.isArray(json?.items) ? json.items : []);
      setClientStatus(`Loaded ${Array.isArray(json?.items) ? json.items.length : 0} client(s)`);
    } catch (err) {
      setClientStatus(err instanceof Error ? err.message : "Failed to search clients");
    }
  }

  async function searchJobs() {
    setJobStatus("");
    try {
      const params = new URLSearchParams();
      if (jobSearch.trim()) params.set("q", jobSearch.trim());
      params.set("limit", "20");
      const res = await fetch(apiUrl(`/jobs?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to search jobs (${res.status})`);
      const json = await res.json();
      setJobResults(Array.isArray(json?.items) ? json.items : []);
      setJobStatus(`Loaded ${Array.isArray(json?.items) ? json.items.length : 0} job(s)`);
    } catch (err) {
      setJobStatus(err instanceof Error ? err.message : "Failed to search jobs");
    }
  }

  function loadTemplateIntoForm(row: TemplateRow) {
    setSelectedTemplateId(row.template_id);
    setPreviewTemplateId(String(row.template_id));
    setTemplateForm({
      promptKey: row.prompt_key || promptKeyFor(row.report_family_key, row.section_key),
      reportFamilyKey: row.report_family_key as PromptFamilyKey,
      sectionKey: row.section_key as PromptSectionKey,
      name: row.name || "",
      description: row.description || "",
      scope: row.scope || "global",
      systemPrompt: row.system_prompt || "",
      userPrompt: row.user_prompt || "",
      variablesJson: prettyJson(row.variables_json),
      modelHint: row.model_hint || "",
      temperature: row.temperature !== null && row.temperature !== undefined ? String(row.temperature) : "",
      status: row.status || "draft",
    });
    void loadTemplateVersions(row.template_id);
  }

  async function saveTemplate() {
    setTemplateStatus("");
    const variables = parseJsonField(templateForm.variablesJson);
    if (variables.error) {
      setTemplateStatus(`Template variables JSON error: ${variables.error}`);
      return;
    }
    const temperature = templateForm.temperature.trim() ? Number(templateForm.temperature) : null;
    if (templateForm.temperature.trim() && Number.isNaN(temperature)) {
      setTemplateStatus("Template temperature must be a valid number");
      return;
    }
    const payload = {
      prompt_key: templateForm.promptKey.trim() || promptKeyFor(templateForm.reportFamilyKey, templateForm.sectionKey),
      report_family_key: templateForm.reportFamilyKey,
      section_key: templateForm.sectionKey,
      name: templateForm.name.trim(),
      description: templateForm.description.trim() || null,
      scope: templateForm.scope,
      system_prompt: templateForm.systemPrompt,
      user_prompt: templateForm.userPrompt,
      variables_json: variables.value as Record<string, unknown> | null,
      model_hint: templateForm.modelHint.trim() || null,
      temperature,
      status: templateForm.status,
    };
    try {
      const res = await fetch(apiUrl("/ai-prompts/templates"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to save template (${res.status})`);
      }
      const json = await res.json();
      const template: TemplateRow | null = json?.template || null;
      setTemplateStatus(template ? `Saved template version ${template.version}` : "Template saved");
      await loadTemplates();
      if (template) {
        setSelectedTemplateId(template.template_id);
        await loadTemplateVersions(template.template_id);
      }
    } catch (err) {
      setTemplateStatus(err instanceof Error ? err.message : "Failed to save template");
    }
  }

  async function activateTemplate(templateId: number) {
    try {
      const res = await fetch(apiUrl(`/ai-prompts/templates/${templateId}/activate`), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to activate template (${res.status})`);
      setTemplateStatus(`Activated template ${templateId}`);
      await loadTemplates();
      if (selectedTemplateId) {
        await loadTemplateVersions(selectedTemplateId);
      }
    } catch (err) {
      setTemplateStatus(err instanceof Error ? err.message : "Failed to activate template");
    }
  }

  function handleClientSelect(value: string) {
    const id = Number(value);
    setSelectedClientId(Number.isNaN(id) ? null : id);
    setRunFilters((prev) => ({ ...prev, clientDbId: value }));
    if (!Number.isNaN(id)) {
      void loadClientProfile(id);
    }
  }

  function handleJobSelect(value: string) {
    const id = Number(value);
    setSelectedJobId(Number.isNaN(id) ? null : id);
    setRunFilters((prev) => ({ ...prev, jobId: value }));
    if (!Number.isNaN(id)) {
      void loadJobOverrides(id);
    }
  }

  async function saveClientProfile() {
    if (!selectedClientId) {
      setClientStatus("Select a client first");
      return;
    }
    setClientStatus("");
    const preferredTerms = parseJsonField(profileForm.preferredTermsJson);
    const forbiddenTerms = parseJsonField(profileForm.forbiddenTermsJson);
    const sectionNotes = parseJsonField(profileForm.sectionNotesJson);
    if (preferredTerms.error) {
      setClientStatus(`Preferred terms JSON error: ${preferredTerms.error}`);
      return;
    }
    if (forbiddenTerms.error) {
      setClientStatus(`Forbidden terms JSON error: ${forbiddenTerms.error}`);
      return;
    }
    if (sectionNotes.error) {
      setClientStatus(`Section notes JSON error: ${sectionNotes.error}`);
      return;
    }
    const payload = {
      profile_name: profileForm.profileName.trim() || `Client ${selectedClientId} prompt profile`,
      industry_context: profileForm.industryContext.trim() || null,
      company_context: profileForm.companyContext.trim() || null,
      tone: profileForm.tone.trim() || null,
      audience_notes: profileForm.audienceNotes.trim() || null,
      preferred_terms_json: preferredTerms.value,
      forbidden_terms_json: forbiddenTerms.value,
      narrative_notes: profileForm.narrativeNotes.trim() || null,
      section_notes_json: sectionNotes.value,
      status: profileForm.status,
    };
    try {
      const res = await fetch(apiUrl(`/clients/${selectedClientId}/ai-prompt-profile`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to save profile (${res.status})`);
      }
      const json = await res.json();
      const profile: ClientProfile | null = json?.profile || null;
      setClientProfile(profile);
      setClientStatus(profile ? `Saved profile version ${profile.version}` : "Client profile saved");
      if (selectedClientId) {
        await loadClientProfile(selectedClientId);
      }
    } catch (err) {
      setClientStatus(err instanceof Error ? err.message : "Failed to save client profile");
    }
  }

  function loadOverrideSnapshot(override: JobOverride) {
    setOverrideForm({
      reportFamilyKey: override.report_family_key as PromptFamilyKey,
      sectionKey: override.section_key as PromptSectionKey,
      overrideTitle: override.override_title || "",
      instructionText: override.instruction_text || "",
      variablesJson: prettyJson(override.variables_json),
      status: override.status || "draft",
    });
  }

  async function saveJobOverride() {
    if (!selectedJobId) {
      setJobStatus("Select a job first");
      return;
    }
    setJobStatus("");
    const variables = parseJsonField(overrideForm.variablesJson);
    if (variables.error) {
      setJobStatus(`Override variables JSON error: ${variables.error}`);
      return;
    }
    const payload = {
      report_family_key: overrideForm.reportFamilyKey,
      section_key: overrideForm.sectionKey,
      override_title: overrideForm.overrideTitle.trim() || `${promptFamilyLabel(overrideForm.reportFamilyKey)} ${promptSectionLabel(overrideForm.sectionKey)}`,
      instruction_text: overrideForm.instructionText.trim() || null,
      variables_json: variables.value as Record<string, unknown> | null,
      status: overrideForm.status,
    };
    try {
      const res = await fetch(apiUrl(`/jobs/${selectedJobId}/ai-prompt-overrides`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to save override (${res.status})`);
      }
      const json = await res.json();
      const override: JobOverride | null = json?.override || null;
      setJobStatus(override ? `Saved override version ${override.version}` : "Job override saved");
      if (selectedJobId) {
        await loadJobOverrides(selectedJobId);
      }
    } catch (err) {
      setJobStatus(err instanceof Error ? err.message : "Failed to save job override");
    }
  }

  async function runPreview() {
    setPreviewLoading(true);
    setPreviewStatus("");
    setPreviewResult(null);
    const facts = parseJsonField(previewFacts);
    if (facts.error) {
      setPreviewStatus(`Facts JSON error: ${facts.error}`);
      setPreviewLoading(false);
      return;
    }
    const templateId = previewTemplateId.trim() ? Number(previewTemplateId.trim()) : null;
    const clientDbId = previewClientId.trim() ? Number(previewClientId.trim()) : null;
    const jobId = previewJobId.trim() ? Number(previewJobId.trim()) : null;
    if (templateId !== null && Number.isNaN(templateId)) {
      setPreviewStatus("Template id must be a valid number");
      setPreviewLoading(false);
      return;
    }
    if (clientDbId !== null && Number.isNaN(clientDbId)) {
      setPreviewStatus("Client id must be a valid number");
      setPreviewLoading(false);
      return;
    }
    if (jobId !== null && Number.isNaN(jobId)) {
      setPreviewStatus("Job id must be a valid number");
      setPreviewLoading(false);
      return;
    }
    try {
      const payload = {
        report_family_key: previewFamilyKey,
        section_key: previewSectionKey,
        client_db_id: clientDbId,
        job_id: jobId,
        template_id: templateId,
        facts: facts.value as Record<string, unknown> | null,
      };
      const res = await fetch(apiUrl("/ai-prompts/preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to preview (${res.status})`);
      }
      const json = await res.json();
      const compiled: PromptPreviewResult | null = json?.compiled_prompt || null;
      setPreviewResult(compiled);
      setPreviewStatus(compiled ? "Preview resolved successfully" : "Preview completed");
    } catch (err) {
      setPreviewStatus(err instanceof Error ? err.message : "Failed to preview prompt");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function refreshRuns() {
    await loadRuns(runFilters);
  }

  async function activateProfile(profileId: number) {
    if (!selectedClientId) return;
    setClientStatus("");
    try {
      const res = await fetch(
        apiUrl(`/clients/${selectedClientId}/ai-prompt-profile/${profileId}/activate`),
        { method: "POST", credentials: "include" }
      );
      if (!res.ok) throw new Error(`Failed to activate profile (${res.status})`);
      setClientStatus(`Activated profile ${profileId}`);
      await loadClientProfile(selectedClientId);
    } catch (err) {
      setClientStatus(err instanceof Error ? err.message : "Failed to activate profile");
    }
  }

  async function runPrompt() {
    setRunLoading(true);
    setRunStatus("");
    setRunResult(null);
    const clientDbId = previewClientId.trim() ? Number(previewClientId.trim()) : null;
    const jobId = previewJobId.trim() ? Number(previewJobId.trim()) : null;
    const templateId = previewTemplateId.trim() ? Number(previewTemplateId.trim()) : null;
    try {
      const payload = {
        report_family_key: previewFamilyKey,
        section_key: previewSectionKey,
        client_db_id: clientDbId,
        job_id: jobId,
        template_id: templateId,
        provider: runProvider,
      };
      const res = await fetch(apiUrl("/ai-prompts/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Run failed (${res.status})`);
      }
      const json = await res.json();
      setRunResult(json as RunOutput);
      setRunStatus("Run completed");
      await loadRuns(runFilters);
    } catch (err) {
      setRunStatus(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunLoading(false);
    }
  }

  const displayTemplateRows = latestTemplates;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(242,102,36,0.10),_transparent_28%),linear-gradient(180deg,_#fdfbf8_0%,_#ffffff_28%)]">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="overflow-hidden rounded-[2rem] border border-orange-100/70 bg-white/90 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="border-b border-slate-200/70 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">Admin Center</Badge>
                  <Badge variant="outline" className="border-orange-200 text-orange-700">
                    AI prompt governance
                  </Badge>
                </div>
                <div>
                  <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">AI Prompts</h1>
                  <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                    Build reusable prompt templates, layer client context on top, and preview the exact prompt stack
                    before any AI-generated insight or report section is produced.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full border-slate-200 px-3 py-1">
                  {templates.length} template rows
                </Badge>
                <Badge variant="outline" className="rounded-full border-slate-200 px-3 py-1">
                  {runs.length} recent runs
                </Badge>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 sm:px-8">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-6 flex w-full flex-wrap justify-start gap-2 bg-slate-100/80 p-1">
                <TabsTrigger value="templates" className="rounded-full px-4">Templates</TabsTrigger>
                <TabsTrigger value="profiles" className="rounded-full px-4">Client Profiles</TabsTrigger>
                <TabsTrigger value="overrides" className="rounded-full px-4">Job Overrides</TabsTrigger>
                <TabsTrigger value="preview" className="rounded-full px-4">Preview</TabsTrigger>
                <TabsTrigger value="runs" className="rounded-full px-4">Run History</TabsTrigger>
              </TabsList>

              <TabsContent value="templates" className="space-y-6">
                <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle>Global prompt templates</CardTitle>
                          <CardDescription>
                            One reusable template per section. Create a new version by saving the same prompt key again.
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className="rounded-full border-slate-200 px-3 py-1">
                          {displayTemplateRows.length} current rows
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {templateLoading ? <div className="text-sm text-slate-500">Loading templates...</div> : null}
                      {templateStatus ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{templateStatus}</div> : null}
                      <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="max-h-[430px] overflow-auto">
                          <table className="w-full border-collapse text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-[0.15em] text-slate-500">
                              <tr>
                                <th className="px-4 py-3">Prompt</th>
                                <th className="px-4 py-3">Scope</th>
                                <th className="px-4 py-3">Version</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Updated</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayTemplateRows.map((row) => {
                                const active = row.status.toLowerCase() === "active";
                                return (
                                  <tr key={row.template_id} className="border-t border-slate-200/70">
                                    <td className="px-4 py-3">
                                      <div className="font-medium text-slate-900">{row.prompt_key}</div>
                                      <div className="text-xs text-slate-500">
                                        {promptFamilyLabel(row.report_family_key)} · {promptSectionLabel(row.section_key)}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <Badge variant="outline" className="rounded-full">
                                        {row.org_id === "global" ? "Global" : "Organisation"}
                                      </Badge>
                                    </td>
                                    <td className="px-4 py-3">v{row.version}</td>
                                    <td className="px-4 py-3">
                                      <Badge variant={active ? "default" : "outline"} className="rounded-full">
                                        {row.status}
                                      </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600">{fmtDate(row.updated_at)}</td>
                                    <td className="px-4 py-3">
                                      <div className="flex justify-end gap-2">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => loadTemplateIntoForm(row)}
                                        >
                                          Load
                                        </Button>
                                        {!active ? (
                                          <Button size="sm" onClick={() => activateTemplate(row.template_id)}>
                                            Activate
                                          </Button>
                                        ) : null}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              {!displayTemplateRows.length ? (
                                <tr>
                                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                                    No templates available yet.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <WandSparkles className="h-4 w-4 text-[#1c5026]" />
                          Version history
                        </div>
                        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                          <div className="max-h-[240px] overflow-auto">
                            <table className="w-full border-collapse text-sm">
                              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-[0.15em] text-slate-500">
                              <tr>
                                  <th className="px-4 py-3">Version</th>
                                  <th className="px-4 py-3">Current</th>
                                  <th className="px-4 py-3">Status</th>
                                  <th className="px-4 py-3">Updated</th>
                                  <th className="px-4 py-3">Prompt Key</th>
                                </tr>
                              </thead>
                              <tbody>
                                {templateVersions.map((row) => (
                                  <tr key={row.template_id} className="border-t border-slate-200/70">
                                    <td className="px-4 py-3">v{row.version}</td>
                                    <td className="px-4 py-3">
                                      {row.status.toLowerCase() === "active" ? (
                                        <Badge variant="default" className="rounded-full">
                                          Active
                                        </Badge>
                                      ) : (
                                        <span className="text-slate-400">-</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">{row.status}</td>
                                    <td className="px-4 py-3 text-slate-600">{fmtDate(row.updated_at)}</td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{row.prompt_key}</td>
                                  </tr>
                                ))}
                                {!templateVersions.length ? (
                                  <tr>
                                    <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                                      Load a template to see its version history.
                                    </td>
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>{selectedTemplateId ? "Edit template version" : "Create template version"}</CardTitle>
                      <CardDescription>
                        Use the same prompt key to create the next version of a template. Existing PDF/report flows are not touched.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Report family</Label>
                          <Select
                            value={templateForm.reportFamilyKey}
                            onValueChange={(value) =>
                              setTemplateForm((prev) => ({
                                ...prev,
                                reportFamilyKey: value as PromptFamilyKey,
                                sectionKey: familySections(value)[0],
                                promptKey: prev.promptKey.trim() || promptKeyFor(value, familySections(value)[0]),
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a family" />
                            </SelectTrigger>
                            <SelectContent>
                              {PROMPT_FAMILIES.map((family) => (
                                <SelectItem key={family.key} value={family.key}>
                                  {family.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Section</Label>
                          <Select
                            value={templateForm.sectionKey}
                            onValueChange={(value) =>
                              setTemplateForm((prev) => ({
                                ...prev,
                                sectionKey: value as PromptSectionKey,
                                promptKey: prev.promptKey.trim() || promptKeyFor(prev.reportFamilyKey, value),
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a section" />
                            </SelectTrigger>
                            <SelectContent>
                              {activeFamilySections.map((section) => (
                                <SelectItem key={section} value={section}>
                                  {promptSectionLabel(section)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Prompt key</Label>
                        <Input
                          value={templateForm.promptKey}
                          onChange={(e) => setTemplateForm((prev) => ({ ...prev, promptKey: e.target.value }))}
                          placeholder={promptKeyFor(templateForm.reportFamilyKey, templateForm.sectionKey)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                          value={templateForm.name}
                          onChange={(e) => setTemplateForm((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="Executive Summary v1"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Input
                          value={templateForm.description}
                          onChange={(e) => setTemplateForm((prev) => ({ ...prev, description: e.target.value }))}
                          placeholder="Short description of the template purpose"
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Scope</Label>
                          <Select
                            value={templateForm.scope}
                            onValueChange={(value) => setTemplateForm((prev) => ({ ...prev, scope: value }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select scope" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="global">Global</SelectItem>
                              <SelectItem value="org">Organisation</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Status</Label>
                          <Select
                            value={templateForm.status}
                            onValueChange={(value) => setTemplateForm((prev) => ({ ...prev, status: value }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="draft">Draft</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Model hint</Label>
                        <Input
                          value={templateForm.modelHint}
                          onChange={(e) => setTemplateForm((prev) => ({ ...prev, modelHint: e.target.value }))}
                          placeholder="gpt-4.1-mini"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Temperature</Label>
                        <Input
                          type="number"
                          min="0"
                          max="2"
                          step="0.1"
                          value={templateForm.temperature}
                          onChange={(e) => setTemplateForm((prev) => ({ ...prev, temperature: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>System prompt</Label>
                        <Textarea
                          rows={8}
                          value={templateForm.systemPrompt}
                          onChange={(e) => setTemplateForm((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                          placeholder="Instruction block that sets the model's role and standards."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>User prompt</Label>
                        <Textarea
                          rows={10}
                          value={templateForm.userPrompt}
                          onChange={(e) => setTemplateForm((prev) => ({ ...prev, userPrompt: e.target.value }))}
                          placeholder="Prompt body with placeholders like {{client_name}} and {{reporting_period}}."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Variables JSON</Label>
                        <Textarea
                          rows={7}
                          value={templateForm.variablesJson}
                          onChange={(e) => setTemplateForm((prev) => ({ ...prev, variablesJson: e.target.value }))}
                          placeholder='{"client_name":"Acme Ltd","reporting_period":"2025"}'
                        />
                      </div>
                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button onClick={saveTemplate}>
                          <Save className="mr-2 h-4 w-4" />
                          Save new version
                        </Button>
                        {selectedTemplateId ? (
                          <Button variant="outline" onClick={() => activateTemplate(selectedTemplateId)}>
                            Activate loaded template
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          onClick={() => {
                            setTemplateForm(DEFAULT_TEMPLATE_FORM);
                            setSelectedTemplateId(null);
                            setTemplateVersions([]);
                          }}
                        >
                          Reset form
                        </Button>
                      </div>
                      {selectedTemplateId ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          Loaded template id <span className="font-medium text-slate-900">{selectedTemplateId}</span>. Save creates
                          the next version using the same prompt key.
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="profiles" className="space-y-6">
                <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Client search</CardTitle>
                      <CardDescription>
                        Find the client you want to govern, then load or create its prompt profile.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
                            placeholder="Search clients by name"
                            className="pl-9"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void searchClients();
                              }
                            }}
                          />
                        </div>
                        <Button variant="outline" onClick={searchClients}>
                          Search
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Label>Client</Label>
                        <Select value={selectedClientId ? String(selectedClientId) : ""} onValueChange={handleClientSelect}>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a client" />
                          </SelectTrigger>
                          <SelectContent>
                            {clientResults.map((client) => (
                              <SelectItem key={client.client_db_id} value={String(client.client_db_id)}>
                                {client.client_name} {client.industry ? `· ${client.industry}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {clientLoading ? <div className="text-sm text-slate-500">Loading client profile...</div> : null}
                      {clientStatus ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{clientStatus}</div> : null}
                      {clientProfile ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-slate-900">{clientProfile.profile_name}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                Version {clientProfile.version} · {fmtDate(clientProfile.updated_at)}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Badge variant={clientProfile.status === "active" ? "default" : "outline"} className="rounded-full text-xs">
                                {clientProfile.status}
                              </Badge>
                              {clientProfile.status !== "active" ? (
                                <Button size="sm" onClick={() => activateProfile(clientProfile.profile_id)}>
                                  Activate
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-3 space-y-1 text-xs">
                            <div><span className="font-medium">Tone:</span> {clientProfile.tone || "Not set"}</div>
                            <div><span className="font-medium">Industry:</span> {clientProfile.industry_context || "Not set"}</div>
                            <div><span className="font-medium">Audience:</span> {clientProfile.audience_notes || "Not set"}</div>
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Client prompt profile</CardTitle>
                      <CardDescription>
                        Layer client context on top of the global prompt templates. Saving creates a new version.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Profile name</Label>
                        <Input
                          value={profileForm.profileName}
                          onChange={(e) => setProfileForm((prev) => ({ ...prev, profileName: e.target.value }))}
                          placeholder="Client prompt profile"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Industry context</Label>
                        <Textarea
                          rows={3}
                          value={profileForm.industryContext}
                          onChange={(e) => setProfileForm((prev) => ({ ...prev, industryContext: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Company context</Label>
                        <Textarea
                          rows={3}
                          value={profileForm.companyContext}
                          onChange={(e) => setProfileForm((prev) => ({ ...prev, companyContext: e.target.value }))}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Tone</Label>
                          <Input
                            value={profileForm.tone}
                            onChange={(e) => setProfileForm((prev) => ({ ...prev, tone: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Status</Label>
                          <Select
                            value={profileForm.status}
                            onValueChange={(value) => setProfileForm((prev) => ({ ...prev, status: value }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="draft">Draft</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Audience notes</Label>
                        <Textarea
                          rows={3}
                          value={profileForm.audienceNotes}
                          onChange={(e) => setProfileForm((prev) => ({ ...prev, audienceNotes: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Preferred terms JSON</Label>
                        <Textarea
                          rows={4}
                          value={profileForm.preferredTermsJson}
                          onChange={(e) => setProfileForm((prev) => ({ ...prev, preferredTermsJson: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Forbidden terms JSON</Label>
                        <Textarea
                          rows={4}
                          value={profileForm.forbiddenTermsJson}
                          onChange={(e) => setProfileForm((prev) => ({ ...prev, forbiddenTermsJson: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Narrative notes</Label>
                        <Textarea
                          rows={5}
                          value={profileForm.narrativeNotes}
                          onChange={(e) => setProfileForm((prev) => ({ ...prev, narrativeNotes: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Section notes JSON</Label>
                        <Textarea
                          rows={6}
                          value={profileForm.sectionNotesJson}
                          onChange={(e) => setProfileForm((prev) => ({ ...prev, sectionNotesJson: e.target.value }))}
                          placeholder='{"executive_summary":"Keep concise and board-ready."}'
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={saveClientProfile} disabled={!selectedClientId}>
                          <Save className="mr-2 h-4 w-4" />
                          Save new version
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setClientProfile(null);
                            setProfileForm(DEFAULT_PROFILE_FORM);
                          }}
                        >
                          Reset form
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="overrides" className="space-y-6">
                <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Job search</CardTitle>
                      <CardDescription>
                        Select a job to inspect or add a section override.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input
                            value={jobSearch}
                            onChange={(e) => setJobSearch(e.target.value)}
                            placeholder="Search jobs by number or title"
                            className="pl-9"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void searchJobs();
                              }
                            }}
                          />
                        </div>
                        <Button variant="outline" onClick={searchJobs}>
                          Search
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Label>Job</Label>
                        <Select value={selectedJobId ? String(selectedJobId) : ""} onValueChange={handleJobSelect}>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a job" />
                          </SelectTrigger>
                          <SelectContent>
                            {jobResults.map((job) => (
                              <SelectItem key={job.job_id} value={String(job.job_id)}>
                                {job.job_number || `Job ${job.job_id}`} {job.title ? `· ${job.title}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {jobLoading ? <div className="text-sm text-slate-500">Loading overrides...</div> : null}
                      {jobStatus ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{jobStatus}</div> : null}
                      <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="max-h-[360px] overflow-auto">
                          <table className="w-full border-collapse text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-[0.15em] text-slate-500">
                              <tr>
                                <th className="px-4 py-3">Section</th>
                                <th className="px-4 py-3">Version</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {jobOverrides.map((row) => (
                                <tr key={row.override_id} className="border-t border-slate-200/70">
                                  <td className="px-4 py-3">
                                    <div className="font-medium text-slate-900">{row.override_title}</div>
                                    <div className="text-xs text-slate-500">
                                      {promptFamilyLabel(row.report_family_key)} · {promptSectionLabel(row.section_key)}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">v{row.version}</td>
                                  <td className="px-4 py-3">{row.status}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex justify-end gap-2">
                                      <Button size="sm" variant="outline" onClick={() => loadOverrideSnapshot(row)}>
                                        Load
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {!jobOverrides.length ? (
                                <tr>
                                  <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                                    No overrides loaded yet.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Job prompt override</CardTitle>
                      <CardDescription>
                        Use this for job-specific instructions that should sit on top of the client profile.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Report family</Label>
                          <Select
                            value={overrideForm.reportFamilyKey}
                            onValueChange={(value) =>
                              setOverrideForm((prev) => ({
                                ...prev,
                                reportFamilyKey: value as PromptFamilyKey,
                                sectionKey: familySections(value)[0],
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a family" />
                            </SelectTrigger>
                            <SelectContent>
                              {PROMPT_FAMILIES.map((family) => (
                                <SelectItem key={family.key} value={family.key}>
                                  {family.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Section</Label>
                          <Select
                            value={overrideForm.sectionKey}
                            onValueChange={(value) => setOverrideForm((prev) => ({ ...prev, sectionKey: value as PromptSectionKey }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a section" />
                            </SelectTrigger>
                            <SelectContent>
                              {familySections(overrideForm.reportFamilyKey).map((section) => (
                                <SelectItem key={section} value={section}>
                                  {promptSectionLabel(section)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Override title</Label>
                        <Input
                          value={overrideForm.overrideTitle}
                          onChange={(e) => setOverrideForm((prev) => ({ ...prev, overrideTitle: e.target.value }))}
                          placeholder="Board-ready executive summary"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Instruction text</Label>
                        <Textarea
                          rows={7}
                          value={overrideForm.instructionText}
                          onChange={(e) => setOverrideForm((prev) => ({ ...prev, instructionText: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Variables JSON</Label>
                        <Textarea
                          rows={6}
                          value={overrideForm.variablesJson}
                          onChange={(e) => setOverrideForm((prev) => ({ ...prev, variablesJson: e.target.value }))}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Status</Label>
                          <Select
                            value={overrideForm.status}
                            onValueChange={(value) => setOverrideForm((prev) => ({ ...prev, status: value }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="draft">Draft</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={saveJobOverride} disabled={!selectedJobId}>
                          <Save className="mr-2 h-4 w-4" />
                          Save new version
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setOverrideForm(DEFAULT_OVERRIDE_FORM);
                          }}
                        >
                          Reset form
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="preview" className="space-y-6">
                <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Prompt preview</CardTitle>
                      <CardDescription>
                        Resolve the effective prompt stack before running an AI insight or report section.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Report family</Label>
                          <Select value={previewFamilyKey} onValueChange={(value) => {
                            const next = value as PromptFamilyKey;
                            setPreviewFamilyKey(next);
                            setPreviewSectionKey(familySections(next)[0]);
                          }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PROMPT_FAMILIES.map((family) => (
                                <SelectItem key={family.key} value={family.key}>{family.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Section</Label>
                          <Select value={previewSectionKey} onValueChange={(value) => setPreviewSectionKey(value as PromptSectionKey)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {activePreviewSections.map((section) => (
                                <SelectItem key={section} value={section}>{promptSectionLabel(section)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Template id (optional)</Label>
                        <Input value={previewTemplateId} onChange={(e) => setPreviewTemplateId(e.target.value)} placeholder="Use loaded template id or leave blank" />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Client id (optional)</Label>
                          <Input value={previewClientId} onChange={(e) => setPreviewClientId(e.target.value)} placeholder="e.g. 490" />
                        </div>
                        <div className="space-y-2">
                          <Label>Job id (optional)</Label>
                          <Input value={previewJobId} onChange={(e) => setPreviewJobId(e.target.value)} placeholder="e.g. 639" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Facts JSON</Label>
                        <Textarea rows={8} value={previewFacts} onChange={(e) => setPreviewFacts(e.target.value)} />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={runPreview} disabled={previewLoading}>
                          {previewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}
                          Resolve preview
                        </Button>
                        <Button variant="outline" onClick={() => setPreviewFacts("{}")}>
                          Reset facts
                        </Button>
                      </div>
                      <div className="border-t border-slate-200 pt-4">
                        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Run prompt against live data</div>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Provider</Label>
                            <Select value={runProvider} onValueChange={setRunProvider}>
                              <SelectTrigger className="h-8 w-32 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="anthropic">Anthropic</SelectItem>
                                <SelectItem value="openai">OpenAI</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button onClick={runPrompt} disabled={runLoading} className="bg-[#1c5026] text-white hover:bg-[#163d1e]">
                            {runLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                            Run now
                          </Button>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          Calls the LLM with live client data. Only <strong>client_insights</strong> is supported here; for CRP/SECR sections open the job&apos;s report page.
                        </p>
                      </div>
                      {previewStatus ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{previewStatus}</div> : null}
                      {runStatus ? <div className={`rounded-xl border px-4 py-3 text-sm ${runStatus.startsWith("Run completed") ? "border-green-200 bg-green-50 text-green-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{runStatus}</div> : null}
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Resolved output</CardTitle>
                      <CardDescription>
                        The system prompt and user prompt shown here are what the model will actually receive.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {previewResult ? (
                        <>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                              <Bot className="h-4 w-4 text-[#1c5026]" />
                              Warnings
                            </div>
                            {previewResult.warnings.length ? (
                              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                                {previewResult.warnings.map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            ) : (
                              <div className="text-sm text-slate-600">No warnings.</div>
                            )}
                          </div>

                          <div className="space-y-2">
                            <Label>System prompt</Label>
                            <pre className="max-h-[280px] overflow-auto rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
                              {previewResult.system_prompt}
                            </pre>
                          </div>
                          <div className="space-y-2">
                            <Label>User prompt</Label>
                            <pre className="max-h-[280px] overflow-auto rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
                              {previewResult.user_prompt}
                            </pre>
                          </div>
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Resolved versions</Label>
                              <pre className="max-h-[220px] overflow-auto rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-6 text-slate-700">
                                {prettyJson(previewResult.resolved_versions)}
                              </pre>
                            </div>
                            <div className="space-y-2">
                              <Label>Metadata</Label>
                              <pre className="max-h-[220px] overflow-auto rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-6 text-slate-700">
                                {prettyJson(previewResult.metadata)}
                              </pre>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-12 text-center text-sm text-slate-500">
                          Resolve a prompt to see the compiled output here.
                        </div>
                      )}

                      {runResult ? (
                        <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <Play className="h-4 w-4 text-[#1c5026]" />
                            Run output
                          </div>
                          {runResult.run.structured?.summary ? (
                            <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-medium uppercase tracking-wide text-green-700">Summary</div>
                                {runResult.run.structured?.confidence ? (
                                  <Badge variant="outline" className="rounded-full text-xs capitalize">
                                    {runResult.run.structured.confidence} confidence
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-800">{runResult.run.structured.summary}</p>
                            </div>
                          ) : null}

                          {(runResult.run.structured?.top_drivers ?? []).length > 0 ? (
                            <div className="space-y-2">
                              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Top drivers</div>
                              <div className="space-y-2">
                                {(runResult.run.structured!.top_drivers ?? []).map((d, i) => (
                                  <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                                    <div className="font-medium text-slate-900">{d.title}</div>
                                    <div className="mt-1 text-xs text-slate-600">{d.detail}</div>
                                    {d.metric ? <div className="mt-1 text-xs text-slate-400">{d.metric}</div> : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {(runResult.run.structured?.recommended_actions ?? []).length > 0 ? (
                            <div className="space-y-2">
                              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Recommended actions</div>
                              <div className="space-y-2">
                                {(runResult.run.structured!.recommended_actions ?? []).map((a, i) => (
                                  <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-slate-900">{a.title}</span>
                                      {a.effort ? <Badge variant="outline" className="rounded-full text-xs">{a.effort}</Badge> : null}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">{a.owner} · {a.timeframe}</div>
                                    <div className="mt-1 text-xs text-slate-600">{a.rationale}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {(runResult.run.structured?.data_gaps ?? []).length > 0 ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <div className="mb-1 text-xs font-medium text-amber-700">Data gaps</div>
                              <ul className="list-disc space-y-1 pl-4 text-xs text-amber-900">
                                {(runResult.run.structured!.data_gaps ?? []).map((g, i) => <li key={i}>{g}</li>)}
                              </ul>
                            </div>
                          ) : null}

                          {(runResult.run.citations ?? []).length > 0 ? (
                            <div className="space-y-1">
                              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Citations</div>
                              {(runResult.run.citations ?? []).map((c, i) => (
                                <div key={i} className="text-xs text-slate-600">
                                  <span className="font-medium">{c.label}:</span> {c.value} <span className="text-slate-400">({c.source})</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="runs" className="space-y-6">
                <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Run filters</CardTitle>
                      <CardDescription>
                        Inspect the most recent prompt runs and compare the inputs used for each generation.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Client id</Label>
                          <Input
                            value={runFilters.clientDbId}
                            onChange={(e) => setRunFilters((prev) => ({ ...prev, clientDbId: e.target.value }))}
                            placeholder="Optional"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Job id</Label>
                          <Input
                            value={runFilters.jobId}
                            onChange={(e) => setRunFilters((prev) => ({ ...prev, jobId: e.target.value }))}
                            placeholder="Optional"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Section key</Label>
                        <Input
                          value={runFilters.sectionKey}
                          onChange={(e) => setRunFilters((prev) => ({ ...prev, sectionKey: e.target.value }))}
                          placeholder="Optional e.g. executive_summary"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Limit</Label>
                        <Input
                          type="number"
                          min="1"
                          max="200"
                          value={runFilters.limit}
                          onChange={(e) => setRunFilters((prev) => ({ ...prev, limit: e.target.value }))}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={refreshRuns}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Refresh runs
                        </Button>
                      </div>
                      {runsStatus ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{runsStatus}</div> : null}
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Recent runs</CardTitle>
                      <CardDescription>
                        A read-only trail of what prompt stack was used, by whom, and when.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="max-h-[640px] overflow-auto">
                          <table className="w-full border-collapse text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-[0.15em] text-slate-500">
                              <tr>
                                <th className="px-4 py-3">When</th>
                                <th className="px-4 py-3">Section</th>
                                <th className="px-4 py-3">Model</th>
                                <th className="px-4 py-3">Tokens</th>
                                <th className="px-4 py-3">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {runsLoading ? (
                                <tr>
                                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                                    Loading runs...
                                  </td>
                                </tr>
                              ) : runs.length ? (
                                runs.map((run) => (
                                  <tr key={run.run_id} className="border-t border-slate-200/70">
                                    <td className="px-4 py-3 text-slate-600">{fmtDate(run.created_at)}</td>
                                    <td className="px-4 py-3">
                                      <div className="font-medium text-slate-900">{promptFamilyLabel(run.report_family_key)}</div>
                                      <div className="text-xs text-slate-500">{promptSectionLabel(run.section_key)}</div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600">
                                      <div>{run.provider || "Unknown"}</div>
                                      <div className="text-xs">{run.model_name || "No model"}</div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600">
                                      {run.total_tokens ?? "-"}
                                      <div className="text-xs text-slate-500">
                                        in {run.input_tokens ?? 0} / out {run.output_tokens ?? 0}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <Badge variant="outline" className="rounded-full">
                                        {run.status || "unknown"}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                                    No runs found for the current filter.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="border-t border-slate-200/70 px-6 py-5 sm:px-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Build prompts in admin, then use the preview and run history to keep outputs explainable and reproducible.
              </p>
              <Button variant="outline" asChild className="rounded-full">
                <Link href="/admin">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Admin
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
