"use client";

import type { WorkspaceTabKey } from "./types";

type JobWorkspaceTabsProps = {
  activeTab: WorkspaceTabKey;
  tabs: Array<{
    key: WorkspaceTabKey;
    label: string;
    countBadge?: string | number;
    disabled?: boolean;
  }>;
  onTabChange: (tab: WorkspaceTabKey) => void;
};

export default function JobWorkspaceTabs({ activeTab, tabs, onTabChange }: JobWorkspaceTabsProps) {
  return (
    <div className="rounded-2xl border bg-white px-3 py-2 shadow-sm">
      <div className="flex gap-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              disabled={tab.disabled}
              onClick={() => onTabChange(tab.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                active
                  ? "bg-emerald-800 text-white shadow-sm"
                  : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
              } ${tab.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <span>{tab.label}</span>
              {tab.countBadge !== undefined ? (
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${active ? "bg-white/15" : "bg-slate-100"}`}>
                  {tab.countBadge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
