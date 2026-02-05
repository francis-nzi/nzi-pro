"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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

type JobListItem = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  status: string | null;
  client_db_id: number;
  client_name: string | null;
};

type JobsResponse = {
  items: JobListItem[];
  limit: number;
  offset: number;
  total: number;
};

type ClientJobsResponse = {
  client_db_id: number;
  items: Array<{
    job_id: number;
    job_number: string | null;
    title: string | null;
    reporting_year: number | null;
    status: string | null;
  }>;
  limit: number;
  offset: number;
  total: number;
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

export default function Page() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const searchParams = useSearchParams();

  const urlClientId = Number(searchParams.get("clientId") ?? "");
  const urlJobId = Number(searchParams.get("jobId") ?? "");
  const clientId = Number.isFinite(urlClientId) && urlClientId > 0 ? urlClientId : null;
  const initialJobId = Number.isFinite(urlJobId) && urlJobId > 0 ? urlJobId : null;

  const [query, setQuery] = useState<string>("");
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(initialJobId);
  const [sites, setSites] = useState<JobSitesResponse["sites"]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("All");
  const [includePrevYear, setIncludePrevYear] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");

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
    if (initialJobId != null) {
      setSelectedJobId(initialJobId);
    }
  }, [initialJobId]);

  async function validateUpload() {
    const jid = selectedJobId;
    if (jid == null || !Number.isFinite(jid) || jid <= 0) {
      setUploadStatus("Please select a Job before uploading.");
      return;
    }
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

      const res = await fetch(`${baseUrl}/jobs/${jid}/excel-upload`, {
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

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        if (clientId != null) {
          const res = await fetch(`${baseUrl}/clients/${clientId}/jobs?limit=200&offset=0`);
          if (!res.ok) return;
          const json = (await res.json()) as ClientJobsResponse;
          if (cancelled) return;
          setJobs(
            (json.items ?? []).map((j) => ({
              job_id: j.job_id,
              job_number: j.job_number,
              title: j.title,
              reporting_year: j.reporting_year,
              status: j.status,
              client_db_id: clientId,
              client_name: null,
            }))
          );
          return;
        }

        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        params.set("limit", "50");
        params.set("offset", "0");
        const res = await fetch(`${baseUrl}/jobs?${params.toString()}`);
        if (!res.ok) return;
        const json = (await res.json()) as JobsResponse;
        if (cancelled) return;
        setJobs(json.items ?? []);
      } catch {
        if (cancelled) return;
        setJobs([]);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [baseUrl, query, clientId]);

  useEffect(() => {
    let cancelled = false;

    async function loadSites(jobId: number) {
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/sites`);
        if (!res.ok) {
          if (!cancelled) setSites([]);
          return;
        }
        const json = (await res.json()) as JobSitesResponse;
        if (cancelled) return;
        const s = json.sites ?? [];
        setSites(s);
        const firstId = s.find((x) => x.site_id != null)?.site_id;
        setSelectedSiteId(firstId != null ? String(firstId) : "All");
      } catch {
        if (!cancelled) setSites([]);
        setSelectedSiteId("All");
      }
    }

    if (selectedJobId != null) {
      loadSites(selectedJobId);
    } else {
      setSites([]);
    }

    return () => {
      cancelled = true;
    };
  }, [baseUrl, selectedJobId]);

  async function checkHealth() {
    setBusy(true);
    setStatus("Checking API...");
    try {
      const res = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (!res.ok) {
        setStatus(`API error: ${res.status} ${res.statusText}`);
        return;
      }
      const json = await res.json().catch(() => null);
      setStatus(json?.ok ? "API OK" : "API responded but not ok");
    } catch (e) {
      setStatus(`API unreachable: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    const jid = selectedJobId;
    if (!jid) {
      setStatus("Please select a job.");
      return;
    }

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

      const res = await fetch(`${baseUrl}/jobs/${jid}/excel-template?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Download failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition") ?? "";
      const match = contentDisposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? `job_${jid}_template.xlsx`;

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

  async function importValidatedRows() {
    const jid = selectedJobId;
    if (jid == null || !Number.isFinite(jid) || jid <= 0) return;

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
      const res = await fetch(`${baseUrl}/jobs/${jid}/excel-import`, {
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

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Data Collection Hub</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="jobSearch">Find Job</Label>
              <Input
                id="jobSearch"
                placeholder="Search by job number, client, or title..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={clientId != null}
              />
              {clientId != null ? (
                <div className="text-xs text-muted-foreground">Filtered to client {clientId}</div>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="jobSelect">Job</Label>
                <Select
                  value={selectedJobId != null ? String(selectedJobId) : ""}
                  onValueChange={(v) => setSelectedJobId(v ? Number(v) : null)}
                >
                  <SelectTrigger id="jobSelect" className="w-full">
                    <SelectValue placeholder="Select a job..." />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.map((j) => (
                      <SelectItem key={j.job_id} value={String(j.job_id)}>
                        {(j.job_number ?? `Job ${j.job_id}`) + " — " + (j.client_name ?? "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="siteSelect">Site</Label>
                <Select
                  value={selectedSiteId}
                  onValueChange={(v) => setSelectedSiteId(v)}
                  disabled={selectedJobId == null}
                >
                  <SelectTrigger id="siteSelect" className="w-full">
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
            </div>

            <div className="flex flex-col gap-3 md:flex-row">
              <Button variant="secondary" onClick={checkHealth} disabled={busy}>
                Check API
              </Button>
              <Button variant="outline" asChild>
                <Link href="/jobs">Jobs</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/clients">Clients</Link>
              </Button>
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

            <div className="text-sm text-muted-foreground">
              <div>API base URL: {baseUrl}</div>
              <div>{status}</div>
            </div>

            <div className="rounded-md border p-4">
              <div className="mb-2 text-sm font-medium">Upload completed template (validate only)</div>
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
                  <Button onClick={validateUpload} disabled={busy || !uploadFile || selectedJobId == null}>
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
                    selectedJobId == null ||
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
                                <td className="p-2 text-right">{typeof r.qty === "number" ? r.qty.toLocaleString() : r.qty}</td>
                                <td className="p-2 text-right">
                                  {typeof r.calc_tco2e === "number" ? r.calc_tco2e.toLocaleString(undefined, { maximumFractionDigits: 6 }) : r.calc_tco2e}
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
  );
}
