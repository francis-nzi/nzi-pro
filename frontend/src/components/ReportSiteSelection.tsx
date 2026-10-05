"use client";
import { useEffect, useState } from "react";

type Site = { site_id: number; site_name: string; include_in_report: boolean };
export default function ReportSiteSelection({ jobId, baseUrl, onSaved }: {
  jobId: number; baseUrl: string; onSaved: () => void;
}) {
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`${baseUrl}/jobs/${jobId}/report-sites`, { credentials: "include" })
      .then(async r => { if (!r.ok) throw new Error("Could not load report sites."); return r.json(); })
      .then(d => { if (!cancelled) setSites(d.sites); })
      .catch(e => { if (!cancelled) setError(String(e.message)); });
    return () => { cancelled = true; };
  }, [jobId, baseUrl]);
  async function save(site: Site, checked: boolean) {
    setSaving(true); setError("");
    try {
      const r = await fetch(`${baseUrl}/jobs/${jobId}/report-sites/${site.site_id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ include_in_report: checked }),
      });
      if (!r.ok) throw new Error("Could not save report site selection.");
      setSites(current => current.map(s => s.site_id === site.site_id ? { ...s, include_in_report: checked } : s));
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setSaving(false); }
  }
  return <section className="print:hidden mb-6 rounded-lg border bg-white p-4">
    <h2 className="font-semibold">Sites included in this report</h2>
    <p className="my-2 text-sm text-gray-600">Choose which sites appear in this job's report tables and charts. Company-wide emissions totals and source data are retained. Selections do not affect other jobs.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {sites.map(site => <label key={site.site_id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={site.include_in_report} disabled={saving}
          aria-label={`Include ${site.site_name} in report`} onChange={e => save(site, e.target.checked)} />
        <span>{site.site_name}</span><span className="text-gray-500">{site.include_in_report ? "Yes" : "No"}</span>
      </label>)}
    </div>
  </section>;
}
