"use client";

import Link from "next/link";

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
      <div className="flex flex-nowrap items-end gap-5 overflow-x-auto px-1 pb-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          const className = `inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 text-[0.92rem] font-medium transition ${
            active
              ? "border-emerald-800 text-slate-900"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
          } ${tab.disabled ? "cursor-not-allowed opacity-50" : ""}`;
          if (tab.href) {
            return (
              <Link key={tab.key} href={tab.href} className={className} aria-current={active ? "page" : undefined}>
                <span>{tab.label}</span>
                {tab.countBadge !== undefined ? (
                  <span className="text-xs text-slate-400">{tab.countBadge}</span>
                ) : null}
              </Link>
            );
          }
          return (
            <button
              key={tab.key}
              type="button"
              disabled={tab.disabled}
              onClick={() => onTabChange(tab.key)}
              className={className}
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
