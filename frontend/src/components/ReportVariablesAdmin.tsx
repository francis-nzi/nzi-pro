"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ReportTemplate = {
  template_id: number;
  template_key: string;
  template_name: string;
  template_type: string;
  description: string;
  is_active: boolean;
};

type TemplateVariable = {
  variable_id: number;
  template_id: number;
  variable_key: string;
  variable_label: string;
  variable_type: string;
  default_value?: string;
  placeholder?: string;
  help_text?: string;
  is_required: boolean;
  display_order: number;
  section?: string;
};

type ReportVariablesAdminProps = {
  baseUrl: string;
};

type PlaceholderGroup = {
  title: string;
  items: Array<{
    token: string;
    meaning: string;
  }>;
};

const PLACEHOLDER_REFERENCE: PlaceholderGroup[] = [
  {
    title: "Core report details",
    items: [
      { token: "{Report Title}", meaning: "Report title" },
      { token: "{Baseline Period}", meaning: "Baseline reporting period" },
      { token: "{Reporting Period}", meaning: "Current reporting period" },
      { token: "{Company Number}", meaning: "Company registration number" },
      { token: "{Registered Address}", meaning: "Registered address" },
      { token: "{Current Date}", meaning: "Generation date" },
    ],
  },
  {
    title: "Job + emissions placeholders",
    items: [
      { token: "{Client Name}", meaning: "Client name" },
      { token: "{Job Number}", meaning: "Job number" },
      { token: "{Reporting Year}", meaning: "Reporting year" },
      { token: "{Scope 1 Emissions}", meaning: "Scope 1 total" },
      { token: "{Scope 2 Emissions}", meaning: "Scope 2 total" },
      { token: "{Scope 3 Emissions}", meaning: "Scope 3 total" },
      { token: "{Total Emissions}", meaning: "Overall total" },
    ],
  },
  {
    title: "Energy + sign-off",
    items: [
      { token: "{UK Energy kWh}", meaning: "UK energy consumption" },
      { token: "{Non-UK Energy kWh}", meaning: "Non-UK energy consumption" },
      { token: "{Renewable Energy kWh}", meaning: "Renewable energy consumption" },
      {
        token: "{Energy Emissions (Location-based)}",
        meaning: "Location-based emissions",
      },
      {
        token: "{Energy Emissions (Market-based)}",
        meaning: "Market-based emissions",
      },
      { token: "{Carbon Offsets}", meaning: "Carbon offsets" },
      { token: "{Consultant Name}", meaning: "Consultant name" },
      { token: "{Client Signee}", meaning: "Client signatory" },
    ],
  },
];

export default function ReportVariablesAdmin({ baseUrl }: ReportVariablesAdminProps) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingVariables, setLoadingVariables] = useState(false);
  const [status, setStatus] = useState("");

  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState<string>("all");

  useEffect(() => {
    void loadTemplates();
  }, [baseUrl]);

  useEffect(() => {
    if (selectedTemplate != null) {
      void loadVariables(selectedTemplate);
    }
  }, [selectedTemplate]);

  async function loadTemplates() {
    setLoadingTemplates(true);
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/report-templates`);
      if (!res.ok) throw new Error("Failed to load report templates");
      const data = await res.json();

      const items = Array.isArray(data?.items) ? data.items : [];
      setTemplates(items);

      if (items.length > 0) {
        setSelectedTemplate((prev) => prev ?? Number(items[0].template_id));
      } else {
        setSelectedTemplate(null);
        setVariables([]);
      }
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function loadVariables(templateId: number) {
    setLoadingVariables(true);
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/report-templates/${templateId}/variables`);
      if (!res.ok) throw new Error("Failed to load variables");
      const data = await res.json();
      setVariables(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
      setVariables([]);
    } finally {
      setLoadingVariables(false);
    }
  }

  const selectedTemplateData = useMemo(
    () => templates.find((t) => t.template_id === selectedTemplate),
    [templates, selectedTemplate]
  );

  const sectionOptions = useMemo(() => {
    const sections = Array.from(new Set(variables.map((v) => v.section || "General")));
    return sections.sort((a, b) => a.localeCompare(b));
  }, [variables]);

  const filteredVariables = useMemo(() => {
    const q = search.trim().toLowerCase();
    return variables.filter((variable) => {
      const section = variable.section || "General";
      if (sectionFilter !== "all" && section !== sectionFilter) return false;

      if (!q) return true;
      const haystack = [
        variable.variable_label,
        variable.variable_key,
        variable.variable_type,
        variable.section,
        variable.default_value,
        variable.placeholder,
        variable.help_text,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");

      return haystack.includes(q);
    });
  }, [variables, search, sectionFilter]);

  const variablesBySection = useMemo(() => {
    return filteredVariables.reduce((acc, variable) => {
      const section = variable.section || "General";
      if (!acc[section]) acc[section] = [];
      acc[section].push(variable);
      return acc;
    }, {} as Record<string, TemplateVariable[]>);
  }, [filteredVariables]);

  const requiredCount = filteredVariables.filter((v) => v.is_required).length;
  const optionalCount = filteredVariables.length - requiredCount;

  return (
    <div className="space-y-6">
      {status && <div className="rounded-md bg-muted p-3 text-sm">{status}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Placeholder reference */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Word Placeholder Reference</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <div className="font-medium">Use single braces in Word templates</div>
              <div className="mt-1 text-xs">
                ✅ <code>{"{Report Title}"}</code> &nbsp; | &nbsp; ❌ <code>report_title</code>
                &nbsp; | &nbsp; ❌ <code>{"{{report_title}}"}</code>
              </div>
            </div>

            {PLACEHOLDER_REFERENCE.map((group) => (
              <div key={group.title} className="space-y-2">
                <h3 className="font-medium" style={{ color: "#F26624" }}>
                  {group.title}
                </h3>
                <div className="space-y-1.5">
                  {group.items.map((item) => (
                    <div key={item.token} className="rounded-md border p-2">
                      <div className="font-mono text-xs">{item.token}</div>
                      <div className="text-xs text-muted-foreground">{item.meaning}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Template + variables explorer */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Template Variables</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingTemplates && templates.length === 0 ? (
                <div className="text-sm text-muted-foreground">Loading templates...</div>
              ) : templates.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No report templates found. Run{" "}
                  <code className="bg-muted px-1 py-0.5 rounded">python setup_report_templates.py</code>
                  {" "}to create initial templates.
                </div>
              ) : (
                <>
                  <Select
                    value={selectedTemplate?.toString()}
                    onValueChange={(v) => {
                      setSelectedTemplate(Number(v));
                      setSearch("");
                      setSectionFilter("all");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a report template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.template_id} value={template.template_id.toString()}>
                          {template.template_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedTemplateData && (
                    <div className="rounded-md border p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-medium">{selectedTemplateData.template_name}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {selectedTemplateData.description}
                          </div>
                        </div>
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                            selectedTemplateData.is_active
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {selectedTemplateData.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>
                          Template Key:{" "}
                          <code className="bg-muted px-1 py-0.5 rounded">
                            {selectedTemplateData.template_key}
                          </code>
                        </div>
                        <div>Type: {selectedTemplateData.template_type}</div>
                        <div>Variables: {variables.length}</div>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by label, key, type, section..."
                    />
                    <Select value={sectionFilter} onValueChange={setSectionFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Filter by section" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sections</SelectItem>
                        {sectionOptions.map((section) => (
                          <SelectItem key={section} value={section}>
                            {section}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-muted px-2 py-1">
                      Showing {filteredVariables.length} / {variables.length}
                    </span>
                    <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">
                      Required: {requiredCount}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                      Optional: {optionalCount}
                    </span>
                    {(search || sectionFilter !== "all") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSearch("");
                          setSectionFilter("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {selectedTemplate != null && (
            <Card>
              <CardHeader>
                <CardTitle>Variables Explorer</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingVariables ? (
                  <div className="text-sm text-muted-foreground">Loading variables...</div>
                ) : filteredVariables.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No variables match the current filter.
                  </div>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(variablesBySection)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([section, sectionVars]) => (
                        <div key={section}>
                          <h3
                            className="font-semibold mb-3 text-sm"
                            style={{ color: "#F26624" }}
                          >
                            {section}
                          </h3>
                          <div className="space-y-3">
                            {sectionVars
                              .sort((a, b) => a.display_order - b.display_order)
                              .map((variable) => (
                                <div
                                  key={variable.variable_id}
                                  className="rounded-md border p-4 hover:bg-muted/50 transition-colors"
                                >
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="font-medium">{variable.variable_label}</div>
                                      {variable.is_required ? (
                                        <span className="text-xs bg-red-100 text-red-800 px-1.5 py-0.5 rounded">
                                          Required
                                        </span>
                                      ) : (
                                        <span className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                                          Optional
                                        </span>
                                      )}
                                    </div>

                                    <div className="text-xs text-muted-foreground space-y-1">
                                      <div>
                                        Key:{" "}
                                        <code className="bg-muted px-1 py-0.5 rounded">
                                          {variable.variable_key}
                                        </code>
                                      </div>
                                      <div>
                                        Type: <span className="capitalize">{variable.variable_type}</span>
                                      </div>
                                      {variable.default_value && (
                                        <div>Default: {variable.default_value}</div>
                                      )}
                                      {variable.placeholder && (
                                        <div>Input hint: {variable.placeholder}</div>
                                      )}
                                      {variable.help_text && (
                                        <div className="italic">ℹ️ {variable.help_text}</div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>How to use this section</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                Use this page to review each template variable key, label, type, default, and required status.
                These are the fields users complete in jobs before generating reports.
              </p>
              <p>
                Placeholder tokens shown on the left are for report templates (especially Word content) and should
                be written exactly with single curly braces.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
