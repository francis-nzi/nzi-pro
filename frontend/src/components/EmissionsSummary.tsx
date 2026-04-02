"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ScopeTotals = {
  scope_1: number;
  scope_2: number;
  scope_3: number;
  total: number;
};

type EmissionsSummaryProps = {
  jobId: number;
  baseUrl?: string;
};

export default function EmissionsSummary({ jobId, baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "" }: EmissionsSummaryProps) {
  const [loading, setLoading] = useState(true);
  const [scopeTotals, setScopeTotals] = useState<ScopeTotals | null>(null);

  const loadScopeTotals = useCallback(async () => {
    setLoading(true);
    const candidateBases = Array.from(
      new Set(
        [
          (baseUrl || "").trim(),
          "/api/backend",
          (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim(),
          "http://127.0.0.1:8002",
          "http://localhost:8000",
        ].filter(Boolean)
      )
    );

    try {
      let lastError: unknown = null;
      for (const base of candidateBases) {
        try {
          const res = await fetch(`${base}/jobs/${jobId}/scope-totals`, {
            credentials: "include",
          });
          if (res.ok) {
            const data = await res.json();
            setScopeTotals(data);
            return;
          }
          lastError = new Error(`Scope totals request failed (${res.status})`);
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Failed to load scope totals");
    } catch (e) {
      console.error("Failed to load scope totals:", e);
      setScopeTotals(null);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => {
    void loadScopeTotals();
  }, [loadScopeTotals]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadScopeTotals();
    };
    window.addEventListener("nzi-job-scope-refresh", handleRefresh);
    return () => window.removeEventListener("nzi-job-scope-refresh", handleRefresh);
  }, [loadScopeTotals]);

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-GB', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Emissions Summary</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground text-center">Loading...</div>
        ) : scopeTotals ? (
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1 text-center">
              <div className="text-2xl font-bold">{formatNumber(scopeTotals.total)}</div>
              <div className="text-xs text-muted-foreground">Total tCO2e</div>
            </div>
            <div className="space-y-1 text-center">
              <div className="text-2xl font-bold text-red-600">{formatNumber(scopeTotals.scope_1)}</div>
              <div className="text-xs text-muted-foreground">Scope 1</div>
            </div>
            <div className="space-y-1 text-center">
              <div className="text-2xl font-bold text-orange-600">{formatNumber(scopeTotals.scope_2)}</div>
              <div className="text-xs text-muted-foreground">Scope 2</div>
            </div>
            <div className="space-y-1 text-center">
              <div className="text-2xl font-bold text-blue-600">{formatNumber(scopeTotals.scope_3)}</div>
              <div className="text-xs text-muted-foreground">Scope 3</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center">No data</div>
        )}
      </CardContent>
    </Card>
  );
}
