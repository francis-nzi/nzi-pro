"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReportVariablesAdmin from "@/components/ReportVariablesAdmin";
import MessagingTemplatesAdmin from "@/components/MessagingTemplatesAdmin";
import UploadProgressBar from "@/components/UploadProgressBar";
import SearchableStringSelect from "@/components/SearchableStringSelect";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function apiBaseUrl(): string {
  return "/api/backend";
}

type JobTemplate = {
  job_template_id: number;
  template_key: string;
  template_name: string | null;
  template_type: string;
  file_path: string | null;
  is_active: boolean;
  archived?: boolean | null;
  archived_at?: string | null;
  archived_by?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  file_name?: string | null;
};

type DatasetCatalogItem = {
  country: string;
  year: number | null;
  archived?: boolean | null;
};

const TEMPLATE_TYPES = [
  { key: "dataset", label: "Data Collection Templates", description: "Excel templates for data capture" },
  { key: "report", label: "Report Templates", description: "Word/PDF templates for reports" },
  { key: "messaging", label: "Messaging Templates", description: "Email templates for quotes, invoices, reminders, and onboarding" },
  { key: "variables", label: "Report Variables", description: "Dynamic fields for report content" },
];

export default function TemplatesPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();
  
  const [activeTab, setActiveTab] = useState(TEMPLATE_TYPES[0].key);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const templateFileInputRef = useRef<HTMLInputElement | null>(null);

  // Form fields for add/edit
  const [templateKey, setTemplateKey] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateType, setTemplateType] = useState("dataset");
  const [isActive, setIsActive] = useState(true);
  const [datasetCountry, setDatasetCountry] = useState("");
  const [datasetYear, setDatasetYear] = useState("");
  const [datasetCatalog, setDatasetCatalog] = useState<DatasetCatalogItem[]>([]);
  const [datasetWorkbookHint, setDatasetWorkbookHint] = useState("");
  const lastAutoTemplateKey = useRef("");
  const lastAutoTemplateName = useRef("");

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/job-templates`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load templates: ${res.status}`);
      }
      const json = await res.json();
      setTemplates(json.items || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  function formatTemplateTimestamp(value: string | null | undefined) {
    if (!value) return "Unknown";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(parsed);
  }

  const loadDatasetCatalog = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/admin/datasets`);
      if (!res.ok) {
        throw new Error(`Failed to load datasets: ${res.status}`);
      }
      const json = await res.json();
      const items = Array.isArray(json?.items) ? (json.items as DatasetCatalogItem[]) : [];
      setDatasetCatalog(items);
    } catch {
      setDatasetCatalog([]);
    }
  }, [baseUrl]);

  useEffect(() => {
    void loadTemplates();
    void loadDatasetCatalog();
  }, [loadDatasetCatalog, loadTemplates]);

  const activeDatasetCatalog = useMemo(
    () => datasetCatalog.filter((item) => !item.archived && item.country && item.year),
    [datasetCatalog]
  );

  const datasetCountryOptions = useMemo(() => {
    const countries = Array.from(new Set(activeDatasetCatalog.map((item) => item.country))).sort((a, b) =>
      a.localeCompare(b)
    );
    return countries;
  }, [activeDatasetCatalog]);

  const datasetCountryStats = useMemo(() => {
    const stats: Record<string, { count: number; latestYear: string }> = {};
    for (const item of activeDatasetCatalog) {
      if (!item.country || !item.year) continue;
      const current = stats[item.country] || { count: 0, latestYear: String(item.year) };
      current.count += 1;
      if (Number(item.year) > Number(current.latestYear)) {
        current.latestYear = String(item.year);
      }
      stats[item.country] = current;
    }
    return stats;
  }, [activeDatasetCatalog]);

  const datasetYearOptions = useMemo(() => {
    if (!datasetCountry) {
      return Array.from(new Set(activeDatasetCatalog.map((item) => String(item.year)))).sort((a, b) => Number(b) - Number(a));
    }
    return activeDatasetCatalog
      .filter((item) => item.country === datasetCountry)
      .map((item) => String(item.year))
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .sort((a, b) => Number(b) - Number(a));
  }, [activeDatasetCatalog, datasetCountry]);

  const latestDatasetYear = useMemo(() => {
    if (!datasetCountry) {
      return "";
    }
    return datasetCountryStats[datasetCountry]?.latestYear || "";
  }, [datasetCountry, datasetCountryStats]);

  useEffect(() => {
    if (!activeDatasetCatalog.length) {
      return;
    }

    if (datasetCountry.trim()) {
      return;
    }

    const preferredCountry =
      (datasetCountryOptions.includes("UK") ? "UK" : datasetCountryOptions[0]);

    let workbookHint = "";
    if (preferredCountry) {
      setDatasetCountry(preferredCountry);
      workbookHint = `Using ${preferredCountry} because it is the first available country with dataset rows.`;
    }

    const yearsForCountry = activeDatasetCatalog
      .filter((item) => item.country === preferredCountry)
      .map((item) => Number(item.year))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a);

    if (!yearsForCountry.length) {
      return;
    }

    const preferredYear = String(yearsForCountry[0]);
    if (!datasetYear || !yearsForCountry.includes(Number(datasetYear))) {
      setDatasetYear(preferredYear);
      workbookHint = `Using the latest available year (${preferredYear}) for ${preferredCountry}.`;
    }

    setDatasetWorkbookHint(workbookHint);
  }, [activeDatasetCatalog, datasetCountry, datasetCountryOptions, datasetYear]);

  useEffect(() => {
    setTemplateType(activeTab);
  }, [activeTab]);

  const filteredTemplates = templates.filter((t) => t.template_type === activeTab && !t.archived);
  const activeTemplates = filteredTemplates.filter((t) => t.is_active);
  const inactiveTemplates = filteredTemplates.filter((t) => !t.is_active);
  const editingTemplate = useMemo(
    () => (editingId ? templates.find((template) => template.job_template_id === editingId) || null : null),
    [editingId, templates]
  );
  const editingTemplateFileLabel = editingTemplate?.file_name || editingTemplate?.file_path || "No file stored";

  function startEdit(template: JobTemplate) {
    setEditingId(template.job_template_id);
    setTemplateKey(template.template_key);
    setTemplateName(template.template_name || "");
    setTemplateType(template.template_type);
    setIsActive(template.is_active);
    setUploadingFile(null);
    setUploadProgress(0);
    if (templateFileInputRef.current) {
      templateFileInputRef.current.value = "";
    }
  }

  function cancelEdit() {
    setEditingId(null);
    clearForm();
  }

  function clearForm() {
    setTemplateKey("");
    setTemplateName("");
    setTemplateType(activeTab);
    setIsActive(true);
    setUploadingFile(null);
    setUploadProgress(0);
    if (templateFileInputRef.current) {
      templateFileInputRef.current.value = "";
    }
  }

  function buildDatasetTemplateDefaults(country: string, year: string) {
    const normalizedCountry = country.trim().replace(/[^\w\- ]+/g, "_").replace(/\s+/g, "_") || "dataset";
    const normalizedYear = year.trim() || String(new Date().getFullYear());
    return {
      templateKey: `${normalizedCountry}_${normalizedYear}_dataset`,
      templateName: `${country.trim() || "Dataset"} ${normalizedYear} Dataset Template`,
    };
  }

  async function saveTemplate() {
    if (!templateKey.trim()) {
      setStatus("Template key is required");
      return;
    }

    if (!editingId && !uploadingFile) {
      setStatus("Please select a file to upload");
      return;
    }

    setStatus("Saving...");
    setUploadProgress(0);
    setUploadingTemplate(true);
    try {
      const formData = new FormData();
      formData.append("template_key", templateKey.trim());
      formData.append("template_name", templateName.trim() || "");
      formData.append("template_type", templateType);
      formData.append("is_active", String(isActive));
      
      if (uploadingFile) {
        formData.append("file", uploadingFile);
      }

      let res;
      if (editingId) {
        res = await uploadFormDataWithProgress(`${baseUrl}/job-templates/${editingId}`, {
          method: "PATCH",
          credentials: "include",
          body: formData,
          onProgress: ({ percent }) => setUploadProgress(percent),
        });
      } else {
        res = await uploadFormDataWithProgress(`${baseUrl}/job-templates`, {
          method: "POST",
          credentials: "include",
          body: formData,
          onProgress: ({ percent }) => setUploadProgress(percent),
        });
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Save failed: ${res.status} - ${text}`);
      }

      setStatus(editingId ? "Template updated!" : "Template created!");
      await loadTemplates();
      cancelEdit();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setUploadProgress(0);
      setUploadingTemplate(false);
    }
  }

  async function deleteTemplate(id: number) {
    const confirmed = await confirmAction({
      title: "Deactivate template?",
      description: "This template will be archived and removed from the active list.",
      confirmLabel: "Deactivate",
      destructive: true,
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${baseUrl}/job-templates/${id}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      if (!res.ok) {
        throw new Error(`Deactivate failed: ${res.status}`);
      }

      setStatus("Template deactivated");
      await loadTemplates();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function archiveTemplate(id: number, templateKey: string) {
    const confirmed = await confirmAction({
      title: "Archive template?",
      description: `Archive template "${templateKey}"? This will move it to the archive management section.`,
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${baseUrl}/job-templates/${id}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      if (!res.ok) {
        throw new Error(`Archive failed: ${res.status}`);
      }

      setStatus("Template archived");
      await loadTemplates();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function downloadTemplate(template: JobTemplate) {
    try {
      setStatus("Preparing template download...");
      const res = await fetch(`${baseUrl}/job-templates/${template.job_template_id}/download`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Download failed: ${res.status}${text ? ` - ${text}` : ""}`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fallbackExt = template.template_type === "dataset" ? ".xlsx" : ".docx";
      const ext = template.file_path && template.file_path.includes(".")
        ? `.${template.file_path.split(".").pop()}`
        : fallbackExt;
      const baseName = (template.template_name || template.template_key || "template")
        .replace(/[^\w\- ]+/g, "_")
        .trim();
      link.href = url;
      link.download = `${baseName || "template"}${ext.startsWith(".") ? ext : fallbackExt}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatus("");
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function downloadDatasetWorkbook() {
    const country = datasetCountry.trim();
    const year = datasetYear.trim();
    if (!country) {
      setStatus("Country is required to generate a dataset workbook");
      return;
    }
    if (!year || Number.isNaN(Number(year))) {
      setStatus("A valid year is required to generate a dataset workbook");
      return;
    }

    const resolvedCountry =
      datasetCountryOptions.find((option) => option.toLowerCase() === country.toLowerCase()) ||
      datasetCountryOptions.find((option) => option.toLowerCase().includes(country.toLowerCase())) ||
      country;

    const matchingDatasetYears = activeDatasetCatalog
      .filter((item) => !item.archived && item.country === resolvedCountry && item.year)
      .map((item) => Number(item.year))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a);
    const effectiveYear = matchingDatasetYears.includes(Number(year))
      ? year
      : String(matchingDatasetYears[0] || year);

    if (effectiveYear !== year) {
      setDatasetWorkbookHint(`Using the latest available year (${effectiveYear}) for ${resolvedCountry}.`);
    } else {
      setDatasetWorkbookHint(`Using ${resolvedCountry} / ${effectiveYear} for the workbook download.`);
    }

    const defaults = buildDatasetTemplateDefaults(resolvedCountry, effectiveYear);
    const currentKey = templateKey.trim();
    const currentName = templateName.trim();
    if (!currentKey || currentKey === lastAutoTemplateKey.current) {
      setTemplateKey(defaults.templateKey);
    }
    if (!currentName || currentName === lastAutoTemplateName.current) {
      setTemplateName(defaults.templateName);
    }
    lastAutoTemplateKey.current = defaults.templateKey;
    lastAutoTemplateName.current = defaults.templateName;

    try {
      setStatus("Preparing dataset workbook...");
      const params = new URLSearchParams({
        country: resolvedCountry,
        year: effectiveYear,
      });
      const res = await fetch(`${baseUrl}/admin/templates/dataset-workbook?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Workbook download failed: ${res.status}${text ? ` - ${text}` : ""}`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || `${resolvedCountry.replace(/[^\w\- ]+/g, "_").trim() || "country"}_${effectiveYear}_dataset_template.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatus("");
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>Templates Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage data capture templates and report templates
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">â† Back to Admin</Link>
          </Button>
        </div>

        {error && <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {status && <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            {TEMPLATE_TYPES.map((type) => (
              <TabsTrigger key={type.key} value={type.key}>
                {type.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {TEMPLATE_TYPES.map((type) => (
            <TabsContent key={type.key} value={type.key} className="min-w-0">
              {type.key === "variables" ? (
                <ReportVariablesAdmin baseUrl={baseUrl} />
              ) : type.key === "messaging" ? (
                <MessagingTemplatesAdmin baseUrl={baseUrl} />
              ) : (
              <>
              <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          {/* Template List */}
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Active Templates</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0">
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : activeTemplates.length === 0 ? (
                <div className="text-sm text-muted-foreground">No active {type.label.toLowerCase()} found</div>
              ) : (
                <div className="space-y-3">
                  {activeTemplates.map((t) => (
                    <div
                      key={t.job_template_id}
                      className="rounded-md border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-base font-semibold">
                            {t.template_name || t.template_key}
                          </div>
                          <div className="break-words text-xs text-muted-foreground">
                            {t.template_key}
                          </div>
                          <div className="mt-2 space-y-1 text-xs">
                            <div className="break-words text-muted-foreground">
                              File: {t.file_name || t.file_path || "Unknown"}
                            </div>
                            <div className="break-words text-muted-foreground">
                              Created: {formatTemplateTimestamp(t.created_at)}
                            </div>
                            <div className="break-words text-muted-foreground">
                              Created by: {t.created_by || "system"}
                            </div>
                            <div className="text-muted-foreground">
                              Type: {t.template_type === 'dataset' ? '📊 Data Collection' : '📄 Report'}
                            </div>
                          </div>
                          <div className="mt-2">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                                t.is_active
                                  ? "bg-green-100 text-green-800"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {t.is_active ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => downloadTemplate(t)}
                          >
                            Download
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(t)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteTemplate(t.job_template_id)}
                          >
                            Deactivate
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add/Edit Form */}
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{editingId ? "Edit Template" : "Add New Template"}</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="templateKey">Template Key *</Label>
                <Input
                  id="templateKey"
                  value={templateKey}
                  onChange={(e) => setTemplateKey(e.target.value)}
                  placeholder="e.g., STANDARD_UK"
                />
                <div className="text-xs text-muted-foreground">
                  Unique identifier for this template
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="templateName">Template Name</Label>
                <Input
                  id="templateName"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g., Standard UK Template"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="templateType">Template Type</Label>
                <Select value={templateType} onValueChange={setTemplateType}>
                  <SelectTrigger id="templateType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dataset">Data Collection Template (Excel)</SelectItem>
                    <SelectItem value="report">Report Template (Word/PDF)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {templateType === "dataset" && (
                <div className="space-y-3 rounded-md border bg-muted/20 p-4">
                  <div>
                    <div className="font-medium">Generate workbook from datasets</div>
                    <p className="text-xs text-muted-foreground">
                      Download a country/year workbook built from the existing dataset rows, edit it offline, then upload it back here.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="datasetCountry">Country</Label>
                      <SearchableStringSelect
                        id="datasetCountry"
                        value={datasetCountry}
                        options={datasetCountryOptions}
                        placeholder="Search country..."
                        showClearButton
                        optionBadges={Object.fromEntries(
                          datasetCountryOptions.map((countryOption) => [
                            countryOption,
                            `${datasetCountryStats[countryOption]?.count ?? 0} datasets`,
                          ])
                        )}
                        onValueChange={(value) => {
                          setDatasetCountry(value);
                          if (!value.trim()) {
                            setDatasetYear("");
                            setDatasetWorkbookHint("");
                            return;
                          }

                          const yearsForCountry = activeDatasetCatalog
                            .filter((item) => item.country === value)
                            .map((item) => Number(item.year))
                            .filter((year) => Number.isFinite(year))
                            .sort((a, b) => b - a);

                          if (yearsForCountry.length) {
                            const nextYear = String(yearsForCountry[0]);
                            setDatasetYear(nextYear);
                            setDatasetWorkbookHint(`Using ${value} / ${nextYear} for the workbook download.`);
                          } else {
                            setDatasetWorkbookHint(`Using ${value} for the workbook download.`);
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="datasetYear">Year</Label>
                        {latestDatasetYear && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">
                            Latest: {latestDatasetYear}
                          </span>
                        )}
                      </div>
                      <Select value={datasetYear || "__none__"} onValueChange={setDatasetYear}>
                        <SelectTrigger id="datasetYear">
                          <SelectValue placeholder="Select year..." />
                        </SelectTrigger>
                        <SelectContent>
                          {datasetYearOptions.length === 0 ? (
                            <SelectItem value="__none__" disabled>
                              No years available
                            </SelectItem>
                          ) : (
                            datasetYearOptions.map((yearOption) => (
                              <SelectItem key={yearOption} value={yearOption}>
                                {yearOption}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
              {datasetWorkbookHint && (
                <div className="text-xs text-muted-foreground">
                  {datasetWorkbookHint}
                </div>
              )}
              <div className="flex justify-end">
                <Button type="button" variant="secondary" onClick={downloadDatasetWorkbook}>
                  Download Workbook
                </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="templateFile">Upload Template File {!editingId && '*'}</Label>
                <Input
                  ref={templateFileInputRef}
                  id="templateFile"
                  type="file"
                  accept={templateType === 'dataset' ? '.xlsx,.xls' : '.docx,.pdf'}
                  onChange={(e) => setUploadingFile(e.target.files?.[0] || null)}
                />
                {uploadingFile && (
                  <div className="text-xs text-muted-foreground">
                    New file selected: {uploadingFile.name}
                  </div>
                )}
                {uploadingTemplate ? <UploadProgressBar value={uploadProgress} label="Uploading template..." /> : null}
                {editingId && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      Current file: {editingTemplateFileLabel}
                    </div>
                    <div>
                      Leave empty to keep the current file
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="isActive">Status</Label>
                <Select
                  value={isActive ? "active" : "inactive"}
                  onValueChange={(v) => setIsActive(v === "active")}
                >
                  <SelectTrigger id="isActive">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <Button onClick={saveTemplate} className="flex-1" disabled={uploadingTemplate}>
                  {editingId ? "Update Template" : "Create Template"}
                </Button>
                {editingId && (
                  <Button onClick={cancelEdit} variant="outline" disabled={uploadingTemplate}>
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
              </div>

              {/* Inactive Templates Section */}
              {inactiveTemplates.length > 0 && (
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle>Inactive Templates</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {inactiveTemplates.map((t) => (
                        <div
                          key={t.job_template_id}
                          className="rounded-md border border-destructive/20 bg-destructive/5 p-3"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="text-base font-semibold">
                                {t.template_name || t.template_key}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {t.template_key}
                              </div>
                              <div className="mt-2 space-y-1 text-xs">
                                <div className="text-muted-foreground">
                                  File: {t.file_name || t.file_path || "Unknown"}
                                </div>
                                <div className="text-muted-foreground">
                                  Created: {formatTemplateTimestamp(t.created_at)}
                                </div>
                                <div className="text-muted-foreground">
                                  Created by: {t.created_by || "system"}
                                </div>
                                <div className="text-muted-foreground">
                                  Type: {t.template_type === 'dataset' ? '📊 Data Collection' : '📄 Report'}
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => startEdit(t)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => archiveTemplate(t.job_template_id, t.template_key)}
                              >
                                Archive
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
              </>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {/* Documentation */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Template Types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h3 className=”font-medium mb-2”>Data Collection Templates</h3>
              <p className="text-muted-foreground">
                Excel templates for collecting emissions data from clients. Upload .xlsx or .xls files.
                These templates are populated with conversion factors and sent to clients for data entry.
              </p>
            </div>
            <div>
              <h3 className=”font-medium mb-2”>Report Templates</h3>
              <p className="text-muted-foreground">
                Word or PDF templates for generating Carbon Reduction Plans and other reports.
                Upload .docx or .pdf files with placeholders that will be replaced with actual data.
              </p>
            </div>
            <div>
              <h3 className=”font-medium mb-2”>Usage</h3>
              <p className="text-muted-foreground">
                Templates are assigned to jobs. Upload files directly - they will be stored securely
                and versioned. Each template type is managed separately in its own tab.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sample Templates */}
        <Card className="mt-6 border-primary/20">
          <CardHeader>
            <CardTitle style={{ color: ‘#F26624’ }}>Sample Report Templates</CardTitle>
            <CardDescription>
              Framework templates for creating custom Word document reports
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-md bg-muted p-4">
              <h3 className="font-medium mb-2">Sample HTML Report Template</h3>
              <p className="text-muted-foreground mb-3">
                A professional HTML template framework with all available placeholder tokens. 
                This can be used as a starting point for creating custom report formats.
              </p>
              <div className="text-xs text-muted-foreground mb-3">
                <strong>Location:</strong> <code>nzi_pro_v7-POSTGRES/sample_report_template.html</code>
              </div>
              <div className="text-xs text-muted-foreground">
                <strong>Contains placeholders for:</strong> Client name, job number, reporting period, 
                emissions by scope, organisation details, commitments, methodology, energy consumption, 
                and sign-off sections.
              </div>
            </div>

            <div className="rounded-md bg-muted p-4">
              <h3 className="font-medium mb-2">Complete Documentation</h3>
              <p className="text-muted-foreground mb-3">
                Comprehensive guide explaining the template system, all available placeholder tokens, 
                and how to create custom Word document templates.
              </p>
              <div className="text-xs text-muted-foreground mb-3">
                <strong>Location:</strong> <code>nzi_pro_v7-POSTGRES/SAMPLE_WORD_TEMPLATE_README.md</code>
              </div>
              <div className="text-xs text-muted-foreground">
                <strong>Includes:</strong> 
                <ul className="list-disc ml-4 mt-1">
                  <li>Two separate template systems explained</li>
                  <li>Complete list of 40+ placeholder tokens</li>
                  <li>Step-by-step guide for creating templates</li>
                  <li>Troubleshooting tips</li>
                </ul>
              </div>
            </div>

            <div className="rounded-md bg-blue-50 border border-blue-200 p-4">
              <h3 className="font-medium mb-2 text-blue-800">Quick Start</h3>
              <ol className="list-decimal ml-4 text-xs text-blue-700 space-y-1">
                <li>Open <code>sample_report_template.html</code> in a text editor</li>
                <li>Customize the sections to match your report format</li>
                <li>Keep placeholders in format <code>{`{Placeholder Name}`}</code></li>
                <li>Save the HTML content to the database template_content field</li>
                <li>The system will replace placeholders with actual data when generating reports</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
