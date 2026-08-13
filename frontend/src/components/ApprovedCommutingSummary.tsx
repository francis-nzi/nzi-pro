"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ApprovedCommutingRow = {
  source_id: number;
  employee_name: string | null;
  source_subtype: string | null;
  qty: number | null;
  uom: string | null;
  calc_tco2e: number | null;
  notes: string | null;
};

type Props = {
  jobId: number;
  baseUrl: string;
  /** Bumped by the parent to force a refetch after a review action elsewhere on the page. */
  refreshKey?: number | string;
};

/** Read-only view of approved Employee Commuting rows, since that data lives
 * in job_emission_sources (not job_scope_rows) and so never otherwise shows
 * up on the Data Entry page -- see list_approved_commuting_rows. Editing
 * still happens on the dedicated Employee Commuting tab. */
export default function ApprovedCommutingSummary({ jobId, baseUrl, refreshKey }: Props) {
  const [rows, setRows] = useState<ApprovedCommutingRow[]>([]);
  const [totalTco2e, setTotalTco2e] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/approved-summary`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => {
        if (cancelled) return;
        setRows(Array.isArray(json?.rows) ? json.rows : []);
        setTotalTco2e(Number(json?.total_tco2e || 0));
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setTotalTco2e(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, baseUrl, refreshKey]);

  if (loading || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <CardTitle className="flex items-center gap-2 text-base">
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Employee Commuting
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
              {rows.length} approved &middot; {totalTco2e.toFixed(2)} tCO&#8322;e
            </span>
          </CardTitle>
          <Link
            href={`/jobs/${jobId}/data-entry/employee-commuting`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-primary hover:underline"
          >
            Manage on Employee Commuting tab
          </Link>
        </button>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-2 pt-0">
          <p className="text-xs text-muted-foreground">
            Read-only here &mdash; this data is entered and approved on the Employee Commuting tab, not edited from Data Entry.
          </p>
          <div className="divide-y rounded-md border">
            {rows.map((row) => (
              <div key={row.source_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{row.employee_name || "Unnamed"}</span>{" "}
                  <span className="text-muted-foreground">&middot; {row.source_subtype || "commuting"}</span>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {row.qty ?? "-"} {row.uom || ""} &middot; {row.calc_tco2e?.toFixed(4) ?? "-"} tCO&#8322;e
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
