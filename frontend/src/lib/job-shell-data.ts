"use client";

import { getToken } from "@/lib/auth-client";

export type JobShellJob = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  status: string | null;
  job_family?: string | null;
  job_template_id?: number | null;
  milestone_template_id?: number | null;
  client_db_id: number;
  client_name: string | null;
  crm_owner?: string | null;
  crm_name?: string | null;
};

export type JobShellData = {
  job: JobShellJob;
  clientOwnerLabel: string;
  clientBenchmarkPeriodLabel: string;
};

const cache = new Map<string, JobShellData>();
const inFlight = new Map<string, Promise<JobShellData>>();

function cacheKey(baseUrl: string, jobId: number): string {
  return `${baseUrl}::${jobId}`;
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatDateLabel(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

async function fetchJobShellData(baseUrl: string, jobId: number): Promise<JobShellData> {
  const jobRes = await fetch(`${baseUrl}/jobs/${jobId}`, {
    credentials: "include",
    headers: authHeaders(),
  });
  if (!jobRes.ok) {
    throw new Error(`Failed to load job (${jobRes.status})`);
  }
  const job = (await jobRes.json()) as JobShellJob;

  let clientOwnerLabel = "";
  let clientBenchmarkPeriodLabel = "";
  if (job.client_db_id) {
    try {
      const clientRes = await fetch(`${baseUrl}/clients/${job.client_db_id}`, {
        credentials: "include",
        headers: authHeaders(),
      });
      if (clientRes.ok) {
        const clientJson = (await clientRes.json()) as {
          crm_owner?: string | null;
          benchmark_period_start?: string | null;
          benchmark_period_end?: string | null;
        };
        clientOwnerLabel = (clientJson.crm_owner ?? "").trim();
        const benchmarkStart = formatDateLabel(clientJson.benchmark_period_start);
        const benchmarkEnd = formatDateLabel(clientJson.benchmark_period_end);
        clientBenchmarkPeriodLabel = benchmarkStart && benchmarkEnd ? `${benchmarkStart} - ${benchmarkEnd}` : "";
      }
    } catch {
      // Leave labels blank; the job shell can still render.
    }
  }

  return {
    job,
    clientOwnerLabel,
    clientBenchmarkPeriodLabel,
  };
}

export function getCachedJobShellData(baseUrl: string, jobId: number): JobShellData | null {
  return cache.get(cacheKey(baseUrl, jobId)) || null;
}

export function primeJobShellData(baseUrl: string, jobId: number, data: JobShellData): void {
  cache.set(cacheKey(baseUrl, jobId), data);
}

export function clearJobShellDataCache(baseUrl?: string, jobId?: number): void {
  if (typeof jobId === "number" && baseUrl) {
    cache.delete(cacheKey(baseUrl, jobId));
    inFlight.delete(cacheKey(baseUrl, jobId));
    return;
  }
  if (typeof jobId === "number") {
    const matchKey = Array.from(cache.keys()).find((key) => key.endsWith(`::${jobId}`));
    if (matchKey) {
      cache.delete(matchKey);
      inFlight.delete(matchKey);
    }
    return;
  }
  cache.clear();
  inFlight.clear();
}

export async function loadJobShellData(
  baseUrl: string,
  jobId: number,
  options?: { refresh?: boolean }
): Promise<JobShellData> {
  const key = cacheKey(baseUrl, jobId);
  const cached = cache.get(key);
  if (cached && !options?.refresh) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = fetchJobShellData(baseUrl, jobId)
    .then((data) => {
      cache.set(key, data);
      inFlight.delete(key);
      return data;
    })
    .catch((error) => {
      inFlight.delete(key);
      throw error;
    });

  inFlight.set(key, promise);
  return promise;
}
