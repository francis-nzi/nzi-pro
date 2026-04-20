"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import UploadProgressBar from "@/components/UploadProgressBar";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import EmissionsSummary from "@/components/EmissionsSummary";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAuthUserIdentifier, getToken } from "@/lib/auth-client";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function apiBaseCandidates(baseUrl?: string): string[] {
  const out: string[] = ["/api/backend"];
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    out.push(`http://${host}:8002`);
    out.push(`http://${host}:8000`);
  }
  if (baseUrl && String(baseUrl).trim()) out.push(String(baseUrl).trim());
  out.push("http://127.0.0.1:8002", "http://localhost:8000");
  return Array.from(new Set(out));
}

type Site = { site_id: number | null; site_name: string | null };
type RegisterGroup = {
  group_id: number;
  scope: string;
  category: string | null;
  group_type: string;
  group_name: string;
  site_id: number | null;
  site_name: string | null;
  rollup_method: string;
  dataset_id: number | null;
  factor_db_id: number | null;
  original_id: string | null;
  factor: number | null;
  ghg_unit: string | null;
  uom: string | null;
  factor_report_label: string | null;
  notes: string | null;
  enabled: boolean;
  source_count?: number;
  source_total_qty?: number;
  source_total_tco2e?: number;
};
type RegisterSource = {
  source_id: number;
  group_id: number | null;
  group_name: string | null;
  scope: string;
  category: string | null;
  source_type: string;
  source_subtype: string | null;
  site_id: number | null;
  site_name: string | null;
  source_name: string;
  asset_identifier: string | null;
  employee_name: string | null;
  original_id: string | null;
  qty: number | null;
  uom: string | null;
  factor: number | null;
  ghg_unit: string | null;
  apply_pct: number;
  notes: string | null;
  data_source: string | null;
  data_confidence: string | null;
  calc_tco2e: number;
  enabled: boolean;
};
type FactorOption = {
  scope: string;
  category: string;
  report_label: string;
  original_id: string;
  uom: string | null;
  factor: number | null;
  ghg_unit: string | null;
  factor_db_id?: number | null;
};
type RegisterPayload = {
  job_id: number;
  source_type: string;
  summary: {
    group_count: number;
    source_count: number;
    enabled_source_count: number;
    disabled_source_count: number;
    ungrouped_source_count: number;
    total_tco2e: number;
  };
  groups: RegisterGroup[];
  sources: RegisterSource[];
};

function blankScope(sourceType: string): string {
  return sourceType === "business_travel" ? "Scope 3" : "Scope 1";
}

export default function JobSourceRegister({
  jobId,
  baseUrl,
  sourceType,
  title,
  description,
  jobNumber,
  clientName,
  reportingYear,
  showEmissionsSummary = false,
}: {
  jobId: number;
  baseUrl: string;
  sourceType: "asset" | "business_travel";
  title: string;
  description: string;
  jobNumber?: string | number | null;
  clientName?: string | null;
  reportingYear?: string | number | null;
  showEmissionsSummary?: boolean;
}) {
  const isBusinessTravel = sourceType === "business_travel";
  const groupLabel = isBusinessTravel ? "Travel Group" : "Asset Group";
  const recordLabel = isBusinessTravel ? "Travel Source" : "Asset";
  const recordPlural = isBusinessTravel ? "Travel Sources" : "Assets";
  const recordIdentityLabel = isBusinessTravel ? "Travel identity" : "Asset identity";
  const recordIdentityPlaceholder = isBusinessTravel ? "Employee ref / trip ref" : "Registration / asset tag";
  const recordNamePlaceholder = isBusinessTravel ? "Employee travel pattern" : "Vehicle / Asset name";
  const confirmAction = useConfirmDialog();
  const apiBases = useMemo(() => apiBaseCandidates(baseUrl), [baseUrl]);
  const [activeApiBase, setActiveApiBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [groups, setGroups] = useState<RegisterGroup[]>([]);
  const [sources, setSources] = useState<RegisterSource[]>([]);
  const [summary, setSummary] = useState<RegisterPayload["summary"] | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState<string>("__none__");
  const [sourceName, setSourceName] = useState("");
  const [assetIdentifier, setAssetIdentifier] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [sourceSubtype, setSourceSubtype] = useState("");
  const [qty, setQty] = useState("1");
  const [applyPct, setApplyPct] = useState("100");
  const [notes, setNotes] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupScope, setGroupScope] = useState<string>(blankScope(sourceType));
  const [groupCategory, setGroupCategory] = useState("");
  const [groupRollupMethod, setGroupRollupMethod] = useState("sum");
  const [groupNotes, setGroupNotes] = useState("");
  const [groupSiteId, setGroupSiteId] = useState<string>("__none__");
  const [downloadSiteId, setDownloadSiteId] = useState<string>("__all__");

  const [factorSearch, setFactorSearch] = useState("");
  const [factorScopeFilter, setFactorScopeFilter] = useState<string>(blankScope(sourceType));
  const [factorOptions, setFactorOptions] = useState<FactorOption[]>([]);
  const [selectedFactor, setSelectedFactor] = useState<FactorOption | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = getToken();
    const userIdentifier = getAuthUserIdentifier();
    const authHeaders: Record<string, string> = {};
    if (token) authHeaders.Authorization = `Bearer ${token}`;
    else if (userIdentifier) authHeaders["X-User-Email"] = userIdentifier;

    const orderedBases = activeApiBase
      ? [activeApiBase, ...apiBases.filter((b) => b !== activeApiBase)]
      : apiBases;

    let fallback: Response | null = null;
    let lastError: unknown = null;
    for (const base of orderedBases) {
      try {
        const res = await fetch(`${base}${path}`, {
          ...init,
          credentials: init?.credentials ?? "include",
          headers: {
            ...authHeaders,
            ...(init?.headers as Record<string, string> | undefined),
          },
        });
        if (res.ok) {
          if (activeApiBase !== base) setActiveApiBase(base);
          return res;
        }
        if (res.status === 401 || res.status === 403) {
          if (!fallback) fallback = res;
          continue;
        }
        if (!fallback) fallback = res;
        return res;
      } catch (e) {
        lastError = e;
      }
    }
    if (fallback) return fallback;
    if (lastError instanceof Error) throw lastError;
    throw new Error("Failed to fetch");
  }

  async function loadSites() {
    try {
      const res = await apiFetch(`/jobs/${jobId}/sites`);
      if (!res.ok) return;
      const data = await res.json();
      setSites(Array.isArray(data?.sites) ? data.sites : []);
    } catch {
      // non-fatal
    }
  }

  async function loadRegister() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/emission-registers?source_type=${encodeURIComponent(sourceType)}`);
      if (!res.ok) throw new Error(`Failed to load register (${res.status})`);
      const data = (await res.json()) as RegisterPayload;
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
      setSources(Array.isArray(data?.sources) ? data.sources : []);
      setSummary(data?.summary ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load register");
    } finally {
      setLoading(false);
    }
  }

  async function reloadRegisterAndSummary() {
    await loadRegister();
    window.dispatchEvent(new Event("nzi-job-scope-refresh"));
  }

  async function loadFactors() {
    try {
      const queryParts = new URLSearchParams();
      queryParts.set("limit", "2000");
      queryParts.set("offset", "0");
      if (factorScopeFilter !== "All") queryParts.set("scope", factorScopeFilter);
      if (factorSearch.trim()) queryParts.set("search", factorSearch.trim());
      const res = await apiFetch(`/jobs/${jobId}/template-factors?${queryParts.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const rows: FactorOption[] = Array.isArray(data?.factors) ? data.factors : [];
      setFactorOptions(rows);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    void loadSites();
    void loadRegister();
    void loadFactors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, sourceType, baseUrl, activeApiBase]);

  useEffect(() => {
    void loadFactors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factorScopeFilter, factorSearch]);

  const selectedGroup = useMemo(
    () => groups.find((group) => String(group.group_id) === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  function chooseFactor(factor: FactorOption) {
    setSelectedFactor(factor);
    setGroupScope(factor.scope || blankScope(sourceType));
    setGroupCategory(factor.category || "");
  }

  function safeFilenamePart(value: string | number | null | undefined): string {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return text
      .replace(/[<>:"/\\|?*]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function registerFilename(kind: "template" | "example"): string {
    const yearValue =
      reportingYear != null && String(reportingYear).trim()
        ? String(reportingYear).trim()
        : String(new Date().getFullYear());
    const selectedDownloadSite =
      downloadSiteId !== "__all__"
        ? sites.find((site) => String(site.site_id) === downloadSiteId)?.site_name ?? null
        : null;
    const parts = [
      safeFilenamePart(jobNumber || `job_${jobId}`),
      safeFilenamePart(clientName || "client"),
      selectedDownloadSite ? safeFilenamePart(selectedDownloadSite) : "",
      safeFilenamePart(sourceType === "business_travel" ? "business_travel_register" : "asset_register"),
      safeFilenamePart(yearValue),
    ].filter(Boolean);
    const suffix = kind === "example" ? "_example" : "";
    return `${parts.join("_")}${suffix}.xlsx`;
  }

  async function downloadRegisterWorkbook(kind: "template" | "example") {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        source_type: sourceType,
        kind,
      });
      if (downloadSiteId !== "__all__") {
        params.set("site_id", downloadSiteId);
      }
      const res = await apiFetch(`/jobs/${jobId}/emission-registers/template?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to download workbook (${res.status})`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = registerFilename(kind);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setStatus(`${kind === "example" ? "Example" : "Template"} workbook downloaded.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download workbook");
    } finally {
      setLoading(false);
    }
  }

  async function createGroup() {
    setLoading(true);
    setError("");
    try {
      const payload = {
        scope: groupScope,
        group_name: groupName.trim(),
        group_type: sourceType,
        category: groupCategory.trim() || null,
        site_id: groupSiteId !== "__none__" ? Number(groupSiteId) : null,
        rollup_method: groupRollupMethod,
        factor_db_id: selectedFactor?.factor_db_id ?? null,
        original_id: selectedFactor?.original_id ?? null,
        factor: selectedFactor?.factor ?? null,
        ghg_unit: selectedFactor?.ghg_unit ?? null,
        uom: selectedFactor?.uom ?? null,
        notes: groupNotes.trim() || null,
      };
      if (!payload.factor_db_id && !payload.original_id) {
        throw new Error("Choose a factor for the group before creating it.");
      }
      const res = await apiFetch(`/jobs/${jobId}/emission-registers/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to create group (${res.status})`);
      }
      setGroupName("");
      setGroupCategory("");
      setGroupNotes("");
      setGroupSiteId("__none__");
      setSelectedFactor(null);
      setFactorSearch("");
      setStatus("Group created.");
      const data = await res.json().catch(() => null);
      if (data?.group_id != null) {
        setSelectedGroupId(String(data.group_id));
      }
      await reloadRegisterAndSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create group");
    } finally {
      setLoading(false);
    }
  }

  async function createSource() {
    setLoading(true);
    setError("");
    try {
      if (!selectedGroup) {
        throw new Error("Choose a group before adding an asset.");
      }
      const payload = {
        source_type: sourceType,
        source_subtype: sourceSubtype.trim() || null,
        group_id: selectedGroupId !== "__none__" ? Number(selectedGroupId) : null,
        source_name: sourceName.trim(),
        asset_identifier: assetIdentifier.trim() || null,
        employee_name: employeeName.trim() || null,
        qty: qty.trim() ? Number(qty) : null,
        apply_pct: applyPct.trim() ? Number(applyPct) : 100,
        data_source: sourceType === "business_travel" ? "Business Travel Register" : "Asset Register",
        data_confidence: "M",
        notes: notes.trim() || null,
        detail_json: {},
      };
      if (!payload.source_name) throw new Error(`${recordLabel} name is required.`);
      const res = await apiFetch(`/jobs/${jobId}/emission-registers/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to create ${recordLabel.toLowerCase()} (${res.status})`);
      }
      setSourceName("");
      setAssetIdentifier("");
      setEmployeeName("");
      setSourceSubtype("");
      setQty("1");
      setApplyPct("100");
      setNotes("");
      setStatus(`${recordLabel} added.`);
      await reloadRegisterAndSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to create ${recordLabel.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }

  async function importWorkbook() {
    if (!uploadFile) {
      setError("Choose an Excel workbook first.");
      return;
    }
    setImporting(true);
    setError("");
    setImportProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await uploadFormDataWithProgress(
        `/jobs/${jobId}/emission-registers/import-workbook?source_type=${encodeURIComponent(sourceType)}`,
        {
          method: "POST",
          headers: (() => {
            const token = getToken();
            const userIdentifier = getAuthUserIdentifier();
            const headers: Record<string, string> = {};
            if (token) headers.Authorization = `Bearer ${token}`;
            else if (userIdentifier) headers["X-User-Email"] = userIdentifier;
            return headers;
          })(),
          credentials: "include",
          body: fd,
          onProgress: ({ percent }) => setImportProgress(percent),
        }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Workbook import failed (${res.status})`);
      }
      const data = await res.json();
      setUploadFile(null);
      setStatus(
        `Workbook imported: ${data?.inserted_sources ?? 0} sources, ${data?.inserted_groups ?? 0} groups.`
      );
      await reloadRegisterAndSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import workbook");
    } finally {
      setImporting(false);
      setImportProgress(0);
    }
  }

  async function importPreviousYear() {
    setImporting(true);
    setError("");
    try {
      const res = await apiFetch(
        `/jobs/${jobId}/emission-registers/rollforward?source_type=${encodeURIComponent(sourceType)}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Previous-year import failed (${res.status})`);
      }
      const data = await res.json();
      setStatus(
        `Previous year imported: ${data?.inserted_sources ?? 0} sources, ${data?.inserted_groups ?? 0} groups. Qty was reset to 0.`
      );
      await reloadRegisterAndSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import previous year");
    } finally {
      setImporting(false);
    }
  }

  async function removeSource(sourceId: number, label: string) {
    const confirmed = await confirmAction({
      title: `Delete ${recordLabel.toLowerCase()}`,
      description: `Delete ${recordLabel.toLowerCase()} "${label}"? It will be hidden from the active register but kept in history.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/emission-registers/sources/${sourceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Delete failed (${res.status})`);
      }
      setStatus(`${recordLabel} archived.`);
      await reloadRegisterAndSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to delete ${recordLabel.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }

  async function removeGroup(groupId: number, label: string) {
    const confirmed = await confirmAction({
      title: "Delete group",
      description: `Delete group "${label}"? ${recordPlural} will remain and the group will be hidden.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/emission-registers/groups/${groupId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Delete failed (${res.status})`);
      }
      setStatus("Group archived.");
      await reloadRegisterAndSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete group");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {showEmissionsSummary ? <EmissionsSummary jobId={jobId} baseUrl={baseUrl} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div><div className="text-xs text-muted-foreground">{recordPlural}</div><div className="text-2xl font-semibold">{summary?.source_count ?? 0}</div></div>
          <div><div className="text-xs text-muted-foreground">Groups</div><div className="text-2xl font-semibold">{summary?.group_count ?? 0}</div></div>
          <div><div className="text-xs text-muted-foreground">Ungrouped</div><div className="text-2xl font-semibold">{summary?.ungrouped_source_count ?? 0}</div></div>
          <div><div className="text-xs text-muted-foreground">tCO₂e</div><div className="text-2xl font-semibold">{(summary?.total_tco2e ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-2 min-w-[220px]">
              <Label>Workbook site</Label>
              <Select value={downloadSiteId} onValueChange={setDownloadSiteId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All sites</SelectItem>
                  {sites.filter((s) => s.site_id != null).map((s) => (
                    <SelectItem key={String(s.site_id)} value={String(s.site_id)}>{s.site_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => void downloadRegisterWorkbook("template")} disabled={loading || importing}>
              Download template
            </Button>
            <Button variant="outline" onClick={() => void downloadRegisterWorkbook("example")} disabled={loading || importing}>
              Download example
            </Button>
            <Button variant="secondary" onClick={importPreviousYear} disabled={loading || importing}>
              {importing ? "Importing previous year..." : "Import previous year"}
            </Button>
          </div>

          <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground space-y-2">
            <p>
              Use matching <span className="font-medium text-foreground">{groupLabel}</span> values to link{" "}
              {recordPlural.toLowerCase()} to shared roll-up groups. The {groupLabel} name is the business roll-up label,
              while the factor ID lives in <span className="font-medium text-foreground">Original ID</span> or{" "}
              <span className="font-medium text-foreground">Factor DB ID</span> on each {recordLabel.toLowerCase()} row.
            </p>
            <p>
              <span className="font-medium text-foreground">group_type</span> is handled internally by the system and
              usually stays as <span className="font-medium text-foreground">asset</span> for the Asset Register and{" "}
              <span className="font-medium text-foreground">business_travel</span> for the Business Travel Register.
            </p>
            <p>
              Suggested pattern:{" "}
              <span className="font-medium text-foreground">[Category] - [{isBusinessTravel ? "Mode" : "Asset"}] - [Site or Team]</span>.
            </p>
            <p>
              For fleet-style reporting, use the group as the factor family bucket, for example{" "}
              <span className="font-medium text-foreground">Diesel Van Class 1 - Head Office</span>, and keep each{" "}
              {recordLabel.toLowerCase()} as the individual record underneath it.
            </p>
            <p>Search is live on the factor picker, and the workbook download can be limited to a single site.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
            <div className="space-y-2">
              <Label htmlFor="asset-register-upload">Import workbook (.xlsx)</Label>
              <Input
                id="asset-register-upload"
                type="file"
                accept=".xlsx"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={importWorkbook} disabled={loading || importing || !uploadFile} className="w-full">
                {importing ? "Importing workbook..." : "Import workbook"}
              </Button>
            </div>
          </div>
          {importing ? <UploadProgressBar value={importProgress} label="Importing workbook..." /> : null}
        </CardContent>
      </Card>

      {error ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
      {status ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{status}</div> : null}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Create Group</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Group name</Label>
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Diesel Vans Class 1 - Head Office" />
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={groupScope} onValueChange={setGroupScope}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Scope 1">Scope 1</SelectItem>
                    <SelectItem value="Scope 2">Scope 2</SelectItem>
                    <SelectItem value="Scope 3">Scope 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input value={groupCategory} onChange={(e) => setGroupCategory(e.target.value)} placeholder="Fleet / Travel / Equipment" />
              </div>
              <div className="space-y-2">
                <Label>Roll-up</Label>
                <Select value={groupRollupMethod} onValueChange={setGroupRollupMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sum">Sum</SelectItem>
                    <SelectItem value="weighted_sum">Weighted sum</SelectItem>
                    <SelectItem value="headcount_scaled">Headcount scaled</SelectItem>
                    <SelectItem value="average">Average</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Site</Label>
              <Select value={groupSiteId} onValueChange={setGroupSiteId}>
                <SelectTrigger><SelectValue placeholder="Optional site..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No site</SelectItem>
                  {sites.filter((s) => s.site_id != null).map((s) => (
                    <SelectItem key={String(s.site_id)} value={String(s.site_id)}>{s.site_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3 rounded-md border bg-muted/10 p-4">
              <div className="space-y-2">
                <Label>Factor search</Label>
                <Input
                  value={factorSearch}
                  onChange={(e) => setFactorSearch(e.target.value)}
                  placeholder="Search by label, category, UOM, or ID"
                />
                <div className="text-xs text-muted-foreground">
                  Pick the factor family this group will own. All assets added underneath inherit it.
                </div>
              </div>
              <div className="space-y-2">
                <Label>Factor scope filter</Label>
                <Select value={factorScopeFilter} onValueChange={setFactorScopeFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All</SelectItem>
                    <SelectItem value="Scope 1">Scope 1</SelectItem>
                    <SelectItem value="Scope 2">Scope 2</SelectItem>
                    <SelectItem value="Scope 3">Scope 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="max-h-56 overflow-auto rounded-md border bg-background">
                <div className="grid grid-cols-[1fr_auto] gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <div>Factor</div>
                  <div>Select</div>
                </div>
                {factorOptions.length ? factorOptions.map((factor) => (
                  <div key={`${factor.original_id}-${factor.report_label}`} className="grid grid-cols-[1fr_auto] gap-2 border-b px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{factor.report_label}</div>
                      <div className="text-xs text-muted-foreground">
                        {factor.scope} · {factor.category} · UOM {factor.uom || "-"} · {factor.original_id}
                      </div>
                    </div>
                    <Button variant={selectedFactor?.original_id === factor.original_id ? "secondary" : "outline"} size="sm" onClick={() => chooseFactor(factor)}>
                      {selectedFactor?.original_id === factor.original_id ? "Chosen" : "Use"}
                    </Button>
                  </div>
                )) : (
                  <div className="p-3 text-sm text-muted-foreground">Search to find a factor, then choose it for this group.</div>
                )}
              </div>
              {selectedFactor ? (
                <div className="rounded-md border bg-background p-3 text-sm">
                  <div className="font-medium">Selected factor</div>
                  <div className="text-muted-foreground">
                {selectedFactor.report_label} · {selectedFactor.original_id} · {selectedFactor.factor ?? "-"} {selectedFactor.ghg_unit ?? ""} · UOM {selectedFactor.uom || "-"}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
              Group the similar assets that share the same emissions factor family. Each asset remains a separate row,
              but the group controls the roll-up bucket.
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={groupNotes} onChange={(e) => setGroupNotes(e.target.value)} placeholder="Optional roll-up notes" />
            </div>
            <div className="flex justify-end">
              <Button onClick={createGroup} disabled={loading || !groupName.trim() || !selectedFactor}>Create group</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{`Add ${recordLabel}`}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{`${recordLabel} name`}</Label>
                <Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder={recordNamePlaceholder} />
              </div>
              <div className="space-y-2">
                <Label>{recordIdentityLabel}</Label>
                <Input value={assetIdentifier} onChange={(e) => setAssetIdentifier(e.target.value)} placeholder={recordIdentityPlaceholder} />
              </div>
              <div className="space-y-2">
                <Label>{isBusinessTravel ? "Employee name" : "Owner / operator"}</Label>
                <Input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>{isBusinessTravel ? "Travel subtype" : "Asset subtype"}</Label>
                <Input value={sourceSubtype} onChange={(e) => setSourceSubtype(e.target.value)} placeholder="Optional subtype" />
              </div>
              <div className="space-y-2">
                <Label>Group</Label>
                <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                  <SelectTrigger><SelectValue placeholder="Choose a group..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No group</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.group_id} value={String(g.group_id)}>{g.group_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Qty</Label>
                <Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Apply %</Label>
                <Input type="number" step="any" value={applyPct} onChange={(e) => setApplyPct(e.target.value)} />
              </div>
            </div>
            <div className="rounded-md border bg-muted/10 p-4 text-sm text-muted-foreground space-y-2">
              <p>
                {recordPlural} inherit scope, site, category, and factor from the selected group. Pick the group
                that represents the roll-up bucket, then add each individual {recordLabel.toLowerCase()} underneath
                it.
              </p>
              {selectedGroup ? (
                <p className="text-foreground">
                  Selected group: <span className="font-medium">{selectedGroup.group_name}</span> · {selectedGroup.scope}
                  {selectedGroup.site_name ? ` · ${selectedGroup.site_name}` : ""}
                  {selectedGroup.factor_report_label ? ` · ${selectedGroup.factor_report_label}` : ""}
                  {selectedGroup.uom ? ` · UOM ${selectedGroup.uom}` : ""}
                </p>
              ) : (
                <p className="text-amber-700">
                  Choose or create a group first so the {recordLabel.toLowerCase()} can inherit its factor and
                  reporting details.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
            </div>
            <div className="flex justify-end">
              <Button onClick={createSource} disabled={loading || !sourceName.trim() || !selectedGroup || !selectedGroup.factor_db_id}>{`Add ${recordLabel.toLowerCase()}`}</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Groups</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">Name</th>
                <th className="p-2">Scope</th>
                <th className="p-2">Site</th>
                <th className="p-2">Factor</th>
                <th className="p-2">UOM</th>
                <th className="p-2">Sources</th>
                <th className="p-2 text-right">tCO₂e</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {groups.length ? groups.map((g) => (
                <tr key={g.group_id} className="border-b">
                  <td className="p-2">{g.group_name}</td>
                  <td className="p-2">{g.scope}</td>
                  <td className="p-2">{g.site_name || "-"}</td>
                  <td className="p-2">
                    <div className="font-medium">{g.factor_report_label || g.original_id || "-"}</div>
                    <div className="text-xs text-muted-foreground">{g.original_id || "-"}{g.factor != null ? ` · ${g.factor}` : ""}{g.ghg_unit ? ` ${g.ghg_unit}` : ""}</div>
                  </td>
                  <td className="p-2">{g.uom || "-"}</td>
                  <td className="p-2">{g.source_count ?? 0}</td>
                  <td className="p-2 text-right">{(g.source_total_tco2e ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="p-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => removeGroup(g.group_id, g.group_name)}>Delete</Button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="p-4 text-muted-foreground">No groups yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{recordPlural}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">Name</th>
                <th className="p-2">Identity</th>
                <th className="p-2">Group</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">tCO₂e</th>
                <th className="p-2">Status</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {sources.length ? sources.map((s) => (
                <tr key={s.source_id} className="border-b">
                  <td className="p-2">{s.source_name}</td>
                  <td className="p-2">{s.asset_identifier || s.employee_name || "-"}</td>
                  <td className="p-2">{s.group_name || "-"}</td>
                  <td className="p-2 text-right">{typeof s.qty === "number" ? s.qty.toLocaleString() : "-"}</td>
                  <td className="p-2 text-right">{(s.calc_tco2e ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="p-2">{s.enabled ? "Active" : "Hidden"}</td>
                  <td className="p-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => removeSource(s.source_id, s.source_name)}>Delete</Button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="p-4 text-muted-foreground">No records yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
