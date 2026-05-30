"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type JobTrainingProps = {
  jobId: number;
  baseUrl: string;
  jobFamily?: string | null;
};

type TrainingDetails = {
  job_id: number | null;
  training_date: string | null;
  delivery_format: string | null;
  topic: string | null;
  audience: string | null;
  attendee_count: number | null;
  session_duration_hours: number | null;
  materials_link: string | null;
  location: string | null;
  notes: string | null;
};

export default function JobTraining({ jobId, baseUrl, jobFamily }: JobTrainingProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [details, setDetails] = useState<TrainingDetails>({
    job_id: null,
    training_date: null,
    delivery_format: null,
    topic: null,
    audience: null,
    attendee_count: null,
    session_duration_hours: null,
    materials_link: null,
    location: null,
    notes: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setStatus("");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/training-details`, { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as TrainingDetails;
        if (!cancelled) setDetails(json);
      } catch {
        if (!cancelled) setStatus("Failed to load training details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (jobFamily === "training") {
      void load();
    }

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobFamily, jobId]);

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/training-details`, {
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
      const json = (await res.json()) as TrainingDetails;
      setDetails(json);
      setStatus("Training details saved.");
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (jobFamily !== "training") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle style={{ color: "#F26624" }}>Training Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Capture the core details for the training engagement. This section is specific to the Training job family.
        </p>
        {status ? <div className="rounded-md bg-muted px-3 py-2 text-sm">{status}</div> : null}
        {loading ? <div className="text-sm text-muted-foreground">Loading training details...</div> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="trainingDate">Training Date</Label>
            <Input
              id="trainingDate"
              type="date"
              value={details.training_date || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, training_date: e.target.value || null }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deliveryFormat">Delivery Format</Label>
            <Input
              id="deliveryFormat"
              value={details.delivery_format || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, delivery_format: e.target.value || null }))}
              placeholder="Onsite / remote / hybrid"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="topic">Topic</Label>
            <Input
              id="topic"
              value={details.topic || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, topic: e.target.value || null }))}
              placeholder="Carbon literacy, leadership training..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audience">Audience</Label>
            <Input
              id="audience"
              value={details.audience || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, audience: e.target.value || null }))}
              placeholder="Leadership team, staff, suppliers..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="attendees">Attendee Count</Label>
            <Input
              id="attendees"
              type="number"
              min="0"
              value={details.attendee_count ?? ""}
              onChange={(e) =>
                setDetails((prev) => ({
                  ...prev,
                  attendee_count: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="duration">Session Hours</Label>
            <Input
              id="duration"
              type="number"
              min="0"
              step="0.25"
              value={details.session_duration_hours ?? ""}
              onChange={(e) =>
                setDetails((prev) => ({
                  ...prev,
                  session_duration_hours: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="materialsLink">Materials Link</Label>
            <Input
              id="materialsLink"
              value={details.materials_link || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, materials_link: e.target.value || null }))}
              placeholder="Shared deck / folder link"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={details.location || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, location: e.target.value || null }))}
              placeholder="Onsite location or venue"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={details.notes || ""}
            onChange={(e) => setDetails((prev) => ({ ...prev, notes: e.target.value || null }))}
            rows={4}
            placeholder="Any delivery notes, follow-ups, or feedback..."
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save Training Details"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
