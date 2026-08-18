"use client";

import { useMemo, useState } from "react";

// Selection-only state for a "select all / select some rows, then bulk act
// on them" list -- e.g. the various Pending Portal Submissions panels.
// `selectableIds` is whatever the caller currently considers eligible for
// selection (e.g. excluding rows grouped as duplicates awaiting
// consolidation); passing a new array each render is fine, `allSelected`
// is recomputed from it directly rather than cached.
export function useBulkSelection<T extends number | string>(selectableIds: T[]) {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  function toggleOne(id: T) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Call after reloading the row list so stale ids (approved/rejected/
  // deleted since the last load) don't linger in the selection.
  function pruneTo(validIds: T[]) {
    const validSet = new Set(validIds);
    setSelected((prev) => new Set([...prev].filter((id) => validSet.has(id))));
  }

  function removeMany(ids: T[]) {
    const removeSet = new Set(ids);
    setSelected((prev) => new Set([...prev].filter((id) => !removeSet.has(id))));
  }

  const selectedCount = useMemo(() => selected.size, [selected]);

  return { selected, selectedCount, allSelected, someSelected, toggleSelectAll, toggleOne, pruneTo, removeMany };
}
