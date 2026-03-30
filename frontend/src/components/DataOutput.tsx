"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import EmissionsSummary from "@/components/EmissionsSummary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Activity = {
  row_id: number;
  level_3: string | null;
  level_4: string | null;
  activity_name: string | null;
  quantity: number | null;
  unit: string | null;
  emissions: number;
  is_custom_entry?: boolean;
  scope?: string;
  category?: string;
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
  sites: Site[];
};

type Scope = {
  scope_name: string;
  total_emissions: number;
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
};

type ScopeCategoryData = {
  [scope: string]: {
    [category: string]: number;
  };
};

type ClientReportingComparisonData = {
  years: number[];
  by_scope: Array<{
    year: number;
    [key: string]: number | string;
  }>;
  by_scope_category: Array<{
    year: number;
    scopes: ScopeCategoryData;
  }>;
  by_scope_volume?: Array<{
    year: number;
    [key: string]: number | string;
  }>;
  by_scope_category_volume?: Array<{
    year: number;
    scopes: ScopeCategoryData;
  }>;
};

type AuditRow = {
  site_name: string;
  scope: string;
  id: string;
  report_label: string;
  uom: string;
  qty: number;
  factor: number;
  tco2e_after_apply: number;
  data_confidence: string;
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

export default function DataOutput({ jobId, baseUrl }: DataOutputProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summaryData, setSummaryData] = useState<DataOutputSummary | null>(null);
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [detailedData, setDetailedData] = useState<DataOutputDetailed | null>(null);
  const [comparisonData, setComparisonData] = useState<ClientReportingComparisonData | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  
  // Expansion state
  const [expandedScopes, setExpandedScopes] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  
  // Expansion state for sites view
  const [expandedSiteNames, setExpandedSiteNames] = useState<Set<string>>(new Set());
  const [expandedSiteScopes, setExpandedSiteScopes] = useState<Set<string>>(new Set());

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
    setComparisonError("");
    setComparisonLoading(true);
    try {
      const [summaryRes, auditRes, jobRes] = await Promise.all([
        fetch(`${baseUrl}/jobs/${jobId}/data-output`),
        fetch(`${baseUrl}/jobs/${jobId}/data-output/audit`),
        fetch(`${baseUrl}/jobs/${jobId}`),
      ]);

      if (!summaryRes.ok) {
        throw new Error(`Failed to load data: ${summaryRes.status}`);
      }
      if (!auditRes.ok) {
        throw new Error(`Failed to load audit data: ${auditRes.status}`);
      }
      if (!jobRes.ok) {
        throw new Error(`Failed to load job context: ${jobRes.status}`);
      }

      const summaryJson = await summaryRes.json();
      const auditJson = await auditRes.json();
      const jobJson = await jobRes.json();
      setSummaryData(summaryJson);
      setAuditData(auditJson);

      const clientId = Number(jobJson?.client_db_id);
      if (Number.isFinite(clientId) && clientId > 0) {
        const comparisonRes = await fetch(`${baseUrl}/clients/${clientId}/reporting`);
        if (comparisonRes.ok) {
          const comparisonJson = (await comparisonRes.json()) as ClientReportingComparisonData;
          setComparisonData(comparisonJson);
        } else {
          setComparisonData(null);
          setComparisonError(`Failed to load year-over-year comparison: ${comparisonRes.status}`);
        }
      } else {
        setComparisonData(null);
        setComparisonError("Unable to resolve client for year-over-year comparison.");
      }
    } catch (e) {
      setError((e as Error).message);
      setComparisonData(null);
    } finally {
      setLoading(false);
      setComparisonLoading(false);
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

  async function loadScopeDetails(scope: string) {
    setSelectedScope(scope);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/data-output?scope=${encodeURIComponent(scope)}`);
      if (!res.ok) {
        throw new Error(`Failed to load scope details: ${res.status}`);
      }
      const data = await res.json();
      setDetailedData(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function toggleScope(scopeName: string) {
    const newExpanded = new Set(expandedScopes);
    if (newExpanded.has(scopeName)) {
      newExpanded.delete(scopeName);
    } else {
      newExpanded.add(scopeName);
    }
    setExpandedScopes(newExpanded);
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

  function toggleSite(siteKey: string) {
    const newExpanded = new Set(expandedSites);
    if (newExpanded.has(siteKey)) {
      newExpanded.delete(siteKey);
    } else {
      newExpanded.add(siteKey);
    }
    setExpandedSites(newExpanded);
  }

  function formatNumber(num: number): string {
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      "ID",
      "Report Label",
      "UOM",
      "Qty",
      "Factor",
      "tCO2e (After Apply)",
      "Data Confidence",
      "Dataset",
    ];
    const lines: string[] = [headers.map(csvEscape).join(",")];

    for (const item of auditDisplayRows) {
      if (item.kind === "subtotal") {
        lines.push(
          [
            `Subtotal: ${item.site_name} / ${item.scope}`,
            "",
            "",
            "",
            "",
            "",
            "",
            item.total.toFixed(2),
            "",
            "",
          ]
            .map(csvEscape)
            .join(",")
        );
      } else if (item.kind === "site-total") {
        lines.push(
          [
            `Site Total: ${item.site_name}`,
            "",
            "",
            "",
            "",
            "",
            "",
            item.total.toFixed(2),
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
            row.id || "-",
            row.report_label || "-",
            row.uom || "-",
            Number(row.qty || 0).toFixed(2),
            Number(row.factor || 0).toFixed(6),
            Number(row.tco2e_after_apply || 0).toFixed(2),
            row.data_confidence || "-",
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
    const subtotalMap = new Map<string, number>();
    const siteTotalMap = new Map<string, number>();
    for (const item of auditData.scope_subtotals || []) {
      subtotalMap.set(`${item.site_name}||${item.scope}`, item.subtotal_tco2e_after_apply);
      siteTotalMap.set(
        item.site_name,
        (siteTotalMap.get(item.site_name) ?? 0) + Number(item.subtotal_tco2e_after_apply || 0)
      );
    }

    const out: Array<
      | { kind: "row"; row: AuditRow }
      | { kind: "subtotal"; site_name: string; scope: string; total: number }
      | { kind: "site-total"; site_name: string; total: number }
    > = [];
    let lastKey = "";
    let lastSite = "";
    for (const row of auditData.rows || []) {
      const key = `${row.site_name}||${row.scope}`;
      if (lastKey && key !== lastKey) {
        const [siteName, scopeName] = lastKey.split("||");
        out.push({
          kind: "subtotal",
          site_name: siteName,
          scope: scopeName,
          total: subtotalMap.get(lastKey) ?? 0,
        });
        if (lastSite && row.site_name !== lastSite) {
          out.push({
            kind: "site-total",
            site_name: lastSite,
            total: siteTotalMap.get(lastSite) ?? 0,
          });
        }
      }
      out.push({ kind: "row", row });
      lastKey = key;
      lastSite = row.site_name;
    }
    if (lastKey) {
      const [siteName, scopeName] = lastKey.split("||");
      out.push({
        kind: "subtotal",
        site_name: siteName,
        scope: scopeName,
        total: subtotalMap.get(lastKey) ?? 0,
      });
      out.push({
        kind: "site-total",
        site_name: siteName,
        total: siteTotalMap.get(siteName) ?? 0,
      });
    }
    return out;
  }, [auditData]);

  const comparisonYears = useMemo(() => {
    if (!comparisonData?.years) return [];
    return [...comparisonData.years].sort((a, b) => a - b);
  }, [comparisonData]);

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
      <EmissionsSummary jobId={jobId} baseUrl={baseUrl} />
      
      <Tabs defaultValue="by-scope" className="w-full">
        <TabsList>
          <TabsTrigger value="by-scope">By Scope</TabsTrigger>
          <TabsTrigger value="by-site">By Site</TabsTrigger>
          <TabsTrigger value="audit-table">Audit Table</TabsTrigger>
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
                  
                  return (
                    <div key={scope.scope_name} className="border rounded-md">
                      {/* Scope Header */}
                      <div
                        className="flex items-center justify-between p-3 bg-muted hover:bg-muted/80 cursor-pointer"
                        onClick={() => toggleScope(scope.scope_name)}
                      >
                        <div className="flex items-center gap-2">
                          {scopeExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span className="font-semibold">{scope.scope_name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm font-medium">{formatNumber(scope.total_emissions)} tCO2e</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadScopeDetails(scope.scope_name);
                            }}
                          >
                            View Details
                          </Button>
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
                                  onClick={() => toggleCategory(categoryKey)}
                                >
                                  <div className="flex items-center gap-2 pl-4">
                                    {categoryExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                    <span className="text-sm font-medium">{category.category_name}</span>
                                  </div>
                                  <span className="text-sm">{formatNumber(category.total_emissions)} tCO2e</span>
                                </div>

                                {/* Sites */}
                                {categoryExpanded && (
                                  <div className="p-2 pl-8 space-y-1">
                                    {category.sites.map((site, idx) => (
                                      <div key={idx} className="flex items-center justify-between p-2 text-sm bg-muted/30 rounded">
                                        <span className="text-muted-foreground">{site.site_name}</span>
                                        <div className="flex items-center gap-2">
                                          <span>{formatNumber(site.total_emissions)} tCO2e</span>
                                          {site.activity_count && (
                                            <span className="text-xs text-muted-foreground">({site.activity_count} activities)</span>
                                          )}
                                        </div>
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
                    <TabsTrigger value="emissions">Emissions (tCO2e)</TabsTrigger>
                    <TabsTrigger value="volume">Volume</TabsTrigger>
                  </TabsList>

                  <TabsContent value="emissions" className="pt-2">
                    {comparisonEmissionsRows.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No emissions comparison data available.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-muted">
                              <th className="text-left p-2 border">Scope</th>
                              <th className="text-left p-2 border">Category</th>
                              {comparisonYears.map((year) => (
                                <th key={year} className="text-right p-2 border">{year}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {comparisonEmissionsRows.map((row, idx) => {
                              if (row.type === "category") {
                                return (
                                  <tr key={`em-cat-${row.scope}-${row.category}-${idx}`} className="hover:bg-muted/30">
                                    <td className="p-2 border">{row.scope}</td>
                                    <td className="p-2 border">{row.category}</td>
                                    {row.values.map((value, colIdx) => (
                                      <td key={colIdx} className="text-right p-2 border">
                                        {value > 0 ? formatNumber(value) : "-"}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              }
                              if (row.type === "subtotal") {
                                return (
                                  <tr key={`em-sub-${row.scope}-${idx}`} className="bg-muted/60 font-semibold">
                                    <td className="p-2 border">{row.scope}</td>
                                    <td className="p-2 border">Subtotal</td>
                                    {row.values.map((value, colIdx) => (
                                      <td key={colIdx} className="text-right p-2 border">
                                        {value > 0 ? formatNumber(value) : "-"}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              }
                              return (
                                <tr key={`em-total-${idx}`} className="bg-muted font-bold">
                                  <td className="p-2 border">All Scopes</td>
                                  <td className="p-2 border">Total</td>
                                  {row.values.map((value, colIdx) => (
                                    <td key={colIdx} className="text-right p-2 border">
                                      {value > 0 ? formatNumber(value) : "-"}
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

                  <TabsContent value="volume" className="pt-2">
                    {comparisonVolumeRows.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No volume comparison data available.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-muted">
                              <th className="text-left p-2 border">Scope</th>
                              <th className="text-left p-2 border">Category</th>
                              {comparisonYears.map((year) => (
                                <th key={year} className="text-right p-2 border">{year}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {comparisonVolumeRows.map((row, idx) => {
                              if (row.type === "category") {
                                return (
                                  <tr key={`vol-cat-${row.scope}-${row.category}-${idx}`} className="hover:bg-muted/30">
                                    <td className="p-2 border">{row.scope}</td>
                                    <td className="p-2 border">{row.category}</td>
                                    {row.values.map((value, colIdx) => (
                                      <td key={colIdx} className="text-right p-2 border">
                                        {value > 0 ? formatNumber(value) : "-"}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              }
                              if (row.type === "subtotal") {
                                return (
                                  <tr key={`vol-sub-${row.scope}-${idx}`} className="bg-muted/60 font-semibold">
                                    <td className="p-2 border">{row.scope}</td>
                                    <td className="p-2 border">Subtotal</td>
                                    {row.values.map((value, colIdx) => (
                                      <td key={colIdx} className="text-right p-2 border">
                                        {value > 0 ? formatNumber(value) : "-"}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              }
                              return (
                                <tr key={`vol-total-${idx}`} className="bg-muted font-bold">
                                  <td className="p-2 border">All Scopes</td>
                                  <td className="p-2 border">Total</td>
                                  {row.values.map((value, colIdx) => (
                                    <td key={colIdx} className="text-right p-2 border">
                                      {value > 0 ? formatNumber(value) : "-"}
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
                          <span className="text-sm font-medium">{formatNumber(site.total_emissions)} tCO2e</span>
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
                                    <span className="text-sm">{formatNumber(scope.total_emissions)} tCO2e</span>
                                  </div>

                                  {/* Categories */}
                                  {scopeExpanded && (
                                    <div className="p-2 pl-8 space-y-1">
                                      {scope.categories.map((category, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-2 text-sm bg-muted/30 rounded">
                                          <span className="text-muted-foreground">{category.category_name}</span>
                                          <span>{formatNumber(category.total_emissions)} tCO2e</span>
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
              {!auditData || (auditData.rows || []).length === 0 ? (
                <div className="text-center text-muted-foreground py-8">No audit rows available.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left">Site</th>
                        <th className="p-2 text-left">Scope</th>
                        <th className="p-2 text-left">ID</th>
                        <th className="p-2 text-left">Report Label</th>
                        <th className="p-2 text-left">UOM</th>
                        <th className="p-2 text-right">Qty</th>
                        <th className="p-2 text-right">Factor</th>
                        <th className="p-2 text-right">tCO2e (After Apply)</th>
                        <th className="p-2 text-left">Data Confidence</th>
                        <th className="p-2 text-left">Dataset</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditDisplayRows.map((item, idx) => {
                        if (item.kind === "subtotal") {
                          return (
                            <tr key={`subtotal-${idx}`} className="border-t bg-muted/30 font-semibold">
                              <td className="p-2" colSpan={7}>
                                Subtotal: {item.site_name} / {item.scope}
                              </td>
                              <td className="p-2 text-right">{formatNumber(item.total)}</td>
                              <td className="p-2" colSpan={2}></td>
                            </tr>
                          );
                        }
                        if (item.kind === "site-total") {
                          return (
                            <tr key={`site-total-${idx}`} className="border-t bg-muted/50 font-bold">
                              <td className="p-2" colSpan={7}>
                                Site Total: {item.site_name}
                              </td>
                              <td className="p-2 text-right">{formatNumber(item.total)}</td>
                              <td className="p-2" colSpan={2}></td>
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
                            <td className="p-2">{row.id || "-"}</td>
                            <td className="p-2">{row.report_label || "-"}</td>
                            <td className="p-2">{row.uom || "-"}</td>
                            <td className="p-2 text-right">{formatNumber(row.qty || 0)}</td>
                            <td className="p-2 text-right">{formatNumber(row.factor || 0)}</td>
                            <td className="p-2 text-right font-medium">{formatNumber(row.tco2e_after_apply || 0)}</td>
                            <td className="p-2">{row.data_confidence || "-"}</td>
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
      </Tabs>

      {/* Detailed View */}
      {selectedScope && detailedData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{detailedData.scope} - Detailed Breakdown</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setSelectedScope(null)}>
                Close Details
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {detailedData.categories.map((category) => {
                const categoryKey = `detail-${category.category_name}`;
                const categoryExpanded = expandedCategories.has(categoryKey);

                return (
                  <div key={categoryKey} className="border rounded-md">
                    {/* Category Header */}
                    <div
                      className="flex items-center justify-between p-3 bg-muted hover:bg-muted/80 cursor-pointer"
                      onClick={() => toggleCategory(categoryKey)}
                    >
                      <div className="flex items-center gap-2">
                        {categoryExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="font-semibold">{category.category_name}</span>
                      </div>
                      <span className="font-medium">{formatNumber(category.total_emissions)} tCO2e</span>
                    </div>

                    {/* Sites with Activities */}
                    {categoryExpanded && (
                      <div className="p-2 space-y-2">
                        {category.sites.map((site, siteIdx) => {
                          const siteKey = `${categoryKey}-${site.site_name}`;
                          const siteExpanded = expandedSites.has(siteKey);

                          return (
                            <div key={siteIdx} className="border rounded">
                              {/* Site Header */}
                              <div
                                className="flex items-center justify-between p-2 bg-background hover:bg-muted/50 cursor-pointer"
                                onClick={() => toggleSite(siteKey)}
                              >
                                <div className="flex items-center gap-2 pl-4">
                                  {siteExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  <span className="text-sm font-medium">{site.site_name}</span>
                                </div>
                                <span className="text-sm">{formatNumber(site.total_emissions)} tCO2e</span>
                              </div>

                              {/* Activities */}
                              {siteExpanded && site.activities && (
                                <div className="p-2">
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                      <thead className="bg-muted/50">
                                        <tr>
                                          <th className="text-left p-2">Activity</th>
                                          <th className="text-left p-2">Level 3</th>
                                          <th className="text-left p-2">Level 4</th>
                                          <th className="text-right p-2">Quantity</th>
                                          <th className="text-left p-2">Unit</th>
                                          <th className="text-right p-2">Emissions (tCO2e)</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {site.activities.map((activity, actIdx) => (
                                          <tr key={actIdx} className="border-t hover:bg-muted/30">
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
                                              {activity.quantity !== null ? formatNumber(activity.quantity) : "-"}
                                            </td>
                                            <td className="p-2">{activity.unit || "-"}</td>
                                            <td className="p-2 text-right font-medium">{formatNumber(activity.emissions)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
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
      )}
    </div>
  );
}
