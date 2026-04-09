"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

function proxyBaseUrl(): string {
  return "/api/backend";
}

type XeroOAuthConfig = {
  redirect_uri?: string | null;
  scope?: string | null;
  start_url?: string | null;
};

export default function XeroOAuthConnectPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [redirectUri, setRedirectUri] = useState("");
  const [scope, setScope] = useState("");
  const [startUrl, setStartUrl] = useState("/xero/oauth/start");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(3);
  const [probeStatus, setProbeStatus] = useState("");
  const [probeLocation, setProbeLocation] = useState("");
  const [probing, setProbing] = useState(false);
  const [copied, setCopied] = useState(false);
  const probeDestination = probeLocation ? (() => {
    try {
      const url = new URL(probeLocation, baseUrl);
      return `${url.host}${url.pathname}`;
    } catch {
      return probeLocation;
    }
  })() : "";
  const probeDestinationHref = probeLocation
    ? (() => {
        try {
          return new URL(probeLocation, baseUrl).toString();
        } catch {
          return probeLocation;
        }
      })()
    : "";
  const probeBadge =
    probing
      ? {
          label: "Checking",
          className: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
        }
      : probeStatus.startsWith("Backend start URL returned redirect")
        ? {
            label: "Redirect OK",
            className: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
          }
        : probeStatus && probeStatus.includes("returned")
          ? {
              label: "Redirect Check",
              className: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200",
            }
          : probeStatus && probeStatus.toLowerCase().includes("failed")
            ? {
                label: "Redirect Failed",
                className: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200",
              }
            : {
                label: "Waiting",
                className: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300",
              };

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${proxyBaseUrl()}/xero/oauth/config`, { credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as XeroOAuthConfig;
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : "Failed to load Xero OAuth config");
      }
      setRedirectUri(String(payload.redirect_uri || ""));
      setScope(String(payload.scope || "accounting.contacts accounting.transactions offline_access"));
      setStartUrl(String(payload.start_url || "/xero/oauth/start"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const continueToXero = useCallback(() => {
    window.location.assign(`${baseUrl}${startUrl}`);
  }, [baseUrl, startUrl]);

  const probeStartRedirect = useCallback(async () => {
    setProbing(true);
    setProbeStatus("Checking backend start URL...");
    setProbeLocation("");
    setCopied(false);
    try {
      const res = await fetch(`${proxyBaseUrl()}/xero/oauth/start?probe_redirect=1`, {
        credentials: "include",
        cache: "no-store",
      });
      const status = res.headers.get("x-proxy-probe-status") || String(res.status);
      const location = res.headers.get("x-proxy-probe-location") || "";
      if (status.startsWith("30")) {
        setProbeStatus(`Backend start URL returned redirect ${status}.`);
      } else {
        setProbeStatus(`Backend start URL returned ${status}.`);
      }
      if (location) {
        setProbeLocation(location);
      }
    } catch (e) {
      setProbeStatus((e as Error).message || "Backend start URL probe failed.");
    } finally {
      setProbing(false);
    }
  }, []);

  const copyProbeDestination = useCallback(async () => {
    if (!probeLocation) return;
    try {
      await navigator.clipboard.writeText(probeDestinationHref || probeLocation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Unable to copy the redirect destination.");
    }
  }, [probeDestinationHref, probeLocation]);

  useEffect(() => {
    if (countdown === 0 && !loading && !error) {
      continueToXero();
    }
  }, [continueToXero, countdown, error, loading]);

  useEffect(() => {
    if (!loading && !error && !probeStatus) {
      void probeStartRedirect();
    }
  }, [error, loading, probeStartRedirect, probeStatus]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-3xl items-center">
        <Card className="w-full">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>Xero OAuth Handoff</CardTitle>
              <Badge variant="secondary">Debug step</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              This page exists to make the OAuth transition visible before the browser leaves NZI Pro.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-md border bg-muted/30 p-4 text-sm">
              <div className="font-medium">What happens next</div>
              <div className="mt-2 text-muted-foreground">
                After you continue, the app will open the backend start URL, set the OAuth state cookie there,
                and then redirect you to Xero for consent.
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Redirect URI</div>
                <div className="mt-2 break-all font-mono text-xs">
                  {redirectUri || "Loading redirect URI..."}
                </div>
              </div>
              <div className="rounded-md border p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Scope</div>
                <div className="mt-2 break-words font-mono text-xs">
                  {scope || "Loading scope..."}
                </div>
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-4 text-sm">
              <div className="font-medium">Backend start URL</div>
              <div className="mt-2 break-all font-mono text-xs">
                {`${baseUrl}${startUrl}`}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">Backend redirect check</div>
                <Badge variant="outline" className={probeBadge.className}>
                  {probeBadge.label}
                </Badge>
                {probeDestination ? (
                  <>
                    <a
                      href={probeDestinationHref || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                      title={probeDestinationHref || probeDestination}
                    >
                      {probeDestination}
                    </a>
                    <Button variant="ghost" size="sm" onClick={() => void copyProbeDestination()} disabled={!probeLocation}>
                      {copied ? "Copied" : "Copy URL"}
                    </Button>
                  </>
                ) : null}
              </div>
              <div className="mt-2 text-muted-foreground">
                {probeStatus || "Waiting to probe backend redirect..."}
              </div>
              {probeLocation ? (
                <div className="mt-2 break-all font-mono text-xs">
                  {probeLocation}
                </div>
              ) : null}
            </div>

            {error ? <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
            {loading ? <div className="text-sm text-muted-foreground">Loading Xero OAuth config...</div> : null}
            {probing ? <div className="text-sm text-muted-foreground">Probing backend redirect...</div> : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={continueToXero} disabled={loading}>
                Continue to Xero
                {countdown > 0 ? ` (${countdown})` : ""}
              </Button>
              <Button variant="outline" asChild>
                <Link href="/admin/settings">Back to System Settings</Link>
              </Button>
              <Button variant="ghost" onClick={() => void loadConfig()} disabled={loading}>
                Refresh Config
              </Button>
              <Button variant="outline" onClick={() => void probeStartRedirect()} disabled={loading || probing}>
                Recheck Redirect
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
