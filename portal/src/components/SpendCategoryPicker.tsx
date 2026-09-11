"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SpendCategory = {
  db_id: number;
  original_id: string | null;
  scope: string | null;
  category: string | null;
  report_label: string | null;
};

export type QuickPickCategory = {
  db_id: number;
  scope: string | null;
  category: string | null;
  report_label: string | null;
};

export type SuggestedCategory = {
  key: number;
  db_id: number | null;
  label: string;
  category: string | null;
};

type PickerRow = {
  spend_description: string | null;
  reference_code: string | null;
  amount_net: number | null;
  currency: string | null;
  mapped_scope: string | null;
  mapped_category: string | null;
  mapped_report_label: string | null;
};

type Props = {
  row: PickerRow;
  categories: SpendCategory[];
  loading: boolean;
  loadError: string;
  suggested: SuggestedCategory[];
  suggesting: boolean;
  frequentlyUsed: QuickPickCategory[];
  // Resolves to an error message, or null once the category is saved.
  onPick: (category: { db_id: number }) => Promise<string | null>;
  onClose: () => void;
};

// One row in the results list -- a spend category, or a frequently-used
// shortcut to one.
type Option = {
  key: string;
  db_id: number;
  label: string;
  scope: string | null;
  category: string | null;
  sic: string | null;
};

type Group = {
  key: string;
  title: string;
  scope: string | null;
  frequent: boolean;
  items: Option[];
};

const PGS = "Purchased Goods and Services";
const DEFAULT_SCOPE = "Scope 3";

function scopeOf(c: { scope: string | null }) {
  return c.scope || "Other";
}

function categoryOf(c: { category: string | null }) {
  return c.category || "Uncategorised";
}

// PG&S leads (it's this tab's own category), everything else alphabetical.
function compareCategories(a: string, b: string) {
  if (a === PGS) return b === PGS ? 0 : -1;
  if (b === PGS) return 1;
  return a.localeCompare(b);
}

// "SPEND-SIC-49.3-5-b" -> "49.3-5". The trailing letter only marks which
// category a shared SIC factor was filed under, so it isn't shown.
function sicCode(originalId: string | null) {
  const m = /^SPEND-SIC-(.+)$/i.exec(originalId || "");
  return m ? m[1].replace(/-[a-z]$/i, "") : null;
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) || 0) + 1);
  return counts;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "ig"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

function FilterChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
        !active && count === 0 && "opacity-50"
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] tabular-nums",
            active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function SpendCategoryPicker({
  row,
  categories,
  loading,
  loadError,
  suggested,
  suggesting,
  frequentlyUsed,
  onPick,
  onClose,
}: Props) {
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState(DEFAULT_SCOPE); // "" = all scopes
  const [categoryFilter, setCategoryFilter] = useState(""); // "" = all categories
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [pickError, setPickError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const tokens = useMemo(() => search.toLowerCase().split(/\s+/).filter(Boolean), [search]);

  // Every search word must appear somewhere in the label, category or SIC
  // code, so "land transport business" narrows instead of widening.
  const textMatches = useMemo(() => {
    if (!tokens.length) return categories;
    return categories.filter((c) => {
      const haystack = `${c.report_label || ""} ${c.category || ""} ${sicCode(c.original_id) || ""}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [categories, tokens]);

  const scopeCounts = useMemo(() => countBy(textMatches, scopeOf), [textMatches]);
  const scopes = useMemo(() => Array.from(countBy(categories, scopeOf).keys()).sort(), [categories]);

  const inScope = useMemo(
    () => (scopeFilter ? textMatches.filter((c) => scopeOf(c) === scopeFilter) : textMatches),
    [textMatches, scopeFilter]
  );
  const categoryCounts = useMemo(() => countBy(inScope, categoryOf), [inScope]);
  // Every category the scope holds stays listed (greyed at 0) while
  // searching, so the chip row doesn't reshuffle under the cursor.
  const categoryChips = useMemo(() => {
    const names = new Set(
      categories.filter((c) => !scopeFilter || scopeOf(c) === scopeFilter).map(categoryOf)
    );
    if (categoryFilter) names.add(categoryFilter);
    return Array.from(names).sort(compareCategories);
  }, [categories, scopeFilter, categoryFilter]);

  // Grouped by scope + category, in the same order as the chips, led by
  // this client's frequently-used categories until they start searching or
  // narrow to one category. `flat` is the same order as one list, for
  // arrow-key navigation.
  const { groups, flat, matchCount } = useMemo(() => {
    const visible = categoryFilter ? inScope.filter((c) => categoryOf(c) === categoryFilter) : inScope;
    const byKey = new Map<string, Group>();
    for (const c of visible) {
      const key = `${scopeOf(c)}|${categoryOf(c)}`;
      if (!byKey.has(key)) byKey.set(key, { key, title: categoryOf(c), scope: scopeOf(c), frequent: false, items: [] });
      byKey.get(key)!.items.push({
        key: `c${c.db_id}`,
        db_id: c.db_id,
        label: c.report_label || "Unnamed category",
        scope: c.scope,
        category: c.category,
        sic: sicCode(c.original_id),
      });
    }
    const sorted = Array.from(byKey.values()).sort(
      (a, b) => (a.scope || "").localeCompare(b.scope || "") || compareCategories(a.title, b.title)
    );
    for (const g of sorted) g.items.sort((a, b) => a.label.localeCompare(b.label));

    const frequent = !tokens.length && !categoryFilter
      ? frequentlyUsed.filter((c) => !scopeFilter || scopeOf(c) === scopeFilter)
      : [];
    if (frequent.length) {
      sorted.unshift({
        key: "frequent",
        title: "Frequently used",
        scope: null,
        frequent: true,
        items: frequent.map((c) => ({
          key: `f${c.db_id}`,
          db_id: c.db_id,
          label: c.report_label || "Unnamed category",
          scope: c.scope,
          category: c.category,
          sic: null,
        })),
      });
    }
    return { groups: sorted, flat: sorted.flatMap((g) => g.items), matchCount: visible.length };
  }, [inScope, categoryFilter, tokens, frequentlyUsed, scopeFilter]);

  useEffect(() => setActiveIndex(0), [search, scopeFilter, categoryFilter]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function isCurrent(o: Option) {
    return (
      !!row.mapped_report_label &&
      o.label === row.mapped_report_label &&
      o.category === row.mapped_category &&
      (!row.mapped_scope || o.scope === row.mapped_scope)
    );
  }

  async function pick(category: { db_id: number }) {
    if (pendingId !== null) return;
    setPendingId(category.db_id);
    setPickError("");
    const err = await onPick(category);
    // On success the parent closes (and unmounts) the picker.
    if (err) {
      setPickError(err);
      setPendingId(null);
    }
  }

  function selectScope(scope: string) {
    setScopeFilter(scope);
    setCategoryFilter("");
  }

  function clearFilters() {
    setScopeFilter("");
    setCategoryFilter("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      const target = flat[activeIndex];
      if (target) void pick(target);
    }
  }

  const amount =
    row.amount_net !== null && row.amount_net !== undefined
      ? `${row.amount_net.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${row.currency || "GBP"}`
      : null;
  // Matches the scope/category filters are hiding, offered from the empty state.
  const hiddenMatches = textMatches.length - matchCount;
  const pickableSuggestions = suggested.filter((s) => s.db_id);
  const showSuggestions = !search.trim() && (suggesting || pickableSuggestions.length > 0);
  let idx = -1;

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-start justify-between gap-4 border-b px-5 pb-4 pt-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Pick a spend category</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground" title={row.spend_description || undefined}>
            <span className="font-medium text-foreground">{row.spend_description || "Untitled line"}</span>
            {row.reference_code && <> · GL {row.reference_code}</>}
            {amount && <> · {amount}</>}
          </p>
          {row.mapped_report_label && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Currently <span className="font-medium text-foreground">{row.mapped_report_label}</span>
              {row.mapped_category && ` · ${row.mapped_category}`}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 border-b px-5 py-4">
        {showSuggestions && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-800">
              <Sparkles className="h-3.5 w-3.5" /> Suggested
            </span>
            {suggesting && pickableSuggestions.length === 0 && (
              <span className="text-xs text-muted-foreground">Looking for a match from this line&apos;s description…</span>
            )}
            {pickableSuggestions.map((s) => (
              <button
                key={s.key}
                type="button"
                title={s.category || undefined}
                disabled={pendingId !== null}
                onClick={() => void pick({ db_id: s.db_id! })}
                className="max-w-[18rem] truncate rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or SIC code — e.g. legal, computer, 69.1"
            aria-label="Search spend categories"
            className="h-10 pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Phones get two compact dropdowns -- the chip rows below would
            fill the whole modal and leave no room for the results. */}
        <div className="grid grid-cols-2 gap-2 sm:hidden">
          <select
            aria-label="Scope"
            value={scopeFilter}
            onChange={(e) => selectScope(e.target.value)}
            className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All scopes ({textMatches.length})</option>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s} ({scopeCounts.get(s) || 0})
              </option>
            ))}
          </select>
          <select
            aria-label="Category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All categories ({inScope.length})</option>
            {categoryChips.map((c) => (
              <option key={c} value={c}>
                {c} ({categoryCounts.get(c) || 0})
              </option>
            ))}
          </select>
        </div>

        {scopes.length > 1 && (
          <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Scope</span>
            <FilterChip active={!scopeFilter} count={textMatches.length} onClick={() => selectScope("")}>
              All
            </FilterChip>
            {scopes.map((s) => (
              <FilterChip key={s} active={scopeFilter === s} count={scopeCounts.get(s) || 0} onClick={() => selectScope(s)}>
                {s}
              </FilterChip>
            ))}
          </div>
        )}

        {categoryChips.length > 1 && (
          <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Category</span>
            <FilterChip active={!categoryFilter} count={inScope.length} onClick={() => setCategoryFilter("")}>
              All
            </FilterChip>
            {categoryChips.map((c) => (
              <FilterChip
                key={c}
                active={categoryFilter === c}
                count={categoryCounts.get(c) || 0}
                onClick={() => setCategoryFilter(categoryFilter === c ? "" : c)}
              >
                {c}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {pickError && (
        <div className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-xs text-rose-800">{pickError}</div>
      )}

      <div ref={listRef} role="listbox" aria-label="Spend categories" className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-5 text-sm text-muted-foreground">Loading spend categories…</div>
        ) : loadError ? (
          <div className="p-5 text-sm text-rose-700">{loadError}</div>
        ) : flat.length === 0 ? (
          <div className="space-y-3 p-5 text-sm text-muted-foreground">
            <p>
              {search.trim() ? <>No spend categories match &ldquo;{search.trim()}&rdquo;</> : "No spend categories here"}
              {scopeFilter && ` in ${scopeFilter}`}
              {categoryFilter && ` · ${categoryFilter}`}.
            </p>
            {hiddenMatches > 0 && (
              <Button size="sm" variant="outline" onClick={clearFilters}>
                Show {hiddenMatches} match{hiddenMatches === 1 ? "" : "es"} in other {categoryFilter ? "categories" : "scopes"}
              </Button>
            )}
            {search.trim() && hiddenMatches === 0 && (
              <p className="text-xs">
                Categories use UK SIC names, so try a broader word — e.g. &ldquo;computer&rdquo; rather than
                &ldquo;software&rdquo;, or &ldquo;legal&rdquo; rather than &ldquo;solicitor&rdquo;.
              </p>
            )}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-muted/95 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                <span>
                  {g.title}
                  {!scopeFilter && g.scope && <span className="font-normal normal-case"> · {g.scope}</span>}
                </span>
                <span className="font-normal tabular-nums">{g.items.length}</span>
              </div>
              {g.items.map((o) => {
                idx += 1;
                const i = idx;
                const active = i === activeIndex;
                const current = isCurrent(o);
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-idx={i}
                    disabled={pendingId !== null}
                    onMouseMove={() => i !== activeIndex && setActiveIndex(i)}
                    onClick={() => void pick(o)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b px-5 py-2.5 text-left text-sm last:border-0 disabled:cursor-wait",
                      active ? "bg-primary/10" : "hover:bg-muted/60",
                      current && "font-medium"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <Highlight text={o.label} tokens={tokens} />
                    </span>
                    {pendingId === o.db_id ? (
                      <span className="shrink-0 text-xs text-muted-foreground">Saving…</span>
                    ) : current ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-700">
                        <Check className="h-3.5 w-3.5" /> Current
                      </span>
                    ) : g.frequent ? (
                      // Same label can sit under several categories, so flag
                      // the ones that aren't this tab's own.
                      o.category &&
                      o.category !== PGS && (
                        <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{o.category}</span>
                      )
                    ) : (
                      o.sic && (
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          SIC <Highlight text={o.sic} tokens={tokens} />
                        </span>
                      )
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
        <span className="text-xs text-muted-foreground">
          {loading ? "" : `${matchCount} of ${categories.length} spend categories`}
          <span className="hidden sm:inline"> · ↑ ↓ to move, Enter to select, Esc to close</span>
        </span>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
