"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ScopeTotals = {
  scope_1: number;
  scope_2: number;
  scope_3: number;
  total: number;
};

type EmissionsSummaryProps = {
  jobId: number;
  baseUrl?: string;
  variant?: "card" | "compact";
  className?: string;
};

export default function EmissionsSummary({
  jobId,
  baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "",
  variant = "card",
  className,
}: EmissionsSummaryProps) {
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

  if (variant === "compact") {
    return (
      <div className={cn("rounded-[28px] border border-slate-200/70 bg-slate-50/55 p-3 shadow-sm", className)}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[0.68rem] uppercase tracking-[0.36em] text-slate-500">Emissions Summary</div>
            <div className="text-xs text-slate-600">Current job totals</div>
          </div>
          {loading ? <div className="text-xs text-slate-500">Loading...</div> : null}
        </div>

        {scopeTotals ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="min-w-0 rounded-2xl border border-slate-200/75 bg-white/90 px-3 py-2.5 text-right shadow-[0_1px_0_rgba(15,23,42,0.02)]">
              <div className="truncate text-[1.05rem] font-semibold leading-tight tracking-tight tabular-nums text-slate-950">
                {formatNumber(scopeTotals.total)}
              </div>
              <div className="mt-1 text-[0.56rem] uppercase tracking-[0.3em] text-slate-500">Total tCO₂e</div>
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-200/75 bg-white/90 px-3 py-2.5 text-right shadow-[0_1px_0_rgba(15,23,42,0.02)]">
              <div className="truncate text-[1.05rem] font-semibold leading-tight tracking-tight tabular-nums text-red-600">
                {formatNumber(scopeTotals.scope_1)}
              </div>
              <div className="mt-1 text-[0.56rem] uppercase tracking-[0.3em] text-slate-500">Scope 1</div>
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-200/75 bg-white/90 px-3 py-2.5 text-right shadow-[0_1px_0_rgba(15,23,42,0.02)]">
              <div className="truncate text-[1.05rem] font-semibold leading-tight tracking-tight tabular-nums text-orange-600">
                {formatNumber(scopeTotals.scope_2)}
              </div>
              <div className="mt-1 text-[0.56rem] uppercase tracking-[0.3em] text-slate-500">Scope 2</div>
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-200/75 bg-white/90 px-3 py-2.5 text-right shadow-[0_1px_0_rgba(15,23,42,0.02)]">
              <div className="truncate text-[1.05rem] font-semibold leading-tight tracking-tight tabular-nums text-blue-600">
                {formatNumber(scopeTotals.scope_3)}
              </div>
              <div className="mt-1 text-[0.56rem] uppercase tracking-[0.3em] text-slate-500">Scope 3</div>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs text-slate-500">No data</div>
        )}
      </div>
    );
  }

  return (
    <Card className={className}>
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
              <div className="text-xs text-muted-foreground">Total tCO₂e</div>
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
