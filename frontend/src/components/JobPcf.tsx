"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatJobFamilyLabel, getJobFamilyDescription, jobFamilyBadgeClassName } from "@/lib/job-family";

type JobPcfProps = {
  jobId: number;
  baseUrl: string;
  jobFamily?: string | null;
};

type PcfDetails = {
  job_id: number | null;
  product_name: string | null;
  product_code: string | null;
  functional_unit_value: number | null;
  functional_unit_unit: string | null;
  system_boundary: string | null;
  methodology: string | null;
  reporting_standard: string | null;
  notes: string | null;
};

export default function JobPcf({ jobId, baseUrl, jobFamily }: JobPcfProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [details, setDetails] = useState<PcfDetails>({
    job_id: null,
    product_name: null,
    product_code: null,
    functional_unit_value: null,
    functional_unit_unit: null,
    system_boundary: null,
    methodology: null,
    reporting_standard: null,
    notes: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setStatus("");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/pcf-details`, { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as PcfDetails;
        if (!cancelled) setDetails(json);
      } catch {
        if (!cancelled) setStatus("Failed to load PCF details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (jobFamily === "pcf") {
      void load();
    }

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobFamily, jobId]);

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/pcf-details`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(details),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }
      const json = (await res.json()) as PcfDetails;
      setDetails(json);
      setStatus("PCF details saved.");
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (jobFamily !== "pcf") return null;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="tracking-tight" style={{ color: "#0F766E" }}>
          PCF Details
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge className={jobFamilyBadgeClassName("pcf")} variant="outline">
            {formatJobFamilyLabel("pcf")}
          </Badge>
          <span>{getJobFamilyDescription("pcf")}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Capture the product scope, functional unit, and reporting context for this footprinting engagement.
        </p>
        {status ? <div className="rounded-md bg-muted px-3 py-2 text-sm">{status}</div> : null}
        {loading ? <div className="text-sm text-muted-foreground">Loading PCF details...</div> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="productName">Product Name</Label>
            <Input
              id="productName"
              value={details.product_name || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, product_name: e.target.value || null }))}
              placeholder="Product or product family"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="productCode">Product Code</Label>
            <Input
              id="productCode"
              value={details.product_code || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, product_code: e.target.value || null }))}
              placeholder="SKU / item code"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="functionalUnitValue">Functional Unit Value</Label>
            <Input
              id="functionalUnitValue"
              type="number"
              min="0"
              step="0.01"
              value={details.functional_unit_value ?? ""}
              onChange={(e) =>
                setDetails((prev) => ({
                  ...prev,
                  functional_unit_value: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="functionalUnitUnit">Functional Unit Unit</Label>
            <Input
              id="functionalUnitUnit"
              value={details.functional_unit_unit || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, functional_unit_unit: e.target.value || null }))}
              placeholder="kg product / item / pack"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="systemBoundary">System Boundary</Label>
            <Input
              id="systemBoundary"
              value={details.system_boundary || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, system_boundary: e.target.value || null }))}
              placeholder="Cradle to gate / cradle to grave"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reportingStandard">Reporting Standard</Label>
            <Input
              id="reportingStandard"
              value={details.reporting_standard || ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, reporting_standard: e.target.value || null }))}
              placeholder="GHG Protocol / ISO 14067 / PAS 2050"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="methodology">Methodology</Label>
          <Textarea
            id="methodology"
            value={details.methodology || ""}
            onChange={(e) => setDetails((prev) => ({ ...prev, methodology: e.target.value || null }))}
            rows={3}
            placeholder="Describe the modelling methodology, assumptions, and scope..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={details.notes || ""}
            onChange={(e) => setDetails((prev) => ({ ...prev, notes: e.target.value || null }))}
            rows={4}
            placeholder="Internal notes, assumptions, or next steps..."
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save PCF Details"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
