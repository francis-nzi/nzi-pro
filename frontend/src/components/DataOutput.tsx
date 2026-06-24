"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import EmissionsSummary from "@/components/EmissionsSummary";
import JobIntensityYearOverYear from "@/components/JobIntensityYearOverYear";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";
import {
  REPORT_WIDGET_IDS,
  ScopeCategoryComparisonTable,
  type ReportComparisonYear,
  type ScopeCategoryComparisonRow,
} from "@/components/report-widgets";

type Activity = {
  row_id: number;
  site_name?: string | null;
  level_3: string | null;
  level_4: string | null;
  activity_name: string | null;
  quantity: number | null;
  unit: string | null;
  factor?: number | null;
  emissions: number;
  is_custom_entry?: boolean;
  scope?: string;
  category?: string;
  source_family?: string;
  record_type?: string;
  source_type?: string | null;
  group_name?: string | null;
  source_name?: string | null;
  asset_identifier?: string | null;
  employee_name?: string | null;
};

type Site = {
  site_name: string;
  site_id?: number;
  total_emissions: number;
  activity_count?: number;
  activities?: Activity[];
};

type Category = {
  category_name: string;
  total_emissions: number;
  site_count?: number;
  sites: Site[];
};

type Scope = {
  scope_name: string;
  total_emissions: number;
  category_count?: number;
  categories: Category[];
};

type DataOutputSummary = {
  job_id: number;
  reporting_year: number | null;
  scopes: Scope[];
  all_sites?: Site[];
};

type DataOutputDetailed = {
  job_id: number;
  reporting_year: number | null;
  scope: string;
  categories: Category[];
};

type DataOutputProps = {
  jobId: number;
  baseUrl: string;
  showEmissionsSummary?: boolean;
};

type ScopeCategoryData = {
  [scope: string]: {
    [category: string]: number;
  };
};

type ActivityDetailRow = {
  year: number;
  scope: string;
  category: string;
  activity: string;
  emissions?: number;
  quantity?: number;
};

type SiteActivityDetailRow = ActivityDetailRow & { site_name: string };

type ClientReportingComparisonData = {
  years: number[];
  benchmark_year?: number | null;
  year_jobs?: Array<{
    year: number;
    job_id: number;
    job_number: string | null;
    title?: string | null;
    reporting_year?: number | null;
  }>;
  by_scope: Array<{
    year: number;
    [key: string]: number | string;
  }>;
  by_scope_category: Array<{
    year: number;
    scopes: ScopeCategoryData;
  }>;
  by_site: Array<{
    year: number;
    [key: string]: number | string;
  }>;
  by_scope_volume?: Array<{
    year: number;
    [key: string]: number | string;
  }>;
  by_scope_category_volume?: Array<{
    year: number;
    scopes: ScopeCategoryData;
  }>;
  by_activity_detail?: ActivityDetailRow[];
  by_activity_detail_volume?: ActivityDetailRow[];
  by_site_activity_detail?: SiteActivityDetailRow[];
  by_site_activity_detail_volume?: SiteActivityDetailRow[];
};

type AuditRow = {
  site_name: string;
  scope: string;
  category?: string;
  id: string;
  report_label: string;
  uom: string;
  qty: number;
  factor: number;
  tco2e_after_apply: number;
  data_confidence: string;
  source_family?: string;
  record_type?: string;
  source_type?: string | null;
  group_name?: string | null;
  source_name?: string | null;
  asset_identifier?: string | null;
  employee_name?: string | null;
  dataset_name: string;
  dataset_version: string;
};

type AuditSubtotal = {
  site_name: string;
  scope: string;
  subtotal_tco2e_after_apply: number;
};

type AuditData = {
  job_id: number;
  reporting_year: number | null;
  rows: AuditRow[];
  scope_subtotals: AuditSubtotal[];
};

export default function DataOutput({ jobId, baseUrl, showEmissionsSummary = false }: DataOutputProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summaryData, setSummaryData] = useState<DataOutputSummary | null>(null);
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [detailedData, setDetailedData] = useState<DataOutputDetailed | null>(null);
  const [comparisonData, setComparisonData] = useState<ClientReportingComparisonData | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  
  // Expansion state
  const [expandedScopes, setExpandedScopes] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  
  // Expansion state for sites view
  const [expandedSiteNames, setExpandedSiteNames] = useState<Set<string>>(new Set());
  const [expandedSiteScopes, setExpandedSiteScopes] = useState<Set<string>>(new Set());

  // Selected site for the YoY detail breakdown in the By Site tab
  const [selectedSiteDetail, setSelectedSiteDetail] = useState<string | null>(null);

  // Compute "by site" view from summary data - must be before useEffect
  const sitesView = useMemo(() => {
    if (!summaryData) return [];
    
    const siteMap: Record<string, {
      site_name: string;
      total_emissions: number;
      scopes: Record<string, { scope_name: string; total_emissions: number; categories: Record<string, { category_name: string; total_emissions: number }> }>;
    }> = {};
    
    for (const scope of summaryData.scopes) {
      for (const category of scope.categories) {
        for (const site of category.sites) {
          const siteName = site.site_name;
          if (!siteMap[siteName]) {
            siteMap[siteName] = { site_name: siteName, total_emissions: 0, scopes: {} };
          }
          
          if (!siteMap[siteName].scopes[scope.scope_name]) {
            siteMap[siteName].scopes[scope.scope_name] = { scope_name: scope.scope_name, total_emissions: 0, categories: {} };
          }
          
          siteMap[siteName].total_emissions += site.total_emissions;
          siteMap[siteName].scopes[scope.scope_name].total_emissions += site.total_emissions;
          
          if (!siteMap[siteName].scopes[scope.scope_name].categories[category.category_name]) {
            siteMap[siteName].scopes[scope.scope_name].categories[category.category_name] = { 
              category_name: category.category_name, 
              total_emissions: 0 
            };
          }
          siteMap[siteName].scopes[scope.scope_name].categories[category.category_name].total_emissions += site.total_emissions;
        }
      }
    }
    
    // Convert to array
    return Object.values(siteMap).map(site => ({
      ...site,
      scopes: Object.values(site.scopes).map(scope => ({
        ...scope,
        categories: Object.values(scope.categories)
      }))
    })).sort((a, b) => b.total_emissions - a.total_emissions);
  }, [summaryData]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    setAuditError("");
    setComparisonError("");
    setComparisonLoading(false);
    setAuditLoading(false);
    let resolvedClientId: number | null = null;
    let initialLoadSucceeded = false;
    try {
      const [summaryRes, jobRes] = await Promise.all([
        fetch(`${baseUrl}/jobs/${jobId}/data-output`),
        fetch(`${baseUrl}/jobs/${jobId}`),
      ]);

      if (!summaryRes.ok) {
        throw new Error(`Failed to load data: ${summaryRes.status}`);
      }
      if (!jobRes.ok) {
        throw new Error(`Failed to load job context: ${jobRes.status}`);
      }

      const summaryJson = await summaryRes.json();
      const jobJson = await jobRes.json();
      setSummaryData(summaryJson);

      resolvedClientId = Number(jobJson?.client_db_id);
      setClientId(Number.isFinite(resolvedClientId) ? resolvedClientId : null);
      initialLoadSucceeded = true;
    } catch (e) {
      setError((e as Error).message);
      setComparisonData(null);
    } finally {
      setLoading(false);
    }

    if (!initialLoadSucceeded) {
      return;
    }

    void (async () => {
      setAuditLoading(true);
      try {
        const auditRes = await fetch(`${baseUrl}/jobs/${jobId}/data-output/audit`);
        if (!auditRes.ok) {
          throw new Error(`Failed to load audit data: ${auditRes.status}`);
        }
        const auditJson = (await auditRes.json()) as AuditData;
        setAuditData(auditJson);
      } catch (e) {
        setAuditData(null);
        setAuditError((e as Error).message);
      } finally {
        setAuditLoading(false);
      }
    })();

    if (resolvedClientId !== null && Number.isFinite(resolvedClientId) && resolvedClientId > 0) {
      void (async () => {
        setComparisonLoading(true);
        try {
          const comparisonRes = await fetch(`${baseUrl}/clients/${resolvedClientId}/reporting`);
          if (comparisonRes.ok) {
            const comparisonJson = (await comparisonRes.json()) as ClientReportingComparisonData;
            setComparisonData(comparisonJson);
          } else {
            setComparisonData(null);
            setComparisonError(`Failed to load year-over-year comparison: ${comparisonRes.status}`);
          }
        } catch {
          setComparisonData(null);
          setComparisonError("Failed to load year-over-year comparison.");
        } finally {
          setComparisonLoading(false);
        }
      })();
    } else {
      setComparisonData(null);
      setComparisonError("Unable to resolve client for year-over-year comparison.");
    }
  }, [baseUrl, jobId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadSummary();
    };
    window.addEventListener("nzi-job-scope-refresh", handleRefresh);
    return () => window.removeEventListener("nzi-job-scope-refresh", handleRefresh);
  }, [loadSummary]);

  async function loadScopeDetails(scope: string): Promise<DataOutputDetailed | null> {
    setSelectedScope(scope);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/data-output?scope=${encodeURIComponent(scope)}`);
      if (!res.ok) {
        throw new Error(`Failed to load scope details: ${res.status}`);
      }
      const data = await res.json();
      setDetailedData(data);
      return data as DataOutputDetailed;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function toggleScope(scope: Scope) {
    const scopeName = scope.scope_name;
    const newExpanded = new Set(expandedScopes);
    const isExpanded = newExpanded.has(scopeName);
    if (isExpanded) {
      newExpanded.delete(scopeName);
      setExpandedScopes(newExpanded);
      setExpandedCategories((prev) => {
        const next = new Set(prev);
        for (const category of scope.categories) {
          next.delete(`${scopeName}-${category.category_name}`);
        }
        return next;
      });
      if (selectedScope === scopeName) {
        setSelectedScope(null);
        setDetailedData(null);
      }
      return;
    }
    newExpanded.add(scopeName);
    setExpandedScopes(newExpanded);
    await openScopeDetails(scope);
  }

  async function openScopeDetails(scope: Scope) {
    const scopeName = scope.scope_name;
    if (selectedScope === scopeName && detailedData?.scope === scopeName) {
      setSelectedScope(null);
      setDetailedData(null);
      return;
    }
    await loadScopeDetails(scopeName);
  }

  function toggleCategory(categoryKey: string) {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryKey)) {
      newExpanded.delete(categoryKey);
    } else {
      newExpanded.add(categoryKey);
    }
    setExpandedCategories(newExpanded);
  }

  async function handleCategoryToggle(scopeName: string, categoryName: string) {
    const categoryKey = `${scopeName}-${categoryName}`;
    const isExpanded = expandedCategories.has(categoryKey);
    if (isExpanded) {
      toggleCategory(categoryKey);
      return;
    }

    if (selectedScope !== scopeName || detailedData?.scope !== scopeName) {
      await loadScopeDetails(scopeName);
    }

    toggleCategory(categoryKey);
  }

  function csvEscape(value: string | number): string {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function exportAuditCsv() {
    if (!auditData || (auditData.rows || []).length === 0) return;
    const headers = [
      "Site",
      "Scope",
      "Category",
      "ID",
      "Report Label",
      "UOM",
      "Qty",
      "Factor",
      "tCO₂e (After Apply)",
      "Data Confidence",
      "Source Family",
      "Dataset",
    ];
    const lines: string[] = [headers.map(csvEscape).join(",")];

    for (const item of auditDisplayRows) {
      if (item.kind === "scope-total") {
        lines.push(
          [
            `Scope Total: ${item.scope}`,
            "",
            "",
            "",
            "",
            "",
            "",
            item.total.toFixed(2),
            "",
            "",
            "",
          ]
            .map(csvEscape)
            .join(",")
        );
      } else if (item.kind === "category-total") {
        lines.push(
          [
            `Category Total: ${item.scope} / ${item.category}`,
            "",
            "",
            "",
            "",
            "",
            "",
            item.total.toFixed(2),
            "",
            "",
            "",
          ]
            .map(csvEscape)
            .join(",")
        );
      } else {
        const row = item.row;
        const datasetLabel = row.dataset_name
          ? `${row.dataset_name}${row.dataset_version ? ` (${row.dataset_version})` : ""}`
          : "-";
        lines.push(
          [
            row.site_name || "-",
            row.scope || "-",
            row.category || "-",
            row.id || "-",
            row.report_label || "-",
            row.uom || "-",
            Number(row.qty || 0).toFixed(2),
            Number(row.factor || 0).toFixed(6),
            Number(row.tco2e_after_apply || 0).toFixed(2),
            row.data_confidence || "-",
            row.source_family || "-",
            datasetLabel,
          ]
            .map(csvEscape)
            .join(",")
        );
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `job-${jobId}-data-output-audit-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  const auditDisplayRows = useMemo(() => {
    if (!auditData) return [];
    const rows = [...(auditData.rows || [])].sort((a, b) => {
      const scopeA = String(a.scope || "").toLowerCase();
      const scopeB = String(b.scope || "").toLowerCase();
      if (scopeA !== scopeB) return scopeA < scopeB ? -1 : 1;
      const catA = String(a.category || "").toLowerCase();
      const catB = String(b.category || "").toLowerCase();
      if (catA !== catB) return catA < catB ? -1 : 1;
      const labelA = String(a.report_label || "").toLowerCase();
      const labelB = String(b.report_label || "").toLowerCase();
      if (labelA !== labelB) return labelA < labelB ? -1 : 1;
      const idA = String(a.id || "").toLowerCase();
      const idB = String(b.id || "").toLowerCase();
      if (idA !== idB) return idA < idB ? -1 : 1;
      return String(a.site_name || "").toLowerCase() < String(b.site_name || "").toLowerCase() ? -1 : 1;
    });

    const scopeTotals = new Map<string, number>();
    const categoryTotals = new Map<string, number>();
    for (const row of rows) {
      const scopeKey = row.scope || "Unknown";
      const categoryKey = `${scopeKey}||${row.category || "Uncategorized"}`;
      const emission = Number(row.tco2e_after_apply || 0);
      scopeTotals.set(scopeKey, (scopeTotals.get(scopeKey) ?? 0) + emission);
      categoryTotals.set(categoryKey, (categoryTotals.get(categoryKey) ?? 0) + emission);
    }

    const out: Array<
      | { kind: "row"; row: AuditRow }
      | { kind: "scope-total"; scope: string; total: number }
      | { kind: "category-total"; scope: string; category: string; total: number }
    > = [];
    let currentScope = "";
    let currentCategory = "";
    for (const row of rows) {
      const scope = row.scope || "Unknown";
      const category = row.category || "Uncategorized";
      const scopeChanged = scope !== currentScope;
      const categoryChanged = category !== currentCategory || scopeChanged;

      if (scopeChanged) {
        currentScope = scope;
        currentCategory = "";
        out.push({
          kind: "scope-total",
          scope,
          total: scopeTotals.get(scope) ?? 0,
        });
      }

      if (categoryChanged) {
        currentCategory = category;
        out.push({
          kind: "category-total",
          scope,
          category,
          total: categoryTotals.get(`${scope}||${category}`) ?? 0,
        });
      }

      out.push({ kind: "row", row });
    }
    return out;
  }, [auditData]);

  const comparisonYears = useMemo(() => {
    if (!comparisonData?.years) return [];
    return [...comparisonData.years].sort((a, b) => a - b);
  }, [comparisonData]);

  // Prefer the client's explicit benchmark_year; fall back to the oldest year in the comparison set
  const benchmarkYear = comparisonData?.benchmark_year ?? comparisonYears[0] ?? null;
  const yearJobsByYear = useMemo(
    () =>
      new Map(
        (comparisonData?.year_jobs || [])
          .filter((job) => Number.isFinite(Number(job.year)) && Number.isFinite(Number(job.job_id)))
          .map((job) => [
            Number(job.year),
            {
              job_id: Number(job.job_id),
              job_number: job.job_number?.trim() || null,
              title: job.title?.trim() || null,
              reporting_year: job.reporting_year ?? null,
            },
          ])
      ),
    [comparisonData?.year_jobs]
  );

  const comparisonYearHeaders = useMemo<ReportComparisonYear[]>(
    () =>
      comparisonYears.map((year) => {
        const yearJob = yearJobsByYear.get(year);
        return {
          year,
          jobId: yearJob?.job_id ?? null,
          jobNumber: yearJob?.job_number ?? null,
          isBenchmark: year === benchmarkYear,
        };
      }),
    [benchmarkYear, comparisonYears, yearJobsByYear]
  );

  function renderComparisonYearHeader(year: number) {
    const yearJob = yearJobsByYear.get(year);
    const yearJobLabel = yearJob?.job_number || (yearJob?.job_id ? `Job ${yearJob.job_id}` : "");

    return (
      <th key={year} className="p-2 border whitespace-nowrap align-middle text-center">
        {yearJob?.job_id ? (
          <Link href={`/jobs/${yearJob.job_id}`} className="flex flex-col items-center gap-0.5" aria-label={`Open ${yearJobLabel}`}>
            {year === benchmarkYear ? (
              <Badge className="h-4 rounded-full border-amber-400 bg-amber-400 px-1.5 py-0 text-[9px] font-bold leading-none text-white">
                BM
              </Badge>
            ) : null}
            <span className="text-xs font-medium text-slate-700">{yearJobLabel}</span>
            <span className="text-sm font-normal text-foreground">{year}</span>
          </Link>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            {year === benchmarkYear ? (
              <Badge className="h-4 rounded-full border-amber-400 bg-amber-400 px-1.5 py-0 text-[9px] font-bold leading-none text-white">
                BM
              </Badge>
            ) : null}
            <span className="text-sm font-normal">{year}</span>
          </div>
        )}
      </th>
    );
  }

  const buildComparisonRows = useCallback((
    byScope: Array<{ year: number; [key: string]: number | string }>,
    byScopeCategory: Array<{ year: number; scopes: ScopeCategoryData }>
  ) => {
    if (!comparisonYears.length) return [];

    const scopeSet = new Set<string>();
    for (const yearData of byScopeCategory || []) {
      const scopes = yearData?.scopes || {};
      for (const scopeName of Object.keys(scopes)) scopeSet.add(scopeName);
    }

    const scopeSortOrder: Record<string, number> = {
      "Scope 1": 1,
      "Scope 2": 2,
      "Scope 3": 3,
    };
    const orderedScopes = Array.from(scopeSet).sort((a, b) => {
      const ao = scopeSortOrder[a] ?? 99;
      const bo = scopeSortOrder[b] ?? 99;
      if (ao !== bo) return ao - bo;
      return a.localeCompare(b);
    });

    const getScopeCategoryValue = (year: number, scope: string, category: string): number => {
      const yearRow = (byScopeCategory || []).find((r) => Number(r.year) === year);
      if (!yearRow?.scopes?.[scope]) return 0;
      return Number(yearRow.scopes[scope][category] || 0);
    };

    const getScopeSubtotal = (year: number, scope: string): number => {
      const yearRow = (byScope || []).find((r) => Number(r.year) === year);
      if (!yearRow) return 0;
      const value = yearRow[scope];
      return typeof value === "number" ? value : Number(value || 0);
    };

    const rows: Array<
      | { type: "category"; scope: string; category: string; values: number[] }
      | { type: "subtotal"; scope: string; values: number[] }
      | { type: "total"; values: number[] }
    > = [];

    for (const scope of orderedScopes) {
      const categorySet = new Set<string>();
      for (const year of comparisonYears) {
        const yearRow = (byScopeCategory || []).find((r) => Number(r.year) === year);
        const scopeObj = yearRow?.scopes?.[scope] || {};
        for (const category of Object.keys(scopeObj)) categorySet.add(category);
      }

      const categories = Array.from(categorySet).sort((a, b) => a.localeCompare(b));
      for (const category of categories) {
        rows.push({
          type: "category",
          scope,
          category,
          values: comparisonYears.map((year) => getScopeCategoryValue(year, scope, category)),
        });
      }

      rows.push({
        type: "subtotal",
        scope,
        values: comparisonYears.map((year) => getScopeSubtotal(year, scope)),
      });
    }

    rows.push({
      type: "total",
      values: comparisonYears.map((year) => {
        const yearRow = (byScope || []).find((r) => Number(r.year) === year);
        const value = yearRow?.total;
        return typeof value === "number" ? value : Number(value || 0);
      }),
    });

    return rows;
  }, [comparisonYears]);

  const comparisonEmissionsRows = useMemo(() => {
    if (!comparisonData || comparisonYears.length === 0) return [];
    return buildComparisonRows(comparisonData.by_scope || [], comparisonData.by_scope_category || []);
  }, [buildComparisonRows, comparisonData, comparisonYears]);

  const comparisonVolumeRows = useMemo(() => {
    if (!comparisonData || comparisonYears.length === 0) return [];
    return buildComparisonRows(
      comparisonData.by_scope_volume || [],
      comparisonData.by_scope_category_volume || []
    );
  }, [buildComparisonRows, comparisonData, comparisonYears]);

  const buildSiteComparisonRows = useCallback((bySite: Array<{ year: number; [key: string]: number | string }>) => {
    if (!comparisonYears.length) return [];

    const siteSet = new Set<string>();
    for (const yearData of bySite || []) {
      for (const key of Object.keys(yearData || {})) {
        if (key !== "year" && key !== "total") {
          siteSet.add(key);
        }
      }
    }

    const orderedSites = Array.from(siteSet).sort((a, b) => a.localeCompare(b));

    return orderedSites.map((site) => ({
      site,
      values: comparisonYears.map((year) => {
        const yearRow = (bySite || []).find((r) => Number(r.year) === year);
        if (!yearRow) return 0;
        const value = yearRow[site];
        return typeof value === "number" ? value : Number(value || 0);
      }),
    }));
  }, [comparisonYears]);

  const comparisonSiteRows = useMemo(() => {
    if (!comparisonData || comparisonYears.length === 0) return [];
    return buildSiteComparisonRows(comparisonData.by_site || []);
  }, [buildSiteComparisonRows, comparisonData, comparisonYears]);

  type DetailTableRow =
    | { type: "activity"; scope: string; category: string; activity: string; values: number[] }
    | { type: "cat-subtotal"; scope: string; category: string; values: number[] }
    | { type: "scope-subtotal"; scope: string; values: number[] }
    | { type: "total"; values: number[] };

  const buildDetailTableRows = useCallback(
    (rows: ActivityDetailRow[], valueKey: "emissions" | "quantity"): DetailTableRow[] => {
      if (!rows.length || !comparisonYears.length) return [];
      const lookup = new Map<string, number>();
      for (const r of rows) {
        lookup.set(`${r.scope}||${r.category}||${r.activity}||${r.year}`, r[valueKey] ?? 0);
      }
      // Collect ordered unique (scope, category, activity) combos
      const scopeOrder: string[] = [];
      const catOrder = new Map<string, string[]>();
      const actOrder = new Map<string, string[]>();
      for (const r of rows) {
        if (!scopeOrder.includes(r.scope)) scopeOrder.push(r.scope);
        const catKey = r.scope;
        if (!catOrder.has(catKey)) catOrder.set(catKey, []);
        if (!catOrder.get(catKey)!.includes(r.category)) catOrder.get(catKey)!.push(r.category);
        const actKey = `${r.scope}||${r.category}`;
        if (!actOrder.has(actKey)) actOrder.set(actKey, []);
        if (!actOrder.get(actKey)!.includes(r.activity)) actOrder.get(actKey)!.push(r.activity);
      }
      const result: DetailTableRow[] = [];
      const totals = comparisonYears.map(() => 0);
      for (const scope of scopeOrder) {
        const scopeTotals = comparisonYears.map(() => 0);
        for (const cat of catOrder.get(scope) || []) {
          const catTotals = comparisonYears.map(() => 0);
          for (const activity of actOrder.get(`${scope}||${cat}`) || []) {
            const values = comparisonYears.map((yr, i) => {
              const v = lookup.get(`${scope}||${cat}||${activity}||${yr}`) ?? 0;
              catTotals[i] += v;
              scopeTotals[i] += v;
              totals[i] += v;
              return v;
            });
            result.push({ type: "activity", scope, category: cat, activity, values });
          }
          result.push({ type: "cat-subtotal", scope, category: cat, values: catTotals });
        }
        result.push({ type: "scope-subtotal", scope, values: scopeTotals });
      }
      result.push({ type: "total", values: totals });
      return result;
    },
    [comparisonYears]
  );

  const detailEmissionsRows = useMemo(
    () => buildDetailTableRows(comparisonData?.by_activity_detail || [], "emissions"),
    [buildDetailTableRows, comparisonData]
  );
  const detailVolumeRows = useMemo(
    () => buildDetailTableRows(comparisonData?.by_activity_detail_volume || [], "quantity"),
    [buildDetailTableRows, comparisonData]
  );

  const siteDetailNames = useMemo(() => {
    const names = Array.from(
      new Set((comparisonData?.by_site_activity_detail || []).map((r) => r.site_name))
    ).sort();
    return names;
  }, [comparisonData]);

  const activeSiteDetail = useMemo(
    () => selectedSiteDetail ?? siteDetailNames[0] ?? null,
    [selectedSiteDetail, siteDetailNames]
  );

  const siteDetailEmissionsRows = useMemo(() => {
    if (!activeSiteDetail) return [];
    return buildDetailTableRows(
      (comparisonData?.by_site_activity_detail || []).filter((r) => r.site_name === activeSiteDetail),
      "emissions"
    );
  }, [buildDetailTableRows, comparisonData, activeSiteDetail]);

  const siteDetailVolumeRows = useMemo(() => {
    if (!activeSiteDetail) return [];
    return buildDetailTableRows(
      (comparisonData?.by_site_activity_detail_volume || []).filter((r) => r.site_name === activeSiteDetail),
      "quantity"
    );
  }, [buildDetailTableRows, comparisonData, activeSiteDetail]);

  function exportActivityDetailCsv(tab: "emissions" | "volume") {
    const rows = tab === "emissions" ? detailEmissionsRows : detailVolumeRows;
    if (!rows.length) return;

    const unit = tab === "emissions" ? "tCO₂e" : "Volume";
    const yearHeaders = comparisonYears.map((yr) => {
      const yj = yearJobsByYear.get(yr);
      const bm = yr === benchmarkYear ? " (BM)" : "";
      return `${yr}${yj?.job_number ? ` ${yj.job_number}` : ""}${bm} ${unit}`;
    });

    const lines: string[] = [
      ["Scope", "Category", "Activity", ...yearHeaders].map(csvEscape).join(","),
    ];

    for (const row of rows) {
      if (row.type === "activity") {
        lines.push([row.scope, row.category, row.activity, ...row.values.map((v) => v > 0 ? v.toFixed(2) : "0")].map(csvEscape).join(","));
      } else if (row.type === "cat-subtotal") {
        lines.push([row.scope, `${row.category} – Subtotal`, "", ...row.values.map((v) => v.toFixed(2))].map(csvEscape).join(","));
      } else if (row.type === "scope-subtotal") {
        lines.push([row.scope, "Subtotal", "", ...row.values.map((v) => v.toFixed(2))].map(csvEscape).join(","));
      } else {
        lines.push(["All Scopes", "TOTAL", "", ...row.values.map((v) => v.toFixed(2))].map(csvEscape).join(","));
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `job-${jobId}-activity-breakdown-${tab}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading data output...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-destructive">{error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!summaryData || summaryData.scopes.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">No emissions data available for this job.</div>
        </CardContent>
      </Card>
    );
  }

  // Toggle functions for sites view
  function toggleSiteName(siteName: string) {
    const newExpanded = new Set(expandedSiteNames);
    if (newExpanded.has(siteName)) {
      newExpanded.delete(siteName);
    } else {
      newExpanded.add(siteName);
    }
    setExpandedSiteNames(newExpanded);
  }

  function toggleSiteScope(scopeKey: string) {
    const newExpanded = new Set(expandedSiteScopes);
    if (newExpanded.has(scopeKey)) {
      newExpanded.delete(scopeKey);
    } else {
      newExpanded.add(scopeKey);
    }
    setExpandedSiteScopes(newExpanded);
  }

  return (
    <div className="space-y-6">
      {showEmissionsSummary ? <EmissionsSummary jobId={jobId} baseUrl={baseUrl} /> : null}
      
      <Tabs defaultValue="by-scope" className="w-full">
        <TabsList>
          <TabsTrigger value="by-scope">By Scope</TabsTrigger>
          <TabsTrigger value="by-site">By Site</TabsTrigger>
          <TabsTrigger value="audit-table">Audit Table</TabsTrigger>
          <TabsTrigger value="intensity-metrics">Intensity Metrics</TabsTrigger>
        </TabsList>
        
        <TabsContent value="by-scope" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Data Output - Emissions Breakdown</CardTitle>
                <div className="text-sm text-muted-foreground">
                  Reporting Year: {summaryData.reporting_year || "N/A"}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {summaryData.scopes.map((scope) => {
                  const scopeExpanded = expandedScopes.has(scope.scope_name);
                  const categoryCount = scope.category_count ?? scope.categories.length;
                  
                  return (
                    <div key={scope.scope_name} className="border rounded-md">
                      {/* Scope Header */}
                      <div
                        className="flex items-center justify-between p-3 bg-muted hover:bg-muted/80 cursor-pointer"
                          onClick={() => void toggleScope(scope)}
                      >
                        <div className="flex items-center gap-2">
                          {scopeExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span className="font-semibold">{scope.scope_name}</span>
                        </div>
                        <span className="text-sm font-medium">{formatNumber(scope.total_emissions, 2)} tCO₂e</span>
                      </div>

                      <div className="px-3 pb-3">
                        <div className="rounded-md border bg-muted/10">
                          <div className="flex items-center justify-between border-b px-3 py-2">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Category amalgamation
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {categoryCount} categories in this scope
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Scope → Category → Rows
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="px-3 py-2 text-left font-medium">Category</th>
                                  <th className="px-3 py-2 text-right font-medium">Sites</th>
                                  <th className="px-3 py-2 text-right font-medium">tCO₂e</th>
                                </tr>
                              </thead>
                              <tbody>
                                {scope.categories.map((category) => (
                                  <tr key={`${scope.scope_name}-${category.category_name}`} className="border-t">
                                    <td className="px-3 py-2 font-medium text-foreground">{category.category_name}</td>
                                    <td className="px-3 py-2 text-right text-muted-foreground">
                                      {category.site_count ?? category.sites.length}
                                    </td>
                                    <td className="px-3 py-2 text-right font-medium">
                                      {formatNumber(category.total_emissions, 2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      {/* Categories */}
                      {scopeExpanded && (
                        <div className="p-2 space-y-1">
                          {scope.categories.map((category) => {
                            const categoryKey = `${scope.scope_name}-${category.category_name}`;
                            const categoryExpanded = expandedCategories.has(categoryKey);

                            return (
                              <div key={categoryKey} className="border rounded">
                                {/* Category Header */}
                                <div
                                  className="flex items-center justify-between p-2 bg-background hover:bg-muted/50 cursor-pointer"
                                  onClick={() => void handleCategoryToggle(scope.scope_name, category.category_name)}
                                >
                                  <div className="flex items-center gap-2 pl-4">
                                    {categoryExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                    <span className="text-sm font-medium">{category.category_name}</span>
                                  </div>
                                  <span className="text-sm">{formatNumber(category.total_emissions, 2)} tCO₂e</span>
                                </div>

                                {/* Sites */}
                                {categoryExpanded && (
                                  <div className="p-2 pl-8">
                                    {selectedScope === scope.scope_name && detailedData?.scope === scope.scope_name ? (
                                      (() => {
                                        const detailedCategory = detailedData.categories.find(
                                          (item) => item.category_name === category.category_name
                                        );
                                        const activities = detailedCategory
                                          ? detailedCategory.sites.flatMap((site) =>
                                              (site.activities || []).map((activity) => ({
                                                ...activity,
                                                site_name: activity.site_name || site.site_name,
                                              }))
                                            )
                                          : [];

                                        if (!detailedCategory) {
                                          return (
                                            <div className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
                                              No detailed rows available for this category.
                                            </div>
                                          );
                                        }

                                        return (
                                          <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                              <thead className="bg-muted/50">
                                                <tr>
                                                  <th className="text-left p-2">Site</th>
                                                  <th className="text-left p-2">Activity</th>
                                                  <th className="text-left p-2">Level 3</th>
                                                  <th className="text-left p-2">Level 4</th>
                                                  <th className="text-right p-2">Quantity</th>
                                                  <th className="text-left p-2">Unit</th>
                                                  <th className="text-right p-2">Emissions Factor</th>
                                                  <th className="text-right p-2">Emissions (tCO₂e)</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {activities.map((activity, actIdx) => (
                                                  <tr key={actIdx} className="border-t hover:bg-muted/30">
                                                    <td className="p-2 text-muted-foreground">{activity.site_name || "-"}</td>
                                                    <td className="p-2">
                                                      <div className="flex items-center gap-2">
                                                        <span>{activity.activity_name || "-"}</span>
                                                        {activity.is_custom_entry ? (
                                                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                                                            CUSTOM
                                                          </span>
                                                        ) : null}
                                                      </div>
                                                    </td>
                                                    <td className="p-2 text-muted-foreground">{activity.level_3 || "-"}</td>
                                                    <td className="p-2 text-muted-foreground">{activity.level_4 || "-"}</td>
                                                    <td className="p-2 text-right">
                                                      {activity.quantity !== null ? formatNumber(activity.quantity, 2) : "-"}
                                                    </td>
                                                    <td className="p-2">{activity.unit || "-"}</td>
                                                    <td className="p-2 text-right text-muted-foreground">
                                                      {activity.factor != null && activity.factor !== 0 ? formatNumber(activity.factor, 6) : "-"}
                                                    </td>
                                                    <td className="p-2 text-right font-medium">{formatNumber(activity.emissions, 2)}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        );
                                      })()
                                    ) : (
                                      <div className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
                                        Loading detailed lines...
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Year-over-Year Scope & Category Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              {comparisonLoading ? (
                <div className="text-sm text-muted-foreground">Loading comparison data...</div>
              ) : comparisonError ? (
                <div className="text-sm text-destructive">{comparisonError}</div>
              ) : comparisonYears.length === 0 ? (
                <div className="text-sm text-muted-foreground">No year-over-year comparison data available.</div>
              ) : (
                <Tabs defaultValue="emissions" className="w-full">
                          <TabsList>
                            <TabsTrigger value="emissions">Emissions (tCO₂e)</TabsTrigger>
                            <TabsTrigger value="volume">Volume</TabsTrigger>
                          </TabsList>

                  <TabsContent value="emissions" className="pt-2">
                    {comparisonEmissionsRows.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No emissions comparison data available.</div>
                    ) : (
                      <ScopeCategoryComparisonTable
                        years={comparisonYearHeaders}
                        rows={comparisonEmissionsRows as ScopeCategoryComparisonRow[]}
                        widgetKey={REPORT_WIDGET_IDS.scopeCategoryComparison}
                        valueFormatter={(value) => (value && value > 0 ? formatNumber(value, 2) : "-")}
                        emptyText="No emissions comparison data available."
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="volume" className="pt-2">
                    {comparisonVolumeRows.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No volume comparison data available.</div>
                    ) : (
                      <ScopeCategoryComparisonTable
                        years={comparisonYearHeaders}
                        rows={comparisonVolumeRows as ScopeCategoryComparisonRow[]}
                        widgetKey={REPORT_WIDGET_IDS.scopeCategoryComparison}
                        valueFormatter={(value) => (value && value > 0 ? formatNumber(value, 2) : "-")}
                        emptyText="No volume comparison data available."
                      />
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle>Year-over-Year Detailed Activity Breakdown</CardTitle>
                {!comparisonLoading && comparisonYears.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => exportActivityDetailCsv("emissions")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 transition-colors"
                      title="Download emissions data as CSV"
                    >
                      <Download className="h-3.5 w-3.5" />
                      CSV (tCO₂e)
                    </button>
                    <button
                      onClick={() => exportActivityDetailCsv("volume")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 transition-colors"
                      title="Download volume data as CSV"
                    >
                      <Download className="h-3.5 w-3.5" />
                      CSV (Volume)
                    </button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {comparisonLoading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : comparisonYears.length === 0 ? (
                <div className="text-sm text-muted-foreground">No data available.</div>
              ) : (
                <Tabs defaultValue="emissions" className="w-full">
                  <TabsList>
                    <TabsTrigger value="emissions">Emissions (tCO₂e)</TabsTrigger>
                    <TabsTrigger value="volume">Volume</TabsTrigger>
                  </TabsList>
                  {(["emissions", "volume"] as const).map((tab) => {
                    const rows = tab === "emissions" ? detailEmissionsRows : detailVolumeRows;
                    return (
                      <TabsContent key={tab} value={tab} className="pt-2">
                        {rows.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No data available.</div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse">
                              <thead>
                                <tr className="bg-muted">
                                  <th className="text-left p-2 border">Scope</th>
                                  <th className="text-left p-2 border">Category</th>
                                  <th className="text-left p-2 border">Activity</th>
                                  {comparisonYears.map((year) => renderComparisonYearHeader(year))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row, idx) => {
                                  if (row.type === "activity") {
                                    return (
                                      <tr key={idx} className="hover:bg-muted/30">
                                        <td className="p-2 border text-muted-foreground">{row.scope}</td>
                                        <td className="p-2 border text-muted-foreground">{row.category}</td>
                                        <td className="p-2 border">{row.activity}</td>
                                        {row.values.map((v, ci) => (
                                          <td key={ci} className="text-right p-2 border">
                                            {v > 0 ? formatNumber(v, 2) : "-"}
                                          </td>
                                        ))}
                                      </tr>
                                    );
                                  }
                                  if (row.type === "cat-subtotal") {
                                    return (
                                      <tr key={idx} className="bg-muted/40 font-semibold text-xs">
                                        <td className="p-2 border">{row.scope}</td>
                                        <td className="p-2 border">{row.category} – Subtotal</td>
                                        <td className="p-2 border"></td>
                                        {row.values.map((v, ci) => (
                                          <td key={ci} className="text-right p-2 border">
                                            {v > 0 ? formatNumber(v, 2) : "-"}
                                          </td>
                                        ))}
                                      </tr>
                                    );
                                  }
                                  if (row.type === "scope-subtotal") {
                                    return (
                                      <tr key={idx} className="bg-muted/60 font-semibold">
                                        <td className="p-2 border">{row.scope}</td>
                                        <td className="p-2 border">Subtotal</td>
                                        <td className="p-2 border"></td>
                                        {row.values.map((v, ci) => (
                                          <td key={ci} className="text-right p-2 border">
                                            {v > 0 ? formatNumber(v, 2) : "-"}
                                          </td>
                                        ))}
                                      </tr>
                                    );
                                  }
                                  return (
                                    <tr key={idx} className="bg-muted font-bold">
                                      <td className="p-2 border">All Scopes</td>
                                      <td className="p-2 border">Total</td>
                                      <td className="p-2 border"></td>
                                      {row.values.map((v, ci) => (
                                        <td key={ci} className="text-right p-2 border">
                                          {v > 0 ? formatNumber(v, 2) : "-"}
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </TabsContent>
                    );
                  })}
                </Tabs>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-site" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Data Output - Emissions by Site</CardTitle>
                <div className="text-sm text-muted-foreground">
                  Reporting Year: {summaryData.reporting_year || "N/A"}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {sitesView.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No site data available.
                </div>
              ) : (
                <div className="space-y-2">
                  {sitesView.map((site) => {
                    const siteExpanded = expandedSiteNames.has(site.site_name);
                    
                    return (
                      <div key={site.site_name} className="border rounded-md">
                        {/* Site Header */}
                        <div
                          className="flex items-center justify-between p-3 bg-muted hover:bg-muted/80 cursor-pointer"
                          onClick={() => toggleSiteName(site.site_name)}
                        >
                          <div className="flex items-center gap-2">
                            {siteExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="font-semibold">{site.site_name}</span>
                          </div>
                          <span className="text-sm font-medium">{formatNumber(site.total_emissions, 2)} tCO₂e</span>
                        </div>

                        {/* Scopes for this site */}
                        {siteExpanded && (
                          <div className="p-2 space-y-1">
                            {site.scopes.map((scope) => {
                              const scopeKey = `${site.site_name}-${scope.scope_name}`;
                              const scopeExpanded = expandedSiteScopes.has(scopeKey);

                              return (
                                <div key={scope.scope_name} className="border rounded">
                                  {/* Scope Header */}
                                  <div
                                    className="flex items-center justify-between p-2 bg-background hover:bg-muted/50 cursor-pointer"
                                    onClick={() => toggleSiteScope(scopeKey)}
                                  >
                                    <div className="flex items-center gap-2 pl-4">
                                      {scopeExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                      <span className="text-sm font-medium">{scope.scope_name}</span>
                                    </div>
                                    <span className="text-sm">{formatNumber(scope.total_emissions, 2)} tCO₂e</span>
                                  </div>

                                  {/* Categories */}
                                  {scopeExpanded && (
                                    <div className="p-2 pl-8 space-y-1">
                                      {scope.categories.map((category, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-2 text-sm bg-muted/30 rounded">
                                          <span className="text-muted-foreground">{category.category_name}</span>
                                          <span>{formatNumber(category.total_emissions, 2)} tCO₂e</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Year-over-Year Site Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              {comparisonLoading ? (
                <div className="text-sm text-muted-foreground">Loading comparison data...</div>
              ) : comparisonError ? (
                <div className="text-sm text-destructive">{comparisonError}</div>
              ) : comparisonYears.length === 0 ? (
                <div className="text-sm text-muted-foreground">No year-over-year site comparison data available.</div>
              ) : comparisonSiteRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">No site comparison rows available.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-muted">
                        <th className="text-left p-2 border">Site</th>
                        {comparisonYears.map((year) => renderComparisonYearHeader(year))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonSiteRows.map((row, idx) => (
                        <tr key={`site-${idx}`} className="hover:bg-muted/30">
                          <td className="p-2 border">{row.site}</td>
                          {row.values.map((value, colIdx) => (
                            <td key={colIdx} className="text-right p-2 border">
                              {value > 0 ? formatNumber(value, 2) : "-"}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="bg-muted font-bold">
                        <td className="p-2 border">Total</td>
                        {comparisonYears.map((year) => {
                          const yearRow = (comparisonData?.by_site || []).find((r) => Number(r.year) === year);
                          const value = yearRow?.total;
                          const total = typeof value === "number" ? value : Number(value || 0);
                          return (
                            <td key={`site-total-${year}`} className="text-right p-2 border">
                              {total > 0 ? formatNumber(total, 2) : "-"}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Year-over-Year Detailed Activity Breakdown — per site */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle>Year-over-Year Detailed Activity Breakdown by Site</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {comparisonLoading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : siteDetailNames.length === 0 ? (
                <div className="text-sm text-muted-foreground">No data available.</div>
              ) : (
                <>
                  {/* Site selector */}
                  {siteDetailNames.length > 1 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {siteDetailNames.map((name) => (
                        <button
                          key={name}
                          onClick={() => setSelectedSiteDetail(name)}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                            activeSiteDetail === name
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-border hover:bg-muted"
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                  <Tabs defaultValue="emissions" className="w-full">
                    <TabsList>
                      <TabsTrigger value="emissions">Emissions (tCO₂e)</TabsTrigger>
                      <TabsTrigger value="volume">Volume</TabsTrigger>
                    </TabsList>
                    {(["emissions", "volume"] as const).map((tab) => {
                      const rows = tab === "emissions" ? siteDetailEmissionsRows : siteDetailVolumeRows;
                      return (
                        <TabsContent key={tab} value={tab} className="pt-2">
                          {rows.length === 0 ? (
                            <div className="text-sm text-muted-foreground">No data available.</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm border-collapse">
                                <thead>
                                  <tr className="bg-muted">
                                    <th className="text-left p-2 border">Scope</th>
                                    <th className="text-left p-2 border">Category</th>
                                    <th className="text-left p-2 border">Activity</th>
                                    {comparisonYears.map((year) => renderComparisonYearHeader(year))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((row, idx) => {
                                    if (row.type === "activity") {
                                      return (
                                        <tr key={idx} className="hover:bg-muted/30">
                                          <td className="p-2 border text-muted-foreground">{row.scope}</td>
                                          <td className="p-2 border text-muted-foreground">{row.category}</td>
                                          <td className="p-2 border">{row.activity}</td>
                                          {row.values.map((v, ci) => (
                                            <td key={ci} className="text-right p-2 border">
                                              {v > 0 ? formatNumber(v, 2) : "-"}
                                            </td>
                                          ))}
                                        </tr>
                                      );
                                    }
                                    if (row.type === "cat-subtotal") {
                                      return (
                                        <tr key={idx} className="bg-muted/40 font-semibold text-xs">
                                          <td className="p-2 border">{row.scope}</td>
                                          <td className="p-2 border">{row.category} – Subtotal</td>
                                          <td className="p-2 border"></td>
                                          {row.values.map((v, ci) => (
                                            <td key={ci} className="text-right p-2 border">
                                              {v > 0 ? formatNumber(v, 2) : "-"}
                                            </td>
                                          ))}
                                        </tr>
                                      );
                                    }
                                    if (row.type === "scope-subtotal") {
                                      return (
                                        <tr key={idx} className="bg-muted/60 font-semibold">
                                          <td className="p-2 border">{row.scope}</td>
                                          <td className="p-2 border">Subtotal</td>
                                          <td className="p-2 border"></td>
                                          {row.values.map((v, ci) => (
                                            <td key={ci} className="text-right p-2 border">
                                              {v > 0 ? formatNumber(v, 2) : "-"}
                                            </td>
                                          ))}
                                        </tr>
                                      );
                                    }
                                    return (
                                      <tr key={idx} className="bg-muted font-bold">
                                        <td className="p-2 border">All Scopes</td>
                                        <td className="p-2 border">Total</td>
                                        <td className="p-2 border"></td>
                                        {row.values.map((v, ci) => (
                                          <td key={ci} className="text-right p-2 border">
                                            {v > 0 ? formatNumber(v, 2) : "-"}
                                          </td>
                                        ))}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </TabsContent>
                      );
                    })}
                  </Tabs>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit-table" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Data Output - Core Audit Table</CardTitle>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-muted-foreground">
                    Reporting Year: {summaryData.reporting_year || "N/A"}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportAuditCsv}
                    disabled={!auditData || (auditData.rows || []).length === 0}
                  >
                    Export CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="text-center text-muted-foreground py-8">Loading audit rows...</div>
              ) : auditError ? (
                <div className="text-center text-destructive py-8">{auditError}</div>
              ) : !auditData || (auditData.rows || []).length === 0 ? (
                <div className="text-center text-muted-foreground py-8">No audit rows available.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left">Site</th>
                        <th className="p-2 text-left">Scope</th>
                        <th className="p-2 text-left">Category</th>
                        <th className="p-2 text-left">ID</th>
                        <th className="p-2 text-left">Report Label</th>
                        <th className="p-2 text-left">UOM</th>
                        <th className="p-2 text-right">Qty</th>
                        <th className="p-2 text-right">Factor</th>
                        <th className="p-2 text-right">tCO₂e (After Apply)</th>
                        <th className="p-2 text-left">Data Confidence</th>
                        <th className="p-2 text-left">Source Family</th>
                        <th className="p-2 text-left">Dataset</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditDisplayRows.map((item, idx) => {
                        if (item.kind === "scope-total") {
                          return (
                            <tr key={`scope-total-${idx}`} className="border-t bg-muted/30 font-semibold">
                              <td className="p-2" colSpan={11}>
                                Scope Total: {item.scope}
                              </td>
                              <td className="p-2 text-right">{formatNumber(item.total, 2)}</td>
                            </tr>
                          );
                        }
                        if (item.kind === "category-total") {
                          return (
                            <tr key={`category-total-${idx}`} className="border-t bg-muted/20 font-semibold">
                              <td className="p-2" colSpan={11}>
                                Category Total: {item.scope} / {item.category}
                              </td>
                              <td className="p-2 text-right">{formatNumber(item.total, 2)}</td>
                            </tr>
                          );
                        }
                        const row = item.row;
                        const datasetLabel = row.dataset_name
                          ? `${row.dataset_name}${row.dataset_version ? ` (${row.dataset_version})` : ""}`
                          : "-";
                        return (
                          <tr key={`row-${idx}`} className="border-t hover:bg-muted/20">
                            <td className="p-2">{row.site_name || "-"}</td>
                            <td className="p-2">{row.scope || "-"}</td>
                            <td className="p-2">{row.category || "-"}</td>
                            <td className="p-2">{row.id || "-"}</td>
                            <td className="p-2">{row.report_label || "-"}</td>
                            <td className="p-2">{row.uom || "-"}</td>
                            <td className="p-2 text-right">{formatNumber(row.qty || 0, 2)}</td>
                            <td className="p-2 text-right">{formatNumber(row.factor || 0, 2)}</td>
                            <td className="p-2 text-right font-medium">{formatNumber(row.tco2e_after_apply || 0, 2)}</td>
                            <td className="p-2">{row.data_confidence || "-"}</td>
                            <td className="p-2">
                              <span className="inline-flex rounded-full bg-muted px-2 py-1 text-xs font-medium">
                                {row.source_family || "-"}
                              </span>
                            </td>
                            <td className="p-2">{datasetLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="intensity-metrics" className="space-y-4">
          <JobIntensityYearOverYear clientId={clientId} baseUrl={baseUrl} />
        </TabsContent>
      </Tabs>

    </div>
  );
}
