"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type JobTemplate = {
  job_template_id: number;
  template_key: string;
  template_name: string | null;
  template_type: string;
  file_path: string | null;
  is_active: boolean;
};

const TEMPLATE_TYPES = [
  { key: "dataset", label: "Data Collection Templates", description: "Excel templates for data capture" },
  { key: "report", label: "Report Templates", description: "Word/PDF templates for reports" },
  { key: "messaging", label: "Messaging Templates", description: "Email templates for quotes, invoices, reminders, and onboarding" },
  { key: "variables", label: "Report Variables", description: "Dynamic fields for report content" },
];

export default function TemplatesPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  
  const [activeTab, setActiveTab] = useState(TEMPLATE_TYPES[0].key);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);

  // Form fields for add/edit
  const [templateKey, setTemplateKey] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateType, setTemplateType] = useState("dataset");
  const [isActive, setIsActive] = useState(true);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/job-templates`);
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

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    setTemplateType(activeTab);
  }, [activeTab]);

  const filteredTemplates = templates.filter(t => t.template_type === activeTab);
  const activeTemplates = filteredTemplates.filter(t => t.is_active);
  const inactiveTemplates = filteredTemplates.filter(t => !t.is_active);

  function startEdit(template: JobTemplate) {
    setEditingId(template.job_template_id);
    setTemplateKey(template.template_key);
    setTemplateName(template.template_name || "");
    setTemplateType(template.template_type);
    setIsActive(template.is_active);
    setUploadingFile(null);
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
        res = await fetch(`${baseUrl}/job-templates/${editingId}`, {
          method: "PATCH",
          body: formData,
        });
      } else {
        res = await fetch(`${baseUrl}/job-templates`, {
          method: "POST",
          body: formData,
        });
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Save failed: ${res.status} - ${text}`);
      }

      setStatus(editingId ? "Template updated!" : "Template created!");
      cancelEdit();
      loadTemplates();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function deleteTemplate(id: number) {
    if (!confirm("Are you sure you want to deactivate this template?")) return;

    try {
      const res = await fetch(`${baseUrl}/job-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });

      if (!res.ok) {
        throw new Error(`Deactivate failed: ${res.status}`);
      }

      setStatus("Template deactivated");
      loadTemplates();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function archiveTemplate(id: number, templateKey: string) {
    if (!confirm(`Archive template "${templateKey}"? This will move it to the archive management section.`)) return;

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
      loadTemplates();
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

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>Templates Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage data capture templates and report templates
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">← Back to Admin</Link>
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
            <TabsContent key={type.key} value={type.key}>
              {type.key === "variables" ? (
                <ReportVariablesAdmin baseUrl={baseUrl} />
              ) : type.key === "messaging" ? (
                <MessagingTemplatesAdmin baseUrl={baseUrl} />
              ) : (
              <>
              <div className="grid gap-6 lg:grid-cols-2">
          {/* Template List */}
          <Card>
            <CardHeader>
              <CardTitle>Active Templates</CardTitle>
            </CardHeader>
            <CardContent>
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
                        <div className="flex-1">
                          <div className="font-medium">{t.template_key}</div>
                          {t.template_name && (
                            <div className="text-sm text-muted-foreground">{t.template_name}</div>
                          )}
                          <div className="mt-2 space-y-1 text-xs">
                            {t.file_path && (
                              <div className="text-muted-foreground">
                                � File: {t.file_path}
                              </div>
                            )}
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
          <Card>
            <CardHeader>
              <CardTitle>{editingId ? "Edit Template" : "Add New Template"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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

              <div className="space-y-2">
                <Label htmlFor="templateFile">Upload Template File {!editingId && '*'}</Label>
                <Input
                  id="templateFile"
                  type="file"
                  accept={templateType === 'dataset' ? '.xlsx,.xls' : '.docx,.pdf'}
                  onChange={(e) => setUploadingFile(e.target.files?.[0] || null)}
                />
                {uploadingFile && (
                  <div className="text-xs text-muted-foreground">
                    Selected: {uploadingFile.name}
                  </div>
                )}
                {editingId && (
                  <div className="text-xs text-muted-foreground">
                    Leave empty to keep existing file
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
                <Button onClick={saveTemplate} className="flex-1">
                  {editingId ? "Update Template" : "Create Template"}
                </Button>
                {editingId && (
                  <Button onClick={cancelEdit} variant="outline">
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
                              <div className="font-medium">{t.template_key}</div>
                              {t.template_name && (
                                <div className="text-sm text-muted-foreground">{t.template_name}</div>
                              )}
                              <div className="mt-2 space-y-1 text-xs">
                                {t.file_path && (
                                  <div className="text-muted-foreground">
                                    📁 File: {t.file_path}
                                  </div>
                                )}
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
              <h3 className="font-medium mb-2">📊 Data Collection Templates</h3>
              <p className="text-muted-foreground">
                Excel templates for collecting emissions data from clients. Upload .xlsx or .xls files.
                These templates are populated with conversion factors and sent to clients for data entry.
              </p>
            </div>
            <div>
              <h3 className="font-medium mb-2">📄 Report Templates</h3>
              <p className="text-muted-foreground">
                Word or PDF templates for generating Carbon Reduction Plans and other reports.
                Upload .docx or .pdf files with placeholders that will be replaced with actual data.
              </p>
            </div>
            <div>
              <h3 className="font-medium mb-2">📋 Usage</h3>
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
            <CardTitle style={{ color: '#F26624' }}>📑 Sample Report Templates</CardTitle>
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
              <h3 className="font-medium mb-2 text-blue-800">💡 Quick Start</h3>
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
