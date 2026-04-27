"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatEmissions } from "@/lib/format";

type CertificateDetails = {
  certificate_id: number;
  certificate_number: string;
  client_name: string;
  job_number?: string | null;
  reporting_year: number;
  emissions: number;
  issued_at?: string | null;
  verified_by?: string | null;
  download_url?: string | null;
};

type Props = {
  jobId: number;
  baseUrl?: string;
};

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobEmissionsCertificate({ jobId, baseUrl = apiBaseUrl() }: Props) {
  const [certificate, setCertificate] = useState<CertificateDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCertificate() {
      if (!Number.isFinite(jobId) || jobId <= 0) {
        setError("Invalid job id");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${baseUrl}/jobs/${jobId}/emissions-certificate`, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
          },
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(text || `Failed to load certificate (${response.status})`);
        }
        const data = (await response.json()) as CertificateDetails;
        if (!cancelled) {
          setCertificate(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setCertificate(null);
          setError(err instanceof Error ? err.message : "Failed to load certificate");
          setLoading(false);
        }
      }
    }

    loadCertificate();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId]);

  const handleDownload = () => {
    if (!jobId || downloading) return;
    setDownloading(true);
    try {
      window.open(`${baseUrl}/jobs/${jobId}/emissions-certificate/pdf?ts=${Date.now()}`, "_blank", "noopener,noreferrer");
    } finally {
      setTimeout(() => setDownloading(false), 1000);
    }
  };

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Carbon Emissions Certificate
        </CardTitle>
        <CardDescription>
          Download a verified certificate for the job&apos;s reporting year and emissions total.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing certificate details...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : certificate ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Certificate No.</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{certificate.certificate_number}</div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Reporting Year</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{certificate.reporting_year}</div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Client</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{certificate.client_name}</div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Emissions</div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {formatEmissions(certificate.emissions, { decimals: 2 })} tCO2e
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Verified by Net Zero International.
              <div className="mt-1 text-emerald-800">
                This certificate may be downloaded for client records and reporting packs.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleDownload} disabled={downloading}>
                {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Download Certificate
              </Button>
              <span className="text-sm text-muted-foreground">
                {certificate.verified_by || "Net Zero International"} sign-off included on the PDF.
              </span>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
