"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEmissions } from "@/lib/format";

type EmissionsRow = {
  job_id: number;
  job_number: string;
  title: string;
  client_name: string;
  client_id: number | null;
  reporting_year: number | null;
  status: string;
  scope_1: number;
  scope_2: number;
  scope_3: number;
  total: number;
};

type SortKey = "client_name" | "job_number" | "reporting_year" | "status" | "scope_1" | "scope_2" | "scope_3" | "total";
type SortDir = "asc" | "desc";

function fmtScope(v: number): string {
  if (v === 0) return "—";
  return formatEmissions(v, { decimals: 1 });
}

function missingDataFlag(row: EmissionsRow): boolean {
  return row.total === 0;
}

type Props = {
  baseUrl: string;
  year: number | null;
  industry: string | null;
  crmOwner: string | null;
};

export default function EmissionsTable({ baseUrl, year, industry, crmOwner }: Props) {
  const [rows, setRows] = useState<EmissionsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("reporting_year");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const load = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (year !== null) p.set("year", String(year));
      if (industry) p.set("industry", industry);
      if (crmOwner) p.set("crm_owner", crmOwner);
      const res = await fetch(`${baseUrl}/dashboard/emissions-table?${p}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; rows: EmissionsRow[] };
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setYearFilter(null);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [baseUrl, year, industry, crmOwner]);

  useEffect(() => { void load(); }, [load]);

  const availableYears = useMemo(() => {
    const years = [...new Set(rows.map(r => r.reporting_year).filter((y): y is number => y !== null))];
    return years.sort((a, b) => b - a);
  }, [rows]);

  const availableStatuses = useMemo(() => {
    const statuses = [...new Set(rows.map(r => r.status).filter(Boolean))];
    return statuses.sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows
      .filter(r => {
        if (yearFilter !== null && r.reporting_year !== yearFilter) return false;
        if (statusFilter !== null && r.status !== statusFilter) return false;
        if (missingOnly && !missingDataFlag(r)) return false;
        if (q) {
          const inClient = (r.client_name || "").toLowerCase().includes(q);
          const inJob = (r.job_number || "").toLowerCase().includes(q);
          const inTitle = (r.title || "").toLowerCase().includes(q);
          if (!inClient && !inJob && !inTitle) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let av: number | string = a[sortKey] ?? "";
        let bv: number | string = b[sortKey] ?? "";
        if (typeof av === "string") av = av.toLowerCase();
        if (typeof bv === "string") bv = bv.toLowerCase();
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [rows, search, yearFilter, statusFilter, missingOnly, sortKey, sortDir]);

  const missingCount = useMemo(() => rows.filter(missingDataFlag).length, [rows]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "reporting_year" ? "desc" : "asc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-30" />;
    return sortDir === "asc"
      ? <ChevronUp className="ml-1 h-3 w-3 text-blue-600" />
      : <ChevronDown className="ml-1 h-3 w-3 text-blue-600" />;
  }

  const Th = ({ col, label, className = "" }: { col: SortKey; label: string; className?: string }) => (
    <th
      className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 select-none cursor-pointer hover:text-slate-800 whitespace-nowrap ${className}`}
      onClick={() => handleSort(col)}
    >
      <span className="inline-flex items-center">
        {label}
        <SortIcon col={col} />
      </span>
    </th>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">Emissions by Job</h3>
        {missingCount > 0 && (
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
            {missingCount} missing data
          </Badge>
        )}
        <div className="flex-1" />
        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-8 pl-8 pr-7 text-xs"
            placeholder="Search client, job…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setSearch("")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
        {/* Missing data toggle */}
        <button
          onClick={() => setMissingOnly(v => !v)}
          className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
            missingOnly
              ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Missing data only
        </button>

        {/* Year pills */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setYearFilter(null)}
            className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
              yearFilter === null
                ? "bg-blue-100 text-blue-800 ring-1 ring-blue-300"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All years
          </button>
          {availableYears.map(y => (
            <button
              key={y}
              onClick={() => setYearFilter(yearFilter === y ? null : y)}
              className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
                yearFilter === y
                  ? "bg-blue-100 text-blue-800 ring-1 ring-blue-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        {/* Status filter */}
        {availableStatuses.length > 1 && (
          <div className="flex flex-wrap gap-1 border-l border-slate-200 pl-2">
            <button
              onClick={() => setStatusFilter(null)}
              className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
                statusFilter === null
                  ? "bg-slate-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              All
            </button>
            {availableStatuses.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-slate-700 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto text-xs text-slate-400">
          {loading ? "Loading…" : `${filtered.length} of ${rows.length} jobs`}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <Th col="client_name" label="Client" />
              <Th col="job_number" label="Job #" />
              <Th col="reporting_year" label="Year" />
              <Th col="status" label="Status" />
              <Th col="scope_1" label="Scope 1" className="text-right" />
              <Th col="scope_2" label="Scope 2" className="text-right" />
              <Th col="scope_3" label="Scope 3" className="text-right" />
              <Th col="total" label="Total tCO₂e" className="text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-xs text-slate-400">Loading…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-xs text-slate-400">No matching jobs.</td>
              </tr>
            ) : (
              filtered.map(row => {
                const missing = missingDataFlag(row);
                return (
                  <tr
                    key={row.job_id}
                    className={`hover:bg-slate-50 ${missing ? "bg-amber-50/50" : ""}`}
                  >
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-sm font-medium text-slate-800" title={row.client_name}>
                      {row.client_name || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      <a
                        href={`/jobs/${row.job_id}`}
                        className="font-mono hover:underline hover:text-blue-600"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.job_number || `#${row.job_id}`}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{row.reporting_year ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        row.status === "Completed" ? "bg-emerald-100 text-emerald-800" :
                        row.status === "Active" ? "bg-blue-100 text-blue-800" :
                        "bg-slate-100 text-slate-600"
                      }`}>
                        {row.status || "Unknown"}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs ${row.scope_1 === 0 ? "text-slate-300" : "text-slate-700"}`}>
                      {fmtScope(row.scope_1)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs ${row.scope_2 === 0 ? "text-slate-300" : "text-slate-700"}`}>
                      {fmtScope(row.scope_2)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs ${row.scope_3 === 0 ? "text-slate-300" : "text-slate-700"}`}>
                      {fmtScope(row.scope_3)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${
                      missing ? "text-amber-600" : "text-slate-800"
                    }`}>
                      {missing ? (
                        <span className="text-amber-500">No data</span>
                      ) : (
                        fmtScope(row.total)
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer totals */}
      {filtered.length > 0 && !loading && (
        <div className="flex items-center justify-end gap-6 border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-xs font-semibold text-slate-600">
          <span>Scope 1: {formatEmissions(filtered.reduce((s, r) => s + r.scope_1, 0), { decimals: 1 })}</span>
          <span>Scope 2: {formatEmissions(filtered.reduce((s, r) => s + r.scope_2, 0), { decimals: 1 })}</span>
          <span>Scope 3: {formatEmissions(filtered.reduce((s, r) => s + r.scope_3, 0), { decimals: 1 })}</span>
          <span className="text-slate-800">
            Total: {formatEmissions(filtered.reduce((s, r) => s + r.total, 0), { decimals: 1 })} tCO₂e
          </span>
        </div>
      )}
    </div>
  );
}
