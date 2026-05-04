"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatEmissions } from "@/lib/format";
import { getToken } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type CertificateDetails = {
  certificate_id: number;
  certificate_number: string;
  client_name: string;
  job_number?: string | null;
  reporting_year: number;
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
  emissions: number;
  issued_at?: string | null;
  verified_by?: string | null;
  download_url?: string | null;
  client_logo_url?: string | null;
  signatory_name?: string | null;
  signatory_title?: string | null;
};

type Props = {
  jobId: number;
  baseUrl?: string;
};

function apiBaseUrl(): string {
  return "/api/backend";
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function resolveLogoPreviewSrc(raw: string | null | undefined, baseUrl: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  if (value.startsWith("/uploads/")) {
    return `${baseUrl.replace(/\/+$/, "")}${value}`;
  }
  if (value.startsWith("/api/backend/")) {
    return value;
  }
  return value;
}

function reportingPeriodLabel(details: CertificateDetails): string {
  if (details.reporting_period_start && details.reporting_period_end) {
    const start = formatDate(details.reporting_period_start);
    const end = formatDate(details.reporting_period_end);
    if (start && end) return `${start} to ${end}`;
  }
  if (details.reporting_year) {
    return `1 January ${details.reporting_year} to 31 December ${details.reporting_year}`;
  }
  return "Reporting period unavailable";
}

export default function JobEmissionsCertificate({ jobId, baseUrl = apiBaseUrl() }: Props) {
  const [certificate, setCertificate] = useState<CertificateDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [nziLogoSrc, setNziLogoSrc] = useState("");

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
        const token = getToken();
        const response = await fetch(`${baseUrl}/jobs/${jobId}/emissions-certificate`, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function loadNziLogo() {
      try {
        const res = await fetch(`${baseUrl}/system-settings/logo/file`, { credentials: "include" });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setNziLogoSrc(objectUrl);
      } catch {
        if (!cancelled) {
          setNziLogoSrc("");
        }
      }
    }

    void loadNziLogo();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [baseUrl]);

  const handleDownload = async () => {
    if (!jobId || downloading) return;
    setDownloading(true);
    try {
      const token = getToken();
      const res = await fetch(`${baseUrl}/jobs/${jobId}/emissions-certificate/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : `emissions-certificate-${jobId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const clientLogoSrc = certificate ? resolveLogoPreviewSrc(certificate.client_logo_url, baseUrl) : "";
  const signatoryName = certificate?.signatory_name || "David Hawes";
  const signatoryTitle = certificate?.signatory_title || "Chief Executive Officer";
  const issueDate = formatDate(certificate?.issued_at || "") || "On issue";
  const reportingPeriod = certificate ? reportingPeriodLabel(certificate) : "";

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Emissions Certificate
        </CardTitle>
        <CardDescription>
          A branded certificate preview matching the issued PDF for this job&apos;s reporting year and emissions total.
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
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
              <div className="p-6 md:p-10">
                <div className="flex items-start justify-between gap-4">
                  {nziLogoSrc ? (
                    <img
                      src={nziLogoSrc}
                      alt="Net Zero International"
                      className="h-16 w-auto object-contain md:h-20"
                    />
                  ) : (
                    <div className="flex h-16 w-40 items-center text-sm font-medium text-slate-500 md:h-20">
                      Net Zero International
                    </div>
                  )}
                  <div className="flex min-h-16 min-w-[9rem] items-center justify-end text-right text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {clientLogoSrc ? (
                      <img
                        src={clientLogoSrc}
                        alt={`${certificate.client_name} logo`}
                        className="max-h-16 max-w-[9rem] object-contain"
                      />
                    ) : (
                      <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-slate-500">
                        [CLIENT LOGO]
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-14 text-center">
                  <div className="text-[0.8rem] font-semibold uppercase tracking-[0.34em] text-slate-500">
                    Annual Carbon Emissions Certificate
                  </div>
                  <h2 className="mt-6 text-3xl font-semibold tracking-tight text-slate-800 md:text-5xl">
                    {certificate.client_name}
                  </h2>
                  <p className="mx-auto mt-8 max-w-4xl text-base leading-7 text-slate-600 md:text-lg">
                    Net Zero International has reviewed the greenhouse gas emissions data for the reporting period stated in
                    this document and confirms the total reported emissions shown below.
                  </p>

                  <div className="mt-14">
                    <div className="text-6xl font-semibold tracking-tight text-slate-800 md:text-7xl">
                      {formatEmissions(certificate.emissions, { decimals: 2 })}
                    </div>
                    <div className="mt-2 text-xl font-semibold text-slate-500">
                      tCO<sub>2</sub>e
                    </div>
                  </div>
                </div>

                <div className="mt-20 grid gap-8 md:grid-cols-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-800">Verified by Net Zero International</div>
                    <div className="mt-4 h-px w-52 bg-slate-300" />
                    <div className="mt-4 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">
                      Authorised Signatory
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-800">{signatoryName}</div>
                    <div className="text-sm text-slate-600">{signatoryTitle}</div>
                    <div className="mt-8 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Issue Date</div>
                    <div className="mt-2 text-base text-slate-800">{issueDate}</div>
                  </div>

                  <div>
                    <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Reporting Period
                    </div>
                    <div className="mt-3 text-lg text-slate-800">{reportingPeriod}</div>
                  </div>

                  <div>
                    <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Statement Number
                    </div>
                    <div className="mt-3 text-lg text-slate-800">{certificate.certificate_number}</div>
                  </div>
                </div>

                <div className="mt-14 rounded-xl bg-slate-100 px-6 py-5 text-center shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
                  <p className="mx-auto max-w-5xl text-sm leading-6 text-slate-500 md:text-[0.95rem]">
                    This document records the reported greenhouse gas emissions for the period identified above, as reviewed by
                    Net Zero International. It does not, by itself, represent carbon neutrality, offsetting, emissions reduction
                    performance, or independent third-party accreditation unless expressly stated.
                  </p>
                </div>

                <div className="mt-6 text-center text-sm text-slate-500">
                  Net Zero International Limited | netzero.international | Company No. 13587676 | VAT No. 389551642
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
              <span className={cn("text-sm text-muted-foreground")}>
                {certificate.verified_by || "Net Zero International"} sign-off included on the PDF.
              </span>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
