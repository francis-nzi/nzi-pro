"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import ClientReporting from "@/components/ClientReporting";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type Client = {
  client_db_id: number;
  client_name: string | null;
};

export default function ClientReportingPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ clientId: string }>();
  const clientId = Number(params?.clientId);

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadClient() {
      if (!Number.isFinite(clientId) || clientId <= 0) return;
      
      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}`);
        if (res.ok) {
          const data = await res.json();
          setClient(data);
        }
      } catch (e) {
        console.error("Failed to load client:", e);
      } finally {
        setLoading(false);
      }
    }
    
    loadClient();
  }, [clientId, baseUrl]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>
              {loading ? "Loading..." : client?.client_name ? `${client.client_name} - Reporting` : "Reporting"}
            </h1>
            <div className="text-sm text-muted-foreground">
              Year-over-year emissions comparison
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href={`/clients/${clientId}`}>Back to Client</Link>
            </Button>
          </div>
        </div>

        <ClientReporting clientId={clientId} baseUrl={baseUrl} />
      </div>
    </div>
  );
}
