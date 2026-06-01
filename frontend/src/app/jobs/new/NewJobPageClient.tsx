"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatJobFamilyLabel, getJobFamilyDescription } from "@/lib/job-family";
import { getJobWorkflowDefinition, normalizeJobFamily } from "@/lib/job-workflows";

function apiBaseUrl(): string {
  return "/api/backend";
}

type Client = {
  client_db_id: number;
  client_name: string;
  crm_owner?: string | null;
};

type TeamUser = {
  email: string;
  full_name: string;
  status?: string | null;
};

type Dataset = {
  dataset_id: number;
  name: string | null;
  source: string | null;
  analysis_type: string | null;
  country: string | null;
  region: string | null;
  currency: string | null;
  year: number | null;
  version: string | null;
  archived?: boolean;
  archived_at?: string | null;
  archived_by?: string | null;
};

type JobType = {
  job_type_id: number;
  name: string;
  is_active: boolean;
  is_crp?: boolean;
  job_family?: string | null;
  description?: string | null;
};

type JobRequiredField =
  | "clientId"
  | "jobType"
  | "reportingYear"
  | "startDate"
  | "dueDate"
  | "scopeDatasets";

function NewJobPageContent() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const router = useRouter();
  const [preselectedClientId, setPreselectedClientId] = useState("");

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamUser[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const clientSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form fields
  const [clientId, setClientId] = useState("");
  const [jobType, setJobType] = useState("");
  const [reportingYear, setReportingYear] = useState(
    new Date().getFullYear().toString()
  );
  const [isBenchmark, setIsBenchmark] = useState(false);
  const [title, setTitle] = useState("");
  const [jobStatus, setJobStatus] = useState("Open");
  const [crmName, setCrmName] = useState("");
  const [legacyJobNo, setLegacyJobNo] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [clientBenchmarkPeriod, setClientBenchmarkPeriod] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const [clientBenchmarkLoaded, setClientBenchmarkLoaded] = useState(false);
  const [scopeDatasetIds, setScopeDatasetIds] = useState<Record<string, string>>({
    "Scope 1": "__none__",
    "Scope 2": "__none__",
    "Scope 3": "__none__",
  });

  const [currentStep, setCurrentStep] = useState(1);
  const [maxStepVisited, setMaxStepVisited] = useState(1);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [showValidationSummary, setShowValidationSummary] = useState(false);

  const selectedJobTypeRecord = useMemo(
    () => jobTypes.find((jt) => jt.name === jobType) || null,
    [jobTypes, jobType]
  );
  const selectedJobFamily = normalizeJobFamily(
    selectedJobTypeRecord?.job_family || (selectedJobTypeRecord?.is_crp ? "crp" : null)
  );
  const selectedWorkflow = getJobWorkflowDefinition(selectedJobFamily);
  const stepConfig = useMemo(
    () => [
      {
        id: 1,
        title: "Job basics",
        description: "Client, owner, and job metadata",
      },
      {
        id: 2,
        title: "Reporting period",
        description: "Reporting year, dates, and benchmark",
      },
      {
        id: 3,
        title: selectedWorkflow.usesScopeDatasets ? "Scope datasets" : "Workflow setup",
        description: selectedWorkflow.usesScopeDatasets
          ? "Assign conversion factor datasets"
          : `Preview the ${selectedWorkflow.label} workflow`,
      },
    ],
    [selectedWorkflow]
  );

  const reportingYearLocked = isBenchmark && !!clientBenchmarkPeriod;

  const stepCompletion = [
    Boolean(clientId) && Boolean(jobType),
    Boolean(startDate) &&
      Boolean(dueDate) &&
      (reportingYearLocked || Boolean(reportingYear.trim())) &&
      (!startDate || !dueDate || new Date(dueDate) >= new Date(startDate)),
    true,
  ];

  const validationCount = Object.keys(formErrors).length;
  const validationMessages = Object.values(formErrors);
  const selectedClient = useMemo(
    () => clients.find((c) => c.client_db_id === Number(clientId)) || null,
    [clients, clientId]
  );
  const filteredClients = clients;

  const requiredFieldLabels: Record<JobRequiredField, string> = {
    clientId: "Client",
    jobType: "Job type",
    reportingYear: "Reporting year",
    startDate: "Start date",
    dueDate: "Due date",
    scopeDatasets: "Scope datasets",
  };

  const stepFieldMap: Record<number, JobRequiredField[]> = {
    1: ["clientId", "jobType"],
    2: ["reportingYear", "startDate", "dueDate"],
    3: selectedWorkflow.usesScopeDatasets ? ["scopeDatasets"] : [],
  };

  function clearFieldError(field: JobRequiredField) {
    if (!formErrors[field]) return;
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function collectErrors(): Partial<Record<JobRequiredField, string>> {
    const nextErrors: Partial<Record<JobRequiredField, string>> = {};

    if (!clientId) {
      nextErrors.clientId = `${requiredFieldLabels.clientId} is required.`;
    }

    if (!jobType) {
      nextErrors.jobType = `${requiredFieldLabels.jobType} is required.`;
    }

    if (!reportingYearLocked && !reportingYear.trim()) {
      nextErrors.reportingYear =
        `${requiredFieldLabels.reportingYear} is required.`;
    }

    if (!startDate) {
      nextErrors.startDate = `${requiredFieldLabels.startDate} is required.`;
    }

    if (!dueDate) {
      nextErrors.dueDate = `${requiredFieldLabels.dueDate} is required.`;
    }

    if (startDate && dueDate) {
      const start = new Date(startDate);
      const due = new Date(dueDate);
      if (due < start) {
        nextErrors.dueDate = "Due date cannot be before start date.";
      }
    }

    return nextErrors;
  }

  function validateStep(stepId: number) {
    const stepFields = stepFieldMap[stepId] ?? [];
    const allErrors = collectErrors();
    const stepErrors: Record<string, string> = {};

    stepFields.forEach((field) => {
      const fieldError = allErrors[field];
      if (fieldError) {
        stepErrors[field] = fieldError;
      }
    });

    setFormErrors((prev) => {
      const updated = { ...prev };
      stepFields.forEach((field) => {
        delete updated[field];
      });
      return { ...updated, ...stepErrors };
    });

    return stepErrors;
  }

  function validateAll() {
    const allErrors = collectErrors();
    setFormErrors(allErrors);
    return allErrors;
  }

  function handleStepChange(stepId: number) {
    if (stepId > maxStepVisited) return;
    setCurrentStep(stepId);
    setShowValidationSummary(false);
  }

  function handleNextStep() {
    const errors = validateStep(currentStep);
    if (Object.keys(errors).length > 0) {
      setShowValidationSummary(true);
      return;
    }

    const nextStep = Math.min(currentStep + 1, stepConfig.length);
    setCurrentStep(nextStep);
    setMaxStepVisited((prev) => Math.max(prev, nextStep));
    setShowValidationSummary(false);
  }

  function handlePreviousStep() {
    setCurrentStep((prev) => Math.max(1, prev - 1));
    setShowValidationSummary(false);
  }

  useEffect(() => {
    loadClients();
    loadDatasets();
    loadJobTypes();
    loadTeamMembers();
  }, [baseUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const value = new URLSearchParams(window.location.search).get("clientId");
    setPreselectedClientId(value || "");
  }, []);

  useEffect(() => {
    if (preselectedClientId && clients.length > 0) {
      const clientExists = clients.some(
        (c: Client) => c.client_db_id === Number(preselectedClientId)
      );

      if (clientExists) {
        setClientId(preselectedClientId);
        const client = clients.find((c) => c.client_db_id === Number(preselectedClientId));
        setClientSearch(client?.client_name || "");
        clearFieldError("clientId");
      }
    }
  }, [preselectedClientId, clients]);

  useEffect(() => {
    if (!preselectedClientId) return;
    void hydrateClientDetails(preselectedClientId);
  }, [preselectedClientId]);

  async function hydrateClientDetails(clientDbId: string) {
    setClientBenchmarkLoaded(false);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientDbId}`);
      if (!res.ok) return;

      const clientData = await res.json();
      setCrmName(clientData.crm_owner || "");
      if (clientData.benchmark_period_start && clientData.benchmark_period_end) {
        setClientBenchmarkPeriod({
          start: clientData.benchmark_period_start,
          end: clientData.benchmark_period_end,
        });
      } else {
        setClientBenchmarkPeriod(null);
      }
    } catch (e) {
      console.error("Error fetching client details:", e);
    } finally {
      setClientBenchmarkLoaded(true);
    }
  }

  const searchClients = useCallback(async (q: string) => {
    setClientSearchLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`${baseUrl}/clients?${params}`);
      if (res.ok) {
        const json = await res.json();
        setClients(json.items || []);
      }
    } catch {
      // ignore transient errors
    } finally {
      setClientSearchLoading(false);
    }
  }, [baseUrl]);

  async function loadClients() {
    setLoading(true);
    try {
      await searchClients("");
    } finally {
      setLoading(false);
    }
  }

  async function handleClientChange(newClientId: string) {
    setClientId(newClientId);
    clearFieldError("clientId");

    if (newClientId) {
      const matchedClient = clients.find((client) => client.client_db_id === Number(newClientId));
      setClientSearch(matchedClient?.client_name || "");
      void hydrateClientDetails(newClientId);
    } else {
      setClientSearch("");
      setCrmName("");
      setClientBenchmarkPeriod(null);
      setClientBenchmarkLoaded(false);
    }
  }

  async function loadDatasets() {
    try {
      const res = await fetch(`${baseUrl}/admin/datasets`, {
        credentials: "include",
      });
      if (!res.ok) {
        console.error("Failed to load datasets");
        return;
      }
      const json = await res.json();
      const activeDatasets = (json.items || []).filter((dataset: Dataset) => !dataset.archived);
      setDatasets(activeDatasets);
    } catch (err) {
      console.error("Error loading datasets:", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadJobTypes() {
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/job_types`, {
        credentials: "include",
      });
      if (!res.ok) {
        console.error("Failed to load job types");
        return;
      }
      const json = await res.json();
      const activeTypes = (json.items || []).filter((jt: JobType) => jt.is_active);
      setJobTypes(activeTypes);

      const defaultCrp = activeTypes.find((jt: JobType) => (jt.job_family || (jt.is_crp ? "crp" : "")).toLowerCase() === "crp");
      if (defaultCrp && (!jobType || !activeTypes.some((jt: JobType) => jt.name === jobType))) {
        setJobType(defaultCrp.name);
      }
    } catch (err) {
      console.error("Error loading job types:", err);
    }
  }

  async function loadTeamMembers() {
    try {
      const res = await fetch(`${baseUrl}/admin/users`, {
        credentials: "include",
      });
      if (!res.ok) {
        console.error("Failed to load team members");
        return;
      }
      const json = await res.json();
      const activeMembers = ((json.items ?? []) as TeamUser[])
        .filter((member) => String(member.status ?? "Active").toLowerCase() === "active")
        .sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""));
      setTeamMembers(activeMembers);
    } catch (err) {
      console.error("Error loading team members:", err);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errors = validateAll();
    if (Object.keys(errors).length > 0) {
      setShowValidationSummary(true);

      if (errors.clientId || errors.jobType) {
        setCurrentStep(1);
      } else if (errors.reportingYear || errors.startDate || errors.dueDate) {
        setCurrentStep(2);
      } else if (errors.scopeDatasets) {
        setCurrentStep(3);
      }
      return;
    }

    setSaving(true);
    setStatus("Creating job...");

    try {
      const res = await fetch(`${baseUrl}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_db_id: Number(clientId),
          job_type: jobType,
          title: title.trim() || "Untitled",
          reporting_year: reportingYear ? Number(reportingYear) : undefined,
          is_benchmark: isBenchmark,
          status: jobStatus,
          crm_name: crmName || null,
          legacy_job_no: legacyJobNo || null,
          start_date: startDate,
          due_date: dueDate,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to create job: ${res.status} - ${text}`);
      }

      const json = await res.json();
      const jobId = json.job_id;

      let successMsg = `Job created successfully! Job #: ${json.job_number || jobId}`;
      successMsg += ` | ${selectedWorkflow.label}`;
      if (json.reporting_period_start && json.reporting_period_end) {
        const start = new Date(json.reporting_period_start).toLocaleDateString(
          "en-GB",
          { day: "2-digit", month: "2-digit", year: "numeric" }
        );
        const end = new Date(json.reporting_period_end).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
        successMsg += ` | Reporting Period: ${start} - ${end}`;
        if (json.is_benchmark) {
          successMsg += " (Benchmark)";
        }
      }

      if (selectedWorkflow.usesScopeDatasets) {
        const scopeItems = ["Scope 1", "Scope 2", "Scope 3"].map((scope) => {
          const v = scopeDatasetIds[scope] ?? "__none__";
          return { scope, dataset_id: v === "__none__" ? null : Number(v) };
        });

        await fetch(`${baseUrl}/jobs/${jobId}/scope-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: scopeItems }),
        });
      }

      setStatus(successMsg);

      setTimeout(() => {
        router.push(`/jobs/${jobId}`);
      }, 1000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">New Job</h1>
            <p className="text-sm text-muted-foreground">Create a new job</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/jobs">Cancel</Link>
          </Button>
        </div>

        {status && (
          <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading clients...</div>
        ) : clients.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="mb-4 text-muted-foreground">
                No clients found. Please create a client first.
              </p>
              <Button asChild>
                <Link href="/clients/new">Create Client</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-md border bg-card p-4">
              <div className="grid gap-3 md:grid-cols-3">
                {stepConfig.map((step, index) => {
                  const isActive = currentStep === step.id;
                  const isComplete = stepCompletion[index];
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => handleStepChange(step.id)}
                      disabled={step.id > maxStepVisited}
                      className={`rounded-md border px-4 py-3 text-left transition ${
                        isActive
                          ? "border-primary bg-muted/60"
                          : "border-transparent hover:border-muted"
                      } ${step.id > maxStepVisited ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Step {step.id}
                        </span>
                        {isComplete && (
                          <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                            Completed
                          </span>
                        )}
                      </div>
                      <div className="mt-2 text-base font-semibold">
                        {step.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {step.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {showValidationSummary && validationCount > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <div className="font-semibold">
                  Fix these {validationCount} {validationCount === 1 ? "field" : "fields"}
                </div>
                <ul className="mt-2 list-disc pl-4">
                  {validationMessages.map((message, index) => (
                    <li key={`validation-${index}`}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {currentStep === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>Job basics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="client-search">Client *</Label>
                      <div className="relative">
                        <Input
                          id="client-search"
                          value={clientSearch}
                          onFocus={() => setClientPickerOpen(true)}
                          onBlur={() => {
                            window.setTimeout(() => setClientPickerOpen(false), 150);
                          }}
                          onChange={(event) => {
                            const value = event.target.value;
                            setClientSearch(value);
                            setClientPickerOpen(true);
                            if (clientId && selectedClient?.client_name !== value) {
                              setClientId("");
                            }
                            if (!value) {
                              setClientId("");
                            }
                            clearFieldError("clientId");
                            if (clientSearchTimer.current) clearTimeout(clientSearchTimer.current);
                            clientSearchTimer.current = setTimeout(() => { void searchClients(value); }, 250);
                          }}
                          placeholder="Search clients by name or ID..."
                          aria-invalid={!!formErrors.clientId}
                          className={formErrors.clientId ? "border-destructive" : ""}
                          autoComplete="off"
                        />
                        {clientPickerOpen && (
                          <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-md border bg-background shadow-lg">
                            <div className="max-h-64 overflow-y-auto py-1">
                              {clientSearchLoading ? (
                                <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
                              ) : filteredClients.length > 0 ? (
                                filteredClients.map((client) => {
                                  const isSelected = client.client_db_id === Number(clientId);
                                  return (
                                    <button
                                      key={client.client_db_id}
                                      type="button"
                                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100 ${
                                        isSelected ? "bg-slate-100 font-medium" : ""
                                      }`}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        void handleClientChange(String(client.client_db_id));
                                        setClientPickerOpen(false);
                                      }}
                                    >
                                      <span className="truncate">{client.client_name}</span>
                                      <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                                        #{client.client_db_id}
                                      </span>
                                    </button>
                                  );
                                })
                              ) : (
                                <div className="px-3 py-2 text-sm text-muted-foreground">
                                  No matching clients. Try a different search.
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {selectedClient && (
                        <p className="text-xs text-muted-foreground">
                          Selected: {selectedClient.client_name} (#{selectedClient.client_db_id})
                        </p>
                      )}
                      {formErrors.clientId && (
                        <p className="text-xs text-destructive">{formErrors.clientId}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="crmName">Client Owner</Label>
                      <Select
                        value={crmName || "__none__"}
                        onValueChange={(value) => setCrmName(value === "__none__" ? "" : value)}
                      >
                        <SelectTrigger id="crmName">
                          <SelectValue placeholder="Select team member..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {teamMembers.map((member) => (
                            <SelectItem
                              key={member.email || member.full_name}
                              value={member.full_name || member.email}
                            >
                              {member.full_name || member.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="legacyJobNo">Legacy Job No</Label>
                      <Input
                        id="legacyJobNo"
                        value={legacyJobNo}
                        onChange={(e) => setLegacyJobNo(e.target.value)}
                        placeholder="Reference from old system"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="jobType">Job Family / Type *</Label>
                      <Select
                        value={jobType}
                        onValueChange={(value) => {
                          setJobType(value);
                          clearFieldError("jobType");
                        }}
                      >
                        <SelectTrigger
                          id="jobType"
                          aria-invalid={!!formErrors.jobType}
                          className={formErrors.jobType ? "border-destructive" : ""}
                        >
                          <SelectValue placeholder="Select job type..." />
                        </SelectTrigger>
                        <SelectContent>
                          {jobTypes.map((jt) => {
                            const family = normalizeJobFamily(jt.job_family || (jt.is_crp ? "crp" : null));
                            const familyLabel = formatJobFamilyLabel(family);
                            const familyDescription = getJobFamilyDescription(family);
                            return (
                              <SelectItem key={jt.job_type_id} value={jt.name}>
                                {jt.name} • {familyLabel} — {familyDescription}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {selectedJobTypeRecord ? (
                        <p className="text-xs text-muted-foreground">
                          Family: {formatJobFamilyLabel(selectedJobFamily)}
                        </p>
                      ) : null}
                      {formErrors.jobType && (
                        <p className="text-xs text-destructive">{formErrors.jobType}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select value={jobStatus} onValueChange={setJobStatus}>
                      <SelectTrigger id="status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Open">Open</SelectItem>
                        <SelectItem value="Data Gathering Phase">
                          Data Gathering Phase
                        </SelectItem>
                        <SelectItem value="Reporting Phase">Reporting Phase</SelectItem>
                        <SelectItem value="Awaiting Client Input">
                          Awaiting Client Input
                        </SelectItem>
                        <SelectItem value="Completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">Job Title/Description</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Optional description"
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {currentStep === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>Reporting period</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="reportingYear">Reporting Year {!isBenchmark && "*"}</Label>
                      <div className="relative">
                        <Input
                          id="reportingYear"
                          type="number"
                          value={reportingYear}
                          onChange={(e) => {
                            setReportingYear(e.target.value);
                            clearFieldError("reportingYear");
                          }}
                          min="1990"
                          max="2100"
                          disabled={reportingYearLocked}
                          aria-invalid={!!formErrors.reportingYear}
                          className={`pr-9 ${reportingYearLocked ? "bg-muted text-muted-foreground" : ""}`}
                        />
                        {reportingYearLocked && (
                          <Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        )}
                      </div>
                      {formErrors.reportingYear && (
                        <p className="text-xs text-destructive">{formErrors.reportingYear}</p>
                      )}
                      {reportingYearLocked && (
                        <p className="text-xs text-muted-foreground">
                          Auto-calculated from benchmark period end date
                        </p>
                      )}
                    </div>
                  </div>

                  {clientBenchmarkPeriod && (
                    <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
                      <h4 className="font-semibold text-sm mb-2">Client Benchmark Period</h4>
                      <p className="text-sm mb-2">
                        <strong>Period:</strong>{" "}
                        {new Date(clientBenchmarkPeriod.start).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })} - {new Date(clientBenchmarkPeriod.end).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </p>
                      <div className="flex items-center space-x-2 mt-3">
                        <input
                          type="checkbox"
                          id="isBenchmark"
                          checked={isBenchmark}
                          onChange={(e) => {
                            setIsBenchmark(e.target.checked);
                            clearFieldError("reportingYear");
                          }}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <Label htmlFor="isBenchmark" className="font-normal cursor-pointer">
                          This is the benchmark job (reporting period will match benchmark period)
                        </Label>
                      </div>
                      {!isBenchmark && (
                        <p className="text-xs text-muted-foreground mt-2">
                          💡 Subsequent jobs will automatically calculate reporting periods based on the benchmark
                          period + incremental years
                        </p>
                      )}
                    </div>
                  )}

                  {clientBenchmarkLoaded && !clientBenchmarkPeriod && clientId && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm text-amber-800">
                        This client does not have a benchmark period defined. The reporting period will be
                        calculated from the reporting year and financial year end. Consider updating the client
                        profile to include benchmark period dates for better period management.
                      </p>
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="startDate">Start Date *</Label>
                      <Input
                        id="startDate"
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          clearFieldError("startDate");
                        }}
                        aria-invalid={!!formErrors.startDate}
                      />
                      {formErrors.startDate && (
                        <p className="text-xs text-destructive">{formErrors.startDate}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dueDate">Due Date *</Label>
                      <Input
                        id="dueDate"
                        type="date"
                        value={dueDate}
                        onChange={(e) => {
                          setDueDate(e.target.value);
                          clearFieldError("dueDate");
                        }}
                        aria-invalid={!!formErrors.dueDate}
                      />
                      {formErrors.dueDate && (
                        <p className="text-xs text-destructive">{formErrors.dueDate}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {currentStep === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle>{selectedWorkflow.usesScopeDatasets ? "Scope dataset configuration" : "Workflow setup"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedWorkflow.usesScopeDatasets ? (
                    <>
                      <div>
                        <h3 className="mb-2 text-sm font-medium">Scope Dataset Configuration</h3>
                        <p className="mb-3 text-xs text-muted-foreground">
                          Dataset allocation is automatic based on the client country and reporting period.
                          You can leave these as None to use the automatic resolution, or override them here if needed.
                        </p>
                        {formErrors.scopeDatasets ? (
                          <p className="text-xs text-destructive">{formErrors.scopeDatasets}</p>
                        ) : null}
                      </div>

                      {(["Scope 1", "Scope 2", "Scope 3"] as const).map((scope) => (
                        <div key={scope} className="space-y-2">
                          <Label htmlFor={`dataset-${scope}`}>{scope}</Label>
                          <Select
                            value={scopeDatasetIds[scope] ?? "__none__"}
                            onValueChange={(value) => {
                              setScopeDatasetIds({
                                ...scopeDatasetIds,
                                [scope]: value,
                              });
                              clearFieldError("scopeDatasets");
                            }}
                          >
                            <SelectTrigger id={`dataset-${scope}`}>
                              <SelectValue placeholder="Auto / None" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {datasets.map((ds) => (
                                <SelectItem key={ds.dataset_id} value={String(ds.dataset_id)}>
                                  {ds.name} ({ds.year})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{selectedWorkflow.label}</Badge>
                          <span className="text-sm font-medium text-slate-900">{selectedWorkflow.description}</span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          This family does not use scope dataset assignment on create. The family-specific workflow
                          and detail sections will be available on the job page after creation.
                        </p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        {selectedWorkflow.stages.map((stage) => (
                          <div key={stage} className="rounded-md border border-dashed border-slate-200 bg-white p-3 text-sm">
                            <div className="font-medium text-slate-900">{stage}</div>
                            <div className="mt-1 text-xs text-muted-foreground">Built-in for {selectedWorkflow.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Card>
                    <CardHeader>
                      <CardTitle style={{ color: "#F26624" }}>Custom Fields</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Custom fields can be configured in <strong>Admin → Custom Fields</strong>. After creating
                        the job, you can fill in custom fields in the <strong>Setup tab</strong> of the job.
                      </p>
                      <p className="text-sm text-muted-foreground mt-2">
                        Required fields will need to be completed before the job can be finalized.
                      </p>
                    </CardContent>
                  </Card>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handlePreviousStep}
                disabled={currentStep === 1}
              >
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" asChild>
                  <Link href="/jobs">Cancel</Link>
                </Button>
                {currentStep < stepConfig.length ? (
                  <Button type="button" onClick={handleNextStep}>
                    Next
                  </Button>
                ) : (
                  <Button type="submit" disabled={saving}>
                    {saving ? "Creating..." : "Create Job"}
                  </Button>
                )}
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default NewJobPageContent;
