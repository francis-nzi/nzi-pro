"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PortalReportViewer({ jobId }: { jobId: number }) {
  const [loaded, setLoaded] = useState(false);

  const reportUrl = useMemo(() => `/api/backend/portal/jobs/${jobId}/report-html`, [jobId]);

  useEffect(() => {
    setLoaded(false);
  }, [reportUrl]);

  return (
    <Card className="overflow-hidden border-gray-200 shadow-sm">
      <CardHeader className="border-b border-gray-100 bg-white py-3">
        <CardTitle className="text-base">Client Report</CardTitle>
        <p className="text-sm text-gray-500">
          Showing the latest saved review snapshot from the app.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {!loaded ? (
          <div className="flex h-64 items-center justify-center text-sm text-gray-400">
            Loading report…
          </div>
        ) : null}
        <iframe
          title={`Client report for job ${jobId}`}
          src={reportUrl}
          onLoad={() => setLoaded(true)}
          className={`w-full border-0 ${loaded ? "block" : "h-0 opacity-0"}`}
          style={{ minHeight: "80vh" }}
        />
      </CardContent>
    </Card>
  );
}
