"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
type PageSize = 50 | 150 | 200 | "all";

function fmtScope(v: number): string {
  if (v === 0) return "—";
  return formatEmissions(v, { decimals: 1 });
}

function missingData(row: EmissionsRow): boolean {
  return row.total === 0;
}

type Props = {
  baseUrl: string;
  year: number | null;
  industry: string | null;
  crmOwner: string | null;
};

function Pill({
  active,
  onClick,
  children,
  variant = "default",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "warning" | "dark";
}) {
  const activeClass =
    variant === "warning"
      ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300"
      : variant === "dark"
      ? "bg-slate-700 text-white"
      : "bg-blue-100 text-blue-800 ring-1 ring-blue-300";
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
        active ? activeClass : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

export default function EmissionsTable({ baseUrl, year, industry, crmOwner }: Props) {
  const [rows, setRows] = useState<EmissionsRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters — year is seeded from parent prop but managed independently
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<number | null>(year);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("reporting_year");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(50);

  // When dashboard year changes, update the year pill selection
  useEffect(() => {
    setYearFilter(year);
    setPage(1);
  }, [year]);

  // Fetch once per industry/crmOwner change (year is client-side only)
  const load = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (industry) p.set("industry", industry);
      if (crmOwner) p.set("crm_owner", crmOwner);
      const res = await fetch(`${baseUrl}/dashboard/emissions-table?${p}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; rows: EmissionsRow[] };
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [baseUrl, industry, crmOwner]);

  useEffect(() => { void load(); }, [load]);

  // Reset page when any filter changes
  useEffect(() => { setPage(1); }, [search, yearFilter, statusFilter, missingOnly, sortKey, sortDir]);

  const availableYears = useMemo(() => {
    const years = [...new Set(rows.map(r => r.reporting_year).filter((y): y is number => y !== null))];
    return years.sort((a, b) => b - a);
  }, [rows]);

  const availableStatuses = useMemo(() => {
    const s = [...new Set(rows.map(r => r.status).filter(Boolean))];
    return s.sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows
      .filter(r => {
        if (yearFilter !== null && r.reporting_year !== yearFilter) return false;
        if (statusFilter !== null && r.status !== statusFilter) return false;
        if (missingOnly && !missingData(r)) return false;
        if (q) {
          const hit =
            (r.client_name || "").toLowerCase().includes(q) ||
            (r.job_number || "").toLowerCase().includes(q) ||
            (r.title || "").toLowerCase().includes(q);
          if (!hit) return false;
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

  const missingCount = useMemo(() => rows.filter(missingData).length, [rows]);

  const totalPages = pageSize === "all" ? 1 : Math.ceil(filtered.length / (pageSize as number));
  const paginated = useMemo(
    () =>
      pageSize === "all"
        ? filtered
        : filtered.slice((page - 1) * (pageSize as number), page * (pageSize as number)),
    [filtered, page, pageSize],
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "reporting_year" || key === "scope_1" || key === "scope_2" || key === "scope_3" || key === "total" ? "desc" : "asc"); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="ml-1 h-3 w-3 text-blue-600" /> : <ChevronDown className="ml-1 h-3 w-3 text-blue-600" />;
  }

  const Th = ({ col, label, right }: { col: SortKey; label: string; right?: boolean }) => (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 select-none cursor-pointer hover:text-slate-800 whitespace-nowrap ${right ? "text-right" : "text-left"}`}
      onClick={() => handleSort(col)}
    >
      <span className="inline-flex items-center justify-end gap-0">
        {!right && <>{label}<SortIcon col={col} /></>}
        {right && <><SortIcon col={col} />{label}</>}
      </span>
    </th>
  );

  const PageNav = ({ compact }: { compact?: boolean }) => {
    if (pageSize === "all" || totalPages <= 1) return null;
    return (
      <div className={`flex items-center gap-1 ${compact ? "" : "gap-2"}`}>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(1)} disabled={page === 1}>
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[90px] text-center text-xs text-slate-600">
          Page {page} of {totalPages}
        </span>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {/* ── Header bar ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">Emissions by Job</h3>
        {!loading && missingCount > 0 && (
          <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
            {missingCount} missing data
          </span>
        )}
        <div className="flex-1" />
        {/* Page size */}
        <Select
          value={String(pageSize)}
          onValueChange={v => { setPageSize(v === "all" ? "all" : (Number(v) as PageSize)); setPage(1); }}
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="50">50 per page</SelectItem>
            <SelectItem value="150">150 per page</SelectItem>
            <SelectItem value="200">200 per page</SelectItem>
            <SelectItem value="all">Show all</SelectItem>
          </SelectContent>
        </Select>
        {/* Search */}
        <div className="relative w-60">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-8 pl-8 pr-7 text-xs"
            placeholder="Search client, job, title…"
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

      {/* ── Filter pills ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
        <Pill active={missingOnly} onClick={() => setMissingOnly(v => !v)} variant="warning">
          Missing data only
        </Pill>
        <div className="h-4 w-px bg-slate-200" />
        {/* Year pills */}
        <Pill active={yearFilter === null} onClick={() => setYearFilter(null)}>All years</Pill>
        {availableYears.map(y => (
          <Pill key={y} active={yearFilter === y} onClick={() => setYearFilter(yearFilter === y ? null : y)}>
            {y}
          </Pill>
        ))}
        {/* Status pills */}
        {availableStatuses.length > 1 && (
          <>
            <div className="h-4 w-px bg-slate-200" />
            <Pill active={statusFilter === null} onClick={() => setStatusFilter(null)} variant="dark">All</Pill>
            {availableStatuses.map(s => (
              <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(statusFilter === s ? null : s)} variant="dark">
                {s}
              </Pill>
            ))}
          </>
        )}
        <div className="ml-auto text-xs text-slate-400">
          {loading ? "Loading…" : `${filtered.length} of ${rows.length} jobs`}
        </div>
      </div>

      {/* ── Top pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
          <span className="text-xs text-slate-400">
            Showing {(page - 1) * (pageSize as number) + 1}–{Math.min(page * (pageSize as number), filtered.length)} of {filtered.length}
          </span>
          <PageNav compact />
        </div>
      )}

      {/* ── Table ── */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <Th col="client_name" label="Client" />
              <Th col="job_number" label="Job #" />
              <Th col="reporting_year" label="Year" />
              <Th col="status" label="Status" />
              <Th col="scope_1" label="Scope 1" right />
              <Th col="scope_2" label="Scope 2" right />
              <Th col="scope_3" label="Scope 3" right />
              <Th col="total" label="Total tCO₂e" right />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && rows.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : paginated.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-xs text-slate-400">No matching jobs.</td></tr>
            ) : (
              paginated.map(row => {
                const missing = missingData(row);
                return (
                  <tr key={row.job_id} className={`hover:bg-slate-50 ${missing ? "bg-amber-50/40" : ""}`}>
                    <td className="max-w-[200px] truncate px-3 py-2.5 text-sm font-medium text-slate-800" title={row.client_name}>
                      {row.client_name || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <a href={`/jobs/${row.job_id}`} className="font-mono text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                        {row.job_number || `#${row.job_id}`}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{row.reporting_year ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        row.status === "Completed" ? "bg-emerald-100 text-emerald-800" :
                        row.status === "Active" ? "bg-blue-100 text-blue-800" :
                        row.status === "Open" ? "bg-sky-100 text-sky-800" :
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
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${missing ? "text-amber-500" : "text-slate-800"}`}>
                      {missing ? "No data" : fmtScope(row.total)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Bottom pagination + totals ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-2">
        <div className="flex gap-4 text-xs font-semibold text-slate-600">
          {!loading && filtered.length > 0 && (
            <>
              <span>S1: {formatEmissions(filtered.reduce((s, r) => s + r.scope_1, 0), { decimals: 1 })}</span>
              <span>S2: {formatEmissions(filtered.reduce((s, r) => s + r.scope_2, 0), { decimals: 1 })}</span>
              <span>S3: {formatEmissions(filtered.reduce((s, r) => s + r.scope_3, 0), { decimals: 1 })}</span>
              <span className="text-slate-800">Total: {formatEmissions(filtered.reduce((s, r) => s + r.total, 0), { decimals: 1 })} tCO₂e</span>
            </>
          )}
        </div>
        <PageNav />
      </div>
    </div>
  );
}
