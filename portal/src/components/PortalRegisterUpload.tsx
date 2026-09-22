"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Preview = { ready_count: number; rows: { identifier: string; report_label: string; qty: number; site_id: number; uom: string }[]; errors: { row: number; reason: string }[] };

export default function PortalRegisterUpload({ bucket, sites, onImported }: {
  bucket: string;
  sites: { site_id: number; site_name: string | null }[];
  onImported: () => void;
}) {
  const [siteId, setSiteId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const base = `/portal/data-entry/${bucket}`;

  async function download() {
    setBusy(true); setError("");
    try {
      const res = await apiFetch(`${base}/template${siteId ? `?site_id=${siteId}` : ""}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Download failed");
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = res.headers.get("X-Filename") || res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || `${bucket}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (err) { setError(err instanceof Error ? err.message : "Download failed"); }
    finally { setBusy(false); }
  }

  async function upload(commit: boolean) {
    if (!file) return;
    setBusy(true); setError(""); setStatus("");
    if (!commit) setPreview(null);
    try {
      const body = new FormData(); body.append("file", file);
      if (siteId) body.append("site_id", siteId);
      const res = await apiFetch(`${base}/upload-${commit ? "commit" : "preview"}`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : data.detail?.message || "Upload failed");
      if (commit) {
        setStatus(`Imported ${data.inserted} rows. They are awaiting NZI review.`);
        setPreview(null); setFile(null); setFileKey((key) => key + 1); onImported();
      } else setPreview(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setBusy(false); }
  }

  return <Card><CardContent className="space-y-3 pt-4">
    <p className="text-sm text-muted-foreground">Download a template, choose activities and quantities, then preview and import. Your selected site fills the filename, workbook header and site dropdowns.</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-muted-foreground">Site for template and blank spreadsheet sites
        <select aria-label="Template site" className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
          value={siteId} disabled={busy} onChange={(event) => { setSiteId(event.target.value); setPreview(null); setStatus(""); }}>
          <option value="">Choose per row in workbook</option>
          {sites.map((site) => <option key={site.site_id} value={site.site_id}>{site.site_name}</option>)}
        </select>
      </label>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void download()}>Download Template</Button>
      <input key={fileKey} aria-label="Completed workbook" type="file" accept=".xlsx" disabled={busy}
        onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setStatus(""); }} className="text-sm" />
      <Button size="sm" disabled={!file || busy} onClick={() => void upload(false)}>{busy ? "Working..." : "Preview"}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {status && <p role="status" className="text-sm text-green-700">{status}</p>}
    {preview && <div className="space-y-2 text-sm">
      <p>{preview.ready_count} rows ready; {preview.errors.length} rows need attention.</p>
      {preview.errors.map((item) => <p key={item.row} className="text-red-700">Row {item.row}: {item.reason}</p>)}
      {preview.rows.length > 0 && <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="border-b"><th className="p-2 text-left">Identifier</th><th className="p-2 text-left">Activity</th><th className="p-2 text-left">Site</th><th className="p-2 text-right">Quantity</th></tr></thead>
        <tbody>{preview.rows.slice(0, 20).map((row, index) => <tr key={index} className="border-b">
          <td className="p-2">{row.identifier}</td><td className="p-2">{row.report_label}</td>
          <td className="p-2">{sites.find((site) => site.site_id === row.site_id)?.site_name}</td><td className="p-2 text-right">{row.qty} {row.uom}</td>
        </tr>)}</tbody>
      </table>{preview.rows.length > 20 && <p>Showing the first 20 rows.</p>}</div>}
      <Button size="sm" disabled={busy || !preview.ready_count || preview.errors.length > 0} onClick={() => void upload(true)}>Confirm &amp; Import {preview.ready_count} Rows</Button>
    </div>}
  </CardContent></Card>;
}
