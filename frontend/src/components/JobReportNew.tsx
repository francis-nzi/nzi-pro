"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import EmissionsSummary from "@/components/EmissionsSummary";
import { ArrowRight, CheckCircle2, FileText, LayoutGrid, LineChart, Sparkles, Target } from "lucide-react";

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

type JobReportNewProps = {
  jobId: number;
  baseUrl?: string;
  onOpenActions?: () => void;
  onOpenLegacyReporting?: () => void;
};

const PROFILE_LIBRARY: ReportProfile[] = [
  {
    key: "crp_standard",
    title: "Carbon Reduction Plan",
    subtitle: "Standard",
    description: "The flagship compliance-led CRP for government and buyer-led submissions.",
    templateKey: "crp_standard",
    sections: ["Executive Summary", "Emissions Footprint", "Actions", "Declaration"],
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

function toneClass(tone: ReportProfile["statusTone"]): string {
  if (tone === "ready") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (tone === "preview") return "bg-sky-100 text-sky-800 border-sky-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

export default function JobReportNew({
  jobId,
  baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "",
  onOpenActions,
  onOpenLegacyReporting,
}: JobReportNewProps) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [assignment, setAssignment] = useState<TemplateAssignment | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("crp_standard");
  const [actionsSummary, setActionsSummary] = useState<JobActionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingTemplateId, setSavingTemplateId] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [assignmentRes, actionsRes] = await Promise.all([
        fetch(`${baseUrl}/jobs/${jobId}/report-template-assignment`, { credentials: "include" }),
        fetch(`${baseUrl}/jobs/${jobId}/report-actions`, { credentials: "include" }),
      ]);

      if (!assignmentRes.ok) {
        throw new Error(`Failed to load report template assignment (${assignmentRes.status})`);
      }
      if (!actionsRes.ok) {
        throw new Error(`Failed to load report actions (${actionsRes.status})`);
      }

      const assignmentPayload = await assignmentRes.json();
      const actionsPayload = await actionsRes.json();

      const availableTemplates: ReportTemplate[] = Array.isArray(assignmentPayload?.available_templates)
        ? assignmentPayload.available_templates
        : [];
      const currentAssignment: TemplateAssignment | null = assignmentPayload?.assignment || null;

      setTemplates(availableTemplates);
      setAssignment(currentAssignment);
      setActionsSummary(actionsPayload || null);

      const preferredKey =
        currentAssignment?.template_key ||
        availableTemplates.find((template) => template.template_key === "crp_standard")?.template_key ||
        availableTemplates.find((template) => template.template_key === "annual_carbon_report")?.template_key ||
        availableTemplates[0]?.template_key ||
        "crp_standard";
      setSelectedKey(preferredKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reporting workspace");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectedProfile = useMemo(
    () => PROFILE_LIBRARY.find((profile) => profile.key === selectedKey) || PROFILE_LIBRARY[0],
    [selectedKey]
  );

  const availableTemplate = useMemo(
    () => templates.find((template) => template.template_key === selectedProfile.templateKey) || null,
    [selectedProfile.templateKey, templates]
  );

  const selectedActions = Array.isArray(actionsSummary?.items) ? actionsSummary.items.length : 0;
  const shortActions = actionsSummary?.term_counts?.short || 0;
  const mediumActions = actionsSummary?.term_counts?.medium || 0;
  const longActions = actionsSummary?.term_counts?.long || 0;
  const activeAssignmentLabel =
    assignment?.template_name || availableTemplate?.template_name || selectedProfile.title;

  const draftReady = Boolean(assignment?.template_id) && selectedActions > 0;

  async function assignProfile(profile: ReportProfile) {
    const template = templates.find((item) => item.template_key === profile.templateKey);
    if (!template) {
      setSelectedKey(profile.key);
      setStatus("This profile is not seeded yet. It is ready for the next reporting phase.");
      return;
    }

    setSavingTemplateId(template.template_id);
    setStatus("");
    setError("");

    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-template-assignment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          template_id: template.template_id,
          version_id: template.latest_version_id ?? null,
        }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => "");
        throw new Error(message || `Failed to assign profile (${res.status})`);
      }

      const data = await res.json();
      setAssignment({
        job_id: jobId,
        template_id: template.template_id,
        version_id: data?.version_id ?? template.latest_version_id ?? null,
        template_key: template.template_key,
        template_name: template.template_name,
        template_type: template.template_type,
        version_number: template.latest_version_number ?? null,
      });
      setSelectedKey(profile.key);
      setStatus(`${profile.title} - ${profile.subtitle} assigned to this job.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign profile");
    } finally {
      setSavingTemplateId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white shadow-xl">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.4fr_0.8fr] lg:p-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
              <Sparkles className="h-3.5 w-3.5" />
              Report (New)
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight">Profile-first reporting workspace</h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-200">
                Choose the report family first, shape the content around that profile, then move straight into
                actions and draft outputs. This is the new reporting path we discussed for CRP, SECR, and
                country-specific variants.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={onOpenActions} className="gap-2">
                <Target className="h-4 w-4" />
                Open Actions
              </Button>
              <Button variant="outline" onClick={onOpenLegacyReporting} className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <FileText className="h-4 w-4" />
                Open Legacy Reporting
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Assigned profile</div>
              <div className="mt-2 text-lg font-semibold">{activeAssignmentLabel}</div>
              <div className="mt-1 text-sm text-slate-300">
                {assignment?.version_number ? `Version ${assignment.version_number}` : "No version assigned yet"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Actions ready</div>
              <div className="mt-2 text-lg font-semibold">{selectedActions} selected</div>
              <div className="mt-1 text-sm text-slate-300">
                Short {shortActions} · Medium {mediumActions} · Long {longActions}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <EmissionsSummary jobId={jobId} baseUrl={baseUrl} />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Choose report profile</CardTitle>
            <CardDescription>
              Start with the report family, then shape the draft and visuals around the profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                {error}
              </div>
            )}
            {status && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                {status}
              </div>
            )}
            {loading && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Loading the reporting workspace...
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {PROFILE_LIBRARY.map((profile) => {
                const template = templates.find((item) => item.template_key === profile.templateKey);
                const isAvailable = Boolean(template);
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
                        disabled={loading || !isAvailable || savingTemplateId === template?.template_id}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!isAvailable) return;
                          void assignProfile(profile);
                        }}
                      >
                        {savingTemplateId === template?.template_id ? "Assigning..." : isAvailable ? "Use this profile" : "Not seeded yet"}
                        {isAvailable ? <ArrowRight className="h-4 w-4" /> : null}
                      </Button>
                      {isAvailable && template?.latest_version_number ? (
                        <Badge variant="outline">v{template.latest_version_number}</Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Draft flow</CardTitle>
              <CardDescription>Use the new process as a guided path from profile to publish.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "1. Select profile", done: Boolean(assignment?.template_id), note: "Choose the report family before drafting." },
                { label: "2. Add actions", done: selectedActions > 0, note: "Use suggested or custom actions from the job." },
                { label: "3. Draft content", done: true, note: "Work section by section without hard required blockers." },
                { label: "4. Preview and export", done: draftReady, note: "Use the current renderer while the v2 path is built out." },
              ].map((step) => (
                <div key={step.label} className="flex gap-3 rounded-lg border p-3">
                  <CheckCircle2 className={`mt-0.5 h-5 w-5 ${step.done ? "text-emerald-600" : "text-slate-300"}`} />
                  <div>
                    <div className="font-medium">{step.label}</div>
                    <div className="text-sm text-muted-foreground">{step.note}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Visual pack</CardTitle>
              <CardDescription>
                The new process still leans into dashboards, charts, and action-led storytelling.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-3">
                <LayoutGrid className="mt-0.5 h-4 w-4 text-slate-600" />
                <div>
                  <div className="font-medium text-slate-900">Executive Summary dashboard</div>
                  <div>Use KPI cards, reduction highlights, and a concise visual narrative.</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <LineChart className="mt-0.5 h-4 w-4 text-slate-600" />
                <div>
                  <div className="font-medium text-slate-900">Charts and graphs</div>
                  <div>Keep pies/donuts where they help quick interpretation and presentation.</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 h-4 w-4 text-slate-600" />
                <div>
                  <div className="font-medium text-slate-900">Actions-led narrative</div>
                  <div>Show short, medium, and long term actions alongside the emissions story.</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
