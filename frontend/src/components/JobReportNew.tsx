"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import EmissionsSummary from "@/components/EmissionsSummary";
import { Textarea } from "@/components/ui/textarea";
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

function buildInitialDraftNotes(profile: ReportProfile): DraftNotes {
  const promptMap: Record<string, string> = {
    "Executive Summary":
      "Open with the key story, the reduction direction, and 2-3 dashboard-style headline points.",
    "Emissions Footprint":
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
    acc[section] = promptMap[section] || `Draft the ${section.toLowerCase()} narrative here.`;
    return acc;
  }, {} as DraftNotes);
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
  const [reportVersions, setReportVersions] = useState<ReportVersion[]>([]);
  const [draftNotes, setDraftNotes] = useState<DraftNotes>(() => buildInitialDraftNotes(PROFILE_LIBRARY[0]));
  const [loading, setLoading] = useState(true);
  const [savingTemplateId, setSavingTemplateId] = useState<number | null>(null);
  const [savingReportVersion, setSavingReportVersion] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [assignmentRes, actionsRes, versionsRes] = await Promise.all([
        fetch(`${baseUrl}/jobs/${jobId}/report-template-assignment`, { credentials: "include" }),
        fetch(`${baseUrl}/jobs/${jobId}/report-actions`, { credentials: "include" }),
        fetch(`${baseUrl}/jobs/${jobId}/report-versions`, { credentials: "include" }),
      ]);

      if (!assignmentRes.ok) {
        throw new Error(`Failed to load report template assignment (${assignmentRes.status})`);
      }
      if (!actionsRes.ok) {
        throw new Error(`Failed to load report actions (${actionsRes.status})`);
      }
      if (!versionsRes.ok) {
        throw new Error(`Failed to load report versions (${versionsRes.status})`);
      }

      const assignmentPayload = await assignmentRes.json();
      const actionsPayload = await actionsRes.json();
      const versionsPayload = await versionsRes.json();

      const availableTemplates: ReportTemplate[] = Array.isArray(assignmentPayload?.available_templates)
        ? assignmentPayload.available_templates
        : [];
      const currentAssignment: TemplateAssignment | null = assignmentPayload?.assignment || null;

      setTemplates(availableTemplates);
      setAssignment(currentAssignment);
      setActionsSummary(actionsPayload || null);
      setReportVersions(Array.isArray(versionsPayload?.versions) ? versionsPayload.versions : []);

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

  const draftStorageKey = useMemo(
    () => `report-draft:${jobId}:${selectedProfile.templateKey}`,
    [jobId, selectedProfile.templateKey]
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as DraftNotes;
        setDraftNotes(() => {
          const next = buildInitialDraftNotes(selectedProfile);
          selectedProfile.sections.forEach((section) => {
            next[section] = typeof parsed?.[section] === "string" ? parsed[section] : next[section];
          });
          return next;
        });
        return;
      }
    } catch {
      // Fall back to the default prompts below.
    }
    setDraftNotes(buildInitialDraftNotes(selectedProfile));
  }, [draftStorageKey, selectedProfile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(draftNotes));
    } catch {
      // Ignore storage failures in private/incognito contexts.
    }
  }, [draftNotes, draftStorageKey]);

  const selectedActions = Array.isArray(actionsSummary?.items) ? actionsSummary.items.length : 0;
  const shortActions = actionsSummary?.term_counts?.short || 0;
  const mediumActions = actionsSummary?.term_counts?.medium || 0;
  const longActions = actionsSummary?.term_counts?.long || 0;
  const activeAssignmentLabel =
    assignment?.template_name || availableTemplate?.template_name || selectedProfile.title;

  const draftReady = Boolean(assignment?.template_id) && selectedActions > 0;
  const draftedSectionCount = selectedProfile.sections.filter((section) => String(draftNotes[section] || "").trim().length > 0).length;
  const draftStarted = draftedSectionCount > 0;
  const previewStatus = draftReady
    ? "Ready for preview"
    : "Preview is available, but the checklist is still incomplete";
  const latestReportVersion = reportVersions[0] || null;
  const previewChecklist = useMemo(
    () => [
      {
        label: "Profile assigned",
        done: Boolean(assignment?.template_id),
        note: "A report family is selected for this job.",
      },
      {
        label: "Actions saved",
        done: selectedActions > 0,
        note: "The action plan will flow into the report section.",
      },
      {
        label: "Draft content started",
        done: draftStarted,
        note: "At least one section has working draft text.",
      },
      {
        label: "Ready to preview",
        done: draftReady,
        note: "You can now open the preview/export flow.",
      },
    ],
    [assignment?.template_id, draftReady, draftStarted, selectedActions]
  );

  const saveReviewPdf = useCallback(async () => {
    setSavingReportVersion(true);
    setStatus("");
    setError("");
    try {
      const res = await fetch(
        `${baseUrl}/jobs/${jobId}/generate-report-with-assets?save_version=true&report_version_status=review`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      if (!res.ok) {
        let message = `Failed to save review PDF (${res.status})`;
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
      const filename = filenameMatch?.[1] || `job-${jobId}-emissions-report.pdf`;
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      const versionNumber = res.headers.get("X-Report-Version-Number") || "";
      const versionLabel = res.headers.get("X-Report-Version-Label") || `v${versionNumber || "?"}`;
      setStatus(`Saved review PDF as ${versionLabel}.`);
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save review PDF");
    } finally {
      setSavingReportVersion(false);
    }
  }, [baseUrl, jobId, loadWorkspace]);

  const markVersionFinal = useCallback(
    async (reportVersionId: number) => {
      setSavingReportVersion(true);
      setStatus("");
      setError("");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/report-versions/${reportVersionId}`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "final" }),
        });
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
        setError(err instanceof Error ? err.message : "Failed to mark version final");
      } finally {
        setSavingReportVersion(false);
      }
    },
    [baseUrl, jobId, loadWorkspace]
  );

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

  function updateDraftNote(section: string, value: string) {
    setDraftNotes((prev) => ({ ...prev, [section]: value }));
  }

  function clearDraftNotes() {
    setDraftNotes(buildInitialDraftNotes(selectedProfile));
    setStatus("Draft canvas reset to the starter prompts.");
  }

  function openPreviewModal() {
    setPreviewModalOpen(true);
  }

  function closePreviewModal() {
    setPreviewModalOpen(false);
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
              <Button variant="outline" onClick={openPreviewModal} className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <FileText className="h-4 w-4" />
                Open Preview Checklist
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

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
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

        <Card>
          <CardHeader className="space-y-2">
            <CardTitle>Stage 3 Draft Content</CardTitle>
            <CardDescription>
              Write the first pass of the report section by section. The notes below stay local to this browser for now.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-white">
                  {selectedProfile.subtitle}
                </Badge>
                <Badge variant="outline" className="bg-white">
                  {draftedSectionCount}/{selectedProfile.sections.length} sections started
                </Badge>
                <Badge variant="outline" className="bg-white">
                  {selectedActions} actions ready
                </Badge>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Use the canvas to capture the draft storyline, then move to preview/export when the section notes feel coherent.
              </p>
            </div>

            <div className="space-y-4">
              {selectedProfile.sections.map((section) => (
                <div key={section} className="space-y-2 rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{section}</div>
                    <Badge variant="outline" className="bg-slate-50">
                      {String(draftNotes[section] || "").trim() ? "Drafted" : "Starter prompt"}
                    </Badge>
                  </div>
                  <Textarea
                    value={draftNotes[section] || ""}
                    onChange={(event) => updateDraftNote(section, event.target.value)}
                    rows={4}
                    placeholder={`Draft the ${section.toLowerCase()} content for this report...`}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={clearDraftNotes}>
                Reset draft canvas
              </Button>
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
                { label: "3. Draft content", done: draftStarted, note: "Work section by section without hard required blockers." },
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
            <CardHeader className="space-y-2">
              <CardTitle>Stage 4 Preview & Export</CardTitle>
              <CardDescription>
                Review the draft, confirm the checklist, and hand off into preview/export.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-white">
                    Stage 4 checkpoint
                  </Badge>
                  <Badge variant="outline" className="bg-white">
                    {draftReady ? "Ready to review" : "Needs attention"}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  Review the current draft, confirm the checkpoint, and then open the live preview/export flow.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  { label: "Profile assigned", done: Boolean(assignment?.template_id), note: "A report family is selected for this job." },
                  { label: "Actions saved", done: selectedActions > 0, note: "The action plan will flow into the report section." },
                  { label: "Draft content started", done: draftStarted, note: "At least one section has working draft text." },
                  { label: "Ready to preview", done: draftReady, note: "You can now open the preview/export flow." },
                ].map((item) => (
                  <div key={item.label} className="flex gap-3 rounded-lg border p-3">
                    <CheckCircle2 className={`mt-0.5 h-5 w-5 ${item.done ? "text-emerald-600" : "text-slate-300"}`} />
                    <div>
                      <div className="font-medium text-slate-900">{item.label}</div>
                      <div className="text-sm text-muted-foreground">{item.note}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border bg-white p-4">
                <div className="flex items-start gap-3">
                  <LayoutGrid className="mt-0.5 h-4 w-4 text-slate-600" />
                  <div>
                    <div className="font-medium text-slate-900">Executive Summary dashboard</div>
                    <div className="text-sm text-muted-foreground">Use KPI cards, charts, and a quick visual story for the reader.</div>
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-3">
                  <LineChart className="mt-0.5 h-4 w-4 text-slate-600" />
                  <div>
                    <div className="font-medium text-slate-900">Charts and graphs</div>
                    <div className="text-sm text-muted-foreground">Keep pies/donuts where they add quick interpretation and polish.</div>
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-3">
                  <Target className="mt-0.5 h-4 w-4 text-slate-600" />
                  <div>
                    <div className="font-medium text-slate-900">Actions-led narrative</div>
                    <div className="text-sm text-muted-foreground">Carry the action plan into the final story so the report feels actionable.</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900">Version history</div>
                    <div className="text-sm text-muted-foreground">
                      Save a reviewed PDF version to the client folder, then mark it final once the client agrees.
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-white">
                    {reportVersions.length} saved
                  </Badge>
                </div>
                <div className="mt-3 space-y-2">
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
                      <div className="text-sm text-muted-foreground">
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
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed bg-white px-3 py-2 text-sm text-muted-foreground">
                      No saved versions yet. Save the first review PDF when you are ready.
                    </div>
                  )}
                  {reportVersions.slice(1, 4).map((version) => (
                    <div key={version.report_version_id} className="flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">
                          {version.version_label || `v${version.version_number}`}
                        </span>
                        <Badge variant="outline" className="bg-slate-50">
                          {version.status || "review"}
                        </Badge>
                      </div>
                      {version.download_url ? (
                        <a
                          href={`${baseUrl}${version.download_url}`}
                          className="text-slate-600 underline-offset-4 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                          >
                            Download
                          </a>
                        ) : null}
                      {version.snapshot_url ? (
                        <a
                          href={`${baseUrl}${version.snapshot_url}`}
                          className="text-slate-600 underline-offset-4 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Frozen preview
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={openPreviewModal} className="gap-2">
                  <FileText className="h-4 w-4" />
                  Preview & Export
                </Button>
                <Button onClick={saveReviewPdf} disabled={savingReportVersion} variant="secondary" className="gap-2">
                  <FileText className="h-4 w-4" />
                  {savingReportVersion ? "Saving review PDF..." : "Save review PDF"}
                </Button>
                <Button variant="outline" onClick={() => onOpenActions?.()}>
                  Review Actions
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="max-w-3xl border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle>Preview checklist</DialogTitle>
            <DialogDescription>
              Review the current draft state before jumping into the renderer. This keeps Stage 4 explicit without blocking drafting.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-white">
                  {selectedProfile.title} - {selectedProfile.subtitle}
                </Badge>
                <Badge variant="outline" className="bg-white">
                  {selectedActions} actions selected
                </Badge>
                <Badge variant="outline" className="bg-white">
                  {draftedSectionCount}/{selectedProfile.sections.length} sections drafted
                </Badge>
                <Badge variant="outline" className="bg-white">
                  {previewStatus}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                The renderer will use the selected profile, the saved actions, and the draft notes already captured in Stage 3.
              </p>
            </div>

            {!draftReady ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                The preview can still open, but the actions section is incomplete until at least one suggested or custom action is saved.
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-3">
                {previewChecklist.map((item) => (
                  <div key={item.label} className="flex gap-3 rounded-lg border p-3">
                    <CheckCircle2 className={`mt-0.5 h-5 w-5 ${item.done ? 'text-emerald-600' : 'text-slate-300'}`} />
                    <div>
                      <div className="font-medium text-slate-900">{item.label}</div>
                      <div className="text-sm text-muted-foreground">{item.note}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-dashed bg-white p-4">
                <div className="flex items-start gap-3">
                  <LayoutGrid className="mt-0.5 h-4 w-4 text-slate-600" />
                  <div>
                    <div className="font-medium text-slate-900">Preview focus</div>
                    <div className="text-sm text-muted-foreground">
                      Keep the executive summary, charts, and action visuals front and center so the report reads like a dashboard first.
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-sm text-slate-700">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Executive summary with headline metrics and chart-led interpretation.
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Graphics that support quick reading: pies, donuts, bars, and reduction trend visuals.
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Actions carried through as the narrative bridge into the draft output.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closePreviewModal}>
              Back to draft
            </Button>
            <Button variant="outline" onClick={() => onOpenActions?.()}>
              Review actions
            </Button>
            <Button
              onClick={saveReviewPdf}
              disabled={savingReportVersion}
              variant="secondary"
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              {savingReportVersion ? "Saving review PDF..." : "Save review PDF"}
            </Button>
            <Button
              onClick={() => {
                closePreviewModal();
                onOpenLegacyReporting?.();
              }}
              disabled={!onOpenLegacyReporting}
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              Open preview & export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


