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
          <CardTitle>Legacy Report Generator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground mb-4">
            This is the current template-based flow. The new profile-first workspace lives in the Report (New) tab.
          </div>
          <ReportGenerator jobId={jobId} baseUrl={baseUrl} />
        </CardContent>
      </Card>
    </div>
  );
}
