"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

type IntensityMetric = {
  label: string;
  value: number;
  divider: number;
};

type IntensityMetrics = {
  [key: string]: IntensityMetric;
};

type IntensityMetricsProps = {
  jobId: number;
  baseUrl: string;
  totalEmissions: number;
  currency?: string;
};

const DIVIDER_OPTIONS = [
  { value: 1, label: "Per 1" },
  { value: 10, label: "Per 10" },
  { value: 100, label: "Per 100" },
  { value: 1000, label: "Per 1,000" },
  { value: 10000, label: "Per 10,000" },
  { value: 100000, label: "Per 100,000" },
  { value: 1000000, label: "Per 1,000,000" },
];

export default function IntensityMetrics({ jobId, baseUrl, totalEmissions, currency = "GBP" }: IntensityMetricsProps) {
  const confirmAction = useConfirmDialog();
  const [metrics, setMetrics] = useState<IntensityMetrics>({});
  const [defaultMetrics, setDefaultMetrics] = useState<IntensityMetrics>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddMetric, setShowAddMetric] = useState(false);
  const [newMetricKey, setNewMetricKey] = useState("");
  const [newMetricLabel, setNewMetricLabel] = useState("");
  const [newMetricValue, setNewMetricValue] = useState("");
  const [newMetricDivider, setNewMetricDivider] = useState(1);

  const loadMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${baseUrl}/jobs/${jobId}/intensity-metrics`);
      if (!res.ok) throw new Error("Failed to load intensity metrics");
      const data = await res.json();
      const jobMetrics = data.metrics && typeof data.metrics === "object" ? data.metrics : {};
      const globalDefaults = data.defaults && typeof data.defaults === "object" ? data.defaults : {};
      setDefaultMetrics(globalDefaults);
      if (jobMetrics && Object.keys(jobMetrics).length > 0) {
        setMetrics(jobMetrics);
      } else if (globalDefaults && Object.keys(globalDefaults).length > 0) {
        setMetrics(globalDefaults);
      } else {
        setMetrics({});
      }
    } catch (e) {
      console.error("Failed to load intensity metrics:", e);
      setMetrics({});
      setDefaultMetrics({});
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const saveMetrics = useCallback(async (metricsOverride?: IntensityMetrics) => {
    try {
      setSaving(true);
      const isPlainMetricsObject =
        typeof metricsOverride === "object" &&
        metricsOverride !== null &&
        !Array.isArray(metricsOverride);
      const payloadMetrics = isPlainMetricsObject ? metricsOverride : metrics;
      const res = await fetch(`${baseUrl}/jobs/${jobId}/intensity-metrics`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics: payloadMetrics }),
      });

      if (!res.ok) throw new Error("Failed to save intensity metrics");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [baseUrl, jobId, metrics]);

  const updateMetric = useCallback((key: string, field: keyof IntensityMetric, value: string | number) => {
    setMetrics(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: field === "value" || field === "divider" ? Number(value) : value,
      },
    }));
  }, []);

  const useGlobalDefaults = useCallback(() => {
    if (Object.keys(defaultMetrics).length === 0) {
      alert("No global defaults have been defined yet.");
      return;
    }
    setMetrics(defaultMetrics);
  }, [defaultMetrics]);

  const addMetric = useCallback(() => {
    if (!newMetricKey || !newMetricLabel) {
      alert("Please provide both a key and label for the metric");
      return;
    }

    if (metrics[newMetricKey]) {
      alert("A metric with this key already exists");
      return;
    }

    setMetrics(prev => ({
      ...prev,
      [newMetricKey]: {
        label: newMetricLabel,
        value: Number(newMetricValue) || 0,
        divider: newMetricDivider,
      },
    }));

    setNewMetricKey("");
    setNewMetricLabel("");
    setNewMetricValue("");
    setNewMetricDivider(1);
    setShowAddMetric(false);
  }, [newMetricKey, newMetricLabel, newMetricValue, newMetricDivider, metrics]);

  const removeMetric = useCallback(async (key: string) => {
    const label = metrics[key]?.label || key;
    const confirmed = await confirmAction({
      title: "Delete intensity metric?",
      description: `Delete "${label}"?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    const newMetrics = { ...metrics };
    delete newMetrics[key];
    setMetrics(newMetrics);
    await saveMetrics(newMetrics);
  }, [confirmAction, metrics, saveMetrics]);

  const calculateIntensity = useCallback((metricValue: number, divider: number): number => {
    if (metricValue === 0) return 0;
    return (totalEmissions / metricValue) * divider;
  }, [totalEmissions]);

  const formatIntensity = useCallback((value: number): string => {
    return value.toFixed(2);
  }, []);

  const getCurrencySymbol = useCallback((curr: string): string => {
    const symbols: { [key: string]: string } = {
      GBP: "Â£",
      USD: "$",
      EUR: "â‚¬",
      AUD: "A$",
      CAD: "C$",
    };
    return symbols[curr] || curr;
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading intensity metrics...</div>;
  }

  return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Intensity Metrics</CardTitle>
            <div className="flex gap-2">
              {Object.keys(defaultMetrics).length > 0 ? (
                <Button size="sm" variant="outline" onClick={useGlobalDefaults} disabled={saving}>
                  Use Global Defaults
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => setShowAddMetric(!showAddMetric)}>
                + Add Metric
              </Button>
              <Button size="sm" onClick={() => saveMetrics()} disabled={saving}>
                {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Object.keys(defaultMetrics).length > 0 ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              Global defaults are available for this job. Use them as a starting point, then edit the wording, values, or dividers before saving.
            </div>
          ) : null}
          {showAddMetric && (
            <div className="rounded-md border p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="metricKey">Metric Key</Label>
                  <Input
                    id="metricKey"
                    value={newMetricKey}
                    onChange={(e) => setNewMetricKey(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                    placeholder="e.g., turnover"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metricLabel">Display Label</Label>
                  <Input
                    id="metricLabel"
                    value={newMetricLabel}
                    onChange={(e) => setNewMetricLabel(e.target.value)}
                    placeholder="e.g., Turnover"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="metricValue">Value</Label>
                  <Input
                    id="metricValue"
                    type="number"
                    value={newMetricValue}
                    onChange={(e) => setNewMetricValue(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metricDivider">Divider</Label>
                  <Select value={String(newMetricDivider)} onValueChange={(v) => setNewMetricDivider(Number(v))}>
                    <SelectTrigger id="metricDivider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIVIDER_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={addMetric}>Add</Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddMetric(false)}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {Object.entries(metrics).map(([key, metric]) => {
              const intensity = calculateIntensity(metric.value, metric.divider);
              const dividerLabel = DIVIDER_OPTIONS.find(d => d.value === metric.divider)?.label || `Per ${metric.divider}`;
              
              return (
                <div key={key} className="rounded-md border p-4">
                  <div className="grid grid-cols-12 gap-3 items-end">
                    <div className="col-span-3 space-y-2">
                      <Label htmlFor={`label-${key}`} className="text-xs text-muted-foreground">Metric wording</Label>
                      <Input
                        id={`label-${key}`}
                        value={metric.label}
                        onChange={(e) => updateMetric(key, "label", e.target.value)}
                        className="h-9"
                        placeholder="Metric wording"
                      />
                    </div>
                    <div className="col-span-3 space-y-2">
                      <Label htmlFor={`value-${key}`} className="text-xs text-muted-foreground">Value</Label>
                      <Input
                        id={`value-${key}`}
                        type="number"
                        value={metric.value}
                        onChange={(e) => updateMetric(key, "value", e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor={`divider-${key}`} className="text-xs text-muted-foreground">Divider</Label>
                      <Select value={String(metric.divider)} onValueChange={(v) => updateMetric(key, "divider", v)}>
                        <SelectTrigger id={`divider-${key}`} className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DIVIDER_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3 space-y-2">
                      <Label className="text-xs text-muted-foreground">Intensity</Label>
                      <div className="font-bold text-lg">
                        {formatIntensity(intensity)} <span className="text-sm font-normal text-muted-foreground">tCO₂e</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {dividerLabel} {key === "turnover" ? getCurrencySymbol(currency) : metric.label}
                      </div>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeMetric(key)}
                        title={`Delete ${metric.label}`}
                        aria-label={`Delete ${metric.label}`}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {Object.keys(metrics).length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">
              No intensity metrics defined. Click &quot;+ Add Metric&quot; to add one, then Save.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
