"use client";

import { useState, useEffect, useCallback } from "react";
import type { TrainingOverview, TrainingLogEntry } from "./types";

export function useTrainingData(jobId: number, baseUrl: string) {
  const [overview, setOverview] = useState<TrainingOverview | null>(null);
  const [automationLog, setAutomationLog] = useState<TrainingLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [overviewRes, logRes] = await Promise.all([
          fetch(`${baseUrl}/jobs/${jobId}/training-overview`),
          fetch(`${baseUrl}/jobs/${jobId}/training-automation-log?limit=50`),
        ]);
        if (cancelled) return;
        if (overviewRes.ok) setOverview(await overviewRes.json());
        if (logRes.ok) {
          const data = await logRes.json();
          setAutomationLog(data.items ?? []);
        }
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [jobId, baseUrl, refreshToken]);

  return { overview, automationLog, loading, refresh };
}
