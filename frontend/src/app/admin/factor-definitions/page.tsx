"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

type FactorDefinition = {
  factor_id: number;
  scope: string | null;
  category: string | null;
  level_1: string | null;
  level_2: string | null;
  level_3: string | null;
  level_4: string | null;
  uom: string | null;
  ghg_unit: string | null;
  report_label: string | null;
  source: string | null;
  region: string | null;
  method: string | null;
  archived: boolean;
  archived_at: string | null;
  year_value_count: number;
};

type ListResponse = {
  items: FactorDefinition[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
  scopes: string[];
  sources: string[];
};

const EMPTY_FORM: Partial<FactorDefinition> = {
  scope: "",
  category: "",
  level_1: "",
  level_2: "",
  level_3: "",
  level_4: "",
  uom: "",
  ghg_unit: "",
  report_label: "",
  source: "",
  region: "",
  method: "",
};

export default function FactorDefinitionsPage() {
  const confirm = useConfirmDialog();

  const [items, setItems] = useState<FactorDefinition[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [scopes, setScopes] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);

  const [q, setQ] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [archivedFilter, setArchivedFilter] = useState("false");

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<FactorDefinition | null>(null);
  const [editForm, setEditForm] = useState<Partial<FactorDefinition>>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (p: number = page) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          per_page: "50",
          archived: archivedFilter,
        });
        if (q) params.set("q", q);
        if (scopeFilter !== "all") params.set("scope", scopeFilter);
        if (sourceFilter !== "all") params.set("source", sourceFilter);

        const res = await fetch(`/api/backend/admin/factor-definitions?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ListResponse = await res.json();
        setItems(data.items);
        setTotal(data.total);
        setPage(data.page);
        setPages(data.pages);
        if (data.scopes.length) setScopes(data.scopes);
        if (data.sources.length) setSources(data.sources);
      } catch (e) {
        setStatus({ msg: String(e), ok: false });
      } finally {
        setLoading(false);
      }
    },
    [q, scopeFilter, sourceFilter, archivedFilter, page]
  );

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeFilter, sourceFilter, archivedFilter]);

  function openEdit(item: FactorDefinition) {
    setEditItem(item);
    setEditForm({
      scope: item.scope ?? "",
      category: item.category ?? "",
      level_1: item.level_1 ?? "",
      level_2: item.level_2 ?? "",
      level_3: item.level_3 ?? "",
      level_4: item.level_4 ?? "",
      uom: item.uom ?? "",
      ghg_unit: item.ghg_unit ?? "",
      report_label: item.report_label ?? "",
      source: item.source ?? "",
      region: item.region ?? "",
      method: item.method ?? "",
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editItem) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/backend/admin/factor-definitions/${editItem.factor_id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setStatus({ msg: "Definition updated.", ok: true });
      setEditOpen(false);
      load(page);
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(item: FactorDefinition) {
    const willArchive = !item.archived;
    const confirmed = await confirm({
      title: willArchive ? "Archive factor definition?" : "Restore factor definition?",
      description: willArchive
        ? `Factor ${item.factor_id} will be marked archived. It won't be deleted.`
        : `Factor ${item.factor_id} will be restored and become active again.`,
      confirmLabel: willArchive ? "Archive" : "Restore",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(
        `/api/backend/admin/factor-definitions/${item.factor_id}/archive`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: willArchive }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus({ msg: willArchive ? "Archived." : "Restored.", ok: true });
      load(page);
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
    }
  }

  function field(label: string, key: keyof FactorDefinition) {
    return (
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input
          value={(editForm[key] as string) ?? ""}
          onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Factor Definitions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit descriptions that apply across all datasets and years. Changes to Category,
            Levels, and Report Label propagate immediately via the v_factor_lookup view.
          </p>
        </div>

        {status && (
          <div
            className={`mb-4 rounded-md px-4 py-2 text-sm ${
              status.ok
                ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            {status.msg}
          </div>
        )}

        {/* Filters */}
        <Card className="mb-4">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-1 gap-2">
                <Input
                  placeholder="Search report label, category, level 1..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load(1)}
                  className="min-w-64"
                />
                <Button variant="secondary" onClick={() => load(1)}>
                  Search
                </Button>
              </div>

              <Select value={scopeFilter} onValueChange={setScopeFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All scopes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All scopes</SelectItem>
                  {scopes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {sources.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={archivedFilter} onValueChange={setArchivedFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Active only</SelectItem>
                  <SelectItem value="true">Archived only</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {loading ? "Loading..." : `${total.toLocaleString()} definitions`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">ID</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Scope</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Category</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Level 1 › 2</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">UoM</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Report Label</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Source</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Values</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr key={item.factor_id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 text-muted-foreground">{item.factor_id}</td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className="text-xs">
                          {item.scope ?? "—"}
                        </Badge>
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-2" title={item.category ?? ""}>
                        {item.category || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2" title={[item.level_1, item.level_2].filter(Boolean).join(" › ")}>
                        {[item.level_1, item.level_2].filter(Boolean).join(" › ") || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{item.uom ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-4 py-2" title={item.report_label ?? ""}>
                        {item.report_label || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{item.source || "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {item.year_value_count}
                      </td>
                      <td className="px-4 py-2">
                        {item.archived ? (
                          <Badge variant="secondary" className="text-xs">Archived</Badge>
                        ) : (
                          <Badge variant="outline" className="border-green-500 text-xs text-green-600">Active</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(item)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={item.archived ? "text-green-600" : "text-muted-foreground"}
                            onClick={() => toggleArchive(item)}
                          >
                            {item.archived ? "Restore" : "Archive"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && items.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                        No definitions found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  Page {page} of {pages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1 || loading}
                    onClick={() => {
                      const p = page - 1;
                      setPage(p);
                      load(p);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= pages || loading}
                    onClick={() => {
                      const p = page + 1;
                      setPage(p);
                      load(p);
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Edit Definition — ID {editItem?.factor_id}
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                Changes to Category, Levels, and Report Label propagate to all datasets and
                years immediately. Scope, UoM, and GHG Unit affect calculations — edit with care.
              </div>

              <div className="grid grid-cols-2 gap-3">
                {field("Report Label", "report_label")}
                {field("Category", "category")}
                {field("Level 1", "level_1")}
                {field("Level 2", "level_2")}
                {field("Level 3", "level_3")}
                {field("Level 4", "level_4")}
                {field("Source", "source")}
                {field("Region", "region")}
                {field("Method", "method")}
              </div>

              <div className="grid grid-cols-3 gap-3 rounded-md border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                <p className="col-span-3 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Calculation fields — affects how emissions are computed
                </p>
                {field("Scope", "scope")}
                {field("UoM", "uom")}
                {field("GHG Unit", "ghg_unit")}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
