"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmissionsSummary from "@/components/EmissionsSummary";
import ReportGenerator from "@/components/ReportGenerator";

type JobReportingProps = {
  jobId: number;
  baseUrl?: string;
};

export default function JobReporting({ jobId, baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "" }: JobReportingProps) {
  return (
    <div className="space-y-6">
      <EmissionsSummary jobId={jobId} baseUrl={baseUrl} />

      <Card>
        <CardHeader>
          <CardTitle>Report Generator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground mb-4">
            Assign template version, complete required variables, and generate report from one canonical flow.
          </div>
          <ReportGenerator jobId={jobId} baseUrl={baseUrl} />
        </CardContent>
      </Card>
    </div>
  );
}
