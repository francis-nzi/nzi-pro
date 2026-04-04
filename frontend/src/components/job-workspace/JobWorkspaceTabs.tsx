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
    <div className="rounded-3xl border bg-white px-4 py-3 shadow-sm">
      <div className="flex gap-2 overflow-x-auto">
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              disabled={tab.disabled}
              onClick={() => onTabChange(tab.key)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                active
                  ? "bg-emerald-800 text-white shadow-sm"
                  : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
              } ${tab.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <span>{tab.label}</span>
              {tab.countBadge !== undefined ? (
                <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/15" : "bg-slate-100"}`}>
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

