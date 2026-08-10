"use client";

import {
  LayoutDashboard,
  BarChart2,
  FileText,
  Zap,
  MonitorSmartphone,
  ClipboardList,
  ClipboardCheck,
  StickyNote,
  Files,
  MessageCircle,
  Building2,
  CreditCard,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SubtabDef = { key: string; label: string };
type GroupDef = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  subtabs?: SubtabDef[];
};

const GROUPS: GroupDef[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "carbon", label: "Carbon Analytics", icon: BarChart2 },
  { key: "reporting", label: "Reporting", icon: FileText },
  { key: "actions", label: "Actions", icon: Zap },
  { key: "srs-readiness", label: "SRS Readiness", icon: ClipboardCheck },
  { key: "portal", label: "Portal", icon: MonitorSmartphone },
  { key: "tasks", label: "Tasks", icon: ClipboardList },
  { key: "notes", label: "Notes", icon: StickyNote },
  { key: "files", label: "Files", icon: Files },
  { key: "timeline", label: "Communications", icon: MessageCircle },
  {
    key: "profile",
    label: "Company Profile",
    icon: Building2,
    subtabs: [
      { key: "details", label: "Details & Targets" },
      { key: "contacts", label: "Contacts Management" },
      { key: "sites", label: "Sites Register" },
      { key: "custom-fields", label: "Custom Fields" },
    ],
  },
  {
    key: "financial",
    label: "Financials",
    icon: CreditCard,
    subtabs: [
      { key: "quotes", label: "Quotes" },
      { key: "invoices", label: "Invoices" },
      { key: "profit-loss", label: "Profit & Loss" },
    ],
  },
  { key: "ai-profile", label: "AI Profile", icon: Sparkles },
];

type Props = {
  activeSection: string;
  activeProfileSubTab: string;
  financialView: string;
  openTaskCount?: number | null;
  onSectionChange: (section: string) => void;
  onProfileSubTabChange: (subtab: string) => void;
  onFinancialViewChange: (view: string) => void;
  accentColor?: string;
};

export default function ClientWorkspaceLeftNav({
  activeSection,
  activeProfileSubTab,
  financialView,
  openTaskCount,
  onSectionChange,
  onProfileSubTabChange,
  onFinancialViewChange,
  accentColor = "#1c5026",
}: Props) {
  return (
    <aside className="w-48 flex-shrink-0 sticky top-6 self-start print:hidden">
      <nav className="space-y-0.5 rounded-xl border border-slate-200/80 bg-white p-2 shadow-sm">
        {GROUPS.map((group) => {
          const Icon = group.icon;
          const isActive = activeSection === group.key;
          const hasSubtabs = isActive && !!group.subtabs?.length;
          const label =
            group.key === "tasks" && openTaskCount != null
              ? `Tasks (${openTaskCount})`
              : group.label;

          return (
            <div key={group.key}>
              <button
                type="button"
                onClick={() => onSectionChange(group.key)}
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors text-left",
                  isActive
                    ? "text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
                style={isActive ? { backgroundColor: accentColor } : undefined}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 truncate">{label}</span>
              </button>

              {hasSubtabs && (
                <div className="mb-1 ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 py-1 pl-3">
                  {group.subtabs!.map((subtab) => {
                    const subActive =
                      group.key === "profile"
                        ? activeProfileSubTab === subtab.key
                        : financialView === subtab.key;
                    return (
                      <button
                        key={subtab.key}
                        type="button"
                        className={cn(
                          "block w-full text-left rounded px-2 py-1.5 text-xs transition-colors",
                          subActive
                            ? "font-semibold"
                            : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        )}
                        style={subActive ? { color: accentColor } : undefined}
                        onClick={() =>
                          group.key === "profile"
                            ? onProfileSubTabChange(subtab.key)
                            : onFinancialViewChange(subtab.key)
                        }
                      >
                        {subtab.label}
                      </button>
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
