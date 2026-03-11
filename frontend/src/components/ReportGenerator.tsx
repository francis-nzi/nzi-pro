"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Save, AlertCircle, Link2 } from "lucide-react";

// Fields that are synced from Job Setup -> Intensity Metrics
// These should be read-only in the Reporting UI with a visual indicator
const SYNCED_METADATA_FIELDS = [
  "employee_number",
  "premises_owned",
  "premises_leased",
  "vehicles_owned",
  "vehicles_leased",
];

// Template-specific metadata visibility overrides to avoid showing fields
// that are not rendered by a given report template.
const TEMPLATE_METADATA_KEY_OVERRIDES: Record<string, string[]> = {
  crp_standard: [
    "employee_number",
    "premises_owned",
    "premises_leased",
    "vehicles_owned",
    "vehicles_leased",
    "operational_control",
    "financial_control",
    "equity_share",
  ],
};

type ReportTemplate = {
  template_id: number;
  template_key: string;
  template_name: string;
  template_type: string;
  description?: string;
  is_global?: boolean;
  client_db_id?: number | null;
  latest_version_id?: number | null;
  latest_version_number?: number | null;
};

type TemplateVersion = {
  version_id: number;
  template_id: number;
  version_number: number;
  version_label?: string | null;
  status?: string | null;
};

type TemplateAssignment = {
  job_id: number;
  template_id: number;
  version_id: number | null;
  assigned_at?: string | null;
  assigned_by?: string | null;
  template_name?: string;
  version_number?: number | null;
};

type TemplateVariable = {
  variable_id: number;
  variable_key: string;
  variable_label: string;
  variable_type: string;
  default_value: string | null;
  placeholder: string | null;
  help_text: string | null;
  is_required: boolean;
  display_order: number;
  section: string | null;
  variable_value: string | null;
};

type ReportMetadataField = {
  key: string;
  label: string;
  field_type: string;
  section: string;
  aliases?: string[];
};

type ReportGeneratorProps = {
  jobId: number;
  baseUrl?: string;
};

type ActivityPreview = {
  totals: Record<string, number>;
  order: string[];
  detailCount: number;
};

type ApiErrorDetails = {
  message: string;
  missingFields: string[];
  missingKeys: string[];
};

type ReportStep = "template" | "variables" | "metadata" | "generate";

export default function ReportGenerator({ jobId, baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "" }: ReportGeneratorProps) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [assignment, setAssignment] = useState<TemplateAssignment | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);

  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [metadataFields, setMetadataFields] = useState<ReportMetadataField[]>([]);
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingDocx, setGeneratingDocx] = useState(false);
  const [openingPreview, setOpeningPreview] = useState(false);
  const [downloadingHtml, setDownloadingHtml] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");

  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [metadataStatus, setMetadataStatus] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [missingRequiredFields, setMissingRequiredFields] = useState<string[]>([]);
  const [activityPreview, setActivityPreview] = useState<ActivityPreview | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activeStep, setActiveStep] = useState<ReportStep>("template");
  const [variableSearch, setVariableSearch] = useState("");
  const [showOnlyRequired, setShowOnlyRequired] = useState(false);
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);

  const normalizeBooleanValue = useCallback((value: string | null | undefined): string => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return "true";
    if (["false", "0", "no", "n", "off"].includes(normalized)) return "false";
    return "";
  }, []);

  const normalizeMetadataValue = useCallback((fieldType: string, value: unknown): string => {
    if (value == null) return "";
    if (fieldType === "boolean") {
      return normalizeBooleanValue(String(value));
    }
    if (fieldType === "date") {
      const raw = String(value).trim();
      if (!raw) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      if (raw.includes("T")) {
        const [datePart] = raw.split("T");
        if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
      }
      return raw;
    }
    return String(value);
  }, [normalizeBooleanValue]);

  const toStringArray = useCallback((value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map((v) => String(v));
  }, []);

  const readErrorDetails = useCallback(async (res: Response, fallback: string): Promise<ApiErrorDetails> => {
    const raw = await res.text();
    if (!raw) {
      return {
        message: fallback,
        missingFields: [],
        missingKeys: [],
      };
    }

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.detail === "string") {
        return {
          message: parsed.detail,
          missingFields: [],
          missingKeys: [],
        };
      }

      if (parsed?.detail && typeof parsed.detail === "object") {
        const message =
          typeof parsed.detail.message === "string"
            ? parsed.detail.message
            : typeof parsed.detail.error === "string"
              ? parsed.detail.error
              : fallback;

        const missingFields = toStringArray(parsed.detail.missing_fields);
        const missingKeys = toStringArray(parsed.detail.missing_keys);

        if (missingFields.length > 0) {
          return {
            message: `${message}: ${missingFields.join(", ")}`,
            missingFields,
            missingKeys,
          };
        }

        return { message, missingFields, missingKeys };
      }
    } catch {
      // Not JSON - return raw body text below
    }

    return {
      message: raw,
      missingFields: [],
      missingKeys: [],
    };
  }, [toStringArray]);

  const getMissingRequiredVariables = () => {
    return variables
      .filter((v) => v.is_required)
      .filter((v) => {
        const value = variableValues[v.variable_key];
        if (value == null) return true;
        return String(value).trim() === "";
      })
      .map((v) => v.variable_label || v.variable_key);
  };

  useEffect(() => {
    async function loadReportMetadata() {
      setLoadingMetadata(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/report-metadata`);
        if (!res.ok) {
          const details = await readErrorDetails(res, `Failed to load report metadata (${res.status})`);
          throw new Error(details.message);
        }

        const data = await res.json();
        const fields: ReportMetadataField[] = data?.fields || [];
        const metadata = (data?.metadata || {}) as Record<string, unknown>;

        const values: Record<string, string> = {};
        fields.forEach((field) => {
          values[field.key] = normalizeMetadataValue(field.field_type, metadata[field.key]);
        });

        setMetadataFields(fields);
        setMetadataValues(values);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoadingMetadata(false);
      }
    }

    loadReportMetadata();
  }, [baseUrl, jobId, normalizeMetadataValue, readErrorDetails]);

  // Load assignment context + available templates for this job
  useEffect(() => {
    async function loadAssignmentContext() {
      setLoadingTemplates(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/report-template-assignment`);
        if (!res.ok) throw new Error(`Failed to load template assignment: ${res.status}`);

        const data = await res.json();
        const available: ReportTemplate[] = data?.available_templates || [];
        const existingAssignment: TemplateAssignment | null = data?.assignment || null;

        setTemplates(available);
        setAssignment(existingAssignment);

        if (existingAssignment) {
          setSelectedTemplateId(existingAssignment.template_id);
          setSelectedVersionId(existingAssignment.version_id ?? null);
        } else if (available.length > 0) {
          const annualTemplate =
            available.find((t) => t.template_key === "annual_carbon_report") ??
            available.find((t) => t.template_type === "carbon_report") ??
            available[0];
          setSelectedTemplateId(annualTemplate.template_id);
          setSelectedVersionId(annualTemplate.latest_version_id ?? null);
        } else {
          setSelectedTemplateId(null);
          setSelectedVersionId(null);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoadingTemplates(false);
      }
    }

    loadAssignmentContext();
  }, [baseUrl, jobId]);

  // Load versions when template changes
  useEffect(() => {
    if (!selectedTemplateId) {
      setVersions([]);
      setSelectedVersionId(null);
      return;
    }

    async function loadVersions() {
      try {
        const res = await fetch(`${baseUrl}/report-templates/${selectedTemplateId}/versions`);
        if (!res.ok) throw new Error(`Failed to load versions: ${res.status}`);

        const data = await res.json();
        const v: TemplateVersion[] = data.items || [];
        setVersions(v);

        if (v.length === 0) {
          setSelectedVersionId(null);
          return;
        }

        const selectedStillExists = selectedVersionId != null && v.some((x) => x.version_id === selectedVersionId);
        if (!selectedStillExists) {
          setSelectedVersionId(v[0].version_id);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }

    loadVersions();
  }, [baseUrl, selectedTemplateId, selectedVersionId]);

  // Load variables when template/version changes
  useEffect(() => {
    if (!selectedTemplateId) {
      setVariables([]);
      setVariableValues({});
      return;
    }
    if (versions.length > 0 && !selectedVersionId) {
      setSelectedVersionId(versions[0].version_id);
      return;
    }

    async function loadVariables() {
      setLoading(true);
      setError("");
      try {
        const query = selectedVersionId ? `?version_id=${selectedVersionId}` : "";
        let res = await fetch(`${baseUrl}/jobs/${jobId}/report-variables/${selectedTemplateId}${query}`);
        if (!res.ok && res.status === 404 && selectedVersionId) {
          // Template switched and version is stale; retry with backend-resolved version.
          setSelectedVersionId(null);
          res = await fetch(`${baseUrl}/jobs/${jobId}/report-variables/${selectedTemplateId}`);
        }
        if (!res.ok) {
          throw new Error(`Failed to load variables: ${res.status}`);
        }
        const data = await res.json();
        const vars = data.items || [];
        setVariables(vars);
        
        // Initialize variable values
        const values: Record<string, string> = {};
        vars.forEach((v: TemplateVariable) => {
          const resolvedValue = v.variable_value || v.default_value || "";
          values[v.variable_key] =
            v.variable_type === "boolean" ? normalizeBooleanValue(resolvedValue) : resolvedValue;
        });
        setVariableValues(values);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    loadVariables();
  }, [selectedTemplateId, selectedVersionId, versions, jobId, baseUrl, normalizeBooleanValue]);

  useEffect(() => {
    setError("");
    setSaveStatus("");
    setMissingRequiredFields([]);
  }, [selectedTemplateId, selectedVersionId]);

  // Load activity grouping preview so users can see the new reporting behaviour in-tab
  useEffect(() => {
    let cancelled = false;

    async function loadActivityPreview() {
      setActivityLoading(true);
      setActivityError("");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/emissions-by-activity`);
        if (!res.ok) {
          throw new Error(`Failed to load activity preview (${res.status})`);
        }

        const data = await res.json();
        if (cancelled) return;

        const rawTotals = (data?.activity_totals || {}) as Record<string, number | string>;
        const totals: Record<string, number> = {};
        Object.entries(rawTotals).forEach(([k, v]) => {
          const n = Number(v);
          totals[k] = Number.isFinite(n) ? n : 0;
        });

        const order = Array.isArray(data?.activity_group_order)
          ? data.activity_group_order.map((x: unknown) => String(x))
          : Object.keys(totals);

        const detailCount = Array.isArray(data?.activity_details) ? data.activity_details.length : 0;

        setActivityPreview({ totals, order, detailCount });
      } catch (e) {
        if (!cancelled) {
          setActivityError((e as Error).message);
          setActivityPreview(null);
        }
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    }

    loadActivityPreview();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId]);

  const handleVariableChange = (key: string, value: string, variableType?: string) => {
    const normalizedValue = variableType === "boolean" ? normalizeBooleanValue(value) : value;
    setVariableValues(prev => ({ ...prev, [key]: normalizedValue }));
    setMissingRequiredFields([]);
  };

  const handleMetadataChange = (key: string, value: string, fieldType?: string) => {
    const normalized = fieldType === "boolean" ? normalizeBooleanValue(value) : value;
    setMetadataValues((prev) => ({ ...prev, [key]: normalized }));
  };

  const selectedTemplate = templates.find((t) => t.template_id === selectedTemplateId);
  const visibleMetadataFields = useMemo(() => {
    const templateKey = selectedTemplate?.template_key;
    if (!templateKey) return metadataFields;
    const overrideKeys = TEMPLATE_METADATA_KEY_OVERRIDES[templateKey];
    if (!overrideKeys || overrideKeys.length === 0) return metadataFields;
    const allowed = new Set(overrideKeys);
    return metadataFields.filter((field) => allowed.has(field.key));
  }, [metadataFields, selectedTemplate?.template_key]);

  const saveMetadata = async (): Promise<void> => {
    if (visibleMetadataFields.length === 0) {
      return;
    }

    setSavingMetadata(true);
    setMetadataStatus("");
    setError("");

    try {
      const payload: Record<string, string> = {};
      visibleMetadataFields.forEach((field) => {
        payload[field.key] = metadataValues[field.key] ?? "";
      });

      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: payload }),
      });

      if (!res.ok) {
        const details = await readErrorDetails(res, `Failed to save report metadata (${res.status})`);
        throw new Error(details.message);
      }

      const data = await res.json();
      const updated = (data?.metadata || {}) as Record<string, unknown>;
      const nextValues: Record<string, string> = { ...metadataValues };
      visibleMetadataFields.forEach((field) => {
        nextValues[field.key] = normalizeMetadataValue(field.field_type, updated[field.key]);
      });
      setMetadataValues(nextValues);

      setMetadataStatus("Report metadata saved successfully!");
      setTimeout(() => setMetadataStatus(""), 3000);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      throw e;
    } finally {
      setSavingMetadata(false);
    }
  };

  const assignTemplate = async (): Promise<number | null> => {
    if (!selectedTemplateId) {
      throw new Error("Please select a template first");
    }

    setAssigning(true);
    setAssignmentStatus("");
    setError("");

    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-template-assignment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedTemplateId,
          version_id: selectedVersionId,
        }),
      });

      if (!res.ok) {
        const details = await readErrorDetails(res, `Failed to assign template (${res.status})`);
        throw new Error(details.message);
      }

      const data = await res.json();
      const effectiveVersionId = data?.version_id ? Number(data.version_id) : selectedVersionId;
      if (effectiveVersionId && effectiveVersionId !== selectedVersionId) {
        setSelectedVersionId(effectiveVersionId);
      }

      const selectedTemplate = templates.find((t) => t.template_id === selectedTemplateId);
      const selectedVersion = versions.find((v) => v.version_id === (effectiveVersionId ?? selectedVersionId));

      setAssignment({
        job_id: jobId,
        template_id: selectedTemplateId,
        version_id: effectiveVersionId ?? null,
        template_name: selectedTemplate?.template_name,
        version_number: selectedVersion?.version_number ?? null,
      });

      setAssignmentStatus("Template assigned to job.");
      setActiveStep("variables");
      setTimeout(() => setAssignmentStatus(""), 3000);

      return effectiveVersionId ?? null;
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      throw e;
    } finally {
      setAssigning(false);
    }
  };

  const saveVariables = async (versionOverride: number | null = null): Promise<number> => {
    if (!selectedTemplateId) {
      throw new Error("Please select a template first");
    }

    const missing = getMissingRequiredVariables();
    if (missing.length > 0) {
      setMissingRequiredFields(missing);
      const message = "Please complete all required fields before saving.";
      setError(message);
      throw new Error(message);
    }

    setSaving(true);
    setSaveStatus("");
    setError("");
    setMissingRequiredFields([]);

    try {
      await saveMetadata();

      const payload = variables.map((variable) => ({
        variable_key: variable.variable_key,
        variable_value:
          variable.variable_type === "boolean"
            ? normalizeBooleanValue(variableValues[variable.variable_key])
            : (variableValues[variable.variable_key] ?? ""),
      }));

      let effectiveVersionId = versionOverride ?? selectedVersionId;
      if (!effectiveVersionId) {
        effectiveVersionId = await assignTemplate();
      }

      if (!effectiveVersionId) {
        throw new Error("A template version is required before saving. Please assign a template version to this job.");
      }

      const query = `?version_id=${effectiveVersionId}`;
      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-variables/${selectedTemplateId}${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: payload })
      });

      if (!res.ok) {
        const details = await readErrorDetails(res, `Failed to save variables (${res.status})`);
        if (details.missingFields.length > 0) {
          setMissingRequiredFields(details.missingFields);
        }
        throw new Error(details.message);
      }

      setSaveStatus("Variables saved successfully!");
      setActiveStep("generate");
      setTimeout(() => setSaveStatus(""), 3000);
      return effectiveVersionId;
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const generateReport = async () => {
    if (!selectedTemplateId) {
      setError("Please select a template first");
      return;
    }

    setGenerating(true);
    setError("");
    setMissingRequiredFields([]);

    try {
      // Validate required variables before any server action
      const missing = getMissingRequiredVariables();
      if (missing.length > 0) {
        setMissingRequiredFields(missing);
        throw new Error("Please complete all required fields before generating the report.");
      }

      // Ensure the template/version is assigned to this job and use the exact resolved version
      const effectiveVersionId = await assignTemplate();
      if (!effectiveVersionId) {
        throw new Error("A template version is required before report generation.");
      }

      // Save variables before generating
      await saveVariables(effectiveVersionId);

      const res = await fetch(`${baseUrl}/jobs/${jobId}/generate-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedTemplateId,
          version_id: effectiveVersionId,
        })
      });

      if (!res.ok) {
        const details = await readErrorDetails(res, `Failed to generate report (${res.status})`);
        throw new Error(details.message);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl);
      }
      setPdfPreviewUrl(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const generateDocxReport = async () => {
    if (!selectedTemplateId) {
      setError("Please select a template first");
      return;
    }

    setGeneratingDocx(true);
    setError("");
    setMissingRequiredFields([]);

    try {
      const missing = getMissingRequiredVariables();
      if (missing.length > 0) {
        setMissingRequiredFields(missing);
        throw new Error("Please complete all required fields before generating the DOCX report.");
      }

      const effectiveVersionId = await assignTemplate();
      if (!effectiveVersionId) {
        throw new Error("A template version is required before DOCX report generation.");
      }

      await saveVariables(effectiveVersionId);

      const res = await fetch(`${baseUrl}/jobs/${jobId}/generate-report-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedTemplateId,
          version_id: effectiveVersionId,
        }),
      });

      if (!res.ok) {
        const details = await readErrorDetails(res, `Failed to generate DOCX report (${res.status})`);
        let message = details.message;
        if (res.status === 501 || /dependency is not installed/i.test(message)) {
          message = `${message} Please install backend dependency \"python-docx\", restart the API server, and try again.`;
        } else if (res.status === 404) {
          message = `${message} The backend DOCX endpoint may be unavailable. Confirm the API is updated and restarted.`;
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `job-${jobId}-report.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingDocx(false);
    }
  };

  const openInteractivePreview = async () => {
    if (!selectedTemplateId) {
      setError("Please select a template first");
      return;
    }

    setOpeningPreview(true);
    setError("");
    setMissingRequiredFields([]);

    try {
      const missing = getMissingRequiredVariables();
      if (missing.length > 0) {
        setMissingRequiredFields(missing);
        throw new Error("Please complete all required fields before opening the interactive preview.");
      }

      const effectiveVersionId = await assignTemplate();
      if (!effectiveVersionId) {
        throw new Error("A template version is required before opening preview.");
      }

      await saveVariables(effectiveVersionId);

      const previewUrl = `${baseUrl}/jobs/${jobId}/generate-html-report?template_id=${selectedTemplateId}&version_id=${effectiveVersionId}`;
      const res = await fetch(previewUrl);
      if (!res.ok) {
        const details = await readErrorDetails(res, `Failed to open preview (${res.status})`);
        throw new Error(details.message);
      }
      const htmlBlob = await res.blob();
      const htmlUrl = URL.createObjectURL(htmlBlob);
      window.open(htmlUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(htmlUrl), 60_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpeningPreview(false);
    }
  };

  const downloadHtmlReport = async () => {
    if (!selectedTemplateId) {
      setError("Please select a template first");
      return;
    }

    setDownloadingHtml(true);
    setError("");
    setMissingRequiredFields([]);

    try {
      const missing = getMissingRequiredVariables();
      if (missing.length > 0) {
        setMissingRequiredFields(missing);
        throw new Error("Please complete all required fields before opening the HTML report.");
      }

      const effectiveVersionId = await assignTemplate();
      if (!effectiveVersionId) {
        throw new Error("A template version is required before opening HTML.");
      }

      await saveVariables(effectiveVersionId);

      const reportUrl = `${baseUrl}/jobs/${jobId}/generate-html-report?template_id=${selectedTemplateId}&version_id=${effectiveVersionId}`;
      const res = await fetch(reportUrl);
      if (!res.ok) {
        const details = await readErrorDetails(res, `Failed to load HTML report (${res.status})`);
        throw new Error(details.message);
      }
      const htmlBlob = await res.blob();
      const url = URL.createObjectURL(htmlBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `job-${jobId}-report.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloadingHtml(false);
    }
  };

  const handleAssignTemplateClick = async () => {
    try {
      await assignTemplate();
    } catch {
      // Error state is already set inside assignTemplate
    }
  };

  const handleSaveVariablesClick = async () => {
    try {
      await saveVariables();
    } catch {
      // Error state is already set inside saveVariables
    }
  };

  const downloadPdfFromPreview = () => {
    if (!pdfPreviewUrl) return;
    const link = document.createElement("a");
    link.href = pdfPreviewUrl;
    link.download = `job-${jobId}-report.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Group variables by section
  const variablesBySection = variables.reduce((acc, variable) => {
    const section = variable.section || "General";
    if (!acc[section]) {
      acc[section] = [];
    }
    acc[section].push(variable);
    return acc;
  }, {} as Record<string, TemplateVariable[]>);

  const metadataBySection = visibleMetadataFields.reduce((acc, field) => {
    const section = field.section || "General";
    if (!acc[section]) {
      acc[section] = [];
    }
    acc[section].push(field);
    return acc;
  }, {} as Record<string, ReportMetadataField[]>);
  const annualTemplateSelected = selectedTemplate?.template_key === "annual_carbon_report";
  const hasActivityVariables = variables.some((v) => v.variable_key.startsWith("activity_"));

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl);
      }
    };
  }, [pdfPreviewUrl]);

  const renderVariableInput = (variable: TemplateVariable) => {
    const value = variableValues[variable.variable_key] || "";
    const commonProps = {
      id: variable.variable_key,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        handleVariableChange(variable.variable_key, e.target.value, variable.variable_type),
      placeholder: variable.placeholder || "",
      required: variable.is_required
    };

    switch (variable.variable_type) {
      case "textarea":
        return (
          <Textarea
            {...commonProps}
            rows={4}
            className="resize-y"
          />
        );
      case "date":
        return (
          <Input
            {...commonProps}
            type="date"
          />
        );
      case "number":
        return (
          <Input
            {...commonProps}
            type="number"
          />
        );
      case "boolean":
        return (
          <Select
            value={value}
            onValueChange={(v) => handleVariableChange(variable.variable_key, v, variable.variable_type)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Yes</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectContent>
          </Select>
        );
      default:
        return (
          <Input
            {...commonProps}
            type="text"
          />
        );
    }
  };

  const isSyncedField = (key: string): boolean => {
    return SYNCED_METADATA_FIELDS.includes(key);
  };

  const renderMetadataInput = (field: ReportMetadataField) => {
    const value = metadataValues[field.key] || "";
    const synced = isSyncedField(field.key);
    
    const commonProps = {
      id: `meta-${field.key}`,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        handleMetadataChange(field.key, e.target.value, field.field_type),
      disabled: synced, // Make synced fields read-only
    };

    switch (field.field_type) {
      case "textarea":
        return <Textarea {...commonProps} rows={3} className={`resize-y ${synced ? "bg-muted/50" : ""}`} />;
      case "date":
        return <Input {...commonProps} type="date" className={synced ? "bg-muted/50" : ""} />;
      case "number":
        return <Input {...commonProps} type="number" className={synced ? "bg-muted/50" : ""} />;
      case "boolean":
        return (
          <Select
            value={value}
            onValueChange={(v) => handleMetadataChange(field.key, v, field.field_type)}
            disabled={synced}
          >
            <SelectTrigger className={synced ? "bg-muted/50" : ""}>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Yes</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectContent>
          </Select>
        );
      default:
        return <Input {...commonProps} type="text" className={synced ? "bg-muted/50" : ""} />;
    }
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeStep} onValueChange={(v) => setActiveStep(v as ReportStep)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="template">1. Template</TabsTrigger>
          <TabsTrigger value="variables" disabled={!selectedTemplateId}>2. Content</TabsTrigger>
          <TabsTrigger value="metadata" disabled={!selectedTemplateId}>3. Metadata</TabsTrigger>
          <TabsTrigger value="generate" disabled={!selectedTemplateId}>4. Generate</TabsTrigger>
        </TabsList>

        {error && (
          <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <TabsContent value="template" className="space-y-6">
      {/* Template Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Report Template & Version</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingTemplates && (
            <div className="text-sm text-muted-foreground">Loading templates...</div>
          )}

          <div className="space-y-2">
            <Label htmlFor="template">Report Template</Label>
            <Select
              value={selectedTemplateId?.toString() || ""}
              onValueChange={(v) => {
                setSelectedTemplateId(parseInt(v, 10));
                // Prevent stale version_id from previous template causing 404s.
                setSelectedVersionId(null);
                setVersions([]);
              }}
            >
              <SelectTrigger id="template">
                <SelectValue placeholder="Choose a template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.template_id} value={t.template_id.toString()}>
                    {t.template_name}{t.is_global ? " (Global)" : " (Client)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedTemplateId && versions.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="templateVersion">Template Version</Label>
                <Select
                  value={selectedVersionId?.toString() || ""}
                  onValueChange={(v) => setSelectedVersionId(parseInt(v))}
                >
                  <SelectTrigger id="templateVersion">
                    <SelectValue placeholder="Choose a version..." />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.version_id} value={v.version_id.toString()}>
                        v{v.version_number}{v.version_label ? ` - ${v.version_label}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedTemplateId && (
              <div className="text-sm text-muted-foreground mt-2">
                {templates.find(t => t.template_id === selectedTemplateId)?.description}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={handleAssignTemplateClick} disabled={!selectedTemplateId || assigning} variant="outline" size="sm">
                {assigning ? "Assigning..." : "Assign to Job"}
              </Button>
              {assignment && (
                <span className="text-xs text-muted-foreground">
                  Assigned: {assignment.template_name || `Template ${assignment.template_id}`}
                  {assignment.version_number ? ` (v${assignment.version_number})` : ""}
                </span>
              )}
            </div>

            {assignmentStatus && (
              <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                {assignmentStatus}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* What's new / activity grouping preview */}
      {selectedTemplateId && (
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle>What’s New in Reporting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              The main improvements are in the generated interactive/PDF report and annual-template activity variables.
            </div>
            <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
              <li>Activity grouping now uses Energy, Business Travel, Employee Commuting, PG&amp;S, and Other.</li>
              <li>Annual template supports activity narrative + per-group commentary + show/hide table toggles.</li>
              <li>Use <strong>Open Interactive Preview</strong> to quickly confirm report output changes.</li>
            </ul>

            {!annualTemplateSelected && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-900">
                You are not currently on the <strong>Annual Carbon Report</strong> template. Select it to see the new
                activity commentary fields in the variable editor.
              </div>
            )}

            {annualTemplateSelected && !hasActivityVariables && !loading && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-900">
                Annual template is selected, but activity fields are missing. Re-run template setup/migrations to seed
                the new variables.
              </div>
            )}

            <div>
              <div className="font-medium mb-2">Current activity grouping preview (from API)</div>
              {activityLoading && <div className="text-muted-foreground">Loading activity totals...</div>}
              {!activityLoading && activityError && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-destructive">
                  {activityError}
                </div>
              )}
              {!activityLoading && activityPreview && (
                <div className="rounded-md border p-3">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {activityPreview.order.map((group) => (
                      <div key={group} className="rounded border p-2">
                        <div className="text-xs text-muted-foreground">{group}</div>
                        <div className="font-semibold">{(activityPreview.totals[group] || 0).toFixed(1)} tCO₂e</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Detailed rows available: {activityPreview.detailCount}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
        </TabsContent>

      {/* Variable Editor */}
      <TabsContent value="variables" className="space-y-6">
      {selectedTemplateId && !loading && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Edit Report Variables</CardTitle>
              <Button
                onClick={handleSaveVariablesClick}
                disabled={saving}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Variables"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {missingRequiredFields.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                <div className="font-medium mb-1">Missing required fields:</div>
                <ul className="list-disc ml-5">
                  {missingRequiredFields.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              </div>
            )}

            {saveStatus && (
              <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                {saveStatus}
              </div>
            )}

            <div className="grid gap-3 rounded-md border p-3 md:grid-cols-3">
              <Input
                placeholder="Search variable label..."
                value={variableSearch}
                onChange={(e) => setVariableSearch(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showOnlyRequired}
                  onChange={(e) => setShowOnlyRequired(e.target.checked)}
                />
                Show required only
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showOnlyMissing}
                  onChange={(e) => setShowOnlyMissing(e.target.checked)}
                />
                Show missing only
              </label>
            </div>

            {Object.entries(variablesBySection).map(([section, sectionVars]) => (
              <details key={section} className="space-y-4 rounded-md border p-4" open={section === "Cover Page"}>
                <summary className="cursor-pointer list-none font-semibold text-lg">{section}</summary>
                <div className="mt-3 grid gap-4">
                  {sectionVars
                    .filter((variable) => {
                      const label = (variable.variable_label || "").toLowerCase();
                      const search = variableSearch.trim().toLowerCase();
                      if (search && !label.includes(search)) return false;
                      if (showOnlyRequired && !variable.is_required) return false;
                      if (showOnlyMissing) {
                        const value = String(variableValues[variable.variable_key] ?? "").trim();
                        if (value) return false;
                      }
                      return true;
                    })
                    .map((variable) => (
                      <div key={variable.variable_key} className="space-y-2">
                        <Label htmlFor={variable.variable_key} className="flex items-center gap-2">
                          {variable.variable_label}
                          {variable.is_required && (
                            <span className="text-destructive text-xs">*</span>
                          )}
                        </Label>
                        {renderVariableInput(variable)}
                        {variable.help_text && (
                          <div className="text-xs text-muted-foreground flex items-start gap-1">
                            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            <span>{variable.help_text}</span>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      )}
      </TabsContent>

      {/* Report Metadata Editor */}
      <TabsContent value="metadata" className="space-y-6">
      {selectedTemplateId && !loadingMetadata && visibleMetadataFields.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Report Metadata (One-to-One Placeholder Mapping)</CardTitle>
              <Button
                onClick={saveMetadata}
                disabled={savingMetadata || saving || generating || generatingDocx || openingPreview}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                {savingMetadata ? "Saving..." : "Save Metadata"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {metadataStatus && (
              <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                {metadataStatus}
              </div>
            )}

            {Object.entries(metadataBySection).map(([section, sectionFields]) => (
              <div key={section} className="space-y-4">
                <h3 className="font-semibold text-lg border-b pb-2">{section}</h3>
                <div className="grid gap-4">
                  {sectionFields.map((field) => {
                    const isSynced = isSyncedField(field.key);
                    return (
                      <div key={field.key} className="space-y-2">
                        <Label htmlFor={`meta-${field.key}`} className="flex items-center gap-2">
                          {field.label}
                          {isSynced && (
                            <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                              <Link2 className="h-3 w-3" />
                              From Job Setup
                            </span>
                          )}
                        </Label>
                        {renderMetadataInput(field)}
                        {field.aliases && field.aliases.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            Aliases: {field.aliases.join(", ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {selectedTemplateId && loadingMetadata && (
        <div className="text-center text-sm text-muted-foreground py-4">
          Loading report metadata...
        </div>
      )}
      </TabsContent>

      {/* Generate Report Button */}
      <TabsContent value="generate" className="space-y-6">
      {selectedTemplateId && !loading && (
        <>
        <Card>
          <CardHeader>
            <CardTitle>Generate Report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              All emissions values will be displayed to 1 decimal place in the generated report.
              Make sure all required variables are filled in before generating.
            </div>

            <Button
              onClick={generateReport}
              disabled={generating || generatingDocx || saving || openingPreview}
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              {generating ? "Generating PDF..." : "Generate PDF Report (In App)"}
            </Button>

            <Button
              variant="outline"
              onClick={generateDocxReport}
              disabled={generatingDocx || generating || openingPreview || saving}
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              {generatingDocx ? "Generating DOCX..." : "Generate DOCX Report"}
            </Button>

            <Button
              variant="outline"
              onClick={openInteractivePreview}
              disabled={openingPreview || generating || generatingDocx || saving}
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              {openingPreview ? "Opening Preview..." : "Open Interactive Preview"}
            </Button>

            <Button
              variant="outline"
              onClick={downloadHtmlReport}
              disabled={downloadingHtml || generating || generatingDocx || saving || openingPreview}
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              {downloadingHtml ? "Downloading..." : "Download HTML (Raw)"}
            </Button>
          </CardContent>
        </Card>
        {pdfPreviewUrl && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>PDF Preview</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={downloadPdfFromPreview}>
                    Download PDF
                  </Button>
                  <Button variant="outline" onClick={() => setPdfPreviewUrl("")}>
                    Clear Preview
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="w-full h-[78vh] border rounded-md bg-white overflow-hidden">
                <iframe title="Report PDF Preview" src={pdfPreviewUrl} className="w-full h-full" />
              </div>
            </CardContent>
          </Card>
        )}
        </>
      )}
      </TabsContent>
      </Tabs>

      {loading && (
        <div className="text-center text-sm text-muted-foreground py-8">
          Loading template variables...
        </div>
      )}

    </div>
  );
}
