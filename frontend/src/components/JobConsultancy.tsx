"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatJobFamilyLabel, getJobFamilyDescription, jobFamilyBadgeClassName } from "@/lib/job-family";

type JobConsultancyProps = {
  jobId: number;
  baseUrl: string;
  jobFamily?: string | null;
};

type ConsultancyDetails = {
  job_id: number | null;
  engagement_type: string | null;
  deliverables: string | null;
  workshop_count: number | null;
  hours_budget: number | null;
  hours_used: number | null;
  next_review_date: string | null;
  summary_notes: string | null;
};

export default function JobConsultancy({ jobId, baseUrl, jobFamily }: JobConsultancyProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [details, setDetails] = useState<ConsultancyDetails>({
    job_id: null,
    engagement_type: null,
    deliverables: null,
    workshop_count: null,
    hours_budget: null,
    hours_used: null,
    next_review_date: null,
    summary_notes: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setStatus("");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/consultancy-details`, { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as ConsultancyDetails;
        if (!cancelled) setDetails(json);
      } catch {
        if (!cancelled) setStatus("Failed to load consultancy details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (jobFamily === "consultancy") void load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobFamily, jobId]);

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/consultancy-details`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(details),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }
      const json = (await res.json()) as ConsultancyDetails;
      setDetails(json);
      setStatus("Consultancy details saved.");
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (jobFamily !== "consultancy") return null;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="tracking-tight" style={{ color: "#7C3AED" }}>
          Consultancy Details
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge className={jobFamilyBadgeClassName("consultancy")} variant="outline">
            {formatJobFamilyLabel("consultancy")}
          </Badge>
          <span>{getJobFamilyDescription("consultancy")}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Capture the core details for the consultancy engagement. This section is specific to the Consultancy job family.
        </p>
        {status ? <div className="rounded-md bg-muted px-3 py-2 text-sm">{status}</div> : null}
        {loading ? <div className="text-sm text-muted-foreground">Loading consultancy details...</div> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="engagementType">Engagement Type</Label>
            <Input
              id="engagementType"
              value={details.engagement_type || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, engagement_type: e.target.value || null }))}
              placeholder="Advisory / audit / strategy / support"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nextReviewDate">Next Review Date</Label>
            <Input
              id="nextReviewDate"
              type="date"
              value={details.next_review_date || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, next_review_date: e.target.value || null }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workshopCount">Workshop Count</Label>
            <Input
              id="workshopCount"
              type="number"
              min="0"
              value={details.workshop_count ?? ""}
              onChange={(e) =>
                setDetails((prev) => ({
                  ...prev,
                  workshop_count: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hoursBudget">Hours Budget</Label>
            <Input
              id="hoursBudget"
              type="number"
              min="0"
              step="0.25"
              value={details.hours_budget ?? ""}
              onChange={(e) =>
                setDetails((prev) => ({
                  ...prev,
                  hours_budget: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hoursUsed">Hours Used</Label>
            <Input
              id="hoursUsed"
              type="number"
              min="0"
              step="0.25"
              value={details.hours_used ?? ""}
              onChange={(e) =>
                setDetails((prev) => ({
                  ...prev,
                  hours_used: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="deliverables">Deliverables</Label>
          <Textarea
            id="deliverables"
            value={details.deliverables || ""}
            onChange={(e) => setDetails((prev) => ({ ...prev, deliverables: e.target.value || null }))}
            rows={3}
            placeholder="Summarise the deliverables or outputs for this engagement..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="summaryNotes">Summary Notes</Label>
          <Textarea
            id="summaryNotes"
            value={details.summary_notes || ""}
            onChange={(e) => setDetails((prev) => ({ ...prev, summary_notes: e.target.value || null }))}
            rows={4}
            placeholder="Optional internal notes, feedback, or next steps..."
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save Consultancy Details"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
