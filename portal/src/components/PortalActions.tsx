"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";

import { Card } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";

// ── Types ────────────────────────────────────────────────────────────────────

type Action = {
  client_action_id: number;
  action_name: string;
  description: string | null;
  action_term: string;
  action_category: string | null;
  scope_focus: string | null;
  is_custom: boolean;
  status: string;
  progress: number;
  target_date: string | null;
  completed_at: string | null;
  owner_contact_id: number | null;
  owner_name: string | null;
};

type Contact = { contact_id: number; full_name: string; job_title: string | null };
type Category = { category_id: number; name: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

// Kanban column order per UX spec §6.4 (Proposed / Approved / In Progress / Verified).
// "cancelled" is a real status but deliberately not a board column — see the
// collapsible section at the bottom of the board.
const STATUS_ORDER = ["open", "approved", "in_progress", "completed"] as const;

const STATUS_LABEL: Record<string, string> = {
  open: "Proposed",
  approved: "Approved",
  in_progress: "In Progress",
  completed: "Verified",
  cancelled: "Cancelled",
};

const STATUS_BADGE_VARIANT: Record<string, BadgeProps["variant"]> = {
  open: "outline",
  approved: "secondary",
  in_progress: "warning",
  completed: "success",
  cancelled: "risk",
};

const NEXT_STATUS: Record<string, string | null> = {
  open: "approved",
  approved: "in_progress",
  in_progress: "completed",
  completed: null,
};

const TERM_LABEL: Record<string, string> = {
  short: "Short term",
  medium: "Medium term",
  long: "Long term",
};

function formatDate(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return raw;
  }
}

// ── Library modal ────────────────────────────────────────────────────────────

type LibraryAction = {
  action_option_id: number;
  action_name: string;
  description: string | null;
  action_term: string;
  action_category: string | null;
  scope_focus: string | null;
  already_added: boolean;
};

const SCOPE_OPTIONS = ["Scope 1", "Scope 2", "Scope 3", "Scope 1 and Scope 2", "All scopes"];
const ALL = "__all__";

function LibraryModal({
  categories,
  onClose,
  onAdded,
}: {
  categories: Category[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [library, setLibrary] = useState<LibraryAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState("");
  const [filterCategory, setFilterCategory] = useState(ALL);
  const [filterScope, setFilterScope] = useState(ALL);
  const [filterTerm, setFilterTerm] = useState(ALL);
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/portal/actions/library")
      .then(r => r.json() as Promise<{ items: LibraryAction[] }>)
      .then(d => setLibrary(d.items ?? []))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = library.filter(a => {
    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase();
      if (!a.action_name.toLowerCase().includes(q) && !(a.description ?? "").toLowerCase().includes(q))
        return false;
    }
    if (filterCategory !== ALL && (a.action_category ?? "").toLowerCase() !== filterCategory.toLowerCase()) return false;
    if (filterScope !== ALL && (a.scope_focus ?? "").toLowerCase() !== filterScope.toLowerCase()) return false;
    if (filterTerm !== ALL && (a.action_term ?? "").toLowerCase() !== filterTerm.toLowerCase()) return false;
    return true;
  });

  const hasFilters = !!(searchQ || filterCategory !== ALL || filterScope !== ALL || filterTerm !== ALL);

  async function handleAdd(optionId: number) {
    setAdding(optionId);
    setError("");
    try {
      const res = await apiFetch("/portal/actions/from-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_option_id: optionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { detail?: string } | null;
        throw new Error(data?.detail || `Error ${res.status}`);
      }
      setLibrary(prev => prev.map(a =>
        a.action_option_id === optionId ? { ...a, already_added: true } : a
      ));
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col p-0">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-border px-6 pb-4 pt-6">
          <DialogHeader className="mb-0">
            <DialogTitle>Action library ({filtered.length})</DialogTitle>
            <DialogDescription>Browse recommended actions and add them to your plan.</DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <Input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by name or description…"
              autoFocus
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map(c => <SelectItem key={c.category_id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterScope} onValueChange={setFilterScope}>
              <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
                <SelectValue placeholder="All scopes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All scopes</SelectItem>
                {SCOPE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterTerm} onValueChange={setFilterTerm}>
              <SelectTrigger className="h-8 w-auto min-w-[10rem] text-xs">
                <SelectValue placeholder="All timeframes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All timeframes</SelectItem>
                <SelectItem value="short">Short term (0–12 months)</SelectItem>
                <SelectItem value="medium">Medium term (1–3 years)</SelectItem>
                <SelectItem value="long">Long term (3+ years)</SelectItem>
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => { setSearchQ(""); setFilterCategory(ALL); setFilterScope(ALL); setFilterTerm(ALL); }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>

        {/* Results */}
        <div className="flex-1 space-y-2.5 overflow-y-auto px-6 py-4">
          {loading ? (
            <SkeletonLoader rows={4} />
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {hasFilters ? "No actions match your filters. Try clearing some." : "No actions in library yet."}
            </p>
          ) : (
            filtered.map(action => (
              <Card
                key={action.action_option_id}
                className={`flex-row items-start gap-3 p-4 ${action.already_added ? "border-status-success/30 bg-status-success/5" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug text-foreground">
                    {action.action_name}
                  </p>
                  {action.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {action.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {action.action_category && <Badge variant="secondary">{action.action_category}</Badge>}
                    {action.scope_focus && <Badge variant="outline">{action.scope_focus}</Badge>}
                    {action.action_term && (
                      <Badge variant="outline">{TERM_LABEL[action.action_term] ?? action.action_term}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 pt-0.5">
                  {action.already_added ? (
                    <Badge variant="success">In plan</Badge>
                  ) : (
                    <Button size="sm" onClick={() => handleAdd(action.action_option_id)} disabled={adding === action.action_option_id}>
                      {adding === action.action_option_id ? "Adding…" : "+ Add"}
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-border px-6 py-4">
          <span className="text-xs text-muted-foreground">
            {filtered.length} action{filtered.length !== 1 ? "s" : ""} shown
          </span>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Update modal ─────────────────────────────────────────────────────────────

function UpdateModal({
  action,
  contacts,
  onClose,
  onSaved,
}: {
  action: Action;
  contacts: Contact[];
  onClose: () => void;
  onSaved: (updated: Action) => void;
}) {
  const [status, setStatus] = useState(action.status);
  const [progress, setProgress] = useState(String(action.progress));
  const [note, setNote] = useState("");
  const [targetDate, setTargetDate] = useState(action.target_date?.slice(0, 10) ?? "");
  const [ownerContactId, setOwnerContactId] = useState(
    action.owner_contact_id ? String(action.owner_contact_id) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = { status, progress: parseInt(progress, 10) || 0 };
      if (note.trim()) body.note = note.trim();
      if (targetDate) body.target_date = targetDate;
      if (ownerContactId) body.owner_contact_id = parseInt(ownerContactId, 10);
      const res = await apiFetch(`/portal/actions/${action.client_action_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Error ${res.status}`);
      }
      const data = await res.json() as { item: Action };
      onSaved(data.item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Auto-set progress to 100 when marking verified
  function handleStatusChange(v: string) {
    setStatus(v);
    if (v === "completed") setProgress("100");
    if (v === "open" && parseInt(progress, 10) === 100) setProgress("0");
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update action</DialogTitle>
          <DialogDescription>{action.action_name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Status</label>
            <Select value={status} onValueChange={handleStatusChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Proposed</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Verified</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Progress — {progress || 0}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={e => setProgress(e.target.value)}
              className="w-full accent-brand"
            />
            <div className="mt-0.5 flex justify-between text-xs text-muted-foreground">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>

          {contacts.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Owner</label>
              <Select value={ownerContactId || "__none__"} onValueChange={(v) => setOwnerContactId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No owner assigned</SelectItem>
                  {contacts.map(c => (
                    <SelectItem key={c.contact_id} value={String(c.contact_id)}>
                      {c.full_name}{c.job_title ? ` (${c.job_title})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Target date</label>
            <Input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Update note (optional)</label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Briefly describe the progress made…"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Action card ───────────────────────────────────────────────────────────────

function ActionCard({
  action,
  contacts,
  onUpdate,
}: {
  action: Action;
  contacts: Contact[];
  onUpdate: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const nextStatus = NEXT_STATUS[action.status] ?? null;

  function handleSaved() {
    setShowModal(false);
    onUpdate();
  }

  async function handleMove() {
    if (!nextStatus) return;
    setMoving(true);
    setError("");
    try {
      const body: Record<string, unknown> = { status: nextStatus };
      if (nextStatus === "completed") body.progress = 100;
      const res = await apiFetch(`/portal/actions/${action.client_action_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      onUpdate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMoving(false);
    }
  }

  return (
    <>
      <Card className="p-4 transition-shadow hover:shadow-md">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug text-foreground">{action.action_name}</h3>
        </div>
        {action.description && (
          <p className="mb-3 line-clamp-2 text-xs leading-snug text-muted-foreground">{action.description}</p>
        )}

        <div className="flex items-center gap-2">
          <Progress value={action.progress} className="flex-1" />
          <span className="w-8 flex-shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
            {action.progress}%
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {action.action_category && <Badge variant="secondary">{action.action_category}</Badge>}
          {action.scope_focus && <Badge variant="outline">{action.scope_focus}</Badge>}
          {action.action_term && (
            <Badge variant="outline">{TERM_LABEL[action.action_term] ?? action.action_term}</Badge>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {action.owner_name && <span>Owner: <span className="font-medium text-foreground">{action.owner_name}</span></span>}
          {action.target_date && <span>Target: {formatDate(action.target_date)}</span>}
          {action.completed_at && <span className="text-status-success">Verified: {formatDate(action.completed_at)}</span>}
        </div>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="flex-1" onClick={() => setShowModal(true)}>
            Details
          </Button>
          {nextStatus && (
            <Button variant="outline" size="sm" className="flex-1" onClick={handleMove} disabled={moving}>
              {moving ? "Moving…" : `→ ${STATUS_LABEL[nextStatus]}`}
            </Button>
          )}
        </div>
      </Card>

      {showModal && (
        <UpdateModal
          action={action}
          contacts={contacts}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

// ── Kanban column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  status,
  actions,
  contacts,
  onUpdate,
}: {
  status: (typeof STATUS_ORDER)[number];
  actions: Action[];
  contacts: Contact[];
  onUpdate: () => void;
}) {
  return (
    <div className="flex min-w-[16rem] flex-1 flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-foreground">{STATUS_LABEL[status]}</h3>
        <Badge variant="outline">{actions.length}</Badge>
      </div>
      <div className="flex flex-col gap-3">
        {actions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No actions here
          </div>
        ) : (
          actions.map(action => (
            <ActionCard key={action.client_action_id} action={action} contacts={contacts} onUpdate={onUpdate} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortalActions() {
  const [actions, setActions] = useState<Action[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);

  const loadActions = useCallback(() => {
    return apiFetch("/portal/actions")
      .then(r => r.json() as Promise<{ items: Action[] }>)
      .then(d => setActions(d.items ?? []))
      .catch(e => setError((e as Error).message));
  }, []);

  useEffect(() => {
    Promise.all([
      loadActions(),
      apiFetch("/portal/actions/contacts")
        .then(r => r.json() as Promise<{ contacts: Contact[] }>)
        .then(d => setContacts(d.contacts ?? []))
        .catch(() => {}),
      apiFetch("/portal/actions/categories")
        .then(r => r.json() as Promise<{ categories: Category[] }>)
        .then(d => setCategories(d.categories ?? []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [loadActions]);

  if (loading) {
    return <SkeletonLoader rows={5} />;
  }

  if (error) {
    return <ErrorPanel description={`Failed to load actions: ${error}`} />;
  }

  const cancelled = actions.filter(a => a.status === "cancelled");

  return (
    <div className="space-y-6">
      {/* Summary + library button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-5">
          {STATUS_ORDER.map(s => (
            <div key={s} className="text-center">
              <div className="text-2xl font-bold text-foreground">{actions.filter(a => a.status === s).length}</div>
              <div className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          {cancelled.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowCancelled(v => !v)}>
              {showCancelled ? "Hide" : "Show"} cancelled ({cancelled.length})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowLibraryModal(true)}>
            Browse library
          </Button>
        </div>
      </div>

      {/* Kanban board */}
      {actions.length === 0 ? (
        <EmptyStatePanel
          title="No actions have been added yet"
          description="Your NZI consultant will add recommended actions, or you can add your own from the library above."
        />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {STATUS_ORDER.map(s => (
            <KanbanColumn
              key={s}
              status={s}
              actions={actions.filter(a => a.status === s)}
              contacts={contacts}
              onUpdate={loadActions}
            />
          ))}
        </div>
      )}

      {/* Cancelled (collapsed by default) */}
      {showCancelled && cancelled.length > 0 && (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Cancelled</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cancelled.map(action => (
              <ActionCard key={action.client_action_id} action={action} contacts={contacts} onUpdate={loadActions} />
            ))}
          </div>
        </div>
      )}

      {showLibraryModal && (
        <LibraryModal
          categories={categories}
          onClose={() => setShowLibraryModal(false)}
          onAdded={() => void loadActions()}
        />
      )}
    </div>
  );
}
