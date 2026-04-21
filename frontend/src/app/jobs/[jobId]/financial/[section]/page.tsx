"use client";

import { useParams } from "next/navigation";

import JobFinancial from "@/components/JobFinancial";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

const FINANCIAL_SECTIONS = {
  quotes: { key: "financial-quotes", label: "Quotes", mode: "quotes" as const },
  invoices: { key: "financial-invoices", label: "Invoices", mode: "invoices" as const },
  "other-costs": { key: "financial-other-costs", label: "Other Costs", mode: "other-costs" as const },
  "profit-loss": { key: "financial-profit-loss", label: "Profit & Loss", mode: "profit-loss" as const },
} as const;

type FinancialSectionKey = keyof typeof FINANCIAL_SECTIONS;

export default function JobFinancialSectionPage() {
  const params = useParams<{ jobId: string; section: string }>();
  const jobId = Number(params?.jobId);
  const sectionSegment = String(params?.section || "quotes").toLowerCase();
  const section = FINANCIAL_SECTIONS[sectionSegment as FinancialSectionKey] ?? FINANCIAL_SECTIONS.quotes;
  const baseUrl = apiBaseUrl();

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel={section.label}
      sectionHref={`/jobs/${jobId}/financial/${sectionSegment}`}
      activeGroup="financial"
      activeSubtab={section.key}
      renderContent={(job) => (
        <JobFinancial
          jobId={jobId}
          clientId={job.client_db_id}
          jobNumber={job.job_number}
          baseUrl={baseUrl}
          mode={section.mode}
        />
      )}
    />
  );
}
