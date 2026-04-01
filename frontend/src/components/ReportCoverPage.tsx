"use client";

import { useEffect, useMemo, useState } from "react";

type ReportCoverPageProps = {
  clientName: string;
  reportTitle?: string;
  reportingYear: number;
  reportingPeriodStart?: string;
  reportingPeriodEnd?: string;
  jobNumber: string;
  generatedDate?: string;
  clientLogoUrl?: string;
  baseUrl: string;
};

export default function ReportCoverPage({
  clientName,
  reportTitle = "Annual Carbon Emissions Report",
  reportingYear,
  reportingPeriodStart,
  reportingPeriodEnd,
  jobNumber,
  generatedDate,
  clientLogoUrl,
  baseUrl,
}: ReportCoverPageProps) {
  const [nziLogoUrl, setNziLogoUrl] = useState<string | null>(null);
  const resolvedClientLogoUrl = useMemo(() => {
    const raw = String(clientLogoUrl || "").trim();
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) {
      return raw;
    }
    if (raw.startsWith("/uploads/")) {
      return `${baseUrl.replace(/\/+$/, "")}${raw}`;
    }
    if (raw.startsWith("/api/backend/")) {
      return raw;
    }
    return raw;
  }, [baseUrl, clientLogoUrl]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${baseUrl}/system-settings/nzi_logo_file`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.setting_value) {
            setNziLogoUrl(`${baseUrl}/system-settings/logo/file`);
          }
        }
      } catch (e) {
        console.error("Failed to load NZI logo:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const today = generatedDate || new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className="relative min-h-screen bg-white flex flex-col items-center justify-between p-12 print:p-8">
      {/* Top Section - NZI Logo */}
      {nziLogoUrl && (
        <div className="w-full flex justify-center mb-8">
          <div className="relative" style={{ height: '250px', width: 'auto' }}>
            <img
              src={nziLogoUrl}
              alt="Net Zero International"
              style={{ 
                height: '250px',
                width: 'auto',
                objectFit: 'contain'
              }}
            />
          </div>
        </div>
      )}

      {/* Middle Section - Title and Details */}
      <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8">
        {/* Client Logo */}
        {resolvedClientLogoUrl && (
          <div className="mb-6">
            <img
              src={resolvedClientLogoUrl}
              alt={`${clientName} Logo`}
              style={{
                maxHeight: '150px',
                maxWidth: '400px',
                objectFit: 'contain'
              }}
            />
          </div>
        )}

        {/* Report Title - 60% of original size */}
        <h1 
          className="font-bold leading-tight"
          style={{ 
            color: '#C62828',
            fontSize: '2.4rem' // 60% of 4rem (text-6xl equivalent)
          }}
        >
          {reportTitle}
        </h1>

        {/* Year */}
        <div className="text-4xl text-gray-600 font-light">
          {reportingYear}
        </div>

        {/* Details Box */}
        <div className="mt-12 w-full max-w-2xl">
          <div className="bg-gray-50 rounded-lg p-8 border-l-4" style={{ borderColor: '#C62828' }}>
            <div className="space-y-4 text-left">
              <div className="grid grid-cols-[140px_1fr] gap-4">
                <div className="text-gray-600 font-medium">Client:</div>
                <div className="text-gray-900">{clientName}</div>
              </div>

              <div className="grid grid-cols-[140px_1fr] gap-4">
                <div className="text-gray-600 font-medium">Report Title:</div>
                <div className="text-gray-900">{reportTitle}</div>
              </div>

              <div className="grid grid-cols-[140px_1fr] gap-4">
                <div className="text-gray-600 font-medium">Reporting Year:</div>
                <div className="text-gray-900">{reportingYear}</div>
              </div>

              {reportingPeriodStart && reportingPeriodEnd && (
                <div className="grid grid-cols-[140px_1fr] gap-4">
                  <div className="text-gray-600 font-medium">Reporting Period:</div>
                  <div className="text-gray-900">
                    {new Date(reportingPeriodStart).toLocaleDateString('en-GB')} to{' '}
                    {new Date(reportingPeriodEnd).toLocaleDateString('en-GB')}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-[140px_1fr] gap-4">
                <div className="text-gray-600 font-medium">Job Number:</div>
                <div className="text-gray-900">{jobNumber}</div>
              </div>

              <div className="grid grid-cols-[140px_1fr] gap-4">
                <div className="text-gray-600 font-medium">Generated:</div>
                <div className="text-gray-900">{today}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section - No page number (hidden) */}
      <div className="w-full text-center text-gray-400 text-sm invisible">
        {/* Page number hidden as requested */}
      </div>

      {/* Print styles */}
      <style jsx>{`
        @media print {
          .print\\:p-8 {
            padding: 2rem;
          }
          
          /* Hide page numbers in print */
          @page {
            margin: 0;
          }
          
          /* Ensure page break after cover */
          .relative {
            page-break-after: always;
          }
        }
      `}</style>
    </div>
  );
}
