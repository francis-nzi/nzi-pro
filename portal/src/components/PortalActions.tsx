"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Info, X } from "lucide-react";
import { apiFetch } from "@/lib/auth";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";
import ActionLeverGrid, { type ActionLeverSummary } from "@/components/ActionLeverGrid";
import LeverSelect, { type LeverOption } from "@/components/LeverSelect";

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
  lever_id: number | null;
  lever_code?: string | null;
  lever_name?: string | null;
};

type Contact = { contact_id: number; full_name: string; job_title: string | null };
type Category = { category_id: number; name: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_ORDER = ["open", "approved", "in_progress", "completed"] as const;

const STATUS_LABEL: Record<string, string> = {
  open: "Proposed",
  approved: "Approved",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Distinct colour per status -- explicit classes rather than the generic
// Badge variants, since "outline"/"secondary" read as the same neutral grey
// and gave no visual distinction between Proposed and Approved.
const STATUS_PILL_CLASS: Record<string, string> = {
  open: "border-slate-300 bg-slate-100 text-slate-700",
  approved: "border-blue-400 bg-blue-50 text-blue-700",
  in_progress: "border-amber-400 bg-amber-50 text-amber-700",
  completed: "border-green-400 bg-green-50 text-green-700",
  cancelled: "border-rose-400 bg-rose-50 text-rose-700",
};

const TERM_LABEL: Record<string, string> = {
  short: "Short term",
  medium: "Medium term",
  long: "Long term",
};

// Matches PLANNED_INITIATIVES_TERM_META in JobAdvancedReports.tsx (the CRM's
// Report Printing "Planned Initiatives" table) so the single-letter term
// pill looks identical across both the CRM and the portal.
const TERM_PILL_META: Record<string, { label: string; className: string }> = {
  short: { label: "S", className: "border-green-400 bg-green-50 text-green-700" },
  medium: { label: "M", className: "border-amber-400 bg-amber-50 text-amber-700" },
  long: { label: "L", className: "border-sky-400 bg-sky-50 text-sky-700" },
};

const SCOPE_OPTIONS = ["Scope 1", "Scope 2", "Scope 3", "Scope 1 and Scope 2", "All scopes"];
const ALL = "__all__";
const NO_OWNER = "__none__";
const UNCATEGORIZED = "Uncategorized";

function formatDate(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return raw;
  }
}

// Status -> completed auto-sets progress to 100; moving off completed from
// 100 resets to 0 -- shared between the inline Status cell and the modal so
// both editing surfaces behave identically.
function deriveProgressForStatusChange(newStatus: string, currentProgress: number): number {
  if (newStatus === "completed") return 100;
  if (currentProgress === 100) return 0;
  return currentProgress;
}

// ── Library modal (unchanged) ───────────────────────────────────────────────

type LibraryAction = {
  action_option_id: number;
  action_name: string;
  description: string | null;
  action_term: string;
  action_category: string | null;
  scope_focus: string | null;
  already_added: boolean;
};

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

// ── Update modal (widened, now the full editor) ─────────────────────────────

function UpdateModal({
  action,
  contacts,
  categories,
  levers,
  onClose,
  onSaved,
}: {
  action: Action;
  contacts: Contact[];
  categories: Category[];
  levers: LeverOption[];
  onClose: () => void;
  onSaved: (updated: Action) => void;
}) {
  const [actionName, setActionName] = useState(action.action_name);
  const [description, setDescription] = useState(action.description ?? "");
  const [category, setCategory] = useState(action.action_category ?? "");
  const [scopeFocus, setScopeFocus] = useState(action.scope_focus ?? "");
  const [term, setTerm] = useState(action.action_term);
  const [status, setStatus] = useState(action.status);
  const [progress, setProgress] = useState(String(action.progress));
  const [note, setNote] = useState("");
  const [targetDate, setTargetDate] = useState(action.target_date?.slice(0, 10) ?? "");
  const [ownerContactId, setOwnerContactId] = useState(
    action.owner_contact_id ? String(action.owner_contact_id) : ""
  );
  const [leverId, setLeverId] = useState<number | null>(action.lever_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!actionName.trim()) {
      setError("Title is required.");
      return;
    }
    if (!leverId) {
      setError("Action lever is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        action_name: actionName.trim(),
        description: description.trim() || null,
        action_category: category.trim() || null,
        scope_focus: scopeFocus.trim() || null,
        action_term: term,
        status,
        progress: parseInt(progress, 10) || 0,
        lever_id: leverId,
      };
      if (note.trim()) body.note = note.trim();
      if (targetDate) body.target_date = targetDate;
      if (ownerContactId) body.owner_contact_id = parseInt(ownerContactId, 10);
      const res = await apiFetch(`/portal/actions/${action.client_action_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { detail?: string } | null;
        throw new Error(data?.detail || `Error ${res.status}`);
      }
      const data = await res.json() as { item: Action };
      onSaved(data.item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleStatusChange(v: string) {
    setStatus(v);
    setProgress(String(deriveProgressForStatusChange(v, parseInt(progress, 10) || 0)));
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Update action</DialogTitle>
          <DialogDescription>Full details for this action — the table shows a quick summary.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">Title</label>
            <Input value={actionName} onChange={e => setActionName(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Category</label>
            <Input
              value={category}
              onChange={e => setCategory(e.target.value)}
              list="portal-action-categories"
              placeholder="e.g. Fleet, Energy…"
            />
            <datalist id="portal-action-categories">
              {categories.map(c => <option key={c.category_id} value={c.name} />)}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Scope</label>
            <Select value={scopeFocus || NO_OWNER} onValueChange={(v) => setScopeFocus(v === NO_OWNER ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="No scope set" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OWNER}>No scope set</SelectItem>
                {SCOPE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Term</label>
            <Select value={term} onValueChange={setTerm}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Short term</SelectItem>
                <SelectItem value="medium">Medium term</SelectItem>
                <SelectItem value="long">Long term</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Status</label>
            <Select value={status} onValueChange={handleStatusChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Proposed</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
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
              <Select value={ownerContactId || NO_OWNER} onValueChange={(v) => setOwnerContactId(v === NO_OWNER ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>No owner assigned</SelectItem>
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

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">
              Action lever <span className="text-destructive">*</span>
            </label>
            <LeverSelect value={leverId} options={levers} onValueChange={setLeverId} ariaInvalid={!leverId} />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">Update note (optional)</label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Briefly describe the progress made…"
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

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

// ── Add custom action modal ─────────────────────────────────────────────────

function AddActionModal({
  contacts,
  categories,
  levers,
  onClose,
  onAdded,
}: {
  contacts: Contact[];
  categories: Category[];
  levers: LeverOption[];
  onClose: () => void;
  onAdded: (created: Action) => void;
}) {
  const [actionName, setActionName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [scopeFocus, setScopeFocus] = useState("");
  const [term, setTerm] = useState("medium");
  const [targetDate, setTargetDate] = useState("");
  const [ownerContactId, setOwnerContactId] = useState("");
  const [leverId, setLeverId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!actionName.trim()) {
      setError("Title is required.");
      return;
    }
    if (!leverId) {
      setError("Action lever is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        action_name: actionName.trim(),
        description: description.trim() || null,
        action_category: category.trim() || null,
        scope_focus: scopeFocus.trim() || null,
        action_term: term,
        lever_id: leverId,
      };
      if (targetDate) body.target_date = targetDate;
      if (ownerContactId) body.owner_contact_id = parseInt(ownerContactId, 10);
      const res = await apiFetch("/portal/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { detail?: string } | null;
        throw new Error(data?.detail || `Error ${res.status}`);
      }
      const data = await res.json() as { item: Action };
      onAdded(data.item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a custom action</DialogTitle>
          <DialogDescription>Add your own action to the shared plan, outside the suggested library.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">Title</label>
            <Input value={actionName} onChange={e => setActionName(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Category</label>
            <Input
              value={category}
              onChange={e => setCategory(e.target.value)}
              list="portal-action-categories"
              placeholder="e.g. Fleet, Energy…"
            />
            <datalist id="portal-action-categories">
              {categories.map(c => <option key={c.category_id} value={c.name} />)}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Scope</label>
            <Select value={scopeFocus || NO_OWNER} onValueChange={(v) => setScopeFocus(v === NO_OWNER ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="No scope set" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OWNER}>No scope set</SelectItem>
                {SCOPE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Term</label>
            <Select value={term} onValueChange={setTerm}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Short term</SelectItem>
                <SelectItem value="medium">Medium term</SelectItem>
                <SelectItem value="long">Long term</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {contacts.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Owner</label>
              <Select value={ownerContactId || NO_OWNER} onValueChange={(v) => setOwnerContactId(v === NO_OWNER ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>No owner assigned</SelectItem>
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

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">
              Action lever <span className="text-destructive">*</span>
            </label>
            <LeverSelect value={leverId} options={levers} onValueChange={setLeverId} ariaInvalid={!leverId} />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Adding…" : "Add action"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Inline progress slider ──────────────────────────────────────────────────

// Read-only -- editing progress happens in the Update modal only; this just
// mirrors the current value so the table stays glanceable.
function ProgressDisplay({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <Progress value={value} className="w-20 flex-shrink-0" />
      <span className="w-8 flex-shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
        {value}%
      </span>
    </div>
  );
}

// ── Description info popover ────────────────────────────────────────────────

// A native `title` attribute only shows on hover, which does nothing on
// click/touch -- this is a small self-contained click-toggled popover
// instead (no tooltip/popover primitive is installed in the portal yet).
function DescriptionInfo({ description }: { description: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close (rather than try to re-track position) on scroll -- simpler and
  // avoids the popover drifting away from the icon while the page moves.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [open]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const popoverWidth = 256; // w-64
      setCoords({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8)),
      });
    }
    setOpen(v => !v);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="text-muted-foreground hover:text-foreground"
        onClick={toggle}
        aria-label="Show description"
      >
        <Info className="mx-auto h-4 w-4" />
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <>
          {/* Portal to <body> -- a table row inside a rounded, overflow-hidden
              category section clips any absolutely-positioned popover that
              would extend past the section's own edge (or the page scrolls
              the row away from where the popover was drawn). Fixed
              positioning at a viewport coordinate captured on open sidesteps
              both problems. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-64 rounded-md border border-border bg-popover p-2.5 text-left text-xs leading-snug text-popover-foreground shadow-md"
            style={{ top: coords.top, left: coords.left }}
          >
            {description}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// ── Action row (table row, inline-editable) ─────────────────────────────────

function ActionRow({
  action,
  index,
  onUpdate,
  onOpenModal,
}: {
  action: Action;
  index: number;
  onUpdate: (fields: Record<string, unknown>) => Promise<boolean>;
  onOpenModal: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(action.action_name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function commit(fields: Record<string, unknown>) {
    setSaving(true);
    setError("");
    const ok = await onUpdate(fields);
    if (!ok) setError("Failed to save");
    setSaving(false);
    return ok;
  }

  async function saveTitle() {
    if (!titleDraft.trim() || titleDraft === action.action_name) {
      setEditingTitle(false);
      setTitleDraft(action.action_name);
      return;
    }
    const ok = await commit({ action_name: titleDraft.trim() });
    if (ok) setEditingTitle(false);
  }

  return (
    <tr className="border-b last:border-0 align-top hover:bg-muted/30">
      <td className="p-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white">
            {index}
          </span>
          {editingTitle ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveTitle();
                  if (e.key === "Escape") { setEditingTitle(false); setTitleDraft(action.action_name); }
                }}
                className="h-7 text-xs"
              />
              <Button size="sm" className="h-7 px-2 text-xs" disabled={saving} onClick={() => void saveTitle()}>
                {saving ? "…" : "Save"}
              </Button>
            </div>
          ) : (
            <button
              className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm font-medium hover:bg-muted"
              onClick={() => setEditingTitle(true)}
              title={action.action_name}
            >
              {action.action_name}
            </button>
          )}
        </div>
      </td>

      <td className="p-2 text-center">
        {action.description ? (
          <DescriptionInfo description={action.description} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      <td className="p-2">
        {(() => {
          const termMeta = TERM_PILL_META[action.action_term];
          return (
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium ${termMeta?.className ?? TERM_PILL_META.medium.className}`}
              title={TERM_LABEL[action.action_term] ?? action.action_term}
            >
              {termMeta?.label ?? (action.action_term || "?").charAt(0).toUpperCase()}
            </span>
          );
        })()}
      </td>

      <td className="p-2">
        <Input
          type="date"
          value={action.target_date?.slice(0, 10) ?? ""}
          onChange={(e) => void commit({ target_date: e.target.value || null })}
          className="h-7 w-full text-xs"
        />
      </td>

      <td className="p-2">
        <Select
          value={action.status}
          onValueChange={(v) => {
            const fields: Record<string, unknown> = { status: v };
            const newProgress = deriveProgressForStatusChange(v, action.progress);
            if (newProgress !== action.progress) fields.progress = newProgress;
            void commit(fields);
          }}
        >
          <SelectTrigger className="h-7 w-full text-xs">
            <SelectValue>
              <Badge variant="outline" className={STATUS_PILL_CLASS[action.status]}>{STATUS_LABEL[action.status]}</Badge>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Proposed</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </td>

      <td className="p-2">
        <ProgressDisplay value={action.progress} />
      </td>

      <td className="p-2 text-center" title={action.owner_name ? `Owner: ${action.owner_name}` : "No owner assigned"}>
        {action.owner_name ? (
          <Check className="mx-auto h-4 w-4 text-status-success" />
        ) : (
          <X className="mx-auto h-4 w-4 text-status-risk" />
        )}
      </td>

      <td className="p-2 text-right">
        <Button variant="ghost" size="sm" onClick={onOpenModal}>Update</Button>
        {error && <div className="mt-1 text-[11px] text-destructive">{error}</div>}
      </td>
    </tr>
  );
}

// ── Category section ─────────────────────────────────────────────────────────

function CategorySection({
  category,
  actions,
  expanded,
  onToggle,
  onUpdate,
  onOpenModal,
}: {
  category: string;
  actions: Action[];
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (actionId: number, fields: Record<string, unknown>) => Promise<boolean>;
  onOpenModal: (action: Action) => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border">
      <button
        className="flex w-full items-center justify-between bg-muted/40 px-3 py-2 text-left hover:bg-muted/60"
        onClick={onToggle}
      >
        <span className="text-sm font-semibold text-foreground">
          {expanded ? "▾" : "▸"} {category}
        </span>
        <Badge variant="outline">{actions.length}</Badge>
      </button>
      {expanded && (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-0 table-fixed text-sm">
            <colgroup>
              <col className="w-56" />
              <col className="w-10" />
              <col className="w-20" />
              <col className="w-36" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-14" />
              <col className="w-16" />
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/20 text-xs text-muted-foreground">
                <th className="p-2 text-left">Title</th>
                <th className="p-2 text-center">Info</th>
                <th className="p-2 text-left">Term</th>
                <th className="p-2 text-left">Target Date</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Progress</th>
                <th className="p-2 text-center">Owner</th>
                <th className="p-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action, idx) => (
                <ActionRow
                  key={action.client_action_id}
                  action={action}
                  index={idx + 1}
                  onUpdate={(fields) => onUpdate(action.client_action_id, fields)}
                  onOpenModal={() => onOpenModal(action)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortalActions() {
  const [actions, setActions] = useState<Action[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [levers, setLevers] = useState<LeverOption[]>([]);
  const [leverSummary, setLeverSummary] = useState<ActionLeverSummary | null>(null);
  const [leverSummaryLoading, setLeverSummaryLoading] = useState(true);
  const [leverFilter, setLeverFilter] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showAddActionModal, setShowAddActionModal] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [editingAction, setEditingAction] = useState<Action | null>(null);
  const [activeTab, setActiveTab] = useState<"actions" | "framework">("actions");
  const [expandedCategories, setExpandedCategories] = useState<Set<string> | null>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const actionsListRef = useRef<HTMLDivElement | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [termFilter, setTermFilter] = useState(ALL);
  const [scopeFilter, setScopeFilter] = useState(ALL);

  const loadActions = useCallback(() => {
    return apiFetch("/portal/actions")
      .then(r => r.json() as Promise<{ items: Action[] }>)
      .then(d => setActions(d.items ?? []))
      .catch(e => setError((e as Error).message));
  }, []);

  const loadLeverSummary = useCallback(() => {
    setLeverSummaryLoading(true);
    return apiFetch("/portal/actions/lever-summary")
      .then(r => r.json() as Promise<ActionLeverSummary>)
      .then(d => setLeverSummary(d))
      .catch(() => {})
      .finally(() => setLeverSummaryLoading(false));
  }, []);

  useEffect(() => {
    Promise.all([
      loadActions(),
      loadLeverSummary(),
      apiFetch("/portal/actions/contacts")
        .then(r => r.json() as Promise<{ contacts: Contact[] }>)
        .then(d => setContacts(d.contacts ?? []))
        .catch(() => {}),
      apiFetch("/portal/actions/categories")
        .then(r => r.json() as Promise<{ categories: Category[] }>)
        .then(d => setCategories(d.categories ?? []))
        .catch(() => {}),
      apiFetch("/portal/actions/levers")
        .then(r => r.json() as Promise<{ items: LeverOption[] }>)
        .then(d => setLevers(d.items ?? []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [loadActions, loadLeverSummary]);

  const updateField = useCallback(async (actionId: number, fields: Record<string, unknown>) => {
    try {
      const res = await apiFetch(`/portal/actions/${actionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) return false;
      const data = await res.json() as { item: Action };
      setActions(prev => prev.map(a => (a.client_action_id === actionId ? data.item : a)));
      return true;
    } catch {
      return false;
    }
  }, []);

  function selectLever(leverId: number) {
    setLeverFilter(prev => (prev === leverId ? null : leverId));
    // Selecting a lever happens from the Framework tab, but the filtered list
    // lives on the Actions tab -- switch over, then scroll once that tab's
    // content has actually mounted.
    setActiveTab("actions");
    requestAnimationFrame(() => {
      actionsListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const filtered = useMemo(() => {
    return actions.filter(a => {
      if (leverFilter != null && a.lever_id !== leverFilter) return false;
      if (!showCancelled && statusFilter === ALL && a.status === "cancelled") return false;
      if (statusFilter !== ALL && a.status !== statusFilter) return false;
      if (termFilter !== ALL && a.action_term !== termFilter) return false;
      if (scopeFilter !== ALL && (a.scope_focus ?? "") !== scopeFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!a.action_name.toLowerCase().includes(q) && !(a.description ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [actions, leverFilter, showCancelled, statusFilter, termFilter, scopeFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Action[]>();
    for (const action of filtered) {
      const key = action.action_category?.trim() || UNCATEGORIZED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(action);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
    return keys.map(key => ({ category: key, actions: map.get(key)! }));
  }, [filtered]);

  // Default: every category collapsed, unless the user has explicitly expanded it.
  const isExpanded = useCallback(
    (category: string) => (expandedCategories ? expandedCategories.has(category) : false),
    [expandedCategories]
  );
  function toggleCategory(category: string) {
    setExpandedCategories(prev => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }
  function expandAll() {
    setExpandedCategories(new Set(grouped.map(g => g.category)));
  }
  function collapseAll() {
    setExpandedCategories(new Set());
  }
  function jumpToCategory(category: string) {
    setExpandedCategories(prev => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      next.add(category);
      return next;
    });
    // Scroll after the section has had a chance to expand/re-render.
    requestAnimationFrame(() => {
      sectionRefs.current.get(category)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const hasFilters = !!(search || statusFilter !== ALL || termFilter !== ALL || scopeFilter !== ALL || leverFilter != null);

  if (loading) {
    return <SkeletonLoader rows={5} />;
  }

  if (error) {
    return <ErrorPanel description={`Failed to load actions: ${error}`} />;
  }

  const cancelledCount = actions.filter(a => a.status === "cancelled").length;

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "actions" | "framework")}>
        <TabsList>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="framework">Action lever framework</TabsTrigger>
        </TabsList>

        <TabsContent value="framework">
          <ActionLeverGrid
            summary={leverSummary}
            loading={leverSummaryLoading}
            selectedLeverId={leverFilter}
            onSelectLever={selectLever}
          />
        </TabsContent>

        <TabsContent value="actions" className="space-y-6">
      {/* Summary + library button */}
      <div ref={actionsListRef} className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-5">
          {STATUS_ORDER.map(s => (
            <div key={s} className="text-center">
              <div className="text-2xl font-bold text-foreground">{actions.filter(a => a.status === s).length}</div>
              <div className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAddActionModal(true)}>
            Add custom action
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowLibraryModal(true)}>
            Browse library
          </Button>
        </div>
      </div>

      {leverFilter != null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Filtered to one action lever.
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setLeverFilter(null)}>
            Clear lever filter
          </Button>
        </div>
      )}

      {/* Filters */}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions…"
            className="h-8 w-56 text-xs"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={termFilter} onValueChange={setTermFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs"><SelectValue placeholder="All terms" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All terms</SelectItem>
              {Object.entries(TERM_LABEL).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs"><SelectValue placeholder="All scopes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All scopes</SelectItem>
              {SCOPE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => { setSearch(""); setStatusFilter(ALL); setTermFilter(ALL); setScopeFilter(ALL); setLeverFilter(null); }}
            >
              Clear filters
            </Button>
          )}
          {cancelledCount > 0 && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setShowCancelled(v => !v)}>
              {showCancelled ? "Hide" : "Show"} cancelled ({cancelledCount})
            </Button>
          )}
        </div>
      )}

      {/* Category sections */}
      {actions.length === 0 ? (
        <EmptyStatePanel
          title="No actions have been added yet"
          description="Your NZI consultant will add recommended actions, or you can add your own from the library above."
        />
      ) : grouped.length === 0 ? (
        <EmptyStatePanel title="No actions match your filters" description="Try clearing some filters above." />
      ) : (
        <>
          {/* Quick nav: jump straight to (and expand) a category */}
          <div className="flex flex-wrap items-center gap-1.5">
            {grouped.map(({ category, actions: groupActions }) => (
              <button
                key={category}
                onClick={() => jumpToCategory(category)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-brand hover:text-foreground"
              >
                {category} <span className="opacity-70">({groupActions.length})</span>
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={expandAll}>Expand all</Button>
            <span className="text-xs text-muted-foreground">·</span>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={collapseAll}>Collapse all</Button>
          </div>

          <div className="space-y-3">
            {grouped.map(({ category, actions: groupActions }) => (
              <div key={category} ref={(el) => { sectionRefs.current.set(category, el); }}>
                <CategorySection
                  category={category}
                  actions={groupActions}
                  expanded={isExpanded(category)}
                  onToggle={() => toggleCategory(category)}
                  onUpdate={updateField}
                  onOpenModal={setEditingAction}
                />
              </div>
            ))}
          </div>
        </>
      )}
        </TabsContent>
      </Tabs>

      {editingAction && (
        <UpdateModal
          action={editingAction}
          contacts={contacts}
          categories={categories}
          levers={levers}
          onClose={() => setEditingAction(null)}
          onSaved={(updated) => {
            setActions(prev => prev.map(a => (a.client_action_id === updated.client_action_id ? updated : a)));
            setEditingAction(null);
            void loadLeverSummary();
          }}
        />
      )}

      {showLibraryModal && (
        <LibraryModal
          categories={categories}
          onClose={() => setShowLibraryModal(false)}
          onAdded={() => { void loadActions(); void loadLeverSummary(); }}
        />
      )}

      {showAddActionModal && (
        <AddActionModal
          contacts={contacts}
          categories={categories}
          levers={levers}
          onClose={() => setShowAddActionModal(false)}
          onAdded={(created) => {
            setActions(prev => [...prev, created]);
            setShowAddActionModal(false);
            void loadLeverSummary();
          }}
        />
      )}
    </div>
  );
}
