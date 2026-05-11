import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import UploadProgressBar from "@/components/UploadProgressBar";

type UploadReadyRow = {
  scope?: string | null;
  original_id?: string | number | null;
  report_label?: string | null;
  qty?: number | string | null;
  calc_tco2e?: number | string | null;
  ghg_unit?: string | null;
};

type UploadValidationResult = {
  ok?: boolean;
  errors?: string[];
  warnings?: string[];
  details?: {
    parsed_row_count?: number;
    rows_ready_count?: number;
  };
  rows_ready?: UploadReadyRow[];
  raw?: string;
  detail?: string;
};

type ImportConflict = {
  scope: string;
  original_id: string;
  report_label: string;
  existing_qty: number;
  upload_qty: number | null;
};

type SiteOption = {
  site_id: number | null;
  site_name: string | null;
};

type JobUploadSectionProps = {
  hidden?: boolean;
  busy: boolean;
  selectedSiteId: string;
  selectedSiteName: string;
  sites: SiteOption[];
  uploadFile: File | null;
  uploadStatus: string;
  uploadProgress: number;
  uploadResult: UploadValidationResult | null;
  importConflicts: ImportConflict[];
  selectedRowsCount: number;
  canImport: boolean;
  onSelectedSiteChange: (value: string) => void;
  onUploadFileChange: (file: File | null) => void;
  onValidateUpload: () => void;
  onClearConflicts: () => void;
  onOverwriteAndImport: () => void;
  onImportValidatedRows: () => void;
};

export default function JobUploadSection({
  hidden,
  busy,
  selectedSiteId,
  selectedSiteName,
  sites,
  uploadFile,
  uploadStatus,
  uploadProgress,
  uploadResult,
  importConflicts,
  selectedRowsCount,
  canImport,
  onSelectedSiteChange,
  onUploadFileChange,
  onValidateUpload,
  onClearConflicts,
  onOverwriteAndImport,
  onImportValidatedRows,
}: JobUploadSectionProps) {
  return (
    <Card className={hidden ? "hidden" : undefined}>
      <CardHeader>
        <CardTitle>Excel Upload</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Upload a completed Excel template to import data. The system will merge with existing entries without replacing custom data.
          </div>

          <div className="space-y-2">
            <Label htmlFor="site">Site</Label>
            <Select value={selectedSiteId} onValueChange={onSelectedSiteChange}>
              <SelectTrigger id="site" className="w-full">
                <SelectValue placeholder="Select a site..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All</SelectItem>
                {sites
                  .filter((s) => s.site_id != null && (s.site_name ?? "").trim().length > 0)
                  .map((s) => (
                    <SelectItem key={String(s.site_id)} value={String(s.site_id)}>
                      {s.site_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="upload">Excel file (.xlsx)</Label>
              <Input
                id="upload"
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  onUploadFileChange(e.target.files?.[0] ?? null);
                }}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={onValidateUpload} disabled={busy || !uploadFile}>
                Validate upload
              </Button>
            </div>
          </div>

          {busy && uploadProgress > 0 ? (
            <UploadProgressBar value={uploadProgress} label={uploadStatus || "Uploading"} />
          ) : null}

          {uploadStatus ? (
            <div
              className={
                uploadStatus.startsWith("Validation OK") || uploadStatus.startsWith("Import complete")
                  ? "rounded-md border border-green-300 bg-green-50 p-3 text-sm font-medium text-green-800"
                  : uploadStatus.startsWith("Upload failed") ||
                      uploadStatus.startsWith("Import failed") ||
                      uploadStatus.startsWith("Import error")
                    ? "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium text-destructive"
                    : "rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
              }
            >
              {uploadStatus}
            </div>
          ) : null}

          {importConflicts.length > 0 ? (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
              <div className="font-medium text-amber-800">
                ⚠️ {importConflicts.length} row{importConflicts.length > 1 ? "s" : ""} already have data entered - uploading will overwrite their quantities.
              </div>
              <div className="max-h-48 overflow-y-auto rounded border border-amber-200 bg-white">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-amber-50">
                    <tr className="border-b border-amber-200">
                      <th className="p-2 text-left">Scope</th>
                      <th className="p-2 text-left">Label</th>
                      <th className="p-2 text-right">Current Qty</th>
                      <th className="p-2 text-right">Upload Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importConflicts.map((c, idx) => (
                      <tr key={idx} className="border-b border-amber-100">
                        <td className="p-2">{c.scope}</td>
                        <td className="p-2">{c.report_label}</td>
                        <td className="p-2 text-right font-mono text-amber-700">{c.existing_qty.toLocaleString()}</td>
                        <td className="p-2 text-right font-mono">{c.upload_qty?.toLocaleString() ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={onClearConflicts}>
                  Cancel
                </Button>
                <Button size="sm" className="bg-amber-600 text-white hover:bg-amber-700" onClick={onOverwriteAndImport}>
                  Overwrite and import
                </Button>
              </div>
            </div>
          ) : null}

          {uploadResult ? (
            <div className="space-y-3">
              {uploadResult?.detail ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <div className="mb-1 font-medium text-destructive">Server error</div>
                  <div>{String(uploadResult.detail)}</div>
                </div>
              ) : null}
              {Array.isArray(uploadResult?.errors) && uploadResult.errors.length ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <div className="mb-2 font-medium text-destructive">Errors</div>
                  <ul className="list-disc pl-5">
                    {uploadResult.errors.map((e: string, idx: number) => (
                      <li key={idx}>{e}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {Array.isArray(uploadResult?.warnings) && uploadResult.warnings.length ? (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="mb-2 font-medium">Warnings</div>
                  <ul className="list-disc pl-5">
                    {uploadResult.warnings.map((w: string, idx: number) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {Array.isArray(uploadResult?.rows_ready) && uploadResult.rows_ready.length ? (() => {
                const allRows = uploadResult.rows_ready as UploadReadyRow[];
                const totalTco2e = allRows.reduce((sum, row) => sum + (typeof row.calc_tco2e === "number" ? row.calc_tco2e : 0), 0);
                const scopeSummary = (["Scope 1", "Scope 2", "Scope 3"] as const)
                  .map((scope) => {
                    const rows = allRows.filter((row) => row.scope === scope);
                    return {
                      scope,
                      count: rows.length,
                      tco2e: rows.reduce((sum, row) => sum + (typeof row.calc_tco2e === "number" ? row.calc_tco2e : 0), 0),
                    };
                  })
                  .filter((entry) => entry.count > 0);

                return (
                  <>
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="mb-2 grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">Rows parsed</div>
                          <div className="font-semibold">{uploadResult?.details?.parsed_row_count ?? allRows.length}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Rows ready</div>
                          <div className="font-semibold">{allRows.length}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Total tCO₂e</div>
                          <div className="font-semibold">
                            {totalTco2e.toLocaleString(undefined, { maximumFractionDigits: 4, minimumFractionDigits: 4 })}
                          </div>
                        </div>
                      </div>
                      {scopeSummary.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2 border-t pt-2 text-xs text-muted-foreground">
                          {scopeSummary.map(({ scope, count, tco2e }) => (
                            <div key={scope}>
                              <span className="font-medium text-foreground">{scope}</span>
                              {" — "}{tco2e.toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO₂e · {count} row{count !== 1 ? "s" : ""}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <Button
                      onClick={onImportValidatedRows}
                      disabled={busy || !canImport}
                      className="w-full bg-green-700 text-base text-white hover:bg-green-800 py-5"
                      size="lg"
                    >
                      Import {selectedRowsCount} rows into {selectedSiteName || "selected site"}
                    </Button>
                    {!canImport ? (
                      <p className="text-xs text-muted-foreground text-center -mt-2">
                        Select a specific site above to enable import
                      </p>
                    ) : null}

                    <div className="rounded-md border p-3">
                      <div className="mb-2 text-sm font-medium">Preview (first 10 rows)</div>
                      <div className="max-h-64 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-background">
                            <tr className="border-b">
                              <th className="p-2 text-left">Scope</th>
                              <th className="p-2 text-left">ID</th>
                              <th className="p-2 text-left">Report Label</th>
                              <th className="p-2 text-right">Qty</th>
                              <th className="p-2 text-right">tCO₂e</th>
                              <th className="p-2 text-left">Unit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allRows.slice(0, 10).map((row, idx) => (
                              <tr key={idx} className="border-b">
                                <td className="p-2">{row.scope}</td>
                                <td className="p-2 font-mono">{row.original_id}</td>
                                <td className="p-2">{row.report_label ?? ""}</td>
                                <td className="p-2 text-right">
                                  {typeof row.qty === "number" ? row.qty.toLocaleString() : row.qty}
                                </td>
                                <td className="p-2 text-right">
                                  {typeof row.calc_tco2e === "number"
                                    ? row.calc_tco2e.toLocaleString(undefined, { maximumFractionDigits: 6 })
                                    : row.calc_tco2e}
                                </td>
                                <td className="p-2">{row.ghg_unit ?? ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })() : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
