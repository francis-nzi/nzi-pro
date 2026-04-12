"use client";

import { useParams, useSearchParams } from "next/navigation";

import JobLiveReport from "@/components/JobLiveReport";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobLiveReportPage() {
  const params = useParams<{ jobId: string }>();
  const searchParams = useSearchParams();
  const jobId = Number(params?.jobId);
  const printMode = searchParams.get("print") === "1";

  return <JobLiveReport jobId={jobId} baseUrl={apiBaseUrl()} printMode={printMode} />;
}
