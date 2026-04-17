"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ScopeCategoryData = {
  [scope: string]: {
    [category: string]: number;
  };
};

type ClientReportingData = {
  client_db_id: number;
  client_name: string;
  years: number[];
  by_scope: Array<{
    year: number;
    [key: string]: number | string;
  }>;
  by_scope_category: Array<{
    year: number;
    scopes: ScopeCategoryData;
  }>;
  by_activity: Array<{
    year: number;
    [key: string]: number | string;
  }>;
  by_site: Array<{
    year: number;
    [key: string]: number | string;
  }>;
};

type ClientReportingProps = {
  clientId: number;
  baseUrl: string;
};

export default function ClientReporting({ clientId, baseUrl }: ClientReportingProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<ClientReportingData | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}/reporting`);
        if (!res.ok) {
          throw new Error(`Failed to load reporting data: ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [clientId, baseUrl]);

  // Format number with 1 decimal place and thousands separator
  function formatNumber(num: number): string {
    return num.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading reporting data...</div>
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

  const reportData = data;

  if (!reportData || reportData.years.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            No reporting data available. Complete CRP jobs to see year-over-year comparisons.
          </div>
        </CardContent>
      </Card>
    );
  }

  const reportDataSafe = reportData as NonNullable<typeof reportData>;
  const latestYear = reportDataSafe.years[reportDataSafe.years.length - 1];

  // Get all unique scopes
  const allScopes = new Set<string>();
  if (reportDataSafe.by_scope_category && reportDataSafe.by_scope_category.length > 0) {
    for (const yearData of reportDataSafe.by_scope_category) {
      if (yearData.scopes) {
        for (const scope of Object.keys(yearData.scopes)) {
          allScopes.add(scope);
        }
      }
    }
  }
  const sortedScopes = Array.from(allScopes).sort();

  // Get all unique categories for each scope
  function getCategoriesForScope(scopeName: string): string[] {
    const categories = new Set<string>();
    if (reportDataSafe.by_scope_category && reportDataSafe.by_scope_category.length > 0) {
      for (const yearData of reportDataSafe.by_scope_category) {
        if (yearData.scopes && yearData.scopes[scopeName]) {
          for (const cat of Object.keys(yearData.scopes[scopeName])) {
            categories.add(cat);
          }
        }
      }
    }
    return Array.from(categories).sort();
  }

  // Get YoY change for a value
  function getYoYChange(currentValue: number, previousValue: number): { value: number | null; color: string } {
    if (previousValue === 0 || isNaN(currentValue) || isNaN(previousValue)) {
      return { value: null, color: '' };
    }
    const change = ((currentValue - previousValue) / previousValue) * 100;
    let color = '';
    if (change > 0) color = 'text-red-600';
    else if (change < 0) color = 'text-green-600';
    return { value: change, color };
  }

  // Get value for a year
  function getValueForYear(dataArray: Array<{ [key: string]: number | string }>, year: number, key: string): number {
    const row = dataArray.find(d => d.year === year);
    if (!row) return 0;
    const val = row[key];
    return typeof val === 'number' ? val : 0;
  }

  // Get value from scope_category data
  function getScopeCatValue(year: number, scope: string, category: string): number {
    const yearData = reportDataSafe.by_scope_category?.find(d => d.year === year);
    if (!yearData || !yearData.scopes || !yearData.scopes[scope]) return 0;
    return yearData.scopes[scope][category] || 0;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Emissions ({latestYear})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(getValueForYear(reportDataSafe.by_scope, latestYear, 'total'))} tCO₂e
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Year-over-Year Change</CardTitle>
          </CardHeader>
          <CardContent>
            {reportDataSafe.years.length >= 2 ? (() => {
              const current = getValueForYear(reportDataSafe.by_scope, latestYear, 'total');
              const previous = getValueForYear(reportDataSafe.by_scope, reportDataSafe.years[reportDataSafe.years.length - 2], 'total');
              const { value, color } = getYoYChange(current, previous);
              if (value === null) {
                return <div className="text-2xl font-bold">-</div>;
              }
              return (
                <div className={`text-2xl font-bold ${color}`}>
                  {value > 0 ? '+' : ''}{value.toFixed(1)}%
                </div>
              );
            })() : <div className="text-2xl font-bold">-</div>}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Years of Data</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reportDataSafe.years.length}</div>
            <div className="text-xs text-muted-foreground">
              {reportDataSafe.years[0]} - {latestYear}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="by-scope" className="w-full">
        <TabsList>
          <TabsTrigger value="by-scope">By Scope</TabsTrigger>
          <TabsTrigger value="by-activity">By Activity</TabsTrigger>
          <TabsTrigger value="by-site">By Site</TabsTrigger>
        </TabsList>
        
        <TabsContent value="by-scope" className="space-y-4">
          {/* Scope Summary Table */}
          <Card>
            <CardHeader>
              <CardTitle>Emissions by Scope - Year over Year</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left p-2 border">Scope</th>
                      {reportDataSafe.years.map(year => (
                        <th key={year} className="text-right p-2 border">{year}</th>
                      ))}
                      <th className="text-right p-2 border">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedScopes.map(scope => (
                      <tr key={scope} className="hover:bg-muted/50">
                        <td className="p-2 border font-medium">{scope}</td>
                        {reportDataSafe.years.map((year, idx) => {
                          const value = getValueForYear(reportDataSafe.by_scope, year, scope);
                          return (
                            <td key={year} className="text-right p-2 border">
                              {value > 0 ? formatNumber(value) : '-'}
                            </td>
                          );
                        })}
                        <td className="text-right p-2 border">
                          {reportDataSafe.years.length >= 2 ? (() => {
                            const current = getValueForYear(reportDataSafe.by_scope, latestYear, scope);
                            const previous = getValueForYear(reportDataSafe.by_scope, reportDataSafe.years[reportDataSafe.years.length - 2], scope);
                            const { value, color } = getYoYChange(current, previous);
                            if (value === null) return '-';
                            return <span className={color}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
                          })() : '-'}
                        </td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr className="bg-muted font-semibold">
                      <td className="p-2 border">Total</td>
                      {reportDataSafe.years.map(year => {
                        const value = getValueForYear(reportDataSafe.by_scope, year, 'total');
                        return (
                          <td key={year} className="text-right p-2 border">
                            {value > 0 ? formatNumber(value) : '-'}
                          </td>
                        );
                      })}
                      <td className="text-right p-2 border">
                        {reportDataSafe.years.length >= 2 ? (() => {
                          const current = getValueForYear(reportDataSafe.by_scope, latestYear, 'total');
                          const previous = getValueForYear(reportDataSafe.by_scope, reportDataSafe.years[reportDataSafe.years.length - 2], 'total');
                          const { value, color } = getYoYChange(current, previous);
                          if (value === null) return '-';
                          return <span className={color}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
                        })() : '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Category breakdown per scope */}
          {sortedScopes.map(scope => {
            const categories = getCategoriesForScope(scope);
            if (categories.length === 0) return null;
            
            return (
              <Card key={scope}>
                <CardHeader>
                  <CardTitle>{scope} - Categories</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-muted">
                          <th className="text-left p-2 border">Category</th>
                          {reportDataSafe.years.map(year => (
                            <th key={year} className="text-right p-2 border">{year}</th>
                          ))}
                          <th className="text-right p-2 border">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categories.map(cat => (
                          <tr key={cat} className="hover:bg-muted/50">
                            <td className="p-2 border font-medium">{cat}</td>
                            {reportDataSafe.years.map(year => {
                              const value = getScopeCatValue(year, scope, cat);
                              return (
                                <td key={year} className="text-right p-2 border">
                                  {value > 0 ? formatNumber(value) : '-'}
                                </td>
                              );
                            })}
                            <td className="text-right p-2 border">
                              {reportDataSafe.years.length >= 2 ? (() => {
                                const current = getScopeCatValue(latestYear, scope, cat);
                                const previous = getScopeCatValue(reportDataSafe.years[reportDataSafe.years.length - 2], scope, cat);
                                const { value, color } = getYoYChange(current, previous);
                                if (value === null) return '-';
                                return <span className={color}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
                              })() : '-'}
                            </td>
                          </tr>
                        ))}
                        {/* Subtotal row */}
                        <tr className="bg-muted font-semibold">
                          <td className="p-2 border">{scope} Total</td>
                          {reportDataSafe.years.map(year => {
                            const value = getValueForYear(reportDataSafe.by_scope, year, scope);
                            return (
                              <td key={year} className="text-right p-2 border">
                                {value > 0 ? formatNumber(value) : '-'}
                              </td>
                            );
                          })}
                          <td className="text-right p-2 border">
                            {reportDataSafe.years.length >= 2 ? (() => {
                              const current = getValueForYear(reportDataSafe.by_scope, latestYear, scope);
                              const previous = getValueForYear(reportDataSafe.by_scope, reportDataSafe.years[reportDataSafe.years.length - 2], scope);
                              const { value, color } = getYoYChange(current, previous);
                              if (value === null) return '-';
                              return <span className={color}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
                            })() : '-'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
        
        <TabsContent value="by-activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Emissions by Activity/Category - Year over Year</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left p-2 border">Activity</th>
                      {reportDataSafe.years.map(year => (
                        <th key={year} className="text-right p-2 border">{year}</th>
                      ))}
                      <th className="text-right p-2 border">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Get all unique categories
                      const allCategories = new Set<string>();
                      for (const row of reportDataSafe.by_activity) {
                        for (const key of Object.keys(row)) {
                          if (key !== 'year' && key !== 'total') {
                            allCategories.add(key);
                          }
                        }
                      }
                      const sortedCategories = Array.from(allCategories).sort();
                      const displayCategories = sortedCategories.slice(0, 20);
                      
                      return (
                        <>
                          {displayCategories.map(cat => (
                            <tr key={cat} className="hover:bg-muted/50">
                              <td className="p-2 border font-medium">{cat}</td>
                              {reportDataSafe.years.map(year => {
                                const value = getValueForYear(reportDataSafe.by_activity, year, cat);
                                return (
                                  <td key={year} className="text-right p-2 border">
                                    {value > 0 ? formatNumber(value) : '-'}
                                  </td>
                                );
                              })}
                              <td className="text-right p-2 border">
                                {reportDataSafe.years.length >= 2 ? (() => {
                                  const current = getValueForYear(reportDataSafe.by_activity, latestYear, cat);
                                  const previous = getValueForYear(reportDataSafe.by_activity, reportDataSafe.years[reportDataSafe.years.length - 2], cat);
                                  const { value, color } = getYoYChange(current, previous);
                                  if (value === null) return '-';
                                  return <span className={color}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
                                })() : '-'}
                              </td>
                            </tr>
                          ))}
                          {sortedCategories.length > 20 && (
                            <tr>
                              <td colSpan={reportDataSafe.years.length + 2} className="p-2 border text-muted-foreground text-center">
                                Showing top 20 of {sortedCategories.length} activities
                              </td>
                            </tr>
                          )}
                          {/* Total row */}
                          <tr className="bg-muted font-semibold">
                            <td className="p-2 border">Total</td>
                            {reportDataSafe.years.map(year => {
                              const value = getValueForYear(reportDataSafe.by_activity, year, 'total');
                              return (
                                <td key={year} className="text-right p-2 border">
                                  {value > 0 ? formatNumber(value) : '-'}
                                </td>
                              );
                            })}
                            <td className="text-right p-2 border">
                              {reportDataSafe.years.length >= 2 ? (() => {
                                const current = getValueForYear(reportDataSafe.by_activity, latestYear, 'total');
                                const previous = getValueForYear(reportDataSafe.by_activity, reportDataSafe.years[reportDataSafe.years.length - 2], 'total');
                                const { value, color } = getYoYChange(current, previous);
                                if (value === null) return '-';
                                return <span className={color}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
                              })() : '-'}
                            </td>
                          </tr>
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="by-site" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Emissions by Site - Year over Year</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left p-2 border">Site</th>
                      {reportDataSafe.years.map(year => (
                        <th key={year} className="text-right p-2 border">{year}</th>
                      ))}
                      <th className="text-right p-2 border">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Get all unique sites
                      const allSites = new Set<string>();
                      for (const row of reportDataSafe.by_site) {
                        for (const key of Object.keys(row)) {
                          if (key !== 'year' && key !== 'total') {
                            allSites.add(key);
                          }
                        }
                      }
                      const sortedSites = Array.from(allSites).sort();
                      
                      return (
                        <>
                          {sortedSites.map(site => (
                            <tr key={site} className="hover:bg-muted/50">
                              <td className="p-2 border font-medium">{site}</td>
                              {reportDataSafe.years.map(year => {
                                const value = getValueForYear(reportDataSafe.by_site, year, site);
                                return (
                                  <td key={year} className="text-right p-2 border">
                                    {value > 0 ? formatNumber(value) : '-'}
                                  </td>
                                );
                              })}
                              <td className="text-right p-2 border">
                                {reportDataSafe.years.length >= 2 ? (() => {
                                  const current = getValueForYear(reportDataSafe.by_site, latestYear, site);
                                  const previous = getValueForYear(reportDataSafe.by_site, reportDataSafe.years[reportDataSafe.years.length - 2], site);
                                  const { value, color } = getYoYChange(current, previous);
                                  if (value === null) return '-';
                                  return <span className={color}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
                                })() : '-'}
                              </td>
                            </tr>
                          ))}
                          {/* Total row */}
                          <tr className="bg-muted font-semibold">
                            <td className="p-2 border">Total</td>
                            {reportDataSafe.years.map(year => {
                              const value = getValueForYear(reportDataSafe.by_site, year, 'total');
                              return (
                                <td key={year} className="text-right p-2 border">
                                  {value > 0 ? formatNumber(value) : '-'}
                                </td>
                              );
                            })}
                            <td className="text-right p-2 border">
                              {reportDataSafe.years.length >= 2 ? (() => {
                                const current = getValueForYear(reportDataSafe.by_site, latestYear, 'total');
                                const previous = getValueForYear(reportDataSafe.by_site, reportDataSafe.years[reportDataSafe.years.length - 2], 'total');
                                const { value, color } = getYoYChange(current, previous);
                                if (value === null) return '-';
                                return <span className={color}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
                              })() : '-'}
                            </td>
                          </tr>
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
