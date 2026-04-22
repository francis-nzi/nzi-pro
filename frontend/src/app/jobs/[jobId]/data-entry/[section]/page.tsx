"use client";

import { useParams } from "next/navigation";

import EmployeeCommutingData from "@/components/EmployeeCommutingData";
import JobCustomDataset from "@/components/JobCustomDataset";
import JobCustomFactors from "@/components/JobCustomFactors";
import JobDataEntry from "@/components/JobDataEntry";
import JobNotesSummary from "@/components/JobNotesSummary";
import JobSourceRegister from "@/components/JobSourceRegister";
import SpendDataCollection from "@/components/SpendDataCollection";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

const DATA_SECTIONS = {
  "data-entry": { label: "Data Entry" },
  "employee-commuting": { label: "Employee Commuting" },
  "asset-register": { label: "Asset Register" },
  "business-travel": { label: "Business Travel" },
  "custom-dataset": { label: "Custom Dataset" },
  "custom-factors": { label: "Job-Only Factors" },
  "spend-data": { label: "Spend Data" },
  notes: { label: "Notes" },
} as const;

type DataSectionKey = keyof typeof DATA_SECTIONS;

export default function JobDataSectionPage() {
  const params = useParams<{ jobId: string; section: string }>();
  const jobId = Number(params?.jobId);
  const sectionSegment = String(params?.section || "data-entry").toLowerCase();
  const section = DATA_SECTIONS[sectionSegment as DataSectionKey] ?? null;
  const baseUrl = apiBaseUrl();

  if (!section) {
    return <div className="p-6 text-sm text-muted-foreground">Unknown data section.</div>;
  }

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel={section.label}
      sectionHref={`/jobs/${jobId}/data-entry/${sectionSegment}`}
      activeGroup="data"
      activeSubtab={sectionSegment}
      renderContent={(job) => {
        switch (sectionSegment) {
          case "data-entry":
            return <JobDataEntry jobId={jobId} />;
          case "employee-commuting":
            return (
              <EmployeeCommutingData
                jobId={jobId}
                baseUrl={baseUrl}
                jobNumber={job.job_number}
                clientName={job.client_name}
                reportingPeriodStart={job.reporting_period_start}
                reportingPeriodEnd={job.reporting_period_end}
              />
            );
          case "asset-register":
            return (
              <JobSourceRegister
                jobId={jobId}
                baseUrl={baseUrl}
                sourceType="asset"
                title="Asset Register"
                description="Capture individual vehicles, equipment, and other Scope 1 sources, then group them for roll-up and reporting."
                jobNumber={job.job_number}
                clientName={job.client_name}
                reportingYear={job.reporting_year}
              />
            );
          case "business-travel":
            return (
              <JobSourceRegister
                jobId={jobId}
                baseUrl={baseUrl}
                sourceType="business_travel"
                title="Business Travel Data Upload"
                description="Download the business travel workbook, compare prior-year factors, and import completed rows into Data Entry."
                jobNumber={job.job_number}
                clientName={job.client_name}
                reportingYear={job.reporting_year}
              />
            );
          case "custom-dataset":
            return <JobCustomDataset jobId={jobId} baseUrl={baseUrl} />;
          case "custom-factors":
            return (
              <JobCustomFactors
                jobId={jobId}
                baseUrl={baseUrl}
                jobNumber={job.job_number}
                clientName={job.client_name}
                reportingYear={job.reporting_year}
              />
            );
          case "spend-data":
            return <SpendDataCollection jobId={jobId} baseUrl={baseUrl} />;
          case "notes":
            return <JobNotesSummary jobId={jobId} baseUrl={baseUrl} />;
          default:
            return <div className="p-6 text-sm text-muted-foreground">Unknown data section.</div>;
        }
      }}
    />
  );
}
