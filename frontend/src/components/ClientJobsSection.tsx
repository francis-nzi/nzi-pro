"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import MilestoneBadge from "@/components/MilestoneBadge";
import StatusBadge from "@/components/StatusBadge";
import { milestoneDotClass } from "@/lib/status-utils";

type ClientJobsSectionProps = {
  clientId: number;
  jobs: Array<{
    job_id: number;
    job_number: string | null;
    title: string | null;
    reporting_year: number | null;
    status: string | null;
    job_type?: string | null;
    is_crp?: boolean;
    milestone_status?: string | null;
    total_emissions?: number | null;
  }>;
};

export default function ClientJobsSection({ clientId, jobs }: ClientJobsSectionProps) {
  if (jobs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No jobs.</div>
        </CardContent>
      </Card>
    );
  }

  const jobsByType = jobs.reduce((acc, job) => {
    const type = job.job_type || "Unknown";
    if (!acc[type]) acc[type] = [];
    acc[type].push(job);
    return acc;
  }, {} as Record<string, typeof jobs>);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobs ({jobs.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(jobsByType).map(([jobType, typeJobs]) => (
          <div key={jobType}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{jobType}</h3>
            <div className="space-y-2">
              {typeJobs.map((j) => {
                const statusColor = milestoneDotClass(j.milestone_status);
                const emissionsValue = Number(j.total_emissions ?? 0);
                const emissionsFormatted = emissionsValue.toLocaleString("en-GB", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                });

                return (
                  <div key={j.job_id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex items-center pt-1">
                          <div className={`h-3 w-3 rounded-full ${statusColor}`} />
                        </div>
                        <Link href={`/jobs/${j.job_id}`} className="min-w-0 flex-1">
                          <div className="font-medium">
                            {(j.job_number ?? `Job ${j.job_id}`) + (j.reporting_year ? ` (${j.reporting_year})` : "")}
                          </div>
                          <div className="text-muted-foreground">{j.title ?? ""}</div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span>Status:</span>
                            <StatusBadge status={j.status} />
                          </div>
                        </Link>
                      </div>
                      <div className="flex items-center gap-3">
                        <MilestoneBadge status={j.milestone_status} className="hidden sm:inline-flex" />
                        <div className="min-w-[120px] text-right">
                          <div className="text-base font-semibold">{emissionsFormatted}</div>
                          <div className="text-xs text-muted-foreground">tCO2e</div>
                        </div>
                        <Button variant="secondary" asChild>
                          <Link href={`/jobs/${j.job_id}`}>Go to Job</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
