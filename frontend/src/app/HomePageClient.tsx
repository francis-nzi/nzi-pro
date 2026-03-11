"use client";

import { useMemo } from "react";
import MainDashboard from "@/components/MainDashboard";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

export default function HomePageClient() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <MainDashboard baseUrl={baseUrl} />
      </div>
    </div>
  );
}
