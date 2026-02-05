"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

const MONTH_MAP: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4,
  May: 5, June: 6, July: 7, August: 8,
  September: 9, October: 10, November: 11, December: 12,
};

function calculateReportingPeriod(
  yearEndMonth: string,
  benchmarkYear: number,
  reportingYearNumber: number
): { start: string; end: string } | null {
  const monthNum = MONTH_MAP[yearEndMonth];
  if (!monthNum || !benchmarkYear || !reportingYearNumber) return null;

  const yearsOffset = reportingYearNumber - 1;
  const periodEndYear = benchmarkYear + yearsOffset;
  const periodStartYear = periodEndYear - 1;

  let startMonth: number;
  let startYear: number;
  let endMonth: number;
  let endYear: number;
  let endDay: number;

  if (monthNum === 12) {
    startMonth = 1;
    startYear = periodStartYear + 1;
    endMonth = 12;
    endYear = periodEndYear;
    endDay = 31;
  } else {
    startMonth = monthNum + 1;
    startYear = periodStartYear;
    endMonth = monthNum;
    endYear = periodEndYear;

    if ([1, 3, 5, 7, 8, 10, 12].includes(endMonth)) {
      endDay = 31;
    } else if ([4, 6, 9, 11].includes(endMonth)) {
      endDay = 30;
    } else {
      endDay = endYear % 4 === 0 && (endYear % 100 !== 0 || endYear % 400 === 0) ? 29 : 28;
    }
  }

  const startDate = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  return { start: startDate, end: endDate };
}

type Job = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  status: string | null;
  job_template_id?: number | null;
  client_db_id: number;
  client_name: string | null;
};

type JobTemplate = {
  job_template_id: number;
  template_key: string | null;
  template_name: string | null;
  excel_template_path: string | null;
  crp_template_path: string | null;
  is_active: boolean;
};

type JobTemplatesResponse = {
  items: JobTemplate[];
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
};

type DatasetsResponse = {
  items: Dataset[];
};

type JobScopeConfigItem = {
  scope: string;
  include_scope: boolean;
  dataset_id: number | null;
  factor_method: string | null;
};

type JobScopeConfigResponse = {
  job_id: number;
  items: JobScopeConfigItem[];
};

type JobSitesResponse = {
  job_id: number;
  client_db_id: number;
  sites: Array<{
    site_id: number | null;
    site_name: string | null;
    location: string | null;
    is_registered_office: boolean;
  }>;
};

export default function JobDetailPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  const [job, setJob] = useState<Job | null>(null);
  const [sites, setSites] = useState<JobSitesResponse["sites"]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("All");
  const [includePrevYear, setIncludePrevYear] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [reportingPeriodStart, setReportingPeriodStart] = useState<string>("");
  const [reportingPeriodEnd, setReportingPeriodEnd] = useState<string>("");

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [scopeDatasetIds, setScopeDatasetIds] = useState<Record<string, string>>({
    "Scope 1": "__none__",
    "Scope 2": "__none__",
    "Scope 3": "__none__",
  });

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [uploadResult, setUploadResult] = useState<any>(null);

  function selectedSiteName(): string {
    if (selectedSiteId === "All") return "All";
    const sid = Number(selectedSiteId);
    const match = sites.find((s) => (s.site_id ?? -1) === sid);
    return (match?.site_name ?? "").trim() || "All";
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(jobId) || jobId <= 0) {
        setError("Invalid job id");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [jRes, sRes, tRes, dRes, scRes] = await Promise.all([
          fetch(`${baseUrl}/jobs/${jobId}`),
          fetch(`${baseUrl}/jobs/${jobId}/sites`),
          fetch(`${baseUrl}/job-templates`),
          fetch(`${baseUrl}/datasets`),
          fetch(`${baseUrl}/jobs/${jobId}/scope-config`),
        ]);

        if (!jRes.ok) {
          const t = await jRes.text().catch(() => "");
          throw new Error(`Failed to load job: ${jRes.status} ${jRes.statusText}${t ? ` - ${t}` : ""}`);
        }

        const jJson = (await jRes.json()) as Job;
        const sJson = sRes.ok ? ((await sRes.json()) as JobSitesResponse) : null;
        const tJson = tRes.ok ? ((await tRes.json()) as JobTemplatesResponse) : null;
        const dJson = dRes.ok ? ((await dRes.json()) as DatasetsResponse) : null;
        const scJson = scRes.ok ? ((await scRes.json()) as JobScopeConfigResponse) : null;

        if (cancelled) return;

        setJob(jJson);
        
        // Auto-calculate reporting period if not set
        if (!jJson.reporting_period_start && jJson.client_db_id && jJson.reporting_year) {
          // Fetch client to get year_end_month and benchmark_year
          const clientRes = await fetch(`${baseUrl}/clients/${jJson.client_db_id}`);
          if (clientRes.ok) {
            const clientJson = await clientRes.json();
            if (clientJson.year_end_month && clientJson.benchmark_year) {
              // Calculate reporting period
              const calculated = calculateReportingPeriod(
                clientJson.year_end_month,
                clientJson.benchmark_year,
                jJson.reporting_year
              );
              if (calculated) {
                setReportingPeriodStart(calculated.start);
                setReportingPeriodEnd(calculated.end);
              }
            }
          }
        } else {
          setReportingPeriodStart(jJson.reporting_period_start || "");
          setReportingPeriodEnd(jJson.reporting_period_end || "");
        }

        const tItems = tJson?.items ?? [];
        setTemplates(tItems);
        const jt = (jJson as any)?.job_template_id;
        setSelectedTemplateId(jt != null ? String(jt) : "");

        const s = sJson?.sites ?? [];
        setSites(s);
        const firstId = s.find((x) => x.site_id != null)?.site_id;
        setSelectedSiteId(firstId != null ? String(firstId) : "All");

        setDatasets(dJson?.items ?? []);
        const cfg = scJson?.items ?? [];
        const nextMap: Record<string, string> = {
          "Scope 1": "__none__",
          "Scope 2": "__none__",
          "Scope 3": "__none__",
        };
        for (const it of cfg) {
          const scope = String(it.scope || "").trim();
          if (!(scope in nextMap)) continue;
          nextMap[scope] = it.dataset_id != null ? String(it.dataset_id) : "__none__";
        }
        setScopeDatasetIds(nextMap);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setJob(null);
        setSites([]);
        setDatasets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId]);

  async function saveScopeDatasets() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    setBusy(true);
    setStatus("Saving scope datasets...");
    try {
      const items = ["Scope 1", "Scope 2", "Scope 3"].map((scope) => {
        const v = scopeDatasetIds[scope] ?? "__none__";
        return { scope, dataset_id: v === "__none__" ? null : Number(v) };
      });

      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ items }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      setStatus("Scope datasets saved. Re-run validation.");
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(jobTemplateId: string) {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    if (!jobTemplateId) {
      setStatus("Please select a template.");
      return;
    }

    setBusy(true);
    setStatus("Saving template...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/job-template`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_template_id: Number(jobTemplateId) }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      setStatus("Template updated.");
      setJob((prev) => (prev ? { ...prev, job_template_id: Number(jobTemplateId) } : prev));
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveReportingPeriod() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    setBusy(true);
    setStatus("Saving reporting period...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reporting_period_start: reportingPeriodStart || null,
          reporting_period_end: reportingPeriodEnd || null,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      setStatus("Reporting period updated. Datasets will be auto-selected based on this period.");
      setJob((prev) =>
        prev
          ? {
              ...prev,
              reporting_period_start: reportingPeriodStart || null,
              reporting_period_end: reportingPeriodEnd || null,
            }
          : prev
      );
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function validateUpload() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    if (!uploadFile) {
      setUploadStatus("Please choose an .xlsx file to upload.");
      return;
    }

    setBusy(true);
    setUploadStatus("Uploading for validation...");
    setUploadResult(null);

    try {
      const form = new FormData();
      form.append("file", uploadFile);

      const res = await fetch(`${baseUrl}/jobs/${jobId}/excel-upload`, {
        method: "POST",
        body: form,
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!res.ok) {
        setUploadStatus(`Upload failed: ${res.status} ${res.statusText}`);
        setUploadResult(json);
        return;
      }

      setUploadStatus(json?.ok ? "Validation OK" : "Validation found issues");
      setUploadResult(json);
    } catch (e) {
      setUploadStatus(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function importValidatedRows() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    if (selectedSiteId === "All") {
      setUploadStatus("Please select a specific site (not 'All') before importing.");
      return;
    }

    if (!Array.isArray(uploadResult?.rows_ready) || uploadResult.rows_ready.length === 0) {
      setUploadStatus("Nothing to import. Validate first.");
      return;
    }

    setBusy(true);
    setUploadStatus("Importing rows...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/excel-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ site_id: Number(selectedSiteId), rows_ready: uploadResult.rows_ready }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setUploadStatus(`Import failed: ${res.status} ${res.statusText}${t ? ` - ${t}` : ""}`);
        return;
      }

      const json = await res.json().catch(() => null);
      setUploadStatus(`Import complete. Inserted ${json?.inserted ?? 0}, updated ${json?.updated ?? 0}.`);
    } catch (e) {
      setUploadStatus(`Import error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    const siteName = selectedSiteName();
    if (!siteName.trim()) {
      setStatus("Please select a site.");
      return;
    }

    setBusy(true);
    setStatus("Downloading template...");
    try {
      const params = new URLSearchParams();
      params.set("site", siteName);
      params.set("include_prev_year", includePrevYear ? "true" : "false");
      params.set("template_format", "single");

      const res = await fetch(`${baseUrl}/jobs/${jobId}/excel-template?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Download failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition") ?? "";
      const match = contentDisposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? `job_${jobId}_template.xlsx`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setStatus(`Downloaded: ${filename}`);
    } catch (e) {
      setStatus(`Download error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{job?.job_number ?? "Job"}</h1>
            <div className="text-sm text-muted-foreground">
              {job?.client_name ?? ""}
              {job?.reporting_year ? ` • ${job.reporting_year}` : ""}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href="/jobs">Back to Jobs</Link>
            </Button>
            {job?.client_db_id ? (
              <Button asChild>
                <Link href={`/?clientId=${job.client_db_id}&jobId=${jobId}`}>Open in Hub</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href={`/?jobId=${jobId}`}>Open in Hub</Link>
              </Button>
            )}
            {job?.client_db_id ? (
              <Button variant="outline" asChild>
                <Link href={`/clients/${job.client_db_id}`}>Client</Link>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link href="/">Hub</Link>
            </Button>
          </div>
        </div>

        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading...</div> : null}

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Job</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Title:</span> {job?.title ?? ""}
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span> {job?.status ?? ""}
              </div>
              <div>
                <span className="text-muted-foreground">Job ID:</span> {Number.isFinite(jobId) ? jobId : "-"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Template</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="text-sm font-medium">Reporting Period</div>
                <div className="text-xs text-muted-foreground">
                  Datasets will be auto-selected based on this period. System supports multi-year periods (e.g., Aug 2024 - Jul 2025).
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="periodStart">Period Start</Label>
                    <Input
                      id="periodStart"
                      type="date"
                      value={reportingPeriodStart}
                      onChange={(e) => setReportingPeriodStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="periodEnd">Period End</Label>
                    <Input
                      id="periodEnd"
                      type="date"
                      value={reportingPeriodEnd}
                      onChange={(e) => setReportingPeriodEnd(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveReportingPeriod} disabled={busy}>
                    Save reporting period
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="jobTemplate">Job Template</Label>
                <Select
                  value={selectedTemplateId}
                  onValueChange={(v) => {
                    setSelectedTemplateId(v);
                    setStatus("");
                  }}
                >
                  <SelectTrigger id="jobTemplate" className="w-full">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.job_template_id} value={String(t.job_template_id)}>
                        {(t.template_key ?? "template") + (t.template_name ? ` — ${t.template_name}` : "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex justify-end">
                  <Button onClick={() => saveTemplate(selectedTemplateId)} disabled={busy || !selectedTemplateId}>
                    Save template
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="site">Site</Label>
                <Select value={selectedSiteId} onValueChange={(v) => setSelectedSiteId(v)}>
                  <SelectTrigger id="site" className="w-full">
                    <SelectValue placeholder="Select a site..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All</SelectItem>
                    {sites
                      .filter((s) => s.site_id != null && (s.site_name ?? "").trim().length > 0)
                      .map((s) => (
                        <SelectItem key={s.site_id ?? ""} value={String(s.site_id)}>
                          {s.site_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2 md:flex-row">
                <Button onClick={downloadTemplate} disabled={busy}>
                  Download Excel template
                </Button>
                <Button
                  variant={includePrevYear ? "default" : "outline"}
                  onClick={() => setIncludePrevYear((v) => !v)}
                  disabled={busy}
                >
                  Include previous year: {includePrevYear ? "On" : "Off"}
                </Button>
              </div>

              {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}

              <div className="mt-4 rounded-md border p-4">
                <div className="mb-2 text-sm font-medium">Upload completed template</div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="upload">Excel file (.xlsx)</Label>
                    <Input
                      id="upload"
                      type="file"
                      accept=".xlsx"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setUploadFile(f);
                        setUploadResult(null);
                        setUploadStatus("");
                      }}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={validateUpload} disabled={busy || !uploadFile}>
                      Validate upload
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button
                    variant="outline"
                    onClick={importValidatedRows}
                    disabled={
                      busy ||
                      selectedSiteId === "All" ||
                      !Array.isArray(uploadResult?.rows_ready) ||
                      uploadResult.rows_ready.length === 0
                    }
                  >
                    Import validated rows
                  </Button>
                </div>

                {uploadStatus ? <div className="mt-3 text-sm text-muted-foreground">{uploadStatus}</div> : null}

                {uploadResult ? (
                  <div className="mt-3 space-y-3">
                    {Array.isArray(uploadResult?.errors) && uploadResult.errors.length ? (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        <div className="mb-2 font-medium text-destructive">Errors</div>
                        <ul className="list-disc pl-5">
                          {uploadResult.errors.map((e: string, idx: number) => (
                            <li key={idx}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {Array.isArray(uploadResult?.warnings) && uploadResult.warnings.length ? (
                      <div className="rounded-md border bg-muted/40 p-3 text-sm">
                        <div className="mb-2 font-medium">Warnings</div>
                        <ul className="list-disc pl-5">
                          {uploadResult.warnings.map((w: string, idx: number) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {typeof uploadResult?.details?.parsed_row_count === "number" ||
                    typeof uploadResult?.details?.rows_ready_count === "number" ? (
                      <div className="rounded-md border p-3 text-sm">
                        <div className="grid gap-2 md:grid-cols-2">
                          <div>
                            <span className="text-muted-foreground">Rows parsed:</span>{" "}
                            {uploadResult?.details?.parsed_row_count ?? "-"}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Rows ready:</span>{" "}
                            {uploadResult?.details?.rows_ready_count ?? "-"}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {Array.isArray(uploadResult?.rows_ready) && uploadResult.rows_ready.length ? (
                      <div className="rounded-md border p-3">
                        <div className="mb-2 text-sm font-medium">Preview (first 10 rows)</div>
                        <div className="max-h-64 overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-background">
                              <tr className="border-b">
                                <th className="p-2 text-left">Scope</th>
                                <th className="p-2 text-left">ID</th>
                                <th className="p-2 text-right">Qty</th>
                                <th className="p-2 text-right">tCO2e</th>
                                <th className="p-2 text-left">Unit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {uploadResult.rows_ready.slice(0, 10).map((r: any, idx: number) => (
                                <tr key={idx} className="border-b">
                                  <td className="p-2">{r.scope}</td>
                                  <td className="p-2 font-mono">{r.original_id}</td>
                                  <td className="p-2 text-right">
                                    {typeof r.qty === "number" ? r.qty.toLocaleString() : r.qty}
                                  </td>
                                  <td className="p-2 text-right">
                                    {typeof r.calc_tco2e === "number"
                                      ? r.calc_tco2e.toLocaleString(undefined, { maximumFractionDigits: 6 })
                                      : r.calc_tco2e}
                                  </td>
                                  <td className="p-2">{r.ghg_unit ?? ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}

                    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(uploadResult, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
