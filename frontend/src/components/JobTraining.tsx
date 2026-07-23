"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback } from "react";
import { LayoutDashboard, BookOpen, Calendar, Users, Zap, CreditCard } from "lucide-react";
import { formatJobFamilyLabel, getJobFamilyDescription, jobFamilyBadgeClassName } from "@/lib/job-family";
import type { TrainingOverview, TrainingLogEntry } from "./training/types";

const OverviewTab = dynamic(() => import("./training/OverviewTab"));
const CourseTab = dynamic(() => import("./training/CourseTab"));
const ScheduleTab = dynamic(() => import("./training/ScheduleTab"));
const AttendeesTab = dynamic(() => import("./training/AttendeesTab"));
const AutomationTab = dynamic(() => import("./training/AutomationTab"));
const BillingTab = dynamic(() => import("./training/BillingTab"));

type JobTrainingProps = {
  jobId: number;
  clientId: number | null;
  baseUrl: string;
  jobFamily?: string | null;
};

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "course", label: "Course", icon: BookOpen },
  { key: "schedule", label: "Schedule", icon: Calendar },
  { key: "attendees", label: "Attendees", icon: Users },
  { key: "automation", label: "Automation", icon: Zap },
  { key: "billing", label: "Billing", icon: CreditCard },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function JobTraining({ jobId, clientId, baseUrl, jobFamily }: JobTrainingProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [overview, setOverview] = useState<TrainingOverview | null>(null);
  const [automationLog, setAutomationLog] = useState<TrainingLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [overviewRes, logRes] = await Promise.all([
          fetch(`${baseUrl}/jobs/${jobId}/training-overview`),
          fetch(`${baseUrl}/jobs/${jobId}/training-automation-log?limit=50`),
        ]);
        if (cancelled) return;
        if (overviewRes.ok) setOverview(await overviewRes.json());
        if (logRes.ok) {
          const logData = await logRes.json();
          setAutomationLog(logData.items ?? []);
        }
      } catch { /* silent */ }
      finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [jobId, baseUrl, refreshToken]);

  if (loading && !overview) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
        Loading training details…
      </div>
    );
  }

  const totalEnrolled = overview?.course_runs.reduce((s, r) => s + r.booking_count, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${jobFamilyBadgeClassName(jobFamily ?? "")}`}>
              {formatJobFamilyLabel(jobFamily ?? "")}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{getJobFamilyDescription(jobFamily ?? "")}</p>
        </div>
        {overview && (
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>{overview.course_runs.length} run{overview.course_runs.length !== 1 ? "s" : ""}</span>
            <span>{totalEnrolled} enrolled</span>
            <span>{overview.sessions.length} session{overview.sessions.length !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 rounded-xl border border-slate-200 bg-slate-50 p-1 shadow-sm">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                isActive
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:bg-white/60 hover:text-slate-700"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${isActive ? "text-emerald-600" : ""}`} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-[400px]">
        {!overview ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No training data yet.
          </div>
        ) : (
          <>
            {activeTab === "overview" && (
              <OverviewTab overview={overview} />
            )}
            {activeTab === "course" && (
              <CourseTab
                products={overview.products}
                baseUrl={baseUrl}
                onRefresh={refresh}
              />
            )}
            {activeTab === "schedule" && (
              <ScheduleTab
                jobId={jobId}
                runs={overview.course_runs}
                products={overview.products}
                sessions={overview.sessions}
                baseUrl={baseUrl}
                onRefresh={refresh}
                onOpenAutomationTab={() => setActiveTab("automation")}
              />
            )}
            {activeTab === "attendees" && (
              <AttendeesTab
                jobId={jobId}
                runs={overview.course_runs}
                sessions={overview.sessions}
                baseUrl={baseUrl}
                onRefresh={refresh}
              />
            )}
            {activeTab === "automation" && (
              <AutomationTab
                jobId={jobId}
                runs={overview.course_runs}
                automationLog={automationLog}
                baseUrl={baseUrl}
                onRefresh={refresh}
              />
            )}
            {activeTab === "billing" && (
              <BillingTab
                jobId={jobId}
                clientId={clientId}
                runs={overview.course_runs}
                baseUrl={baseUrl}
                onRefresh={refresh}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
