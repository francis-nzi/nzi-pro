"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import EmissionsSummary from "@/components/EmissionsSummary";
import ReportingElements from "@/components/ReportingElements";
import ReportVariablesPanel from "@/components/job-workspace/ReportVariablesPanel";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, CheckCircle2, ChevronDown, CircleX, FileText, Sparkles, Target } from "lucide-react";
import { apiUrl } from "@/lib/auth-client";

type ReportTemplate = {
  template_id: number;
  template_key: string;
  template_name: string;
  template_type: string;
  is_global?: boolean;
  client_db_id?: number | null;
  latest_version_id?: number | null;
  latest_version_number?: number | null;
};

type TemplateAssignment = {
  job_id: number;
  template_id: number;
  version_id: number | null;
  template_key?: string | null;
  template_name?: string | null;
  template_type?: string | null;
  version_number?: number | null;
};

type TermCountMap = Record<string, number>;

type JobActionsSummary = {
  items?: Array<Record<string, unknown>>;
  term_counts?: TermCountMap;
};

type ReportVersion = {
  report_version_id: number;
  version_number: number;
  version_label?: string | null;
  status?: string | null;
  generated_at?: string | null;
  generated_by?: string | null;
  file_id?: number | null;
  download_url?: string | null;
  snapshot_url?: string | null;
};

type ReportProfile = {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  templateKey: string;
  sections: string[];
  graphics: string[];
  statusLabel: string;
  statusTone: "ready" | "coming-soon" | "preview";
};

type DraftNotes = Record<string, string>;
type DraftOrigins = Record<string, "starter" | "local" | "ai">;
type DraftProviders = Record<string, "starter" | "manual" | "anthropic" | "openai" | "rule-based">;

type DraftWorkspaceContext = {
  job_id?: number;
  template_key?: string | null;
  context_summary?: string | null;
  job_data?: Record<string, unknown> | null;
  previous_job_data?: Record<string, unknown> | null;
  scope_totals?: Record<string, number>;
  benchmark_totals?: Record<string, number>;
  categories?: Array<Record<string, unknown>>;
  previous_categories?: Array<Record<string, unknown>>;
  job_actions?: JobActionsSummary | null;
  top_category?: { category?: string; dataset_category?: string; emissions?: number } | null;
};

type ReportDraftRow = {
  section_key?: string | null;
  section_title?: string | null;
  draft_text?: string | null;
  draft_json?: Record<string, unknown> | null;
  provider?: string | null;
  model?: string | null;
  confidence?: string | null;
  status?: string | null;
};

type DraftStoragePayload = {
  draft_notes?: DraftNotes;
  draft_origins?: DraftOrigins;
  draft_providers?: DraftProviders;
} | DraftNotes;

type JobReportNewProps = {
  jobId: number;
  baseUrl?: string;
  onOpenActions?: () => void;
  showEmissionsSummary?: boolean;
  isActive?: boolean;
};

const PROFILE_LIBRARY: ReportProfile[] = [
  {
    key: "crp_standard",
    title: "Carbon Reduction Plan",
    subtitle: "Standard",
    description: "The flagship compliance-led CRP for government and buyer-led submissions.",
    templateKey: "crp_standard",
    sections: ["Executive Summary", "Emissions Overview", "Actions", "Declaration"],
    graphics: ["Executive dashboard", "Scope donut", "Trend cards", "Action matrix"],
    statusLabel: "Ready",
    statusTone: "ready",
  },
  {
    key: "crp_basic",
    title: "Carbon Reduction Plan",
    subtitle: "Basic",
    description: "A shorter, lower-friction version for straightforward client disclosure.",
    templateKey: "crp_basic",
    sections: ["Executive Summary", "Key Emissions", "Actions", "Sign-off"],
    graphics: ["KPI strip", "Simple donut", "Action cards"],
    statusLabel: "Coming soon",
    statusTone: "coming-soon",
  },
  {
    key: "secr",
    title: "Carbon Reduction Plan",
    subtitle: "SECR",
    description: "UK SECR-oriented version with energy and compliance emphasis.",
    templateKey: "secr",
    sections: ["Executive Summary", "Energy & Emissions", "SECR Narrative", "Actions"],
    graphics: ["Energy bars", "Compliance dashboard", "Reduction pathway"],
    statusLabel: "Coming soon",
    statusTone: "coming-soon",
  },
  {
    key: "annual_carbon_report",
    title: "Annual Carbon Report",
    subtitle: "Profile-based",
    description: "A broader annual narrative for clients who need a more general report format.",
    templateKey: "annual_carbon_report",
    sections: ["Executive Summary", "Methodology", "Results", "Actions"],
    graphics: ["Scope donut", "Activity bars", "Confidence cards"],
    statusLabel: "Ready",
    statusTone: "preview",
  },
];

const SECTION_LABEL_ALIASES: Record<string, string> = {
  "Emissions Footprint": "Emissions Overview",
};

const AI_DRAFT_SECTIONS = new Set(["Executive Summary", "Emissions Overview", "Actions"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isLikelyNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.trim().toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network error") ||
    message.includes("load failed")
  );
}

function formatFriendlyFetchError(error: unknown, fallback: string): string {
  if (isLikelyNetworkFetchError(error)) {
    return fallback;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, retries = 1): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isLikelyNetworkFetchError(error)) {
        throw error;
      }
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Fetch failed");
}

function toneClass(tone: ReportProfile["statusTone"]): string {
  if (tone === "ready") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (tone === "preview") return "bg-sky-100 text-sky-800 border-sky-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

function buildInitialDraftNotes(profile: ReportProfile): DraftNotes {
  const promptMap: Record<string, string> = {
    "Executive Summary":
      "Open with the key story, the reduction direction, and 2-3 dashboard-style headline points.",
    "Emissions Overview":
      "Summarise the main emissions sources, any notable changes, and the biggest drivers to watch.",
    "Key Emissions":
      "Capture the highest-emitting activities and the quick interpretation the reader should take away.",
    "Energy & Emissions":
      "Lead with energy-led findings, any country-specific nuances, and the major operational drivers.",
    "SECR Narrative":
      "Draft the compliance language, energy context, and the key disclosures needed for SECR readers.",
    "Methodology":
      "Explain the calculation approach, boundary choices, and any assumptions that matter for trust.",
    "Results":
      "Translate the numbers into a plain-English result story with a focus on change and momentum.",
    "Actions":
      "Describe the selected actions, time horizon, and what the client can realistically do next.",
    "Declaration":
      "Capture the sign-off language and any final confirmation wording required for the issue version.",
    "Sign-off":
      "Add the final approver details and the statement that closes the draft cleanly.",
  };

  return profile.sections.reduce((acc, section) => {
    const normalizedSection = SECTION_LABEL_ALIASES[section] || section;
    acc[section] = promptMap[normalizedSection] || promptMap[section] || `Draft the ${section.toLowerCase()} narrative here.`;
    return acc;
  }, {} as DraftNotes);
}

function buildInitialDraftOrigins(profile: ReportProfile): DraftOrigins {
  return profile.sections.reduce((acc, section) => {
    acc[section] = "starter";
    return acc;
  }, {} as DraftOrigins);
}

function buildInitialDraftProviders(profile: ReportProfile): DraftProviders {
  return profile.sections.reduce((acc, section) => {
    acc[section] = "starter";
    return acc;
  }, {} as DraftProviders);
}

function getDraftProviderLabel(provider: string | null | undefined, origin: DraftOrigins[string]): string {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "anthropic") return "Claude";
  if (normalized === "openai") return "OpenAI";
  if (normalized === "rule-based") return "Fallback";
  if (normalized === "manual") return "Manual";
  if (normalized === "starter") return "Starter prompt";
  if (origin === "ai") return "AI drafted";
  if (origin === "local") return "Drafted";
  return "Starter prompt";
}

function getDraftSectionKey(section: string): string {
  const normalized = SECTION_LABEL_ALIASES[section] || section;
  if (normalized === "Executive Summary") return "executive_summary";
  if (normalized === "Emissions Overview") return "emissions_overview";
  if (normalized === "Actions") return "actions";
  return normalized.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function getDraftSectionMeta(section: string): { badge: string; hint: string } {
  const normalized = SECTION_LABEL_ALIASES[section] || section;

  if (normalized === "Executive Summary") {
    return {
      badge: "Opening narrative",
      hint: "Lead with the headline change and the business takeaway.",
    };
  }
  if (normalized === "Emissions Overview") {
    return {
      badge: "Emissions story",
      hint: "Focus on totals, scope split, and the biggest drivers.",
    };
  }
  if (normalized === "Actions") {
    return {
      badge: "Action-led",
      hint: "Group practical next steps and the most important priorities.",
    };
  }

  return {
    badge: "Section draft",
    hint: "Draft this section with the supplied job and client evidence.",
  };
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function looksLikeJsonText(text: string): boolean {
  const raw = stripCodeFences(text);
  if (!raw) return false;
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    return true;
  }
  return /"(section_key|draft_text|bullet_points|summary|narrative|headline_points)"\s*:/.test(raw);
}

function coerceReadableDraftText(value: unknown, fallback = ""): string {
  const stripped = stripCodeFences(String(value ?? ""));
  if (!stripped) {
    return stripCodeFences(fallback);
  }

  if (!looksLikeJsonText(stripped)) {
    return stripped;
  }

  try {
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const nestedCandidates = [
      parsed.draft_text,
      parsed.draftText,
      parsed.summary,
      parsed.narrative,
      parsed.content,
      parsed.text,
    ];
    for (const candidate of nestedCandidates) {
      const candidateText = stripCodeFences(String(candidate ?? ""));
      if (candidateText && !looksLikeJsonText(candidateText)) {
        return candidateText;
      }
    }

    const bulletPoints = Array.isArray(parsed.bullet_points)
      ? parsed.bullet_points.map((item) => String(item ?? "").trim()).filter(Boolean)
      : Array.isArray(parsed.bulletPoints)
        ? parsed.bulletPoints.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [];
    if (bulletPoints.length > 0) {
      return bulletPoints.map((point) => (/[.!?]$/.test(point) ? point : `${point}.`)).join(" ");
    }
  } catch {
    // Fall through to the fallback text below.
  }

  const fallbackText = stripCodeFences(fallback);
  if (fallbackText && !looksLikeJsonText(fallbackText)) {
    return fallbackText;
  }

  return "Draft the section using the supplied evidence.";
}

function loadStoredDraftCanvas(raw: string | null, profile: ReportProfile): {
  notes: DraftNotes;
  origins: DraftOrigins;
  providers: DraftProviders;
} {
  const notes = buildInitialDraftNotes(profile);
  const origins = buildInitialDraftOrigins(profile);
  const providers = buildInitialDraftProviders(profile);
  if (!raw) {
    return { notes, origins, providers };
  }

  try {
    const parsed = JSON.parse(raw) as DraftStoragePayload;
    const parsedNotes =
      parsed && typeof parsed === "object" && "draft_notes" in parsed && parsed.draft_notes && typeof parsed.draft_notes === "object"
        ? parsed.draft_notes
        : parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as DraftNotes)
          : {};
    const parsedOrigins =
      parsed && typeof parsed === "object" && "draft_origins" in parsed && parsed.draft_origins && typeof parsed.draft_origins === "object"
        ? parsed.draft_origins
        : {};
    const parsedProviders =
      parsed && typeof parsed === "object" && "draft_providers" in parsed && parsed.draft_providers && typeof parsed.draft_providers === "object"
        ? parsed.draft_providers
        : {};

    profile.sections.forEach((section) => {
      const alias = SECTION_LABEL_ALIASES[section] || section;
      const storedValue =
        typeof parsedNotes?.[section] === "string"
          ? coerceReadableDraftText(parsedNotes[section], notes[section])
          : typeof parsedNotes?.[alias] === "string"
            ? coerceReadableDraftText(parsedNotes[alias], notes[section])
            : null;
      const storedOrigin =
        typeof parsedOrigins?.[section] === "string"
          ? parsedOrigins[section]
          : typeof parsedOrigins?.[alias] === "string"
            ? parsedOrigins[alias]
            : null;

      if (storedValue !== null) {
        notes[section] = storedValue;
        origins[section] = storedOrigin === "ai" || storedOrigin === "local" ? storedOrigin : "local";
        const storedProvider =
          typeof parsedProviders?.[section] === "string"
            ? parsedProviders[section]
            : typeof parsedProviders?.[alias] === "string"
              ? parsedProviders[alias]
              : null;
        const normalizedProvider = String(storedProvider || "").trim().toLowerCase();
        providers[section] =
          normalizedProvider === "anthropic" ||
          normalizedProvider === "openai" ||
          normalizedProvider === "rule-based" ||
          normalizedProvider === "manual" ||
          normalizedProvider === "starter"
            ? (normalizedProvider as DraftProviders[string])
            : storedOrigin === "ai"
              ? "anthropic"
              : storedOrigin === "local"
                ? "manual"
                : "starter";
      }
    });
  } catch {
    // Fall back to the starter canvas when the saved payload cannot be parsed.
  }

  return { notes, origins, providers };
}

function AccordionSection({
  stageNum,
  title,
  description,
  isOpen,
  onToggle,
  children,
  id,
}: {
  stageNum: number;
  title: string;
  description?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Card id={id}>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-slate-50 text-[11px] uppercase tracking-[0.18em] text-slate-500">
              Stage {stageNum}
            </Badge>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </div>
        {description ? (
          <CardDescription className="mt-1">{description}</CardDescription>
        ) : null}
      </CardHeader>
      {isOpen ? (
        <CardContent className="space-y-4 pt-0">
          {children}
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function JobReportNew({
  jobId,
  baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "",
  onOpenActions,
  showEmissionsSummary = false,
  isActive = true,
}: JobReportNewProps) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [assignment, setAssignment] = useState<TemplateAssignment | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("crp_standard");
  const [actionsSummary, setActionsSummary] = useState<JobActionsSummary | null>(null);
  const [reportVersions, setReportVersions] = useState<ReportVersion[]>([]);
  const [draftNotes, setDraftNotes] = useState<DraftNotes>(() => buildInitialDraftNotes(PROFILE_LIBRARY[0]));
  const [draftOrigins, setDraftOrigins] = useState<DraftOrigins>(() => buildInitialDraftOrigins(PROFILE_LIBRARY[0]));
  const [draftProviders, setDraftProviders] = useState<DraftProviders>(() => buildInitialDraftProviders(PROFILE_LIBRARY[0]));
  const [draftContext, setDraftContext] = useState<DraftWorkspaceContext | null>(null);
  const [serverDraftCount, setServerDraftCount] = useState(0);
  const [draftSyncReady, setDraftSyncReady] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftGeneratingSection, setDraftGeneratingSection] = useState<string | null>(null);
  const [draftError, setDraftError] = useState("");
  const [activeDraftSection, setActiveDraftSection] = useState<string>("Executive Summary");
  const [loading, setLoading] = useState(true);
  const [reportVersionsLoading, setReportVersionsLoading] = useState(true);
  const [workspaceWarnings, setWorkspaceWarnings] = useState<string[]>([]);
  const [reportVersionsError, setReportVersionsError] = useState<string>("");
  const [savingTemplateId, setSavingTemplateId] = useState<number | null>(null);
  const [savingReportVersion, setSavingReportVersion] = useState(false);
  const [reportVersionBusy, setReportVersionBusy] = useState<{ id: number; kind: "download" | "snapshot" } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(["stage-2", "stage-3", "stage-4", "stage-5", "stage-6"])
  );
  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    setWorkspaceWarnings([]);
    try {
      const [assignmentResult, actionsResult] = await Promise.allSettled([
        fetchWithRetry(`${baseUrl}/jobs/${jobId}/report-template-assignment`, { credentials: "include" }, 1),
        fetchWithRetry(`${baseUrl}/jobs/${jobId}/report-actions`, { credentials: "include" }, 1),
      ]);

      const warnings: string[] = [];

      const parseFailure = async (res: Response, label: string) => {
        let detail = `${res.status}`;
        try {
          const raw = await res.text();
          try {
            const parsed = JSON.parse(raw) as { detail?: unknown };
            if (parsed?.detail) {
              detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
            } else if (raw.trim()) {
              detail = raw.slice(0, 400);
            }
          } catch {
            if (raw.trim()) {
              detail = raw.slice(0, 400);
            }
          }
        } catch {
          // Keep status code fallback.
        }
        return `${label}: ${detail}`;
      };

      if (assignmentResult.status === "fulfilled") {
        const assignmentRes = assignmentResult.value;
        if (!assignmentRes.ok) {
          warnings.push(await parseFailure(assignmentRes, "Report profile assignment could not be loaded"));
        } else {
          const assignmentPayload = await assignmentRes.json();
          const availableTemplates: ReportTemplate[] = Array.isArray(assignmentPayload?.available_templates)
            ? assignmentPayload.available_templates
            : [];
          const currentAssignment: TemplateAssignment | null = assignmentPayload?.assignment || null;
          setTemplates(availableTemplates);
          setAssignment(currentAssignment);
          const preferredKey =
            currentAssignment?.template_key ||
            availableTemplates.find((template) => template.template_key === "crp_standard")?.template_key ||
            availableTemplates.find((template) => template.template_key === "annual_carbon_report")?.template_key ||
            availableTemplates[0]?.template_key ||
            "crp_standard";
          setSelectedKey(preferredKey);
        }
      } else {
        warnings.push("Report profile assignment could not be loaded.");
      }

      if (actionsResult.status === "fulfilled") {
        const actionsRes = actionsResult.value;
        if (!actionsRes.ok) {
          warnings.push(await parseFailure(actionsRes, "Report actions could not be loaded"));
        } else {
          const actionsPayload = await actionsRes.json();
          setActionsSummary(actionsPayload || null);
        }
      } else {
        warnings.push("Report actions could not be loaded.");
      }

      setWorkspaceWarnings(warnings);
      if (warnings.length > 0) {
        setError("Some report workspace data could not be loaded.");
      }
    } catch (err) {
      setError(formatFriendlyFetchError(err, "Failed to load reporting workspace"));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => {
    if (!isActive || loading) {
      return;
    }

    let cancelled = false;
    async function loadReportVersions() {
      setReportVersionsLoading(true);
      setReportVersionsError("");
      try {
        const res = await fetchWithRetry(`${baseUrl}/jobs/${jobId}/report-versions`, { credentials: "include" }, 1);
        if (!res.ok) {
          const warning = await (async () => {
            let detail = `${res.status}`;
            try {
              const raw = await res.text();
              try {
                const parsed = JSON.parse(raw) as { detail?: unknown };
                if (parsed?.detail) {
                  detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
                } else if (raw.trim()) {
                  detail = raw.slice(0, 400);
                }
              } catch {
                if (raw.trim()) {
                  detail = raw.slice(0, 400);
                }
              }
            } catch {
              // Keep status code fallback.
            }
            return `Version history could not be loaded: ${detail}`;
          })();
          if (!cancelled) {
            setReportVersionsError(warning);
            setReportVersions([]);
          }
          return;
        }
        const versionsPayload = await res.json();
        if (!cancelled) {
          if (versionsPayload?.warning) {
            setReportVersionsError(String(versionsPayload.warning));
          }
          setReportVersions(Array.isArray(versionsPayload?.versions) ? versionsPayload.versions : []);
        }
      } catch (err) {
        if (!cancelled) {
          const warning = formatFriendlyFetchError(err, "Version history could not be loaded");
          setReportVersionsError(warning);
          setReportVersions([]);
        }
      } finally {
        if (!cancelled) {
          setReportVersionsLoading(false);
        }
      }
    }

    const handle = window.setTimeout(() => {
      void loadReportVersions();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [baseUrl, jobId, isActive, loading]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void loadWorkspace();
  }, [isActive, loadWorkspace]);

  const selectedProfile = useMemo(
    () => PROFILE_LIBRARY.find((profile) => profile.key === selectedKey) || PROFILE_LIBRARY[0],
    [selectedKey]
  );
  const initialDraftNotes = useMemo(() => buildInitialDraftNotes(selectedProfile), [selectedProfile]);

  useEffect(() => {
    setActiveDraftSection((current) => {
      if (selectedProfile.sections.includes(current)) {
        return current;
      }
      return selectedProfile.sections[0] || current;
    });
  }, [selectedProfile.sections]);

  const availableTemplate = useMemo(
    () => templates.find((template) => template.template_key === selectedProfile.templateKey) || null,
    [selectedProfile.templateKey, templates]
  );

  const draftStorageKey = useMemo(
    () => `report-draft:${jobId}:${selectedProfile.templateKey}`,
    [jobId, selectedProfile.templateKey]
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      const stored = loadStoredDraftCanvas(raw, selectedProfile);
      setDraftNotes(stored.notes);
      setDraftOrigins(stored.origins);
      setDraftProviders(stored.providers);
      setDraftDirty(false);
      return;
    } catch {
      // Fall back to the default prompts below.
    }
    setDraftNotes(initialDraftNotes);
    setDraftOrigins(buildInitialDraftOrigins(selectedProfile));
    setDraftProviders(buildInitialDraftProviders(selectedProfile));
    setDraftDirty(false);
  }, [draftStorageKey, initialDraftNotes, selectedProfile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({ draft_notes: draftNotes, draft_origins: draftOrigins, draft_providers: draftProviders })
      );
    } catch {
      // Ignore storage failures in private/incognito contexts.
    }
  }, [draftNotes, draftOrigins, draftProviders, draftStorageKey]);

  const syncReportDrafts = useCallback(async () => {
    if (!draftSyncReady || !draftDirty || !selectedProfile.templateKey) {
      return;
    }

    const sections = selectedProfile.sections
      .map((section) => {
        const draftText = String(draftNotes[section] || "").trim();
        const starterText = String(initialDraftNotes[section] || "").trim();
        const origin = draftOrigins[section] || "starter";
        const provider = draftProviders[section] || (origin === "ai" ? "anthropic" : origin === "local" ? "manual" : "starter");
        if (!draftText) {
          return null;
        }
        if (draftText === starterText && origin === "starter") {
          return null;
        }
        return {
          section_key: getDraftSectionKey(section),
          section_title: section,
          draft_text: draftText,
          draft_json: {
            section_key: getDraftSectionKey(section),
            section_title: section,
            draft_text: draftText,
            origin,
            provider,
          },
          provider,
          model: provider === "anthropic" || provider === "openai" ? "draft-generation" : provider === "rule-based" ? "fallback" : "manual-edit",
          confidence: provider === "anthropic" || provider === "openai" ? "medium" : "low",
          origin,
        };
      })
      .filter(Boolean);

    if (sections.length === 0 && serverDraftCount === 0) {
      return;
    }

    const res = await fetchWithRetry(`${baseUrl}/jobs/${jobId}/report-drafts`, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_key: selectedProfile.templateKey,
        sections,
      }),
    }, 1);
    if (!res.ok) {
      const message = await res.text().catch(() => "");
      throw new Error(message || `Failed to save report drafts (${res.status})`);
    }
    const payload = await res.json().catch(() => null);
    if (Array.isArray(payload?.items)) {
      setServerDraftCount(payload.items.length);
    }
    setDraftDirty(false);
  }, [baseUrl, draftDirty, draftNotes, draftOrigins, draftProviders, draftSyncReady, initialDraftNotes, jobId, selectedProfile.sections, selectedProfile.templateKey, serverDraftCount]);

  useEffect(() => {
    if (!draftSyncReady) {
      return;
    }

    const handle = window.setTimeout(() => {
      void syncReportDrafts().catch((err) => {
        setDraftError(formatFriendlyFetchError(err, "Unable to save draft changes right now."));
      });
    }, 500);

    return () => {
      window.clearTimeout(handle);
    };
  }, [draftNotes, draftOrigins, draftProviders, draftSyncReady, syncReportDrafts]);

  useEffect(() => {
    let cancelled = false;

    async function loadDraftContext() {
      if (!selectedProfile.templateKey || loading) {
        setDraftContext(null);
        return;
      }

      try {
        const res = await fetchWithRetry(
          `${baseUrl}/jobs/${jobId}/report-draft-context?template_key=${encodeURIComponent(selectedProfile.templateKey)}`,
          { credentials: "include" },
          1
        );
        if (!res.ok) {
          throw new Error(`Failed to load draft context (${res.status})`);
        }
        const payload = (await res.json()) as DraftWorkspaceContext;
        if (!cancelled) {
          setDraftContext(payload);
        }
      } catch {
        if (!cancelled) {
          setDraftContext(null);
        }
      }
    }

    void loadDraftContext();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId, loading, selectedProfile.templateKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadReportDrafts() {
      if (loading) {
        return;
      }
      setDraftSyncReady(false);
      setServerDraftCount(0);

      try {
        const res = await fetchWithRetry(
          `${baseUrl}/jobs/${jobId}/report-drafts?template_key=${encodeURIComponent(selectedProfile.templateKey)}`,
          { credentials: "include" },
          1
        );
        if (!res.ok) {
          throw new Error(`Failed to load saved drafts (${res.status})`);
        }
        const payload = await res.json();
        const items: ReportDraftRow[] = Array.isArray(payload?.items) ? payload.items : [];
        if (items.length > 0 && !cancelled) {
          setDraftNotes((prev) => {
            const next = { ...prev };
            items.forEach((item) => {
              const sectionKey = String(item.section_key || "").trim();
              if (!sectionKey) return;
              const sectionLabel =
                selectedProfile.sections.find((label) => getDraftSectionKey(label) === sectionKey) ||
                item.section_title ||
                sectionKey;
              if (typeof item.draft_text === "string" && sectionLabel) {
                next[sectionLabel] = coerceReadableDraftText(item.draft_text, next[sectionLabel]);
              }
            });
            return next;
          });
          setDraftOrigins((prev) => {
            const next = { ...prev };
            items.forEach((item) => {
              const sectionKey = String(item.section_key || "").trim();
              if (!sectionKey) return;
              const sectionLabel =
                selectedProfile.sections.find((label) => getDraftSectionKey(label) === sectionKey) ||
                item.section_title ||
                sectionKey;
              if (sectionLabel) {
                const origin = item.draft_json && typeof item.draft_json === "object" && typeof item.draft_json.origin === "string"
                  ? item.draft_json.origin
                  : item.provider === "anthropic" || item.provider === "openai"
                    ? "ai"
                    : "local";
                next[sectionLabel] = origin === "ai" ? "ai" : "local";
              }
            });
            return next;
          });
          setDraftProviders((prev) => {
            const next = { ...prev };
            items.forEach((item) => {
              const sectionKey = String(item.section_key || "").trim();
              if (!sectionKey) return;
              const sectionLabel =
                selectedProfile.sections.find((label) => getDraftSectionKey(label) === sectionKey) ||
                item.section_title ||
                sectionKey;
              if (!sectionLabel) return;
              const draftJsonProvider =
                item.draft_json && typeof item.draft_json === "object" && typeof item.draft_json.provider === "string"
                  ? String(item.draft_json.provider)
                  : "";
              const provider = String(draftJsonProvider || item.provider || "").trim().toLowerCase();
              if (
                provider === "anthropic" ||
                provider === "openai" ||
                provider === "rule-based" ||
                provider === "manual" ||
                provider === "starter"
              ) {
                next[sectionLabel] = provider as DraftProviders[string];
              } else {
                next[sectionLabel] = item.provider === "anthropic" || item.provider === "openai" ? "anthropic" : "manual";
              }
            });
            return next;
          });
        }
        if (!cancelled) {
          setServerDraftCount(items.length);
          setDraftDirty(false);
        }
      } catch {
        if (!cancelled) {
          setServerDraftCount(0);
          setDraftDirty(false);
        }
      } finally {
        if (!cancelled) {
          setDraftSyncReady(true);
        }
      }
    }

    void loadReportDrafts();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId, loading, selectedProfile.sections, selectedProfile.templateKey]);

  const selectedActions = Array.isArray(actionsSummary?.items) ? actionsSummary.items.length : 0;
  const shortActions = actionsSummary?.term_counts?.short || 0;
  const mediumActions = actionsSummary?.term_counts?.medium || 0;
  const longActions = actionsSummary?.term_counts?.long || 0;
  const activeAssignmentLabel =
    assignment?.template_name || availableTemplate?.template_name || selectedProfile.title;

  const draftReady = Boolean(assignment?.template_id) && selectedActions > 0;
  const draftedSectionCount = selectedProfile.sections.filter((section) => {
    const note = String(draftNotes[section] || "").trim();
    const starter = String(initialDraftNotes[section] || "").trim();
    return note.length > 0 && note !== starter;
  }).length;
  const draftStarted = draftedSectionCount > 0;
  const stage4Checks = useMemo(
    () => [
      { label: "Profile assigned", done: Boolean(assignment?.template_id), note: "A report family is selected for this job." },
      { label: "Actions saved", done: selectedActions > 0, note: "The action plan will flow into the report section." },
      { label: "Draft content started", done: draftStarted, note: "At least one section has working draft text." },
      { label: "Ready to preview", done: draftReady, note: "You can now open the preview/export flow." },
    ],
    [assignment?.template_id, draftReady, draftStarted, selectedActions]
  );
  const stage4MissingChecks = stage4Checks.filter((item) => !item.done);
  const latestReportVersion = reportVersions[0] || null;

  const downloadReportVersion = useCallback(
    async (version: ReportVersion) => {
      if (!version.download_url || reportVersionBusy) {
        return;
      }
      setReportVersionBusy({ id: version.report_version_id, kind: "download" });
      setError("");
      try {
        const res = await fetchWithRetry(apiUrl(version.download_url), { credentials: "include" }, 1);
        if (!res.ok) {
          let message = `Failed to download version PDF (${res.status})`;
          try {
            const payload = await res.json();
            if (payload?.detail) {
              message = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
            }
          } catch {
            // Keep fallback message.
          }
          throw new Error(message);
        }
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") || "";
        const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
        const filename = filenameMatch?.[1] || `job-${jobId}-report-v${version.version_number}.pdf`;
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(url);
        setStatus(`Downloaded ${version.version_label || `v${version.version_number}`}.`);
      } catch (err) {
        setError(formatFriendlyFetchError(err, "Failed to download report version"));
      } finally {
        setReportVersionBusy(null);
      }
    },
    [jobId, reportVersionBusy]
  );

  const openReportVersionSnapshot = useCallback(
    async (version: ReportVersion) => {
      if (!version.snapshot_url || reportVersionBusy) {
        return;
      }
      setReportVersionBusy({ id: version.report_version_id, kind: "snapshot" });
      setError("");
      const previewWindow = window.open("", "_blank", "noopener,noreferrer");
      if (!previewWindow) {
        setReportVersionBusy(null);
        setError("Pop-up blocked. Please allow pop-ups for frozen previews.");
        return;
      }
      try {
        const res = await fetchWithRetry(apiUrl(version.snapshot_url), { credentials: "include" }, 1);
        if (!res.ok) {
          let message = `Failed to open frozen preview (${res.status})`;
          try {
            const payload = await res.json();
            if (payload?.detail) {
              message = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
            }
          } catch {
            // Keep fallback message.
          }
          throw new Error(message);
        }
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        previewWindow.location.href = url;
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
        setStatus(`Opened frozen preview for ${version.version_label || `v${version.version_number}`}.`);
      } catch (err) {
        previewWindow.close();
        setError(formatFriendlyFetchError(err, "Failed to open frozen preview"));
      } finally {
        setReportVersionBusy(null);
      }
    },
    [reportVersionBusy]
  );

  const markVersionFinal = useCallback(
    async (reportVersionId: number) => {
      setSavingReportVersion(true);
      setStatus("");
      setError("");
      try {
        const res = await fetchWithRetry(`${baseUrl}/jobs/${jobId}/report-versions/${reportVersionId}`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "final" }),
        }, 1);
        if (!res.ok) {
          let message = `Failed to mark version final (${res.status})`;
          try {
            const payload = await res.json();
            if (payload?.detail) {
              message = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
            }
          } catch {
            // Keep fallback message.
          }
          throw new Error(message);
        }

        setStatus("Saved report version marked final.");
        await loadWorkspace();
      } catch (err) {
        setError(formatFriendlyFetchError(err, "Failed to mark version final"));
      } finally {
        setSavingReportVersion(false);
      }
    },
    [baseUrl, jobId, loadWorkspace]
  );

  async function assignProfile(profile: ReportProfile) {
    const template = templates.find((item) => item.template_key === profile.templateKey);
    setSavingTemplateId(template?.template_id ?? -1);
    setStatus("");
    setError("");

    try {
      const res = await fetchWithRetry(`${baseUrl}/jobs/${jobId}/report-template-assignment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          template_id: template?.template_id ?? null,
          template_key: profile.templateKey,
          version_id: template?.latest_version_id ?? null,
        }),
      }, 1);

      if (!res.ok) {
        const message = await res.text().catch(() => "");
        throw new Error(message || `Failed to assign profile (${res.status})`);
      }

      const data = await res.json();
      setAssignment({
        job_id: jobId,
        template_id: data?.template_id ?? template?.template_id ?? null,
        version_id: data?.version_id ?? template?.latest_version_id ?? null,
        template_key: template?.template_key ?? profile.templateKey,
        template_name: template?.template_name ?? profile.title,
        template_type: template?.template_type ?? "carbon_reduction_plan",
        version_number: template?.latest_version_number ?? null,
      });
      setSelectedKey(profile.key);
      setStatus(`${profile.title} - ${profile.subtitle} assigned to this job.`);
    } catch (err) {
      setError(formatFriendlyFetchError(err, "Failed to assign profile"));
    } finally {
      setSavingTemplateId(null);
    }
  }

  function updateDraftNote(section: string, value: string) {
    setDraftNotes((prev) => ({ ...prev, [section]: value }));
    setDraftOrigins((prev) => ({ ...prev, [section]: value.trim() ? "local" : "starter" }));
    setDraftProviders((prev) => {
      const next = { ...prev };
      if (!value.trim()) {
        next[section] = "starter";
        return next;
      }
      const current = next[section];
      if (current === "anthropic" || current === "openai" || current === "rule-based") {
        return next;
      }
      next[section] = "manual";
      return next;
    });
    setDraftDirty(true);
    setDraftError("");
  }

  function clearDraftNotes() {
    setDraftNotes(initialDraftNotes);
    setDraftOrigins(buildInitialDraftOrigins(selectedProfile));
    setDraftProviders(buildInitialDraftProviders(selectedProfile));
    setDraftDirty(true);
    setStatus("Draft canvas reset to the starter prompts.");
    setDraftError("");
  }

  const generateSectionDraft = useCallback(
    async (section: string) => {
      const sectionKey = getDraftSectionKey(section);
      if (!AI_DRAFT_SECTIONS.has(section)) {
        return;
      }

      setDraftGeneratingSection(section);
      setStatus("");
      setError("");
      setDraftError("");
      try {
        const res = await fetchWithRetry(`${baseUrl}/jobs/${jobId}/report-drafts/generate`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            section_key: sectionKey,
            template_key: selectedProfile.templateKey,
            provider: "anthropic",
          }),
        }, 1);

        if (!res.ok) {
          let message = `Failed to generate draft for ${section} (${res.status})`;
          try {
            const payload = await res.json();
            if (payload?.detail) {
              message = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
            }
          } catch {
            // Keep fallback message.
          }
          throw new Error(message);
        }

        const payload = await res.json();
        const draftText =
          typeof payload?.draft?.draft_text === "string"
            ? payload.draft.draft_text
            : typeof payload?.draft?.draftText === "string"
              ? payload.draft.draftText
              : "";
        const readableDraftText = coerceReadableDraftText(draftText, draftText);
        if (!readableDraftText.trim()) {
          throw new Error("The AI draft did not return usable text.");
        }

        setDraftNotes((prev) => ({ ...prev, [section]: readableDraftText }));
        setDraftOrigins((prev) => ({ ...prev, [section]: "ai" }));
        const provider = String(payload?.draft?.provider || payload?.saved_draft?.provider || "anthropic").trim().toLowerCase();
        setDraftProviders((prev) => ({
          ...prev,
          [section]:
            provider === "anthropic" || provider === "openai" || provider === "rule-based"
              ? (provider as DraftProviders[string])
              : "anthropic",
        }));
        setDraftDirty(true);
        setStatus(`Generated an AI draft for ${section}.`);
      } catch (err) {
        setDraftError(formatFriendlyFetchError(err, `Unable to generate draft for ${section} right now.`));
      } finally {
        setDraftGeneratingSection(null);
      }
    },
    [baseUrl, jobId, selectedProfile.templateKey]
  );

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white shadow-xl">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1.15fr_0.85fr] lg:p-5">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
              <Sparkles className="h-3.5 w-3.5" />
              Stage 1
            </div>
              <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">Stage 1 Job Context</h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-200">
                Choose the report family, confirm the job context, and keep the workflow inside one page instead of
                bouncing between screens.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={onOpenActions} className="gap-2">
                <Target className="h-4 w-4" />
                Open Actions
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  document.getElementById("stage-4-profile")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              >
                <FileText className="h-4 w-4" />
                Jump to Stage 4
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
              <div className="text-[10px] uppercase tracking-[0.25em] text-slate-300">Assigned profile</div>
              <div className="mt-2 text-base font-semibold leading-6">{activeAssignmentLabel}</div>
              <div className="mt-1 text-xs text-slate-300">
                {assignment?.version_number ? `Version ${assignment.version_number}` : "No version assigned yet"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
              <div className="text-[10px] uppercase tracking-[0.25em] text-slate-300">Actions ready</div>
              <div className="mt-2 text-base font-semibold">{selectedActions} selected</div>
              <div className="mt-1 text-sm text-slate-300">
                Short {shortActions} · Medium {mediumActions} · Long {longActions}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {showEmissionsSummary ? <EmissionsSummary jobId={jobId} baseUrl={baseUrl} /> : null}

      {/* ── Stage 2: Organisation Data ─────────────────────────────────── */}
      <AccordionSection
        stageNum={2}
        title="Organisation Data"
        description="Staff count, premises and vehicle numbers used in the Background &amp; Organisation section of the report."
        isOpen={openSections.has("stage-2")}
        onToggle={() => toggleSection("stage-2")}
      >
        <ReportingElements jobId={jobId} baseUrl={baseUrl ?? "/api/backend"} />
      </AccordionSection>

      {/* ── Stage 3: Report Variables ──────────────────────────────────── */}
      <AccordionSection
        stageNum={3}
        title="Report Variables"
        description="Boundary controls, energy figures, narrative commentary, sign-off details and other metadata used by report templates."
        isOpen={openSections.has("stage-3")}
        onToggle={() => toggleSection("stage-3")}
      >
        <ReportVariablesPanel jobId={jobId} baseUrl={baseUrl ?? "/api/backend"} />
      </AccordionSection>

      {/* ── Stage 4: Choose Report Profile ────────────────────────────── */}
      <AccordionSection
        stageNum={4}
        title="Choose report profile"
        description="Start with the report family, then shape the draft and visuals around the profile."
        isOpen={openSections.has("stage-4")}
        onToggle={() => toggleSection("stage-4")}
        id="stage-4-profile"
      >
            <div className="grid gap-4 md:grid-cols-2">
              {PROFILE_LIBRARY.map((profile) => {
                const template = templates.find((item) => item.template_key === profile.templateKey);
                const isSelected = selectedProfile.key === profile.key;
                return (
                  <div
                    key={profile.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedKey(profile.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedKey(profile.key);
                      }
                    }}
                    className={`cursor-pointer text-left rounded-2xl border p-4 transition-all ${
                      isSelected ? "border-slate-950 bg-slate-50 shadow-sm" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-500">{profile.subtitle}</div>
                        <div className="mt-1 text-lg font-semibold">{profile.title}</div>
                      </div>
                      <Badge className={toneClass(profile.statusTone)}>{profile.statusLabel}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{profile.description}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {profile.sections.slice(0, 4).map((section) => (
                        <Badge key={section} variant="outline" className="bg-white">
                          {section}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="gap-2"
                        disabled={loading || savingTemplateId === template?.template_id}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void assignProfile(profile);
                        }}
                      >
                        {savingTemplateId === template?.template_id ? "Assigning..." : "Use this profile"}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                      {template?.latest_version_number ? (
                        <Badge variant="outline">v{template.latest_version_number}</Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
      </AccordionSection>

      {/* ── Stage 5: Draft Content ─────────────────────────────────────── */}
      <AccordionSection
        stageNum={5}
        title="Draft Content"
        description="Work one section at a time. The navigator keeps the other sections visible without forcing a long scroll."
        isOpen={openSections.has("stage-5")}
        onToggle={() => toggleSection("stage-5")}
      >
            <div className="rounded-xl border bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-white">
                  {selectedProfile.subtitle}
                </Badge>
                <Badge variant="outline" className="bg-white">
                  {draftedSectionCount}/{selectedProfile.sections.length} drafted
                </Badge>
                <Badge variant="outline" className="bg-white">
                  {selectedActions} actions ready
                </Badge>
                <Badge variant="outline" className="bg-white">
                  {draftOrigins["Executive Summary"] === "ai" || draftOrigins["Emissions Overview"] === "ai" || draftOrigins["Actions"] === "ai"
                    ? "AI drafting enabled"
                    : "AI drafting ready"}
                </Badge>
                <Badge variant="outline" className="bg-white">
                  {getDraftProviderLabel(draftProviders[activeDraftSection], draftOrigins[activeDraftSection])}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Draft one section at a time, keep the others as quick navigation, and move to preview/export when the narrative feels coherent.
              </p>
              {draftContext?.context_summary ? (
                <p className="mt-1.5 text-sm text-slate-500">
                  Draft inputs: {draftContext.context_summary}
                </p>
              ) : null}
            </div>

            {draftError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                {draftError}
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
              <div className="rounded-2xl border bg-white p-2.5">
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Sections</div>
                  <Badge variant="outline" className="bg-slate-50 text-[11px]">
                    {selectedProfile.sections.length} total
                  </Badge>
                </div>
                <div className="mt-2 space-y-1.5">
                  {selectedProfile.sections.map((section) => {
                    const isActive = activeDraftSection === section;
                    const origin = draftOrigins[section];
                    const originLabel = getDraftProviderLabel(draftProviders[section], origin);
                    const meta = getDraftSectionMeta(section);
                    return (
                      <button
                        key={section}
                        type="button"
                        onClick={() => setActiveDraftSection(section)}
                        title={meta.hint}
                        className={`w-full rounded-xl border px-2.5 py-2.5 text-left transition ${
                          isActive
                            ? "border-slate-900 bg-slate-50 shadow-sm"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-slate-900">{section}</div>
                          </div>
                          <Badge variant="outline" className="shrink-0 bg-slate-50 text-[10px]">
                            {originLabel}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-3.5">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Active section</div>
                    <div className="mt-1 text-xl font-semibold text-slate-950">{activeDraftSection}</div>
                    <div className="mt-1.5 max-w-2xl text-sm text-slate-600">{getDraftSectionMeta(activeDraftSection).hint}</div>
                  </div>
                  {AI_DRAFT_SECTIONS.has(activeDraftSection) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2 w-fit justify-self-start xl:justify-self-end"
                      onClick={() => void generateSectionDraft(activeDraftSection)}
                      disabled={draftGeneratingSection === activeDraftSection}
                    >
                      <Sparkles className="h-4 w-4" />
                        {draftGeneratingSection === activeDraftSection ? "Generating..." : "Generate Draft"}
                    </Button>
                  ) : null}
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="bg-slate-50">
                    {getDraftProviderLabel(draftProviders[activeDraftSection], draftOrigins[activeDraftSection])}
                  </Badge>
                  <Badge variant="outline" className="bg-white">
                    {getDraftSectionMeta(activeDraftSection).badge}
                  </Badge>
                </div>

                <Textarea
                  className="mt-3 min-h-[260px]"
                  value={draftNotes[activeDraftSection] || ""}
                  onChange={(event) => updateDraftNote(activeDraftSection, event.target.value)}
                  rows={8}
                  placeholder={`Draft the ${activeDraftSection.toLowerCase()} content for this report...`}
                />

                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={clearDraftNotes}>
                    Reset draft canvas
                  </Button>
                </div>
              </div>
            </div>
      </AccordionSection>

      {/* ── Stage 6: Preview & Export ──────────────────────────────────── */}
      <AccordionSection
        stageNum={6}
        title="Preview & Export"
        description="Quick review before you jump into Report Printing."
        isOpen={openSections.has("stage-6")}
        onToggle={() => toggleSection("stage-6")}
      >
              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-white">
                    Stage 6 checkpoint
                  </Badge>
                  <Badge variant="outline" className="bg-white">
                    {draftReady ? "Done" : "Not done"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-slate-600">Confirm the essentials and move straight to Report Printing.</p>
              </div>

              {loading ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  Loading the reporting workspace...
                </div>
              ) : null}
              {error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                  {error}
                </div>
              ) : null}
              {status ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  {status}
                </div>
              ) : null}

              <div
                className={`rounded-xl border p-3 ${
                  stage4MissingChecks.length > 0 || reportVersionsError
                    ? "border-rose-200 bg-rose-50/80"
                    : "border-emerald-200 bg-emerald-50/80"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">
                    {stage4MissingChecks.length > 0 || reportVersionsError ? "Needs attention" : "All set"}
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase tracking-[0.18em] ${
                      stage4MissingChecks.length > 0 || reportVersionsError
                        ? "border-rose-200 bg-rose-100 text-rose-700"
                        : "border-emerald-200 bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {stage4MissingChecks.length > 0 || reportVersionsError ? "Not done" : "Done"}
                  </Badge>
                </div>
                {reportVersionsError ? (
                  <div className="mt-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-xs text-rose-800">
                    {reportVersionsError}
                  </div>
                ) : null}
                {workspaceWarnings.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Workspace warnings</div>
                    <ul className="mt-2 space-y-2 text-sm text-slate-800">
                      {workspaceWarnings.map((warning) => (
                        <li key={warning} className="rounded-md border border-rose-200 bg-white px-3 py-2 text-xs text-rose-800">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {stage4MissingChecks.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Missing items</div>
                    <ul className="mt-2 space-y-2 text-sm text-slate-800">
                      {stage4MissingChecks.map((item) => (
                        <li key={item.label} className="rounded-md border border-rose-200 bg-white px-3 py-2">
                          <div className="font-medium text-slate-900">{item.label}</div>
                          <div className="text-xs text-muted-foreground">{item.note}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2">
                {stage4Checks.map((item) => {
                  const passed = item.done;
                  return (
                    <div
                      key={item.label}
                      className={`flex gap-2 rounded-lg border p-2.5 ${
                        passed ? "border-emerald-200 bg-emerald-50/70" : "border-rose-200 bg-rose-50/70"
                      }`}
                    >
                      <div
                        className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${
                          passed ? "border-emerald-500 bg-emerald-500 text-white" : "border-rose-500 bg-rose-500 text-white"
                        }`}
                        aria-hidden="true"
                      >
                        {passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-slate-900">{item.label}</div>
                          <Badge
                            variant="outline"
                            className={`text-[10px] uppercase tracking-[0.18em] ${
                              passed ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-rose-200 bg-rose-100 text-rose-700"
                            }`}
                          >
                            {passed ? "Done" : "Not done"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{item.note}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl border bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900">Version history</div>
                    <div className="text-xs text-muted-foreground">Recent saved PDFs and frozen previews.</div>
                  </div>
                  <Badge variant="outline" className="bg-white">
                    {reportVersions.length} saved
                  </Badge>
                </div>
                <div className="mt-2 space-y-2">
                  {reportVersionsLoading ? (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                      Loading version history...
                    </div>
                  ) : reportVersionsError ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                      {reportVersionsError}
                    </div>
                  ) : null}
                  {latestReportVersion ? (
                    <div className="rounded-lg border bg-white px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">
                          {latestReportVersion.version_label || `v${latestReportVersion.version_number}`}
                        </span>
                        <Badge variant="outline" className="bg-slate-50">
                          {latestReportVersion.status || "review"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {latestReportVersion.generated_at ? `Generated ${latestReportVersion.generated_at}` : "Recently generated"}
                      </div>
                      {latestReportVersion.status !== "final" ? (
                        <div className="mt-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => markVersionFinal(latestReportVersion.report_version_id)}
                            disabled={savingReportVersion}
                          >
                            Mark final
                          </Button>
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs">
                        {latestReportVersion.download_url ? (
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs text-slate-600 underline-offset-4 hover:underline"
                            onClick={() => void downloadReportVersion(latestReportVersion)}
                            disabled={reportVersionBusy?.id === latestReportVersion.report_version_id}
                          >
                            Download
                          </Button>
                        ) : null}
                        {latestReportVersion.snapshot_url ? (
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs text-slate-600 underline-offset-4 hover:underline"
                            onClick={() => void openReportVersionSnapshot(latestReportVersion)}
                            disabled={reportVersionBusy?.id === latestReportVersion.report_version_id}
                          >
                            Frozen preview
                          </Button>
                        ) : null}
                        <Link
                          href={`/jobs/${jobId}/admin/certificate`}
                          className="text-slate-600 underline-offset-4 hover:underline"
                        >
                          Emissions certificate
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed bg-white px-3 py-2 text-xs text-muted-foreground">
                      No saved versions yet. Save the first review PDF when you are ready.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <Link href={`/jobs/${jobId}/advanced-reports`}>Open Report Printing</Link>
                </Button>
                <Button variant="outline" onClick={() => onOpenActions?.()}>
                  Review Actions
                </Button>
              </div>
      </AccordionSection>
    </div>
  );
}


