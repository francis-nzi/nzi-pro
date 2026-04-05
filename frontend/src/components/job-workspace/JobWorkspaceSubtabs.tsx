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
    <div className="border-b border-slate-200/80 pb-1">
      <div className="md:hidden">
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
          Section
        </label>
        <Select value={selectedSubtab} onValueChange={onSubtabChange}>
          <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 bg-white text-left text-sm">
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

      <div className="hidden flex-wrap gap-5 px-1 md:flex">
        {subtabs.map((subtab) => {
          const active = activeSubtab === subtab.key;
          return (
            <button
              key={subtab.key}
              type="button"
              disabled={subtab.disabled}
              onClick={() => onSubtabChange(subtab.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 text-[13px] font-medium transition ${
                active
                  ? "border-emerald-800 text-slate-900"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              } ${subtab.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <span>{subtab.label}</span>
              {subtab.countBadge !== undefined ? (
                <span className="text-xs text-slate-400">{subtab.countBadge}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
