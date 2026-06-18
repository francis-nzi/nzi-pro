"use client";

import { useMemo } from "react";
import { Calendar, Users, CheckCircle, Clock, AlertCircle, BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TrainingOverview } from "./types";
import { formatTrainingCourseRunStatus, formatTrainingDeliveryMode } from "@/lib/training-workflow";

type Props = {
  overview: TrainingOverview;
};

function statusColor(status: string): string {
  switch (status) {
    case "open": return "bg-green-100 text-green-800";
    case "in_progress": return "bg-blue-100 text-blue-800";
    case "completed": return "bg-slate-100 text-slate-700";
    case "cancelled": return "bg-red-100 text-red-800";
    case "full": return "bg-amber-100 text-amber-800";
    case "scheduled": return "bg-purple-100 text-purple-800";
    default: return "bg-slate-100 text-slate-600";
  }
}

export default function OverviewTab({ overview }: Props) {
  const { course_runs, sessions } = overview;

  const stats = useMemo(() => {
    const totalBookings = course_runs.reduce((s, r) => s + r.booking_count, 0);
    const totalCapacity = course_runs.reduce((s, r) => s + (r.capacity ?? 0), 0);
    const activeRuns = course_runs.filter((r) => !["cancelled", "completed"].includes(r.status));
    const completedRuns = course_runs.filter((r) => r.status === "completed");
    const attended = course_runs.reduce(
      (s, r) => s + r.bookings.filter((b) => b.attendance_status === "attended").length,
      0
    );
    return { totalBookings, totalCapacity, activeRuns: activeRuns.length, completedRuns: completedRuns.length, attended };
  }, [course_runs]);

  const upcomingSessions = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return sessions
      .filter((s) => s.session_date && s.session_date >= today && s.status !== "cancelled")
      .sort((a, b) => (a.session_date ?? "").localeCompare(b.session_date ?? ""))
      .slice(0, 8);
  }, [sessions]);

  const kpis = [
    {
      label: "Course Runs",
      value: course_runs.length,
      sub: `${stats.activeRuns} active`,
      icon: BookOpen,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Total Enrolled",
      value: stats.totalBookings,
      sub: stats.totalCapacity > 0 ? `of ${stats.totalCapacity} places` : "no capacity set",
      icon: Users,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Attended",
      value: stats.attended,
      sub: stats.totalBookings > 0 ? `${Math.round((stats.attended / stats.totalBookings) * 100)}% rate` : "—",
      icon: CheckCircle,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "Sessions Scheduled",
      value: upcomingSessions.length,
      sub: "upcoming",
      icon: Calendar,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">{k.label}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{k.value}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{k.sub}</p>
                </div>
                <div className={`rounded-lg p-2 ${k.bg}`}>
                  <Icon className={`h-5 w-5 ${k.color}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upcoming sessions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-purple-500" />
              Upcoming Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingSessions.length === 0 ? (
              <p className="text-sm text-slate-400">No upcoming sessions.</p>
            ) : (
              <div className="space-y-2">
                {upcomingSessions.map((s) => {
                  const run = course_runs.find((r) => r.training_course_run_id === s.training_course_run_id);
                  return (
                    <div key={s.training_course_session_id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
                      <div className="min-w-[54px] rounded-md bg-purple-50 px-2 py-1 text-center">
                        <p className="text-xs font-bold text-purple-700">
                          {s.session_date
                            ? new Date(s.session_date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                            : "TBC"}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {s.session_title || run?.run_name || "Session"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {s.start_time ? s.start_time.slice(0, 5) : ""}
                          {s.end_time ? `–${s.end_time.slice(0, 5)}` : ""}
                          {s.venue_name ? ` · ${s.venue_name}` : ""}
                        </p>
                      </div>
                      <Badge className="shrink-0 text-xs" variant="outline">
                        {s.attendance_count} enrolled
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Course runs summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              Course Runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {course_runs.length === 0 ? (
              <p className="text-sm text-slate-400">No course runs yet.</p>
            ) : (
              <div className="space-y-2">
                {course_runs.map((run) => (
                  <div key={run.training_course_run_id} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {run.run_name || run.product_name || `Run #${run.training_course_run_id}`}
                      </p>
                      <p className="text-xs text-slate-500">
                        {run.start_date
                          ? new Date(run.start_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                          : "No date"}
                        {run.delivery_mode ? ` · ${formatTrainingDeliveryMode(run.delivery_mode)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {run.booking_count}{run.capacity ? `/${run.capacity}` : ""}
                      </span>
                      <Badge className={`text-xs ${statusColor(run.status)}`} variant="outline">
                        {formatTrainingCourseRunStatus(run.status)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
