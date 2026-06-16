"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type AiProfile = {
  profile_id: number;
  profile_name: string;
  company_context: string | null;
  industry_context: string | null;
  tone: string | null;
  audience_notes: string | null;
  narrative_notes: string | null;
  preferred_terms_json: string | null;
  forbidden_terms_json: string | null;
  section_notes_json: string | null;
  status: string;
  version: number;
  updated_at: string | null;
};

type SectionNotes = {
  executive_summary: string;
  emissions_overview: string;
  actions: string;
  declaration: string;
};

type Props = {
  clientId: number;
  clientName?: string | null;
  clientWebsite?: string | null;
  baseUrl: string;
};

function parseList(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join(", ");
    if (typeof parsed === "object" && parsed !== null) return Object.values(parsed).join(", ");
  } catch {
    // already plain text
  }
  return String(raw);
}

function parseSectionNotes(raw: string | null): SectionNotes {
  const empty: SectionNotes = {
    executive_summary: "",
    emissions_overview: "",
    actions: "",
    declaration: "",
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return {
      executive_summary: parsed.executive_summary || "",
      emissions_overview: parsed.emissions_overview || "",
      actions: parsed.actions || "",
      declaration: parsed.declaration || "",
    };
  } catch {
    return empty;
  }
}

function listToArray(text: string): string[] | null {
  const items = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

export default function ClientAiProfile({ clientId, clientName, clientWebsite, baseUrl }: Props) {
  const [profile, setProfile] = useState<AiProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"" | "saved" | "error" | "generated">("");
  const [saveMessage, setSaveMessage] = useState("");

  const [companyContext, setCompanyContext] = useState("");
  const [industryContext, setIndustryContext] = useState("");
  const [tone, setTone] = useState("");
  const [audienceNotes, setAudienceNotes] = useState("");
  const [narrativeNotes, setNarrativeNotes] = useState("");
  const [preferredTerms, setPreferredTerms] = useState("");
  const [forbiddenTerms, setForbiddenTerms] = useState("");
  const [sectionNotes, setSectionNotes] = useState<SectionNotes>({
    executive_summary: "",
    emissions_overview: "",
    actions: "",
    declaration: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}/ai-prompt-profile`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { profile: AiProfile | null };
        if (cancelled) return;
        if (data.profile) {
          const p = data.profile;
          setProfile(p);
          setCompanyContext(p.company_context || "");
          setIndustryContext(p.industry_context || "");
          setTone(p.tone || "");
          setAudienceNotes(p.audience_notes || "");
          setNarrativeNotes(p.narrative_notes || "");
          setPreferredTerms(parseList(p.preferred_terms_json));
          setForbiddenTerms(parseList(p.forbidden_terms_json));
          setSectionNotes(parseSectionNotes(p.section_notes_json));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId]);

  async function save(status: "active" | "draft") {
    setSaving(true);
    setSaveStatus("");
    setSaveMessage("");
    try {
      const sectionNotesPayload: Record<string, string> = {};
      if (sectionNotes.executive_summary) sectionNotesPayload.executive_summary = sectionNotes.executive_summary;
      if (sectionNotes.emissions_overview) sectionNotesPayload.emissions_overview = sectionNotes.emissions_overview;
      if (sectionNotes.actions) sectionNotesPayload.actions = sectionNotes.actions;
      if (sectionNotes.declaration) sectionNotesPayload.declaration = sectionNotes.declaration;

      const payload = {
        profile_name: clientName ? `${clientName} — AI Profile` : "Client AI Profile",
        company_context: companyContext || null,
        industry_context: industryContext || null,
        tone: tone || null,
        audience_notes: audienceNotes || null,
        narrative_notes: narrativeNotes || null,
        preferred_terms_json: listToArray(preferredTerms),
        forbidden_terms_json: listToArray(forbiddenTerms),
        section_notes_json: Object.keys(sectionNotesPayload).length > 0 ? sectionNotesPayload : null,
        status,
      };

      const res = await fetch(`${baseUrl}/clients/${clientId}/ai-prompt-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Save failed (${res.status})`);
      }

      const data = (await res.json()) as { profile: AiProfile };
      setProfile(data.profile);
      setSaveStatus("saved");
      setSaveMessage(status === "active" ? "Profile saved and activated — all future AI insights for this client will use it." : "Profile saved as draft.");
    } catch (e) {
      setSaveStatus("error");
      setSaveMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function generateDraft() {
    setGenerating(true);
    setSaveStatus("");
    setSaveMessage("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/ai-prompt-profile/generate-draft`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Generation failed (${res.status})`);
      }
      const data = (await res.json()) as {
        draft: {
          company_context: string;
          industry_context: string;
          tone: string;
          audience_notes: string;
          narrative_notes: string;
          preferred_terms: string[];
          forbidden_terms: string[];
          section_notes: {
            executive_summary?: string;
            emissions_overview?: string;
            actions?: string;
            declaration?: string;
          };
        };
        website_scraped: boolean;
      };
      const d = data.draft;
      if (d.company_context) setCompanyContext(d.company_context);
      if (d.industry_context) setIndustryContext(d.industry_context);
      if (d.tone) setTone(d.tone);
      if (d.audience_notes) setAudienceNotes(d.audience_notes);
      if (d.narrative_notes) setNarrativeNotes(d.narrative_notes);
      if (Array.isArray(d.preferred_terms) && d.preferred_terms.length > 0)
        setPreferredTerms(d.preferred_terms.join(", "));
      if (Array.isArray(d.forbidden_terms) && d.forbidden_terms.length > 0)
        setForbiddenTerms(d.forbidden_terms.join(", "));
      if (d.section_notes) {
        setSectionNotes({
          executive_summary: d.section_notes.executive_summary || "",
          emissions_overview: d.section_notes.emissions_overview || "",
          actions: d.section_notes.actions || "",
          declaration: d.section_notes.declaration || "",
        });
      }
      setSaveStatus("generated");
      setSaveMessage(
        data.website_scraped
          ? "Draft generated from client data and website review. Review each field and save when ready."
          : "Draft generated from client data (no website available to review). Review each field and save when ready."
      );
    } catch (e) {
      setSaveStatus("error");
      setSaveMessage((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading AI profile...</div>;
  }

  const isActive = profile?.status === "active";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border bg-card/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">AI Client Profile</div>
            <h3 className="text-2xl font-semibold tracking-tight">
              {clientName ? `${clientName}` : "Client"} — AI context
            </h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              This profile is automatically included in every AI insight generated for this client. Fill in as much
              context as you can — the richer the profile, the more relevant the outputs.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {profile ? (
              <>
                <Badge variant={isActive ? "default" : "outline"} className={isActive ? "bg-green-700 text-white" : ""}>
                  {isActive ? "Active" : "Draft"}
                </Badge>
                <span className="text-xs text-muted-foreground">v{profile.version}</span>
              </>
            ) : (
              <Badge variant="outline">No profile yet</Badge>
            )}
            <div className="flex flex-col items-end gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={generating || saving}
                onClick={() => void generateDraft()}
                className="gap-2"
              >
                {generating ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Generating…
                  </>
                ) : (
                  <>✦ Generate Draft</>
                )}
              </Button>
              {clientWebsite ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Website available
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  No website — add in Edit Client
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save status */}
      {saveMessage ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            saveStatus === "saved"
              ? "border-green-200 bg-green-50 text-green-800"
              : saveStatus === "generated"
              ? "border-blue-200 bg-blue-50 text-blue-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {saveMessage}
        </div>
      ) : null}

      {/* Main fields */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Client background</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="aiCompanyContext">About this client</Label>
              <Textarea
                id="aiCompanyContext"
                rows={5}
                placeholder="Describe the company — what they do, their size, structure, key challenges, and anything the AI should know to give relevant advice."
                value={companyContext}
                onChange={(e) => setCompanyContext(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="aiIndustryContext">Industry & market context</Label>
              <Textarea
                id="aiIndustryContext"
                rows={4}
                placeholder="Describe the industry, typical regulatory pressures, supply chain characteristics, and any sector-specific nuances."
                value={industryContext}
                onChange={(e) => setIndustryContext(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report style & audience</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="aiTone">Report tone</Label>
              <Input
                id="aiTone"
                placeholder="e.g. professional and concise, plain English for a non-technical board"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="aiAudienceNotes">Who reads this report</Label>
              <Textarea
                id="aiAudienceNotes"
                rows={3}
                placeholder="e.g. Board of directors, sustainability manager, external auditors. Include any technical level notes."
                value={audienceNotes}
                onChange={(e) => setAudienceNotes(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="aiNarrativeNotes">Key messages & narrative direction</Label>
              <Textarea
                id="aiNarrativeNotes"
                rows={4}
                placeholder="What story should the report tell? Any themes to emphasise or angles to take on the data?"
                value={narrativeNotes}
                onChange={(e) => setNarrativeNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Language preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Language preferences</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="aiPreferredTerms">Words & phrases to use</Label>
            <Textarea
              id="aiPreferredTerms"
              rows={3}
              placeholder="Comma-separated — e.g. carbon footprint, decarbonisation journey, net zero roadmap"
              value={preferredTerms}
              onChange={(e) => setPreferredTerms(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Separate each term with a comma.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="aiForbiddenTerms">Words & phrases to avoid</Label>
            <Textarea
              id="aiForbiddenTerms"
              rows={3}
              placeholder="Comma-separated — e.g. emissions, carbon neutral, greenwashing"
              value={forbiddenTerms}
              onChange={(e) => setForbiddenTerms(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Separate each term with a comma.</p>
          </div>
        </CardContent>
      </Card>

      {/* Section-specific notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Section-specific guidance</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="aiSectionExecSummary">Executive summary notes</Label>
            <Textarea
              id="aiSectionExecSummary"
              rows={3}
              placeholder="Any specific angle or emphasis for the executive summary section?"
              value={sectionNotes.executive_summary}
              onChange={(e) => setSectionNotes((prev) => ({ ...prev, executive_summary: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aiSectionEmissions">Emissions overview notes</Label>
            <Textarea
              id="aiSectionEmissions"
              rows={3}
              placeholder="Guidance for the emissions overview — e.g. focus on Scope 2, highlight year-on-year changes."
              value={sectionNotes.emissions_overview}
              onChange={(e) => setSectionNotes((prev) => ({ ...prev, emissions_overview: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aiSectionActions">Actions section notes</Label>
            <Textarea
              id="aiSectionActions"
              rows={3}
              placeholder="What should the actions section emphasise? Quick wins, long-term strategy, specific initiatives?"
              value={sectionNotes.actions}
              onChange={(e) => setSectionNotes((prev) => ({ ...prev, actions: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aiSectionDeclaration">Declaration notes</Label>
            <Textarea
              id="aiSectionDeclaration"
              rows={3}
              placeholder="Any specific sign-off language or format for the declaration?"
              value={sectionNotes.declaration}
              onChange={(e) => setSectionNotes((prev) => ({ ...prev, declaration: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-5 py-4">
        <div className="flex-1 space-y-0.5">
          <div className="text-sm font-medium">Ready to apply?</div>
          <div className="text-xs text-muted-foreground">
            Save &amp; Activate makes this the live profile used by all AI insights for this client.
            Save as Draft stores it without activating.
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={saving} onClick={() => save("draft")}>
            Save as Draft
          </Button>
          <Button disabled={saving} onClick={() => save("active")} className="bg-green-700 hover:bg-green-800 text-white">
            {saving ? "Saving…" : "Save & Activate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
