"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  const selectedSubtab = subtabs.some((subtab) => subtab.key === activeSubtab)
    ? activeSubtab
    : subtabs[0]?.key ?? "";

  return (
    <div className="rounded-2xl border bg-slate-50/80 px-4 py-3">
      <div className="md:hidden">
        <label className="mb-2 block text-xs font-medium uppercase tracking-[0.25em] text-slate-500">
          Section
        </label>
        <Select value={selectedSubtab} onValueChange={onSubtabChange}>
          <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white text-left">
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent>
            {subtabs.map((subtab) => (
              <SelectItem key={subtab.key} value={subtab.key} disabled={subtab.disabled}>
                <span>{subtab.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="hidden flex-wrap gap-2 md:flex">
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
    </div>
  );
}
