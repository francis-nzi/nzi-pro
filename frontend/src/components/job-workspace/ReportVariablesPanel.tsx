"use client";

import { useEffect, useState } from "react";
import JobReportVariablesSection from "./JobReportVariablesSection";
import {
  AUTO_REPORT_METADATA_FIELDS,
  JOB_SETUP_METADATA_FALLBACK_FIELDS,
  JOB_SETUP_METADATA_KEY_ORDER,
  JOB_SETUP_METADATA_KEYS,
  buildMetadataFieldValues,
  normalizeMetadataFormValue,
  type ReportMetadataField,
} from "@/lib/job-workspace";

type ConsultantOption = {
  user_id?: string | null;
  full_name: string | null;
  position?: string | null;
};

type ReportVariablesPanelProps = {
  jobId: number;
  baseUrl: string;
};

export default function ReportVariablesPanel({ jobId, baseUrl }: ReportVariablesPanelProps) {
  const [fields, setFields] = useState<ReportMetadataField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [consultantOptions, setConsultantOptions] = useState<ConsultantOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(jobId) || jobId <= 0) return;
      setLoading(true);
      try {
        const [metaRes, teamRes] = await Promise.all([
          fetch(`${baseUrl}/jobs/${jobId}/report-metadata`),
          fetch(`${baseUrl}/jobs/${jobId}/team`),
        ]);

        if (!cancelled) {
          // Team members for consultant dropdown
          if (teamRes.ok) {
            const teamData = await teamRes.json() as { members?: ConsultantOption[] };
            setConsultantOptions(
              (teamData.members ?? []).filter((m) => m.full_name)
            );
          }

          // Report metadata fields + values
          if (metaRes.ok) {
            const payload = await metaRes.json() as {
              fields?: ReportMetadataField[];
              metadata?: Record<string, unknown>;
            };
            const rawFields = Array.isArray(payload?.fields) ? payload.fields : [];
            const filtered = rawFields.filter((f) =>
              JOB_SETUP_METADATA_KEY_ORDER.has(f.key as (typeof JOB_SETUP_METADATA_KEYS)[number])
            );
            const effectiveFields = filtered.length > 0 ? filtered : JOB_SETUP_METADATA_FALLBACK_FIELDS;
            const metadata = (payload?.metadata ?? {}) as Record<string, unknown>;
            setApiUnavailable(false);
            setFields(effectiveFields);
            setFieldValues(buildMetadataFieldValues(effectiveFields, metadata));
          } else if (metaRes.status === 404) {
            setApiUnavailable(true);
            setFields(JOB_SETUP_METADATA_FALLBACK_FIELDS);
            setFieldValues(buildMetadataFieldValues(JOB_SETUP_METADATA_FALLBACK_FIELDS, {}));
          }
        }
      } catch {
        if (!cancelled) {
          setApiUnavailable(true);
          setFields(JOB_SETUP_METADATA_FALLBACK_FIELDS);
          setFieldValues(buildMetadataFieldValues(JOB_SETUP_METADATA_FALLBACK_FIELDS, {}));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [jobId, baseUrl]);

  async function handleSave() {
    if (fields.length === 0 || apiUnavailable) return;
    setSaving(true);
    setStatus("Saving…");
    try {
      const payload: Record<string, string> = {};
      fields.forEach((f) => {
        if (AUTO_REPORT_METADATA_FIELDS.has(f.key)) return;
        payload[f.key] = fieldValues[f.key] ?? "";
      });

      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: payload }),
        credentials: "include",
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status}${text ? ` – ${text}` : ""}`);
        return;
      }

      const updated = await res.json() as { metadata?: Record<string, unknown> };
      const refreshed = (updated?.metadata ?? {}) as Record<string, unknown>;
      setFieldValues((prev) => {
        const next = { ...prev };
        fields.forEach((f) => {
          const v = normalizeMetadataFormValue(f.field_type, refreshed[f.key]);
          if (v !== "") next[f.key] = v;
        });
        return next;
      });
      setStatus("Saved successfully.");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="py-4 text-sm text-muted-foreground">Loading report variables…</div>;
  }

  const fieldsBySection: Record<string, ReportMetadataField[]> = {};
  fields.forEach((f) => {
    if (!fieldsBySection[f.section]) fieldsBySection[f.section] = [];
    fieldsBySection[f.section].push(f);
  });

  return (
    <JobReportVariablesSection
      fieldsBySection={fieldsBySection}
      fieldValues={fieldValues}
      consultantOptions={consultantOptions}
      apiUnavailable={apiUnavailable}
      saving={saving}
      status={status}
      onValueChange={(key, val) => setFieldValues((prev) => ({ ...prev, [key]: val }))}
      onSave={() => void handleSave()}
      hasFields={fields.length > 0}
    />
  );
}
