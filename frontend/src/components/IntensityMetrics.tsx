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

const REQUIRED_METRIC_KEY = "employees";
const REQUIRED_METRIC_LABEL = "Employee";

// Canonical presets — these use stable keys so YoY matching is consistent.
// Employees is always added by default; Turnover and Office Space can be added once.
const CANONICAL_PRESETS = [
  { key: "employees", label: "Employee", defaultDivider: 1 },
  { key: "turnover", label: "Turnover (GBP)", defaultDivider: 1000000 },
  { key: "office_space", label: "Office Space (m²)", defaultDivider: 1 },
] as const;
type CanonicalKey = (typeof CANONICAL_PRESETS)[number]["key"];
// Also treat legacy key variants as canonical so they show the "Standard" badge
const PRESET_KEYS = new Set<string>([...CANONICAL_PRESETS.map((p) => p.key), "office_space_m2"]);

function ensureRequiredEmployeeMetric(source: IntensityMetrics, fallbackValue = 0): IntensityMetrics {
  const employeeMetric = source[REQUIRED_METRIC_KEY];
  const employeeValue = Number(employeeMetric?.value ?? fallbackValue) || 0;
  const employeeDivider = Number(employeeMetric?.divider ?? 1) || 1;
  const normalized: IntensityMetrics = {
    [REQUIRED_METRIC_KEY]: {
      label: REQUIRED_METRIC_LABEL,
      value: employeeValue,
      divider: employeeDivider,
    },
  };

  for (const [key, metric] of Object.entries(source)) {
    if (key === REQUIRED_METRIC_KEY) continue;
    normalized[key] = metric;
  }
  return normalized;
}

function getEmployeeMetricValue(metrics: IntensityMetrics): number {
  const raw = metrics[REQUIRED_METRIC_KEY]?.value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function IntensityMetrics({ jobId, baseUrl, totalEmissions, currency = "GBP" }: IntensityMetricsProps) {
  const confirmAction = useConfirmDialog();
  const [metrics, setMetrics] = useState<IntensityMetrics>({});
  const [defaultMetrics, setDefaultMetrics] = useState<IntensityMetrics>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddMetric, setShowAddMetric] = useState(false);
  // "preset:<key>" | "custom" | ""
  const [addMetricType, setAddMetricType] = useState<string>("");
  const [newMetricKey, setNewMetricKey] = useState("");
  const [newMetricLabel, setNewMetricLabel] = useState("");
  const [newMetricValue, setNewMetricValue] = useState("");
  const [newMetricDivider, setNewMetricDivider] = useState(1);

  const loadMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${baseUrl}/jobs/${jobId}/intensity-metrics`);
      if (!res.ok) throw new Error("Failed to load intensity metrics");
      const data = await res.json();
      const jobMetrics = data.metrics && typeof data.metrics === "object" ? data.metrics : {};
      const globalDefaults = data.defaults && typeof data.defaults === "object" ? data.defaults : {};
      setDefaultMetrics(ensureRequiredEmployeeMetric(globalDefaults));
      if (jobMetrics && Object.keys(jobMetrics).length > 0) {
        setMetrics(ensureRequiredEmployeeMetric(jobMetrics));
      } else if (globalDefaults && Object.keys(globalDefaults).length > 0) {
        setMetrics(ensureRequiredEmployeeMetric(globalDefaults));
      } else {
        setMetrics(ensureRequiredEmployeeMetric({}));
      }
    } catch (e) {
      console.error("Failed to load intensity metrics:", e);
      setMetrics({});
      setDefaultMetrics({});
      setError((e as Error).message || "Failed to load intensity metrics");
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
      setError(null);
      const isPlainMetricsObject =
        typeof metricsOverride === "object" &&
        metricsOverride !== null &&
        !Array.isArray(metricsOverride);
      const payloadMetrics = ensureRequiredEmployeeMetric(isPlainMetricsObject ? metricsOverride : metrics);
      const res = await fetch(`${baseUrl}/jobs/${jobId}/intensity-metrics`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics: payloadMetrics }),
      });

      if (!res.ok) throw new Error("Failed to save intensity metrics");
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("intensity-metrics-saved", {
            detail: {
              jobId,
              employeeNumber: getEmployeeMetricValue(payloadMetrics),
            },
          })
        );
      }
    } catch (e) {
      setError((e as Error).message || "Failed to save intensity metrics");
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
      setError("No global defaults have been defined yet.");
      return;
    }
    setError(null);
    setMetrics(ensureRequiredEmployeeMetric(defaultMetrics));
  }, [defaultMetrics]);

  const resetAddForm = useCallback(() => {
    setAddMetricType("");
    setNewMetricKey("");
    setNewMetricLabel("");
    setNewMetricValue("");
    setNewMetricDivider(1);
    setShowAddMetric(false);
  }, []);

  const addMetric = useCallback(() => {
    const isPreset = addMetricType.startsWith("preset:");
    const resolvedKey = isPreset ? addMetricType.slice(7) : newMetricKey.trim();
    const resolvedLabel = newMetricLabel.trim() || (isPreset ? (CANONICAL_PRESETS.find(p => p.key === resolvedKey)?.label ?? resolvedKey) : resolvedKey);

    if (!resolvedKey) {
      setError("Please select a metric type");
      return;
    }
    if (!isPreset && resolvedKey === REQUIRED_METRIC_KEY) {
      setError("Employee is already built into the intensity metrics.");
      return;
    }
    if (metrics[resolvedKey]) {
      setError("A metric with this key already exists");
      return;
    }
    setError(null);
    setMetrics(prev => ({
      ...prev,
      [resolvedKey]: {
        label: resolvedLabel,
        value: Number(newMetricValue) || 0,
        divider: newMetricDivider,
      },
    }));
    resetAddForm();
  }, [addMetricType, newMetricKey, newMetricLabel, newMetricValue, newMetricDivider, metrics, resetAddForm]);

  const removeMetric = useCallback(async (key: string) => {
    if (key === REQUIRED_METRIC_KEY) {
      setError("Employee is required and cannot be deleted.");
      return;
    }
    setError(null);
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
      GBP: "\u00A3",
      USD: "$",
      EUR: "\u20AC",
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
            <Button size="sm" variant="outline" onClick={() => { if (showAddMetric) { resetAddForm(); } else { setShowAddMetric(true); } }}>
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
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start justify-between gap-3">
              <div>{error}</div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-red-700 hover:bg-red-100 hover:text-red-800"
                onClick={() => setError(null)}
              >
                Dismiss
              </Button>
            </div>
          ) : null}
          {Object.keys(defaultMetrics).length > 0 ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              Global defaults are available for this job. Use them as a starting point, then edit the wording, values, or dividers before saving.
            </div>
          ) : null}
          {showAddMetric && (() => {
            const isPreset = addMetricType.startsWith("preset:");
            const selectedPreset = isPreset ? CANONICAL_PRESETS.find(p => p.key === addMetricType.slice(7)) : null;
            const isCustom = addMetricType === "custom";
            const availablePresets = CANONICAL_PRESETS.filter(p => p.key !== REQUIRED_METRIC_KEY && !metrics[p.key]);
            return (
              <div className="rounded-md border p-4 space-y-3">
                {/* Row 1: Type selector */}
                <div className="space-y-2">
                  <Label htmlFor="metricType">Metric type</Label>
                  <Select
                    value={addMetricType}
                    onValueChange={(v) => {
                      setAddMetricType(v);
                      if (v.startsWith("preset:")) {
                        const preset = CANONICAL_PRESETS.find(p => p.key === v.slice(7));
                        if (preset) {
                          setNewMetricLabel(preset.label);
                          setNewMetricDivider(preset.defaultDivider);
                        }
                      } else {
                        setNewMetricLabel("");
                        setNewMetricDivider(1);
                      }
                    }}
                  >
                    <SelectTrigger id="metricType" autoFocus>
                      <SelectValue placeholder="Select a metric type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePresets.map((p) => (
                        <SelectItem key={p.key} value={`preset:${p.key}`}>{p.label}</SelectItem>
                      ))}
                      {availablePresets.length > 0 && <div className="my-1 border-t" />}
                      <SelectItem value="custom">Custom…</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Row 2: Label (preset = editable but pre-filled; custom = free text) */}
                {(isPreset || isCustom) && (
                  <div className={`grid gap-3 ${isCustom ? "grid-cols-2" : "grid-cols-1"}`}>
                    {isCustom && (
                      <div className="space-y-2">
                        <Label htmlFor="metricKey">Metric key <span className="text-muted-foreground text-xs">(unique identifier)</span></Label>
                        <Input
                          id="metricKey"
                          value={newMetricKey}
                          onChange={(e) => setNewMetricKey(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                          placeholder="e.g., fleet_size"
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="metricLabel">Display label</Label>
                      <Input
                        id="metricLabel"
                        value={newMetricLabel}
                        onChange={(e) => setNewMetricLabel(e.target.value)}
                        placeholder={selectedPreset?.label ?? "e.g., Fleet Size"}
                      />
                    </div>
                  </div>
                )}

                {/* Row 3: Value + Divider */}
                {(isPreset || isCustom) && (
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
                )}

                <div className="flex gap-2">
                  <Button size="sm" onClick={addMetric} disabled={!addMetricType}>Add</Button>
                  <Button size="sm" variant="outline" onClick={resetAddForm}>Cancel</Button>
                </div>
              </div>
            );
          })()}

          <div className="space-y-3">
            {Object.entries(metrics).map(([key, metric]) => {
              const intensity = calculateIntensity(metric.value, metric.divider);
              const dividerLabel = DIVIDER_OPTIONS.find(d => d.value === metric.divider)?.label || `Per ${metric.divider.toLocaleString()}`;
              const isCanonical = PRESET_KEYS.has(key as CanonicalKey);
              const isLocked = key === REQUIRED_METRIC_KEY;
              const displayLabel = isLocked ? REQUIRED_METRIC_LABEL : metric.label;
              const intensityUnitSuffix = key === "turnover" ? getCurrencySymbol(currency) : displayLabel;

              return (
                <div key={key} className="rounded-md border p-4">
                  <div className="grid grid-cols-12 gap-3 items-end">
                    <div className="col-span-3 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor={`label-${key}`} className="text-xs text-muted-foreground">Metric wording</Label>
                        {isCanonical && (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                            Standard
                          </span>
                        )}
                      </div>
                      <Input
                        id={`label-${key}`}
                        value={metric.label}
                        onChange={(e) => updateMetric(key, "label", isLocked ? REQUIRED_METRIC_LABEL : e.target.value)}
                        disabled={isLocked}
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
                        {dividerLabel} {intensityUnitSuffix}
                      </div>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeMetric(key)}
                        disabled={isLocked}
                        title={isLocked ? "Employee metric is required" : `Delete ${metric.label}`}
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
