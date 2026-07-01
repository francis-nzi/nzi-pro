"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";

// ── Types ────────────────────────────────────────────────────────────────────

type Action = {
  job_action_id: number;
  job_id: number;
  reporting_year: number | null;
  job_title: string;
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

const STATUS_LABEL: Record<string, string> = {
  open: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLOURS: Record<string, string> = {
  open: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
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

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: "#F26624" }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums text-gray-600 w-8 text-right">{pct}%</span>
    </div>
  );
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
  const [filterCategory, setFilterCategory] = useState("");
  const [filterScope, setFilterScope] = useState("");
  const [filterTerm, setFilterTerm] = useState("");
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
    if (filterCategory && (a.action_category ?? "").toLowerCase() !== filterCategory.toLowerCase()) return false;
    if (filterScope && (a.scope_focus ?? "").toLowerCase() !== filterScope.toLowerCase()) return false;
    if (filterTerm && (a.action_term ?? "").toLowerCase() !== filterTerm.toLowerCase()) return false;
    return true;
  });

  const hasFilters = !!(searchQ || filterCategory || filterScope || filterTerm);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Action library ({filtered.length})
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Browse recommended actions and add them to your plan.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none mt-0.5"
            >
              ✕
            </button>
          </div>

          {/* Search */}
          <div className="mt-4">
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by name or description…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              autoFocus
            />
          </div>

          {/* Filters */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="">All categories</option>
              {categories.map(c => (
                <option key={c.category_id} value={c.name}>{c.name}</option>
              ))}
            </select>

            <select
              value={filterScope}
              onChange={e => setFilterScope(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="">All scopes</option>
              {SCOPE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            <select
              value={filterTerm}
              onChange={e => setFilterTerm(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="">All timeframes</option>
              <option value="short">Short term (0–12 months)</option>
              <option value="medium">Medium term (1–3 years)</option>
              <option value="long">Long term (3+ years)</option>
            </select>

            {hasFilters && (
              <button
                onClick={() => { setSearchQ(""); setFilterCategory(""); setFilterScope(""); setFilterTerm(""); }}
                className="text-xs text-orange-600 hover:text-orange-700 font-medium"
              >
                Clear filters
              </button>
            )}
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading library…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              {hasFilters ? "No actions match your filters. Try clearing some." : "No actions in library yet."}
            </div>
          ) : (
            filtered.map(action => (
              <div
                key={action.action_option_id}
                className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${
                  action.already_added ? "border-green-200 bg-green-50/40" : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 leading-snug">
                    {action.action_name}
                  </p>
                  {action.description && (
                    <p className="mt-0.5 text-xs text-gray-500 leading-snug line-clamp-2">
                      {action.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {action.action_category && (
                      <span className="inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                        {action.action_category}
                      </span>
                    )}
                    {action.scope_focus && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {action.scope_focus}
                      </span>
                    )}
                    {action.action_term && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {TERM_LABEL[action.action_term] ?? action.action_term}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 pt-0.5">
                  {action.already_added ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1.5 text-xs font-medium text-green-700">
                      ✓ In plan
                    </span>
                  ) : (
                    <button
                      onClick={() => handleAdd(action.action_option_id)}
                      disabled={adding === action.action_option_id}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                      style={{ backgroundColor: "#F26624" }}
                    >
                      {adding === action.action_option_id ? "Adding…" : "+ Add"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-gray-400">
            {filtered.length} action{filtered.length !== 1 ? "s" : ""} shown
          </span>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
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
      const res = await apiFetch(`/portal/actions/${action.job_action_id}`, {
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

  // Auto-set progress to 100 when marking complete
  function handleStatusChange(v: string) {
    setStatus(v);
    if (v === "completed") setProgress("100");
    if (v === "open" && parseInt(progress, 10) === 100) setProgress("0");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Update action</h2>
          <p className="mt-0.5 text-sm text-gray-500 leading-snug">{action.action_name}</p>
        </div>
        <div className="px-6 py-4 space-y-4">
          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={status}
              onChange={e => handleStatusChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="open">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Progress */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Progress — {progress || 0}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={e => setProgress(e.target.value)}
              className="w-full accent-orange-500"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-0.5">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>

          {/* Owner */}
          {contacts.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
              <select
                value={ownerContactId}
                onChange={e => setOwnerContactId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option value="">No owner assigned</option>
                {contacts.map(c => (
                  <option key={c.contact_id} value={String(c.contact_id)}>
                    {c.full_name}{c.job_title ? ` (${c.job_title})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Target date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target date</label>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Update note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Briefly describe the progress made…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="px-6 pb-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#F26624" }}
          >
            {saving ? "Saving…" : "Save update"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add action modal ──────────────────────────────────────────────────────────

function AddActionModal({
  contacts,
  categories,
  onClose,
  onSaved,
}: {
  contacts: Contact[];
  categories: Category[];
  onClose: () => void;
  onSaved: (action: Action) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [term, setTerm] = useState("medium");
  const [scopeFocus, setScopeFocus] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [ownerContactId, setOwnerContactId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!name.trim()) { setError("Action name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        action_name: name.trim(),
        action_term: term,
      };
      if (description.trim()) body.description = description.trim();
      if (category) body.action_category = category;
      if (scopeFocus) body.scope_focus = scopeFocus;
      if (targetDate) body.target_date = targetDate;
      if (ownerContactId) body.owner_contact_id = parseInt(ownerContactId, 10);

      const res = await apiFetch("/portal/actions", {
        method: "POST",
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Add new action</h2>
          <p className="mt-0.5 text-sm text-gray-500">This will be visible to your NZI consultant.</p>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Action name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Switch to renewable electricity tariff"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional details about this action…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option value="">Select…</option>
                {categories.map(c => (
                  <option key={c.category_id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timeframe</label>
              <select
                value={term}
                onChange={e => setTerm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option value="short">Short term (0–12 months)</option>
                <option value="medium">Medium term (1–3 years)</option>
                <option value="long">Long term (3+ years)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scope focus</label>
              <select
                value={scopeFocus}
                onChange={e => setScopeFocus(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option value="">Select…</option>
                <option>Scope 1</option>
                <option>Scope 2</option>
                <option>Scope 3</option>
                <option>Scope 1 and Scope 2</option>
                <option>All scopes</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target date</label>
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
          </div>
          {contacts.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
              <select
                value={ownerContactId}
                onChange={e => setOwnerContactId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                <option value="">No owner assigned</option>
                {contacts.map(c => (
                  <option key={c.contact_id} value={String(c.contact_id)}>
                    {c.full_name}{c.job_title ? ` (${c.job_title})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="px-6 pb-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#F26624" }}
          >
            {saving ? "Saving…" : "Add action"}
          </button>
        </div>
      </div>
    </div>
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

  function handleSaved(updated: Action) {
    setShowModal(false);
    onUpdate();
  }

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 leading-snug">{action.action_name}</h3>
            {action.description && (
              <p className="mt-1 text-sm text-gray-500 leading-snug line-clamp-2">{action.description}</p>
            )}
          </div>
          <span className={`flex-shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOURS[action.status] ?? STATUS_COLOURS.open}`}>
            {STATUS_LABEL[action.status] ?? action.status}
          </span>
        </div>

        <ProgressBar value={action.progress} />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {action.action_category && (
            <span className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-700">
              {action.action_category}
            </span>
          )}
          {action.scope_focus && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
              {action.scope_focus}
            </span>
          )}
          {action.action_term && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
              {TERM_LABEL[action.action_term] ?? action.action_term}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-400">
          <div className="flex items-center gap-3">
            {action.owner_name && (
              <span>Owner: <span className="text-gray-600 font-medium">{action.owner_name}</span></span>
            )}
            {action.target_date && (
              <span>Target: <span className="text-gray-600">{formatDate(action.target_date)}</span></span>
            )}
            {action.completed_at && (
              <span>Completed: <span className="text-green-600">{formatDate(action.completed_at)}</span></span>
            )}
          </div>
          {action.status !== "cancelled" && (
            <button
              onClick={() => setShowModal(true)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Update
            </button>
          )}
        </div>
      </div>

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

// ── Main component ────────────────────────────────────────────────────────────

type FilterKey = "all" | "open" | "in_progress" | "completed";

export default function PortalActions() {
  const [actions, setActions] = useState<Action[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);

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

  const openCount = actions.filter(a => a.status === "open").length;
  const inProgressCount = actions.filter(a => a.status === "in_progress").length;
  const completedCount = actions.filter(a => a.status === "completed").length;

  const filtered = filter === "all"
    ? actions.filter(a => a.status !== "cancelled")
    : actions.filter(a => a.status === filter);

  if (loading) {
    return <div className="py-10 text-center text-sm text-gray-400">Loading actions…</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load actions: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary + Add button */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{openCount}</div>
            <div className="text-xs text-gray-500">Not started</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{inProgressCount}</div>
            <div className="text-xs text-gray-500">In progress</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{completedCount}</div>
            <div className="text-xs text-gray-500">Completed</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowLibraryModal(true)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Browse library
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: "#F26624" }}
          >
            + Add action
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-gray-200">
        {(["all", "open", "in_progress", "completed"] as FilterKey[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${filter === f ? "border-b-2 border-orange-500 text-orange-600" : "text-gray-500 hover:text-gray-700"}`}
          >
            {f === "all" ? "All" : f === "open" ? "Not started" : f === "in_progress" ? "In progress" : "Completed"}
          </button>
        ))}
      </div>

      {/* Action list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">
          {actions.length === 0
            ? "No actions have been added yet. Your NZI consultant will add recommended actions, or you can add your own above."
            : "No actions match this filter."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(action => (
            <ActionCard
              key={action.job_action_id}
              action={action}
              contacts={contacts}
              onUpdate={loadActions}
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddActionModal
          contacts={contacts}
          categories={categories}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); void loadActions(); }}
        />
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
