import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SCOPE_KEYS, type ScopeKey } from "@/lib/job-workspace";

type ScopeDatasetSummary = {
  key: string;
  label?: ScopeKey;
  title: string;
  detail: string;
};

type EffectiveScopeDataset = {
  scope: ScopeKey;
  datasetId: string;
  title: string;
};

type ScopeDatasetSectionProps = {
  hidden?: boolean;
  busy: boolean;
  loadingScopeConfig: boolean;
  datasetOverrideSummary: string;
  showAdvancedDatasetConfig: boolean;
  onToggleAdvanced: () => void;
  scopeConfigMode: string;
  scopeAutoResolution: {
    country: string | null;
    reporting_period_start: string | null;
    reporting_period_end: string | null;
    uses_legacy_fallback: boolean;
    unresolved_scopes: string[];
  } | null;
  scopeConfigWarnings: string[];
  primaryScopeDatasets: ScopeDatasetSummary[];
  additionalAllocatedDatasets: Array<{ key: string; title: string; detail: string }>;
  manualFallbackDatasets: ScopeDatasetSummary[];
  effectiveScopeDatasets: EffectiveScopeDataset[];
  scopeCatalogStatus: string;
  scopeCatalogCount: number | null;
  datasets: Array<{ dataset_id: number; name: string | null; year: number | null; country: string | null; analysis_type: string | null }>;
  additionalDatasetIds: string[];
  scopeDatasetIds: Record<ScopeKey, string>;
  onToggleAdditionalDataset: (datasetId: string) => void;
  onRemoveAdditionalDataset: (datasetId: string) => void;
  onScopeDatasetChange: (scope: ScopeKey, datasetId: string) => void;
  onReloadCatalog: () => void;
  onSaveScopeDatasets: () => void;
};

export default function JobScopeDatasetSection({
  hidden,
  busy,
  loadingScopeConfig,
  datasetOverrideSummary,
  showAdvancedDatasetConfig,
  onToggleAdvanced,
  scopeConfigMode,
  scopeAutoResolution,
  scopeConfigWarnings,
  primaryScopeDatasets,
  additionalAllocatedDatasets,
  manualFallbackDatasets,
  effectiveScopeDatasets,
  scopeCatalogStatus,
  scopeCatalogCount,
  datasets,
  additionalDatasetIds,
  scopeDatasetIds,
  onToggleAdditionalDataset,
  onRemoveAdditionalDataset,
  onScopeDatasetChange,
  onReloadCatalog,
  onSaveScopeDatasets,
}: ScopeDatasetSectionProps) {
  return (
    <Card className={hidden ? "hidden" : undefined}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Additional Job Datasets</CardTitle>
            <div className="text-sm text-muted-foreground">{datasetOverrideSummary}</div>
          </div>
          <Button variant="outline" onClick={onToggleAdvanced}>
            {showAdvancedDatasetConfig ? "Hide Job Datasets" : "Show Job Datasets"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!showAdvancedDatasetConfig ? (
          <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
            The job will use automatically resolved datasets by default. Open this section only if you need to
            review unresolved scopes, add extra datasets, or set manual fallback mappings.
          </div>
        ) : null}

        {!showAdvancedDatasetConfig && (primaryScopeDatasets.length > 0 || additionalAllocatedDatasets.length > 0 || manualFallbackDatasets.length > 0) ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700">
                Primary scope = automatic resolution
              </div>
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                Additional = job-specific extras
              </div>
              <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
                Fallback = manual override
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/60 p-3">
                <div className="text-sm font-medium text-sky-900">Primary scope datasets</div>
                <div className="text-xs text-sky-800/80">Automatically resolved from the client country and reporting period.</div>
                {primaryScopeDatasets.length > 0 ? (
                  <div className="space-y-2">
                    {primaryScopeDatasets.map((dataset) => (
                      <div key={dataset.key} className="rounded border border-sky-100 bg-white/80 px-3 py-2 text-xs">
                        <div className="font-medium text-sky-950">
                          {dataset.label ? `${dataset.label}: ` : ""}
                          {dataset.title}
                        </div>
                        {dataset.detail ? <div className="text-sky-800/80">{dataset.detail}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-sky-800/80">No primary scope datasets resolved.</div>
                )}
              </div>

              <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="text-sm font-medium text-emerald-900">Additional datasets</div>
                <div className="text-xs text-emerald-800/80">Extra datasets added manually to supplement the primary scope allocation.</div>
                {additionalAllocatedDatasets.length > 0 ? (
                  <div className="space-y-2">
                    {additionalAllocatedDatasets.map((dataset) => (
                      <div key={dataset.key} className="rounded border border-emerald-100 bg-white/80 px-3 py-2 text-xs">
                        <div className="font-medium text-emerald-950">{dataset.title}</div>
                        {dataset.detail ? <div className="text-emerald-800/80">{dataset.detail}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-emerald-800/80">No additional datasets selected.</div>
                )}
              </div>

              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3">
                <div className="text-sm font-medium text-amber-900">Manual fallback datasets</div>
                <div className="text-xs text-amber-800/80">Scope-by-scope fallback selections used when automatic resolution needs a manual override.</div>
                {manualFallbackDatasets.length > 0 ? (
                  <div className="space-y-2">
                    {manualFallbackDatasets.map((dataset) => (
                      <div key={dataset.key} className="rounded border border-amber-100 bg-white/80 px-3 py-2 text-xs">
                        <div className="font-medium text-amber-950">
                          {dataset.label ? `${dataset.label}: ` : ""}
                          {dataset.title}
                        </div>
                        {dataset.detail ? <div className="text-amber-800/80">{dataset.detail}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-amber-800/80">No manual fallback datasets selected.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {showAdvancedDatasetConfig ? (
          <>
            <div className="rounded-md border border-sky-200 bg-sky-50/60 p-3 space-y-2">
              <div className="text-sm font-medium text-sky-900">
                Mode: {scopeConfigMode === "automatic" ? "Automatic resolution" : "Manual mapping"}
              </div>
              {scopeConfigMode === "automatic" ? (
                <div className="text-xs text-sky-800/80">
                  Effective datasets are resolved from client country + reporting period. Manual selections below are fallback values only.
                </div>
              ) : (
                <div className="text-xs text-sky-800/80">Manual scope dataset mapping is active for factor lookup.</div>
              )}

              {scopeAutoResolution ? (
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-sky-200 bg-white/80 px-2 py-1 text-sky-800">
                    {scopeAutoResolution.country || "Unspecified country"}
                  </span>
                  <span className="rounded-full border border-sky-200 bg-white/80 px-2 py-1 text-sky-800">
                    {scopeAutoResolution.reporting_period_start || "?"} to {scopeAutoResolution.reporting_period_end || "?"}
                  </span>
                  {scopeAutoResolution.uses_legacy_fallback ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                      Legacy fallback datasets in use
                    </span>
                  ) : null}
                  {scopeAutoResolution.unresolved_scopes?.length ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                      Unresolved: {scopeAutoResolution.unresolved_scopes.join(", ")}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {scopeConfigWarnings.length ? (
                <ul className="list-disc space-y-1 pl-5 text-xs text-sky-800/80">
                  {scopeConfigWarnings.map((warning, idx) => (
                    <li key={`scope-warning-${idx}`}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="text-sm text-muted-foreground">
              Add any extra datasets this job needs in addition to the automatically resolved scope datasets.
            </div>

            {additionalDatasetIds.length > 0 ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                <div className="text-sm font-medium text-emerald-900">Selected additional datasets</div>
                <div className="flex flex-wrap gap-2">
                  {additionalDatasetIds
                    .map((id) => datasets.find((d) => String(d.dataset_id) === id))
                    .filter((ds): ds is (typeof datasets)[number] => Boolean(ds))
                    .map((ds) => (
                      <div
                        key={`selected-extra-${ds.dataset_id}`}
                        className="flex items-center gap-2 rounded border border-emerald-100 bg-white/80 px-3 py-2 text-xs"
                      >
                        <div>
                          <div className="font-medium text-emerald-950">{ds.name || `Dataset ${ds.dataset_id}`}</div>
                          <div className="text-emerald-800/80">
                            {ds.country || "Unknown"} | {ds.year || "n/a"} | {ds.analysis_type || "n/a"}
                          </div>
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveAdditionalDataset(String(ds.dataset_id))}>
                          Remove
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            {scopeConfigMode === "automatic" ? (
              <div className="rounded-md border border-sky-200 bg-sky-50/60 p-3 space-y-2">
                <div className="text-sm font-medium text-sky-900">Effective datasets in use</div>
                <div className="grid gap-2 md:grid-cols-3 text-xs">
                  {effectiveScopeDatasets.map((entry) => (
                    <div key={`effective-${entry.scope}`} className="rounded border border-sky-100 bg-white/80 p-2">
                      <div className="font-medium text-sky-950">{entry.scope}</div>
                      <div className="text-sky-800/80">{entry.title}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-emerald-900">Additional Datasets For This Job</div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-emerald-800/80">{additionalDatasetIds.length} selected</div>
                  <Button type="button" variant="outline" size="sm" onClick={onReloadCatalog} disabled={loadingScopeConfig}>
                    {loadingScopeConfig ? "Reloading..." : "Reload catalog"}
                  </Button>
                </div>
              </div>
              <div className="text-xs text-emerald-800/80">
                Select any extra datasets the client needs for this job in addition to the default scope datasets.
              </div>
              {scopeCatalogStatus ? (
                <div className="rounded border border-emerald-100 bg-white/80 px-3 py-2 text-xs text-emerald-800/80">
                  {scopeCatalogStatus}
                  {scopeCatalogCount != null ? ` (${scopeCatalogCount} total)` : ""}
                </div>
              ) : null}
              <div className="max-h-52 space-y-2 overflow-auto pr-1">
                {datasets
                  .slice()
                  .sort((a, b) => {
                    const ay = Number(a.year || 0);
                    const by = Number(b.year || 0);
                    if (ay !== by) return by - ay;
                    return String(a.name || "").localeCompare(String(b.name || ""));
                  })
                  .map((ds) => {
                    const id = String(ds.dataset_id);
                    const selected = additionalDatasetIds.includes(id);
                    return (
                      <label
                        key={`extra-dataset-${id}`}
                        className="flex cursor-pointer items-center justify-between rounded border border-emerald-100 bg-white/80 px-2 py-1.5 text-xs hover:bg-emerald-100/60"
                      >
                        <div className="pr-2">
                          <div className="font-medium text-emerald-950">{ds.name || `Dataset ${id}`}</div>
                          <div className="text-emerald-800/80">
                            {ds.country || "Unknown"} • {ds.year || "n/a"} • {ds.analysis_type || "n/a"}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => onToggleAdditionalDataset(id)}
                          className="h-4 w-4"
                        />
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="space-y-4">
              {SCOPE_KEYS.map((scope) => (
                <div key={scope} className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3">
                  <Label htmlFor={`dataset-${scope}`} className="text-amber-900">
                    {scope}
                    {scopeConfigMode === "automatic" ? " (fallback)" : ""}
                  </Label>
                  <Select value={scopeDatasetIds[scope] ?? "__none__"} onValueChange={(v) => onScopeDatasetChange(scope, v)}>
                    <SelectTrigger id={`dataset-${scope}`} className="w-full border-amber-200 bg-white/80">
                      <SelectValue placeholder="Select dataset..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {datasets.map((ds) => (
                        <SelectItem key={ds.dataset_id} value={String(ds.dataset_id)}>
                          {(ds.name || `Dataset ${ds.dataset_id}`)} ({ds.year})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={onSaveScopeDatasets} disabled={busy}>
                {scopeConfigMode === "automatic" ? "Save Fallback Scope Datasets" : "Save Scope Datasets"}
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
