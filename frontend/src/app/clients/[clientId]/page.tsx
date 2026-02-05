"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type Client = {
  client_db_id: number;
  client_name: string | null;
  industry: string | null;
  status: string | null;
  website: string | null;
  company_reg: string | null;
  headquarters: string | null;
  crm_owner: string | null;
};

type ClientJobsResponse = {
  client_db_id: number;
  items: Array<{
    job_id: number;
    job_number: string | null;
    title: string | null;
    reporting_year: number | null;
    status: string | null;
  }>;
  limit: number;
  offset: number;
  total: number;
};

type ClientSitesResponse = {
  client_db_id: number;
  sites: Array<{
    site_name: string | null;
    location: string | null;
    is_registered_office: boolean;
  }>;
};

export default function ClientDetailPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ clientId: string }>();
  const clientId = Number(params?.clientId);

  const [client, setClient] = useState<Client | null>(null);
  const [jobs, setJobs] = useState<ClientJobsResponse["items"]>([]);
  const [sites, setSites] = useState<ClientSitesResponse["sites"]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(clientId) || clientId <= 0) {
        setError("Invalid client id");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [cRes, jRes, sRes] = await Promise.all([
          fetch(`${baseUrl}/clients/${clientId}`),
          fetch(`${baseUrl}/clients/${clientId}/jobs?limit=50&offset=0`),
          fetch(`${baseUrl}/clients/${clientId}/sites`),
        ]);

        if (!cRes.ok) {
          const t = await cRes.text().catch(() => "");
          throw new Error(`Failed to load client: ${cRes.status} ${cRes.statusText}${t ? ` - ${t}` : ""}`);
        }
        const cJson = (await cRes.json()) as Client;

        const jJson = jRes.ok ? ((await jRes.json()) as ClientJobsResponse) : null;
        const sJson = sRes.ok ? ((await sRes.json()) as ClientSitesResponse) : null;

        if (cancelled) return;

        setClient(cJson);
        setJobs(jJson?.items ?? []);
        setSites(sJson?.sites ?? []);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setClient(null);
        setJobs([]);
        setSites([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{client?.client_name ?? "Client"}</h1>
            <div className="text-sm text-muted-foreground">Client ID: {Number.isFinite(clientId) ? clientId : "-"}</div>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link href={`/jobs/new?clientId=${clientId}`}>+ Add Job</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href={`/clients/${clientId}/edit`}>Edit Client</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/clients">Back to Clients</Link>
            </Button>
          </div>
        </div>

        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading...</div> : null}

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Industry:</span> {client?.industry ?? ""}
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span> {client?.status ?? ""}
              </div>
              <div>
                <span className="text-muted-foreground">CRM Owner:</span> {client?.crm_owner ?? ""}
              </div>
              <div>
                <span className="text-muted-foreground">HQ:</span> {client?.headquarters ?? ""}
              </div>
              <div>
                <span className="text-muted-foreground">Reg:</span> {client?.company_reg ?? ""}
              </div>
              <div>
                <span className="text-muted-foreground">Website:</span> {client?.website ?? ""}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sites ({sites.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {sites.length === 0 ? (
                <div className="text-sm text-muted-foreground">No sites.</div>
              ) : (
                <div className="space-y-2">
                  {sites.map((s, idx) => (
                    <div key={`${s.site_name ?? "site"}-${idx}`} className="rounded-md border px-3 py-2 text-sm">
                      <div className="font-medium">{s.site_name ?? ""}</div>
                      <div className="text-muted-foreground">
                        {(s.location ?? "") + (s.is_registered_office ? " (Registered Office)" : "")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Jobs ({jobs.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <div className="text-sm text-muted-foreground">No jobs.</div>
              ) : (
                <div className="space-y-2">
                  {jobs.map((j) => (
                    <div key={j.job_id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`/jobs/${j.job_id}`} className="min-w-0 flex-1">
                          <div className="font-medium">
                            {(j.job_number ?? `Job ${j.job_id}`) + (j.reporting_year ? ` (${j.reporting_year})` : "")}
                          </div>
                          <div className="text-muted-foreground">{j.title ?? ""}</div>
                          <div className="text-muted-foreground">Status: {j.status ?? ""}</div>
                        </Link>
                        <Button variant="secondary" asChild>
                          <Link href={`/?clientId=${clientId}&jobId=${j.job_id}`}>Open in Hub</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
