"use client";

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

type SiteOption = {
  site_id: number | null;
  site_name: string | null;
};

type CommutingSummary = {
  job_id: number;
  row_count: number;
  total_tco2e: number;
  site_count: number;
  data_source: string;
};

type PreviewRow = {
  row_number: number;
  row_type: string;
  employee_name: string;
  original_id: string;
  report_label: string | null;
  qty: number;
  uom: string | null;
  calc_tco2e: number;
};

type UnresolvedRow = {
  sheet: string;
  row_number: number;
  employee_name: string;
  reason: string;
  original_id?: string | null;
};

type PreviewPayload = {
  job_id: number;
  site_id: number | null;
  site_label: string;
  template_version: string;
  parsed_count: number;
  ready_count: number;
  unresolved_count: number;
  total_tco2e: number;
  ready_rows: PreviewRow[];
  unresolved_rows: UnresolvedRow[];
};

export default function EmployeeCommutingData({
  jobId,
  baseUrl,
  jobNumber,
  clientName,
  reportingPeriodStart,
  reportingPeriodEnd,
}: {
  jobId: number;
  baseUrl: string;
  jobNumber?: string | null;
  clientName?: string | null;
  reportingPeriodStart?: string | null;
  reportingPeriodEnd?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState<CommutingSummary | null>(null);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("__none__");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);

  const selectedSiteLabel = useMemo(() => {
    if (selectedSiteId === "__none__") return "All_Staff";
    const siteId = Number(selectedSiteId);
    return sites.find((site) => site.site_id === siteId)?.site_name || "All_Staff";
  }, [selectedSiteId, sites]);

  function safeNamePart(value: string | null | undefined) {
    const text = String(value || "").trim();
    const cleaned = text.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
    return cleaned || "Unknown";
  }

  function formatPeriodPart(value: string | null | undefined) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const datePart = raw.includes("T") ? raw.split("T")[0] : raw.slice(0, 10);
    const parsed = new Date(datePart);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).replace(/\s+/g, "-");
  }

  function fallbackTemplateFilename() {
    const periodStart = formatPeriodPart(reportingPeriodStart);
    const periodEnd = formatPeriodPart(reportingPeriodEnd);
    const periodPart = periodStart && periodEnd ? `${periodStart}-to-${periodEnd}` : "Reporting_Period";
    return [
      safeNamePart(jobNumber || `Job-${jobId}`),
      safeNamePart(clientName || "Client"),
      safeNamePart(selectedSiteLabel),
      safeNamePart(periodPart),
      "employee_commuting",
    ].join("_") + ".xlsx";
  }

  function filenameFromDisposition(disposition: string | null, fallback: string) {
    if (!disposition) return fallback;
    const filenameStar = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (filenameStar?.[1]) {
      try {
        return decodeURIComponent(filenameStar[1].trim().replace(/^"(.*)"$/, "$1"));
      } catch {
        // fall through
      }
    }
    const filenameMatch = disposition.match(/filename\s*=\s*("?)([^";]+)\1/i);
    if (filenameMatch?.[2]) {
      return filenameMatch[2].trim();
    }
    return fallback;
  }

  useEffect(() => {
    void loadSummary();
    void loadSites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, baseUrl]);

  async function loadSummary() {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/summary`);
      if (!res.ok) {
        throw new Error(`Failed to load employee commuting summary (${res.status})`);
      }
      const data = (await res.json()) as CommutingSummary;
      setSummary(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load employee commuting summary");
    }
  }

  async function loadSites() {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/sites`);
      if (!res.ok) return;
      const data = await res.json();
      setSites(Array.isArray(data?.sites) ? data.sites : []);
    } catch {
      // non-fatal
    }
  }

  function siteQuery() {
    if (selectedSiteId === "__none__") return "";
    return `?site_id=${encodeURIComponent(selectedSiteId)}`;
  }

  async function downloadTemplate() {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/template${siteQuery()}`);
      if (!res.ok) {
        throw new Error(`Template download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromDisposition(
        res.headers.get("content-disposition"),
        fallbackTemplateFilename()
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setStatus(`Template downloaded for ${selectedSiteLabel.replaceAll("_", " ")}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Template download failed");
    } finally {
      setLoading(false);
    }
  }

  async function readError(res: Response): Promise<{ message: string; preview?: PreviewPayload | null }> {
    try {
      const data = await res.json();
      const detail = data?.detail;
      if (typeof detail === "string") {
        return { message: detail };
      }
      if (detail && typeof detail === "object") {
        return {
          message: String(detail.message || `Request failed (${res.status})`),
          preview: detail.preview ?? null,
        };
      }
      return { message: data?.message || `Request failed (${res.status})` };
    } catch {
      const text = await res.text().catch(() => "");
      return { message: text || `Request failed (${res.status})` };
    }
  }

  async function previewUpload() {
    if (!uploadFile) {
      setError("Please choose a completed employee commuting workbook first.");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/upload-preview${siteQuery()}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const apiError = await readError(res);
        throw new Error(apiError.message);
      }
      const data = (await res.json()) as PreviewPayload;
      setPreview(data);
      setStatus(
        `Preview complete: ${data.ready_count} ready, ${data.unresolved_count} unresolved, ${data.total_tco2e.toFixed(4)} tCO2e.`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  async function commitUpload() {
    if (!uploadFile) {
      setError("Please choose a completed employee commuting workbook first.");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const siteSuffix = selectedSiteId === "__none__" ? "" : `site_id=${encodeURIComponent(selectedSiteId)}&`;
      const res = await fetch(
        `${baseUrl}/jobs/${jobId}/employee-commuting/upload-commit?${siteSuffix}replace_existing=${
          replaceExisting ? "true" : "false"
        }`,
        {
          method: "POST",
          body: fd,
        }
      );
      if (!res.ok) {
        const apiError = await readError(res);
        if (apiError.preview) {
          setPreview(apiError.preview);
        }
        throw new Error(apiError.message);
      }
      const data = await res.json();
      setStatus(
        `Employee commuting import completed. Inserted ${data?.inserted ?? 0} rows${
          replaceExisting ? `, replaced ${data?.disabled ?? 0}` : ""
        }.`
      );
      setPreview(null);
      await loadSummary();
      window.dispatchEvent(new Event("nzi-job-scope-refresh"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee Commuting &amp; Working From Home</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="text-sm text-muted-foreground">
          Download the new commuting workbook, complete the commuting and WFH tabs, then upload it here.
          Imported rows are written into Job Data below with the source <span className="font-medium">Employee Commuting Template</span>.
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase text-muted-foreground">Imported Rows</div>
            <div className="mt-1 text-2xl font-semibold">{summary?.row_count ?? 0}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase text-muted-foreground">Imported tCO2e</div>
            <div className="mt-1 text-2xl font-semibold">
              {(summary?.total_tco2e ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase text-muted-foreground">Sites Covered</div>
            <div className="mt-1 text-2xl font-semibold">{summary?.site_count ?? 0}</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="employee-commuting-site">Site</Label>
            <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
              <SelectTrigger id="employee-commuting-site">
                <SelectValue placeholder="Organisation-wide / no site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Organisation-wide / No site</SelectItem>
                {sites
                  .filter((site) => site.site_id != null && (site.site_name ?? "").trim().length > 0)
                  .map((site) => (
                    <SelectItem key={site.site_id ?? ""} value={String(site.site_id)}>
                      {site.site_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              The selected site is used in the downloaded file name and applied to imported rows.
            </div>
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={downloadTemplate} disabled={loading}>
              Download Template
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
          <div className="space-y-2">
            <Label htmlFor="employee-commuting-upload">Completed Workbook (.xlsx)</Label>
            <Input
              id="employee-commuting-upload"
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                setUploadFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setError("");
                setStatus("");
              }}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={previewUpload} disabled={loading || !uploadFile}>
              Preview Upload
            </Button>
          </div>
          <div className="flex items-end">
            <Button
              onClick={commitUpload}
              disabled={
                loading ||
                !uploadFile ||
                !preview ||
                preview.ready_count === 0 ||
                preview.unresolved_count > 0
              }
            >
              Import to Job Data
            </Button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
          />
          Replace previous commuting import for this site selection
        </label>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {status ? (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">{status}</div>
        ) : null}

        {preview ? (
          <div className="space-y-4 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">Preview Summary</div>
                <div className="text-sm text-muted-foreground">
                  {preview.site_label.replaceAll("_", " ")} • {preview.template_version}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Ready rows: {preview.ready_count} | Unresolved rows: {preview.unresolved_count}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-xs uppercase text-muted-foreground">Parsed Rows</div>
                <div className="mt-1 text-xl font-semibold">{preview.parsed_count}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs uppercase text-muted-foreground">Ready Rows</div>
                <div className="mt-1 text-xl font-semibold">{preview.ready_count}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs uppercase text-muted-foreground">Unresolved Rows</div>
                <div className="mt-1 text-xl font-semibold">{preview.unresolved_count}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs uppercase text-muted-foreground">Preview tCO2e</div>
                <div className="mt-1 text-xl font-semibold">
                  {preview.total_tco2e.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </div>
              </div>
            </div>

            {preview.unresolved_rows.length > 0 ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <div className="mb-2 font-medium text-destructive">Unresolved Rows</div>
                <div className="space-y-2 text-sm">
                  {preview.unresolved_rows.map((row, idx) => (
                    <div key={`${row.sheet}-${row.row_number}-${idx}`} className="rounded border bg-background p-2">
                      <div className="font-medium">
                        {row.sheet} row {row.row_number}
                        {row.employee_name ? ` • ${row.employee_name}` : ""}
                      </div>
                      <div className="text-muted-foreground">{row.reason}</div>
                      {row.original_id ? <div className="font-mono text-xs">{row.original_id}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {preview.ready_rows.length > 0 ? (
              <div className="rounded-md border">
                <div className="border-b px-3 py-2 text-sm font-medium">Ready Rows</div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-left">
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Employee / Team</th>
                        <th className="px-3 py-2">Original ID</th>
                        <th className="px-3 py-2">Report Label</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2">Unit</th>
                        <th className="px-3 py-2 text-right">tCO2e</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.ready_rows.slice(0, 60).map((row) => (
                        <tr key={`${row.row_type}-${row.row_number}-${row.original_id}`} className="border-b">
                          <td className="px-3 py-2">{row.row_number}</td>
                          <td className="px-3 py-2 capitalize">{row.row_type}</td>
                          <td className="px-3 py-2">{row.employee_name || "Unspecified"}</td>
                          <td className="px-3 py-2 font-mono">{row.original_id}</td>
                          <td className="px-3 py-2">{row.report_label || ""}</td>
                          <td className="px-3 py-2 text-right">
                            {row.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </td>
                          <td className="px-3 py-2">{row.uom || ""}</td>
                          <td className="px-3 py-2 text-right">
                            {row.calc_tco2e.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
