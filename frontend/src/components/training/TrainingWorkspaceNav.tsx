"use client";

import Link from "next/link";
import { LayoutDashboard, BookOpen, Calendar, Users, Zap, CreditCard, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TRAINING_SECTIONS = [
  { key: "overview",        label: "Overview",      icon: LayoutDashboard, path: "overview" },
  { key: "courses",         label: "Courses",        icon: BookOpen,        path: "courses" },
  { key: "schedule",        label: "Schedule",       icon: Calendar,        path: "schedule" },
  { key: "participants",    label: "Participants",   icon: Users,           path: "participants" },
  { key: "communications",  label: "Comms",          icon: Zap,             path: "communications" },
  { key: "billing",         label: "Billing",        icon: CreditCard,      path: "billing" },
] as const;

export type TrainingSection = typeof TRAINING_SECTIONS[number]["key"];

type Props = {
  jobId: number;
  activeSection: TrainingSection;
};

export default function TrainingWorkspaceNav({ jobId, activeSection }: Props) {
  return (
    <div className="mb-6 flex items-center gap-0 border-b border-slate-200/80 print:hidden">
      {TRAINING_SECTIONS.map(({ key, label, icon: Icon, path }) => {
        const active = key === activeSection;
        return (
          <Link
            key={key}
            href={`/jobs/${jobId}/training/${path}`}
            className={cn(
              "mr-4 inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2.5 text-sm font-medium transition-colors",
              active
                ? "border-emerald-700 text-slate-900"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
            )}
          >
            <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", active && "text-emerald-700")} />
            {label}
          </Link>
        );
      })}

      <div className="ml-auto pb-2.5">
        <Link
          href={`/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
        >
          <Settings2 className="h-3 w-3" />
          Job Setup
        </Link>
      </div>
    </div>
  );
}
