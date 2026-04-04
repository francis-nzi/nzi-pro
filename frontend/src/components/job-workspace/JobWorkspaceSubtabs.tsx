"use client";

import type { WorkspaceSubtab } from "./types";

type JobWorkspaceSubtabsProps = {
  activeSubtab: string;
  subtabs: WorkspaceSubtab[];
  onSubtabChange: (subtab: string) => void;
};

export default function JobWorkspaceSubtabs({ activeSubtab, subtabs, onSubtabChange }: JobWorkspaceSubtabsProps) {
  if (subtabs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 rounded-2xl border bg-slate-50/80 px-4 py-3">
      {subtabs.map((subtab) => {
        const active = activeSubtab === subtab.key;
        return (
          <button
            key={subtab.key}
            type="button"
            disabled={subtab.disabled}
            onClick={() => onSubtabChange(subtab.key)}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
            } ${subtab.disabled ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <span>{subtab.label}</span>
            {subtab.countBadge !== undefined ? (
              <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/15" : "bg-slate-100"}`}>
                {subtab.countBadge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

