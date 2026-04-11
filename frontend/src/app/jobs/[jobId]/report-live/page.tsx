"use client";

import { useParams } from "next/navigation";

import JobLiveReport from "@/components/JobLiveReport";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobLiveReportPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  return <JobLiveReport jobId={jobId} baseUrl={apiBaseUrl()} />;
}
