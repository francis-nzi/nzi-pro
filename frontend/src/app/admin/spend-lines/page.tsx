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
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

type SpendLine = {
  spend_line_id: number;
  label: string;
  keywords: string | null;
  factor_db_id: number | null;
  dataset_id: number | null;
  original_id: string | null;
  scope: string | null;
  category: string | null;
  report_label: string | null;
  is_active: boolean;
};

type CategoryOption = {
  db_id: number;
  dataset_id: number | null;
  original_id: string | null;
  scope: string | null;
  report_label: string | null;
};

export default function SpendLinesPage() {
  const confirm = useConfirmDialog();

  const [items, setItems] = useState<SpendLine[]>([]);
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<SpendLine | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [keywordsInput, setKeywordsInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryOption | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [searchingCategories, setSearchingCategories] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (includeInactive) params.set("include_inactive", "true");
      const res = await fetch(`/api/backend/admin/spend-lines?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
    } finally {
      setLoading(false);
    }
  }, [q, includeInactive]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  async function searchCategories(text: string) {
    setSearchingCategories(true);
    try {
      const res = await fetch(`/api/backend/admin/spend-lines/category-options?q=${encodeURIComponent(text)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const d = await res.json();
        setCategoryOptions(d.items || []);
      }
    } finally {
      setSearchingCategories(false);
    }
  }

  function openNew() {
    setEditItem(null);
    setLabelInput("");
    setKeywordsInput("");
    setSelectedCategory(null);
    setCategorySearch("");
    setCategoryOptions([]);
    setEditOpen(true);
  }

  function openEdit(item: SpendLine) {
    setEditItem(item);
    setLabelInput(item.label);
    setKeywordsInput(item.keywords || "");
    setSelectedCategory(
      item.factor_db_id
        ? { db_id: item.factor_db_id, dataset_id: item.dataset_id, original_id: item.original_id, scope: item.scope, report_label: item.report_label }
        : null
    );
    setCategorySearch("");
    setCategoryOptions([]);
    setEditOpen(true);
  }

  async function save() {
    if (!labelInput.trim()) {
      setStatus({ msg: "Label is required", ok: false });
      return;
    }
    if (!selectedCategory) {
      setStatus({ msg: "Pick a linked PG&S category", ok: false });
      return;
    }
    setSaving(true);
    try {
      const payload = { label: labelInput.trim(), keywords: keywordsInput.trim(), factor_db_id: selectedCategory.db_id };
      const url = editItem ? `/api/backend/admin/spend-lines/${editItem.spend_line_id}` : "/api/backend/admin/spend-lines";
      const res = await fetch(url, {
        method: editItem ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setStatus({ msg: editItem ? "Spend Line updated." : "Spend Line created.", ok: true });
      setEditOpen(false);
      load();
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: SpendLine) {
    const willDeactivate = item.is_active;
    const confirmed = await confirm({
      title: willDeactivate ? "Deactivate Spend Line?" : "Reactivate Spend Line?",
      description: willDeactivate
        ? `"${item.label}" will no longer be suggested to clients. It won't be deleted.`
        : `"${item.label}" will be suggested to clients again.`,
      confirmLabel: willDeactivate ? "Deactivate" : "Reactivate",
    });
    if (!confirmed) return;

    try {
      const res = willDeactivate
        ? await fetch(`/api/backend/admin/spend-lines/${item.spend_line_id}`, { method: "DELETE", credentials: "include" })
        : await fetch(`/api/backend/admin/spend-lines/${item.spend_line_id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: true }),
          });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus({ msg: willDeactivate ? "Deactivated." : "Reactivated.", ok: true });
      load();
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Spend Lines</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A curated, business-friendly list of Purchased Goods &amp; Services categories, each linked to a real
              factor and tagged with keywords. Powers the &quot;Suggest Spend Line&quot; button clients see when
              categorising a raw GL/ledger line.
            </p>
          </div>
          <Button onClick={openNew}>+ New Spend Line</Button>
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

        <Card className="mb-4">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 gap-2">
                <Input
                  placeholder="Search label or keywords..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load()}
                  className="min-w-64"
                />
                <Button variant="secondary" onClick={() => load()}>
                  Search
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} className="h-4 w-4" />
                Include inactive
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {loading ? "Loading..." : `${items.length} spend line(s)`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Label</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Keywords</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Linked Category</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr key={item.spend_line_id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">{item.label}</td>
                      <td className="max-w-[260px] truncate px-4 py-2 text-muted-foreground" title={item.keywords || ""}>
                        {item.keywords || "—"}
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-2" title={item.report_label || ""}>
                        {item.report_label || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        {item.is_active ? (
                          <Badge variant="outline" className="border-green-500 text-xs text-green-600">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={item.is_active ? "text-muted-foreground" : "text-green-600"}
                            onClick={() => toggleActive(item)}
                          >
                            {item.is_active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No Spend Lines yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editItem ? `Edit — ${editItem.label}` : "New Spend Line"}</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Label</Label>
                <Input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} placeholder="e.g. IT Consultancy" />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Keywords (comma-separated)</Label>
                <Input
                  value={keywordsInput}
                  onChange={(e) => setKeywordsInput(e.target.value)}
                  placeholder="e.g. it, software, consultancy, saas"
                />
                <p className="text-xs text-muted-foreground">
                  Used to match this Spend Line against a client&apos;s GL description/code -- any word overlap counts.
                </p>
              </div>

              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Linked PG&amp;S Category</Label>
                {selectedCategory ? (
                  <div className="rounded-md border p-3 text-sm">
                    <div className="font-medium">{selectedCategory.report_label}</div>
                    <div className="text-xs text-muted-foreground">{selectedCategory.scope}</div>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => setSelectedCategory(null)}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder="Search PG&S categories..."
                      value={categorySearch}
                      onChange={(e) => {
                        setCategorySearch(e.target.value);
                        void searchCategories(e.target.value);
                      }}
                      onFocus={() => {
                        if (categoryOptions.length === 0) void searchCategories("");
                      }}
                    />
                    <div className="max-h-48 overflow-y-auto rounded-md border">
                      {searchingCategories ? (
                        <div className="p-2 text-sm text-muted-foreground">Searching...</div>
                      ) : categoryOptions.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground">No matches.</div>
                      ) : (
                        categoryOptions.map((cat) => (
                          <button
                            key={cat.db_id}
                            className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted"
                            onClick={() => setSelectedCategory(cat)}
                          >
                            <div className="font-medium">{cat.report_label}</div>
                            <div className="text-xs text-muted-foreground">{cat.scope}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
