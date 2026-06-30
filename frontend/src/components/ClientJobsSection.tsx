"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingOrbit from "@/components/LoadingOrbit";
import MilestoneBadge from "@/components/MilestoneBadge";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatJobFamilyLabel, getJobFamilyDescription, jobFamilyBadgeClassName } from "@/lib/job-family";
import { milestoneDotClass } from "@/lib/status-utils";

type ClientJobsSectionProps = {
  loading?: boolean;
  jobs: Array<{
    job_id: number;
    job_number: string | null;
    title: string | null;
    reporting_year: number | null;
    status: string | null;
    job_type?: string | null;
    job_family?: string | null;
    is_crp?: boolean;
    milestone_status?: string | null;
    total_emissions?: number | null;
  }>;
};

export default function ClientJobsSection({ loading = false, jobs }: ClientJobsSectionProps) {
  const [familyFilter, setFamilyFilter] = useState<string>("all");

  const availableFamilies = useMemo(
    () =>
      Array.from(
        new Set(jobs.map((job) => String(job.job_family || job.job_type || "").trim().toLowerCase()).filter(Boolean))
      ).sort(),
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    if (familyFilter === "all") return jobs;
    return jobs.filter((job) => String(job.job_family || job.job_type || "").trim().toLowerCase() === familyFilter);
  }, [familyFilter, jobs]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingOrbit className="py-6" label="Loading jobs..." />
        </CardContent>
      </Card>
    );
  }

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

  if (filteredJobs.length === 0) {
    return (
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>Jobs ({jobs.length})</CardTitle>
          <div className="flex items-center gap-3">
            <label htmlFor="clientJobFamilyFilter" className="text-sm text-muted-foreground">
              Group
            </label>
            <Select value={familyFilter} onValueChange={setFamilyFilter}>
              <SelectTrigger id="clientJobFamilyFilter" className="w-[220px]">
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {availableFamilies.map((family) => (
                  <SelectItem key={family} value={family}>
                    <div className="flex items-center gap-2">
                      <span>{formatJobFamilyLabel(family)}</span>
                      <Badge className={jobFamilyBadgeClassName(family)} variant="outline">
                        {formatJobFamilyLabel(family)}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{getJobFamilyDescription(family)}</div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No jobs match the selected group.</div>
        </CardContent>
      </Card>
    );
  }

  const jobsByType = filteredJobs.reduce((acc, job) => {
    const type = job.job_family || job.job_type || "Unknown";
    if (!acc[type]) acc[type] = [];
    acc[type].push(job);
    return acc;
  }, {} as Record<string, typeof filteredJobs>);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>Jobs ({jobs.length})</CardTitle>
        <div className="flex items-center gap-3">
          <label htmlFor="clientJobFamilyFilter" className="text-sm text-muted-foreground">
            Group
          </label>
          <Select value={familyFilter} onValueChange={setFamilyFilter}>
            <SelectTrigger id="clientJobFamilyFilter" className="w-[220px]">
              <SelectValue placeholder="All groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {availableFamilies.map((family) => (
                <SelectItem key={family} value={family}>
                  <div className="flex items-center gap-2">
                    <span>{formatJobFamilyLabel(family)}</span>
                    <Badge className={jobFamilyBadgeClassName(family)} variant="outline">
                      {formatJobFamilyLabel(family)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{getJobFamilyDescription(family)}</div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(jobsByType).map(([jobType, typeJobs]) => (
          <div key={jobType}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{formatJobFamilyLabel(jobType)}</h3>
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
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={jobFamilyBadgeClassName(j.job_family || j.job_type)}>
                              {formatJobFamilyLabel(j.job_family || j.job_type)}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {getJobFamilyDescription(j.job_family || j.job_type)}
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
                        {emissionsValue > 0 && (
                          <div className="min-w-[120px] text-right">
                            <div className="text-base font-semibold">{emissionsFormatted}</div>
                            <div className="text-xs text-muted-foreground">tCO₂e</div>
                          </div>
                        )}
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
