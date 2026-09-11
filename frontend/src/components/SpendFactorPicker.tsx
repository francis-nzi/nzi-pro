"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// CRM counterpart of the portal's SpendCategoryPicker
// (portal/src/components/SpendCategoryPicker.tsx) -- same layout, plus the
// factor's DB ID, SIC code and value on every row for staff.

export type SpendFactor = {
  db_id: number;
  original_id: string | null;
  scope: string | null;
  category: string | null;
  report_label: string | null;
  factor: number | null;
  ghg_unit?: string | null;
  uom?: string | null;
  dataset_name?: string | null;
};

export type TopSpendFactor = {
  db_id: number;
  original_id?: string | null;
  scope: string | null;
  category: string | null;
  report_label: string | null;
  use_count?: number;
};

export type PickerSpendRow = {
  reference_code: string | null;
  spend_description: string;
  site_name?: string | null;
  currency: string;
  amount_net: number;
  factor_db_id: number | null;
  factor_original_id?: string | null;
  mapped_scope: string | null;
  mapped_category?: string | null;
  mapped_report_label: string | null;
};

type Props = {
  row: PickerSpendRow;
  factors: SpendFactor[];
  loading: boolean;
  loadError: string;
  frequentlyUsed: TopSpendFactor[];
  // Resolves to an error message, or null once the mapping is saved.
  onPick: (factor: { db_id: number }) => Promise<string | null>;
  onClose: () => void;
};

type Option = {
  key: string;
  db_id: number;
  label: string;
  scope: string | null;
  category: string | null;
  sic: string | null;
  factor: SpendFactor | null;
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

// PG&S leads (it's the spend screen's own category), everything else alphabetical.
function compareCategories(a: string, b: string) {
  if (a === PGS) return b === PGS ? 0 : -1;
  if (b === PGS) return 1;
  return a.localeCompare(b);
}

// "SPEND-SIC-49.3-5-b" -> "49.3-5". The trailing letter only marks which
// category a shared SIC factor was filed under.
function sicCode(originalId: string | null | undefined) {
  const m = /^SPEND-SIC-(.+)$/i.exec(originalId || "");
  return m ? m[1].replace(/-[a-z]$/i, "") : null;
}

function formatFactor(f: SpendFactor) {
  if (f.factor === null || f.factor === undefined) return null;
  const value = Number(f.factor).toLocaleString("en-GB", { maximumSignificantDigits: 4 });
  const unit = [f.ghg_unit, f.uom].filter(Boolean).join("/");
  return unit ? `${value} ${unit}` : value;
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

export default function SpendFactorPicker({ row, factors, loading, loadError, frequentlyUsed, onPick, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState(DEFAULT_SCOPE); // "" = all scopes
  const [categoryFilter, setCategoryFilter] = useState(""); // "" = all categories
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [pickError, setPickError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const tokens = useMemo(() => search.toLowerCase().split(/\s+/).filter(Boolean), [search]);
  const factorById = useMemo(() => new Map(factors.map((f) => [f.db_id, f])), [factors]);

  // Every search word must appear somewhere in the label, category, SIC
  // code or DB ID, so extra words narrow instead of widening.
  const textMatches = useMemo(() => {
    if (!tokens.length) return factors;
    return factors.filter((f) => {
      const haystack = `${f.report_label || ""} ${f.category || ""} ${sicCode(f.original_id) || ""} ${f.db_id}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [factors, tokens]);

  const scopeCounts = useMemo(() => countBy(textMatches, scopeOf), [textMatches]);
  const scopes = useMemo(() => Array.from(countBy(factors, scopeOf).keys()).sort(), [factors]);

  const inScope = useMemo(
    () => (scopeFilter ? textMatches.filter((f) => scopeOf(f) === scopeFilter) : textMatches),
    [textMatches, scopeFilter]
  );
  const categoryCounts = useMemo(() => countBy(inScope, categoryOf), [inScope]);
  // Every category the scope holds stays listed (greyed at 0) while
  // searching, so the chip row doesn't reshuffle under the cursor.
  const categoryChips = useMemo(() => {
    const names = new Set(factors.filter((f) => !scopeFilter || scopeOf(f) === scopeFilter).map(categoryOf));
    if (categoryFilter) names.add(categoryFilter);
    return Array.from(names).sort(compareCategories);
  }, [factors, scopeFilter, categoryFilter]);

  // Grouped by scope + category, in the same order as the chips, led by the
  // client's frequently-used factors until a search or category narrows
  // things. `flat` is the same order as one list, for arrow-key navigation.
  const { groups, flat, matchCount } = useMemo(() => {
    const visible = categoryFilter ? inScope.filter((f) => categoryOf(f) === categoryFilter) : inScope;
    const byKey = new Map<string, Group>();
    for (const f of visible) {
      const key = `${scopeOf(f)}|${categoryOf(f)}`;
      if (!byKey.has(key)) byKey.set(key, { key, title: categoryOf(f), scope: scopeOf(f), frequent: false, items: [] });
      byKey.get(key)!.items.push({
        key: `f${f.db_id}`,
        db_id: f.db_id,
        label: f.report_label || "Unnamed factor",
        scope: f.scope,
        category: f.category,
        sic: sicCode(f.original_id),
        factor: f,
      });
    }
    const sorted = Array.from(byKey.values()).sort(
      (a, b) => (a.scope || "").localeCompare(b.scope || "") || compareCategories(a.title, b.title)
    );
    for (const g of sorted) g.items.sort((a, b) => a.label.localeCompare(b.label));

    // The top endpoint already re-points these at the job's own factors.
    const frequent =
      !tokens.length && !categoryFilter ? frequentlyUsed.filter((c) => !scopeFilter || scopeOf(c) === scopeFilter) : [];
    if (frequent.length) {
      sorted.unshift({
        key: "frequent",
        title: "Frequently used",
        scope: null,
        frequent: true,
        items: frequent.map((c) => ({
          key: `t${c.db_id}`,
          db_id: c.db_id,
          label: c.report_label || "Unnamed factor",
          scope: c.scope,
          category: c.category,
          sic: sicCode(c.original_id),
          factor: factorById.get(c.db_id) || null,
        })),
      });
    }
    return { groups: sorted, flat: sorted.flatMap((g) => g.items), matchCount: visible.length };
  }, [inScope, categoryFilter, tokens, frequentlyUsed, scopeFilter, factorById]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // By DB ID first; the label match covers a row mapped to the same factor
  // in another year's dataset (the list only carries the job's own).
  function isCurrent(o: Option) {
    if (row.factor_db_id !== null && o.db_id === row.factor_db_id) return true;
    return (
      !!row.mapped_report_label &&
      o.label === row.mapped_report_label &&
      o.category === (row.mapped_category ?? null) &&
      (!row.mapped_scope || o.scope === row.mapped_scope)
    );
  }

  async function pick(option: { db_id: number }) {
    if (pendingId !== null) return;
    setPendingId(option.db_id);
    setPickError("");
    const err = await onPick(option);
    // On success the parent closes (and unmounts) the picker.
    if (err) {
      setPickError(err);
      setPendingId(null);
    }
  }

  // Each filter change moves the keyboard highlight back to the top.
  function changeSearch(text: string) {
    setSearch(text);
    setActiveIndex(0);
  }

  function selectScope(scope: string) {
    setScopeFilter(scope);
    setCategoryFilter("");
    setActiveIndex(0);
  }

  function selectCategory(category: string) {
    setCategoryFilter(category);
    setActiveIndex(0);
  }

  function clearFilters() {
    selectScope("");
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

  const amount = `${(row.amount_net || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${row.currency || "GBP"}`;
  const hiddenMatches = textMatches.length - matchCount;
  let idx = -1;

  return (
    <div
      className="flex h-[min(46rem,calc(100vh-2rem))] w-[min(52rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-start justify-between gap-4 border-b px-5 pb-4 pt-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{row.factor_db_id ? "Change mapping" : "Map spend row"}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground" title={row.spend_description}>
            <span className="font-medium text-foreground">{row.spend_description || "Untitled row"}</span>
            {row.reference_code && <> · Code {row.reference_code}</>}
            {row.site_name && <> · {row.site_name}</>} · {amount}
          </p>
          {row.mapped_report_label ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Currently <span className="font-medium text-foreground">{row.mapped_report_label}</span>
              {[row.mapped_scope, row.mapped_category].filter(Boolean).map((s) => ` · ${s}`).join("")}
              {row.factor_db_id !== null && <span className="font-mono"> · DB {row.factor_db_id}</span>}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Not mapped yet. Your choice is also saved against this client&apos;s code for future years.
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
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder="Search by name, SIC code or DB ID — e.g. legal, computer, 69.1"
            aria-label="Search spend factors"
            className="h-10 pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => changeSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {scopes.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
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
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Category</span>
            <FilterChip active={!categoryFilter} count={inScope.length} onClick={() => selectCategory("")}>
              All
            </FilterChip>
            {categoryChips.map((c) => (
              <FilterChip
                key={c}
                active={categoryFilter === c}
                count={categoryCounts.get(c) || 0}
                onClick={() => selectCategory(categoryFilter === c ? "" : c)}
              >
                {c}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {pickError && <div className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-xs text-rose-800">{pickError}</div>}

      <div ref={listRef} role="listbox" aria-label="Spend factors" className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-5 text-sm text-muted-foreground">Loading spend factors…</div>
        ) : loadError ? (
          <div className="p-5 text-sm text-rose-700">{loadError}</div>
        ) : flat.length === 0 ? (
          <div className="space-y-3 p-5 text-sm text-muted-foreground">
            <p>
              {search.trim() ? <>No spend factors match &ldquo;{search.trim()}&rdquo;</> : "No spend factors here"}
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
                Factors use UK SIC names, so try a broader word — e.g. &ldquo;computer&rdquo; rather than
                &ldquo;software&rdquo;, or &ldquo;legal&rdquo; rather than &ldquo;solicitor&rdquo;.
              </p>
            )}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-muted px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                const factorText = o.factor ? formatFactor(o.factor) : null;
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
                      "flex w-full items-center gap-3 border-b px-5 py-2 text-left text-sm last:border-0 disabled:cursor-wait",
                      active ? "bg-primary/10" : "hover:bg-muted/60",
                      current && "font-medium"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        <Highlight text={o.label} tokens={tokens} />
                      </span>
                      {g.frequent && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {[o.scope, o.category].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                    {pendingId === o.db_id ? (
                      <span className="shrink-0 text-xs text-muted-foreground">Saving…</span>
                    ) : (
                      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right font-mono text-[11px] font-normal text-muted-foreground">
                        {current && (
                          <span className="inline-flex items-center gap-1 font-sans text-xs text-emerald-700">
                            <Check className="h-3.5 w-3.5" /> Current
                          </span>
                        )}
                        {factorText && <span>{factorText}</span>}
                        <span>
                          DB <Highlight text={String(o.db_id)} tokens={tokens} />
                          {o.sic && (
                            <>
                              {" · SIC "}
                              <Highlight text={o.sic} tokens={tokens} />
                            </>
                          )}
                        </span>
                      </span>
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
          {loading ? "" : `${matchCount} of ${factors.length} spend factors`}
          <span className="hidden sm:inline"> · ↑ ↓ to move, Enter to select, Esc to close</span>
        </span>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
