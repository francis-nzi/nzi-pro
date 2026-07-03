"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type HistoryItem = {
  audit_id: number;
  created_at: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  diff: Record<string, { before: unknown; after: unknown }> | null;
  section: string | null;
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatAbsoluteTime(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function actionBadgeClass(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("create") || a.includes("insert") || a.includes("add")) {
    return "bg-emerald-100 text-emerald-800";
  }
  if (a.includes("delete") || a.includes("remove") || a.includes("deactivate")) {
    return "bg-red-100 text-red-800";
  }
  if (a.includes("import") || a.includes("upload") || a.includes("sync") || a.includes("rollforward")) {
    return "bg-blue-100 text-blue-800";
  }
  return "bg-slate-100 text-slate-700";
}

function actionLabel(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function DiffTable({ diff }: { diff: Record<string, { before: unknown; after: unknown }> }) {
  const entries = Object.entries(diff).filter(([key]) => !["updated_at", "created_at"].includes(key));
  if (entries.length === 0) return null;
  return (
    <table className="mt-1 w-full text-[11px] border rounded overflow-hidden">
      <thead className="bg-muted/60">
        <tr>
          <th className="p-1 text-left font-medium text-muted-foreground w-1/3">Field</th>
          <th className="p-1 text-left font-medium text-muted-foreground w-1/3">Before</th>
          <th className="p-1 text-left font-medium text-muted-foreground w-1/3">After</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, { before, after }]) => (
          <tr key={key} className="border-t">
            <td className="p-1 text-muted-foreground">{key.replace(/_/g, " ")}</td>
            <td className="p-1 text-red-700 line-through">{before != null ? String(before) : "—"}</td>
            <td className="p-1 text-emerald-700">{after != null ? String(after) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Props = {
  jobId: number;
  baseUrl: string;
  entityType?: string;
  label?: string;
};

export default function ActivityHistoryModal({ jobId, baseUrl, entityType, label = "History" }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(newOffset) });
      if (entityType) params.set("entity_type", entityType);
      const res = await fetch(`${baseUrl}/jobs/${jobId}/history?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(data?.total ?? 0);
      setOffset(newOffset);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId, entityType]);

  function handleOpen() {
    setOpen(true);
    setItems([]);
    setOffset(0);
    void load(0);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={handleOpen}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Activity History{entityType ? ` — ${entityType.replace(/_/g, " ")}` : ""}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-0 min-h-0">
            {loading && items.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No activity recorded yet.</div>
            ) : (
              <div className="divide-y">
                {items.map((item) => (
                  <div key={item.audit_id} className="py-3 px-1 space-y-1">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className={`inline-flex shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${actionBadgeClass(item.action)}`}>
                        {actionLabel(item.action)}
                      </span>
                      <span className="text-sm font-medium truncate">{item.actor_name || item.actor_email || "System"}</span>
                      {item.actor_name && item.actor_email ? (
                        <span className="text-xs text-muted-foreground">({item.actor_email})</span>
                      ) : null}
                      <span
                        className="ml-auto shrink-0 text-xs text-muted-foreground"
                        title={formatAbsoluteTime(item.created_at)}
                      >
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>
                    {item.entity_id ? (
                      <div className="text-xs text-muted-foreground">
                        {item.entity_type.replace(/_/g, " ")} #{item.entity_id}
                        {item.section ? ` · ${item.section}` : ""}
                      </div>
                    ) : null}
                    {item.diff && Object.keys(item.diff).length > 0 ? (
                      <DiffTable diff={item.diff} />
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {total > LIMIT ? (
            <div className="flex items-center justify-between border-t pt-3 text-sm text-muted-foreground shrink-0">
              <span>{total} total events</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0 || loading}
                  onClick={() => load(Math.max(0, offset - LIMIT))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + LIMIT >= total || loading}
                  onClick={() => load(offset + LIMIT)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : total > 0 ? (
            <div className="border-t pt-2 text-xs text-muted-foreground shrink-0">{total} event{total !== 1 ? "s" : ""}</div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
