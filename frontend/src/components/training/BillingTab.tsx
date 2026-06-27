"use client";

import { useMemo } from "react";
import { DollarSign, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { TRAINING_BILLING_STATUS_OPTIONS, formatTrainingBillingStatus } from "@/lib/training-workflow";
import type { TrainingCourseRun, TrainingBooking } from "./types";

type Props = {
  runs: TrainingCourseRun[];
  baseUrl: string;
  onRefresh: () => void;
};

type BookingRow = TrainingBooking & { run_name: string };

function billingColor(s: string) {
  switch (s) {
    case "paid": return "bg-green-100 text-green-800";
    case "invoiced": return "bg-blue-100 text-blue-800";
    case "included": return "bg-teal-100 text-teal-800";
    case "waived": return "bg-slate-100 text-slate-500";
    default: return "bg-amber-100 text-amber-700";
  }
}

function billingIcon(s: string) {
  switch (s) {
    case "paid": return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    case "invoiced": return <Clock className="h-3.5 w-3.5 text-blue-400" />;
    default: return <AlertCircle className="h-3.5 w-3.5 text-amber-400" />;
  }
}

export default function BillingTab({ runs, baseUrl, onRefresh }: Props) {
  const allBookings = useMemo<BookingRow[]>(() => {
    const result: BookingRow[] = [];
    for (const run of runs) {
      for (const b of run.bookings) {
        result.push({
          ...b,
          run_name: run.run_name || run.product_name || `Cohort #${run.training_course_run_id}`,
        });
      }
    }
    return result;
  }, [runs]);

  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of allBookings) {
      counts[b.billing_status] = (counts[b.billing_status] ?? 0) + 1;
    }
    return counts;
  }, [allBookings]);

  async function updateBilling(booking: BookingRow, billing_status: string) {
    try {
      const res = await fetch(`${baseUrl}/training-bookings/${booking.training_booking_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...booking, billing_status }),
      });
      if (!res.ok) throw new Error(await res.text());
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  const kpis = [
    { label: "Pending", value: summary["pending"] ?? 0, color: "text-amber-600", bg: "bg-amber-50", icon: AlertCircle },
    { label: "Invoiced", value: summary["invoiced"] ?? 0, color: "text-blue-600", bg: "bg-blue-50", icon: Clock },
    { label: "Paid", value: summary["paid"] ?? 0, color: "text-green-600", bg: "bg-green-50", icon: CheckCircle },
    { label: "Included / Waived", value: (summary["included"] ?? 0) + (summary["waived"] ?? 0), color: "text-slate-600", bg: "bg-slate-50", icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">{k.label}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{k.value}</p>
                  <p className="mt-0.5 text-xs text-slate-400">attendees</p>
                </div>
                <div className={`rounded-lg p-2 ${k.bg}`}>
                  <Icon className={`h-5 w-5 ${k.color}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-cohort breakdown */}
      {runs.map((run) => (
        <Card key={run.training_course_run_id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>{run.run_name || run.product_name || `Cohort #${run.training_course_run_id}`}</span>
              <span className="text-xs font-normal text-slate-500">{run.booking_count} attendees</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {run.bookings.length === 0 ? (
              <p className="px-4 pb-4 text-xs text-slate-400">No bookings.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Attendee</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead className="w-[160px]">Billing Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.bookings.map((b) => {
                    const br = { ...b, run_name: run.run_name || "" };
                    return (
                      <TableRow key={b.training_booking_id}>
                        <TableCell className="text-sm">
                          <div className="font-medium">{b.person_name}</div>
                          {b.person_email && <div className="text-xs text-slate-400">{b.person_email}</div>}
                          {b.client_name && <div className="text-xs text-slate-400">{b.client_name}</div>}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {b.booking_source?.replace(/_/g, " ")}
                          {b.entitlement_id ? ` (entitlement #${b.entitlement_id})` : ""}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {billingIcon(b.billing_status)}
                            <span className="text-xs text-slate-600">{b.attendance_status?.replace(/_/g, " ")}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={b.billing_status}
                            onValueChange={(v) => updateBilling(br, v)}
                          >
                            <SelectTrigger className="h-7 border-0 p-0 shadow-none focus:ring-0">
                              <Badge className={`text-xs ${billingColor(b.billing_status)}`} variant="outline">
                                {formatTrainingBillingStatus(b.billing_status)}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {TRAINING_BILLING_STATUS_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}

      {allBookings.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No bookings yet. Add attendees in the Attendees tab.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
