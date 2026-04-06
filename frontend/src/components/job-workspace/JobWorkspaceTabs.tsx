"use client";

import type { WorkspaceTab } from "./types";
import type { WorkspaceGroupKey } from "./types";

type JobWorkspaceTabsProps = {
  activeTab: WorkspaceGroupKey;
  tabs: WorkspaceTab[];
  onTabChange: (tab: WorkspaceGroupKey) => void;
};

export default function JobWorkspaceTabs({ activeTab, tabs, onTabChange }: JobWorkspaceTabsProps) {
  return (
    <div className="border-b border-slate-200/80">
      <div className="flex gap-5 overflow-x-auto px-1 pb-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              disabled={tab.disabled}
              onClick={() => onTabChange(tab.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 text-sm font-medium transition ${
                active
                  ? "border-emerald-800 text-slate-900"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              } ${tab.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <span>{tab.label}</span>
              {tab.countBadge !== undefined ? (
                <span className="text-xs text-slate-400">{tab.countBadge}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
