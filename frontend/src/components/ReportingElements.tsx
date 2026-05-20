"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Fields = {
  employee_number: string;
  premises_owned: string;
  premises_leased: string;
  vehicles_owned: string;
  vehicles_leased: string;
};

const EMPTY: Fields = {
  employee_number: "0",
  premises_owned: "0",
  premises_leased: "0",
  vehicles_owned: "0",
  vehicles_leased: "0",
};

const FIELD_LABELS: [keyof Fields, string][] = [
  ["employee_number",  "No. of Staff"],
  ["premises_owned",   "No. of Premises Owned"],
  ["premises_leased",  "No. of Premises Leased"],
  ["vehicles_owned",   "No. of Vehicles Owned"],
  ["vehicles_leased",  "No. of Vehicles Leased"],
];

export default function ReportingElements({
  jobId,
  baseUrl,
}: {
  jobId: number;
  baseUrl: string;
}) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [metaRes, intensityRes] = await Promise.all([
        fetch(`${baseUrl}/jobs/${jobId}/report-metadata`, { credentials: "include" }),
        fetch(`${baseUrl}/jobs/${jobId}/intensity-metrics`, { credentials: "include" }),
      ]);
      if (!metaRes.ok) return;
      const data = await metaRes.json() as { metadata?: Record<string, unknown> };
      const meta = data.metadata ?? {};
      const intensityData = intensityRes.ok ? await intensityRes.json() as { metrics?: Record<string, { value?: unknown }> } : {};
      const employeeMetricValue = intensityData.metrics?.employees?.value;
      const employeeNumberFromIntensity = employeeMetricValue != null && employeeMetricValue !== ""
        ? String(employeeMetricValue)
        : "";
      setFields({
        employee_number: employeeNumberFromIntensity || (meta.employee_number != null ? String(meta.employee_number) : "0"),
        premises_owned:  meta.premises_owned  != null ? String(meta.premises_owned)  : "0",
        premises_leased: meta.premises_leased != null ? String(meta.premises_leased) : "0",
        vehicles_owned:  meta.vehicles_owned  != null ? String(meta.vehicles_owned)  : "0",
        vehicles_leased: meta.vehicles_leased != null ? String(meta.vehicles_leased) : "0",
      });
    } catch {
      // leave defaults
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handleIntensityMetricsSaved = (event: Event) => {
      const customEvent = event as CustomEvent<{ jobId?: number; employeeNumber?: number }>;
      if (customEvent.detail?.jobId !== jobId) return;
      const nextEmployee = customEvent.detail.employeeNumber;
      if (nextEmployee != null && !Number.isNaN(nextEmployee)) {
        setFields(prev => ({ ...prev, employee_number: String(nextEmployee) }));
      }
    };

    window.addEventListener("intensity-metrics-saved", handleIntensityMetricsSaved as EventListener);
    return () => {
      window.removeEventListener("intensity-metrics-saved", handleIntensityMetricsSaved as EventListener);
    };
  }, [jobId]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const metadata: Record<string, number | null> = {};
      for (const [key] of FIELD_LABELS) {
        const raw = fields[key].trim();
        metadata[key] = raw === "" ? null : Number(raw);
      }
      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ metadata }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);

      // Sync employee count to intensity-metrics so the PDF report reflects it
      const employeeCount = metadata.employee_number;
      if (employeeCount != null && employeeCount > 0) {
        try {
          await fetch(`${baseUrl}/jobs/${jobId}/intensity-metrics`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ metrics: { employees: { value: employeeCount } } }),
          });
        } catch {
          // Non-fatal — report-metadata already saved
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reporting Elements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          These figures appear in the Background &amp; Organisation section of the carbon report. Enter 0 if not applicable.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELD_LABELS.map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`re-${key}`}>{label}</Label>
              <Input
                id={`re-${key}`}
                type="number"
                min="0"
                placeholder="0"
                value={fields[key]}
                onChange={(e) => setFields(prev => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Reporting Elements"}
          </Button>
          {saved && <span className="text-sm text-green-600">Saved</span>}
        </div>
      </CardContent>
    </Card>
  );
}
