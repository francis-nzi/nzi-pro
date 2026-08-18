"use client";

import { useParams } from "next/navigation";

import ActivityHistoryModal from "@/components/ActivityHistoryModal";
import EmployeeCommutingData from "@/components/EmployeeCommutingData";
import JobCustomDataset from "@/components/JobCustomDataset";
import JobCustomFactors from "@/components/JobCustomFactors";
import JobDataEntry from "@/components/JobDataEntry";
import JobNotesSummary from "@/components/JobNotesSummary";
import JobSourceRegister from "@/components/JobSourceRegister";
import PendingPortalSourceSubmissions from "@/components/PendingPortalSourceSubmissions";
import SpendDataCollection from "@/components/SpendDataCollection";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

const DATA_SECTIONS: Record<string, { label: string; entityType?: string }> = {
  "data-entry":         { label: "Data Entry",         entityType: "job_scope_row" },
  "employee-commuting": { label: "Employee Commuting",  entityType: "employee_commuting_direct_entry,employee_commuting_import" },
  "asset-register":     { label: "Asset Register",      entityType: "job_scope_row" },
  "business-travel":    { label: "Business Travel",     entityType: "job_scope_row,job_emission_register_import" },
  "custom-dataset":     { label: "Custom Dataset" },
  "custom-factors":     { label: "Client Factors",   entityType: "job_custom_factor" },
  "spend-data":         { label: "Spend Data",          entityType: "spend_entry,job_scope_row" },
  notes:                { label: "Notes" },
};

export default function JobDataSectionPage() {
  const params = useParams<{ jobId: string; section: string }>();
  const jobId = Number(params?.jobId);
  const sectionSegment = String(params?.section || "data-entry").toLowerCase();
  const section = DATA_SECTIONS[sectionSegment] ?? null;
  const baseUrl = apiBaseUrl();

  if (!section) {
    return <div className="p-6 text-sm text-muted-foreground">Unknown data section.</div>;
  }

  const historyButton = section.entityType ? (
    <ActivityHistoryModal
      jobId={jobId}
      baseUrl={baseUrl}
      entityType={section.entityType}
      label="Activity History"
    />
  ) : null;

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel={section.label}
      sectionHref={`/jobs/${jobId}/data-entry/${sectionSegment}`}
      activeGroup="data"
      activeSubtab={sectionSegment}
      headerSlot={historyButton}
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
              <div className="space-y-4">
                <PendingPortalSourceSubmissions
                  jobId={jobId}
                  baseUrl={baseUrl}
                  sourceType="asset"
                  title="Pending Portal Submissions"
                />
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
              </div>
            );
          case "business-travel":
            return (
              <div className="space-y-4">
                <PendingPortalSourceSubmissions
                  jobId={jobId}
                  baseUrl={baseUrl}
                  sourceType="business_travel"
                  title="Pending Portal Submissions"
                />
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
              </div>
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
