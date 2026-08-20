"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PortalLoginHistoryModal from "@/components/PortalLoginHistoryModal";

type PortalStatusRow = {
  client_db_id: number;
  client_name: string;
  is_enabled: boolean;
  portal_trained: boolean;
  max_users: number | null;
  access_expires_at: string | null;
  active_user_count: number;
  is_currently_active: boolean;
};

type SortKey = "client_name" | "portal_trained" | "is_enabled" | "is_currently_active" | "active_user_count" | "access_expires_at";
type SortDir = "asc" | "desc";
type PageSize = 25 | 50 | 100 | "all";

type Props = { baseUrl: string };

function Dot({ on, title }: { on: boolean; title: string }) {
  return (
    <span
      title={title}
      className={`inline-block h-2.5 w-2.5 rounded-full ${on ? "bg-green-500" : "bg-red-400"}`}
    />
  );
}

function formatExpiry(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return value;
  }
}

export default function PortalsTable({ baseUrl }: Props) {
  const [rows, setRows] = useState<PortalStatusRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("client_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [historyClient, setHistoryClient] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/dashboard/portal-status`, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load portal status (${res.status})`);
      const data = await res.json() as { clients?: PortalStatusRow[] };
      setRows(Array.isArray(data.clients) ? data.clients : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, sortKey, sortDir]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows
      .filter((r) => !q || r.client_name.toLowerCase().includes(q))
      .sort((a, b) => {
        let av: number | string | boolean = a[sortKey] ?? "";
        let bv: number | string | boolean = b[sortKey] ?? "";
        if (typeof av === "string") av = av.toLowerCase();
        if (typeof bv === "string") bv = bv.toLowerCase();
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [rows, search, sortKey, sortDir]);

  const totalPages = pageSize === "all" ? 1 : Math.ceil(filtered.length / (pageSize as number));
  const paginated = useMemo(
    () => (pageSize === "all" ? filtered : filtered.slice((page - 1) * (pageSize as number), page * (pageSize as number))),
    [filtered, page, pageSize],
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
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
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[90px] text-center text-xs text-slate-600">
          Page {page} of {totalPages}
        </span>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
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
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">Client Portals</h3>
        <div className="flex-1" />
        <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(v === "all" ? "all" : (Number(v) as PageSize)); setPage(1); }}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25 per page</SelectItem>
            <SelectItem value="50">50 per page</SelectItem>
            <SelectItem value="100">100 per page</SelectItem>
            <SelectItem value="all">Show all</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative w-60">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input className="h-8 pl-8 pr-7 text-xs" placeholder="Search client…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setSearch("")}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {error ? <div className="px-4 py-2 text-xs text-rose-700">{error}</div> : null}

      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-xs text-slate-400">
        <span>{loading ? "Loading…" : `${filtered.length} of ${rows.length} clients`}</span>
        <PageNav compact />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <Th col="client_name" label="Client" />
              <Th col="portal_trained" label="Portal Trained?" />
              <Th col="is_enabled" label="Access" />
              <Th col="is_currently_active" label="On Portal" />
              <Th col="active_user_count" label="No. of Users" right />
              <Th col="access_expires_at" label="Portal Expiry" />
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">History</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && rows.length === 0 ? (
              <tr><td colSpan={7} className="py-10 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : paginated.length === 0 ? (
              <tr><td colSpan={7} className="py-10 text-center text-xs text-slate-400">No matching clients.</td></tr>
            ) : (
              paginated.map((row) => (
                <tr key={row.client_db_id} className="hover:bg-slate-50">
                  <td className="max-w-[220px] truncate px-3 py-2.5 text-sm font-medium text-slate-800" title={row.client_name}>
                    <a href={`/clients/${row.client_db_id}`} className="text-blue-600 hover:underline">
                      {row.client_name || "—"}
                    </a>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{row.portal_trained ? "Y" : "N"}</td>
                  <td className="px-3 py-2.5"><Dot on={row.is_enabled} title={row.is_enabled ? "Portal access enabled" : "Portal access disabled"} /></td>
                  <td className="px-3 py-2.5"><Dot on={row.is_currently_active} title={row.is_currently_active ? "A client user is currently on the portal" : "No one currently on the portal"} /></td>
                  <td className="px-3 py-2.5 text-right text-xs text-slate-600">
                    {row.active_user_count}{row.max_users != null ? ` / ${row.max_users}` : ""}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{formatExpiry(row.access_expires_at)}</td>
                  <td className="px-3 py-2.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setHistoryClient({ id: row.client_db_id, name: row.client_name })}
                    >
                      History
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-2">
        <PageNav />
      </div>

      <PortalLoginHistoryModal
        baseUrl={baseUrl}
        clientDbId={historyClient?.id ?? null}
        clientName={historyClient?.name}
        open={historyClient != null}
        onOpenChange={(open) => { if (!open) setHistoryClient(null); }}
      />
    </div>
  );
}
