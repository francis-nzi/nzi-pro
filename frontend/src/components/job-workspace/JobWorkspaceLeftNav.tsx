"use client";

import Link from "next/link";
import {
  BarChart2,
  CreditCard,
  Database,
  FileText,
  Lightbulb,
  MessageCircle,
  Settings2,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceGroupKey } from "./types";

type SubtabDef = { key: string; label: string; href: string };
type GroupDef = {
  key: WorkspaceGroupKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  subtabs: SubtabDef[];
};

function buildGroups(jobId: number): GroupDef[] {
  const j = jobId;
  return [
    {
      key: "setup",
      label: "Setup",
      icon: Settings2,
      href: `/jobs/${j}/setup`,
      subtabs: [
        { key: "setup-overview",      label: "Setup Overview", href: `/jobs/${j}/setup` },
        { key: "setup-custom-fields", label: "Custom Fields",  href: `/jobs/${j}/setup` },
      ],
    },
    {
      key: "data",
      label: "Data",
      icon: Database,
      href: `/jobs/${j}/data-entry`,
      subtabs: [
        { key: "data-entry",         label: "Data Entry",         href: `/jobs/${j}/data-entry` },
        { key: "employee-commuting", label: "Employee Commuting", href: `/jobs/${j}/data-entry/employee-commuting` },
        { key: "asset-register",     label: "Asset Register",     href: `/jobs/${j}/data-entry/asset-register` },
        { key: "business-travel",    label: "Business Travel",    href: `/jobs/${j}/data-entry/business-travel` },
        { key: "upload",             label: "Data Upload",        href: `/jobs/${j}?tab=upload` },
        { key: "custom-dataset",     label: "Custom Dataset",     href: `/jobs/${j}/data-entry/custom-dataset` },
        { key: "custom-factors",     label: "Job-Only Factors",   href: `/jobs/${j}/data-entry/custom-factors` },
        { key: "spend-data",         label: "Spend Data",         href: `/jobs/${j}/data-entry/spend-data` },
        { key: "notes",              label: "Notes",              href: `/jobs/${j}/data-entry/notes` },
      ],
    },
    {
      key: "outputs",
      label: "Outputs",
      icon: BarChart2,
      href: `/jobs/${j}/outputs`,
      subtabs: [
        { key: "data-output", label: "Data Output", href: `/jobs/${j}/outputs` },
        { key: "actions",     label: "Actions",     href: `/jobs/${j}?tab=actions` },
      ],
    },
    {
      key: "report",
      label: "Report",
      icon: FileText,
      href: `/jobs/${j}/report-new`,
      subtabs: [
        { key: "report-new",       label: "Report Preparation", href: `/jobs/${j}/report-new` },
        { key: "advanced-reports", label: "Report Printing",    href: `/jobs/${j}/advanced-reports` },
        { key: "client-review",    label: "Client Review",      href: `/jobs/${j}/client-review` },
      ],
    },
    {
      key: "analysis",
      label: "Analysis",
      icon: TrendingUp,
      href: `/jobs/${j}/lca`,
      subtabs: [
        { key: "lca", label: "Life Cycle Analysis", href: `/jobs/${j}/lca` },
      ],
    },
    {
      key: "insights",
      label: "Insights",
      icon: Lightbulb,
      href: `/jobs/${j}/insights`,
      subtabs: [],
    },
    {
      key: "communications",
      label: "Comms",
      icon: MessageCircle,
      href: `/jobs/${j}/communications/timeline`,
      subtabs: [
        { key: "communications-timeline",   label: "Timeline",     href: `/jobs/${j}/communications/timeline` },
        { key: "communications-inbox",      label: "Inbox",        href: `/jobs/${j}/communications/inbox` },
        { key: "communications-email",      label: "Email",        href: `/jobs/${j}/communications/email` },
        { key: "communications-tasks",      label: "Tasks",        href: `/jobs/${j}/communications/tasks` },
        { key: "communications-automation", label: "Automation",   href: `/jobs/${j}/communications/automation` },
        { key: "communications-crm",        label: "CRM Timeline", href: `/jobs/${j}/communications/crm` },
      ],
    },
    {
      key: "financial",
      label: "Financial",
      icon: CreditCard,
      href: `/jobs/${j}/financial/quotes`,
      subtabs: [
        { key: "financial-quotes",      label: "Quotes",       href: `/jobs/${j}/financial/quotes` },
        { key: "financial-invoices",    label: "Invoices",     href: `/jobs/${j}/financial/invoices` },
        { key: "financial-other-costs", label: "Other Costs",  href: `/jobs/${j}/financial/other-costs` },
        { key: "financial-profit-loss", label: "Profit & Loss",href: `/jobs/${j}/financial/profit-loss` },
      ],
    },
    {
      key: "admin",
      label: "Admin",
      icon: ShieldCheck,
      href: `/jobs/${j}/admin/files`,
      subtabs: [
        { key: "files",       label: "Files",        href: `/jobs/${j}/admin/files` },
        { key: "time",        label: "Time Entries", href: `/jobs/${j}/admin/time` },
        { key: "certificate", label: "Certificate",  href: `/jobs/${j}/admin/certificate` },
      ],
    },
  ];
}

type Props = {
  jobId: number;
  activeGroup: WorkspaceGroupKey;
  activeSubtab?: string;
  accentColor?: string;
  // When provided, active group subtabs render as buttons calling this instead of navigating.
  // Use this on the main page.tsx where Setup subtabs control in-page scroll/show.
  onSubtabChange?: (key: string) => void;
};

export default function JobWorkspaceLeftNav({
  jobId,
  activeGroup,
  activeSubtab,
  accentColor = "#1c5026",
  onSubtabChange,
}: Props) {
  const groups = buildGroups(jobId);

  return (
    <aside className="w-48 flex-shrink-0 sticky top-6 self-start print:hidden">
      <nav className="space-y-0.5 rounded-xl border border-slate-200/80 bg-white p-2 shadow-sm">
        {groups.map((group) => {
          const Icon = group.icon;
          const isActive = activeGroup === group.key;
          const hasSubtabs = isActive && group.subtabs.length > 0;

          return (
            <div key={group.key}>
              <Link
                href={group.href}
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors",
                  isActive
                    ? "text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
                style={isActive ? { backgroundColor: accentColor } : undefined}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 truncate">{group.label}</span>
              </Link>

              {hasSubtabs && (
                <div className="mb-1 ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 py-1 pl-3">
                  {group.subtabs.map((subtab) => {
                    const subActive = activeSubtab === subtab.key;
                    const cls = cn(
                      "block w-full text-left rounded px-2 py-1.5 text-xs transition-colors",
                      subActive
                        ? "font-semibold"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    );
                    const style = subActive ? { color: accentColor } : undefined;

                    if (onSubtabChange) {
                      return (
                        <button
                          key={subtab.key}
                          type="button"
                          className={cls}
                          style={style}
                          onClick={() => onSubtabChange(subtab.key)}
                        >
                          {subtab.label}
                        </button>
                      );
                    }
                    return (
                      <Link key={subtab.key} href={subtab.href} className={cls} style={style}>
                        {subtab.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
