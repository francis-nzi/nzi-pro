/**
 * Shared widget PNG capture utility.
 * Used by JobInsights (Capture Charts for PDF) and JobPortalManagement
 * (Capture Charts for Portal) — single implementation, two call sites.
 */
import { getWidgetPngExporter } from "@/components/report-widgets";
import { findLargestSvg, captureSvgToPngDataUrl } from "@/components/report-widgets/png-export";

export type CaptureResult = {
  saved: number;
  failed: number;
  widgetIds: string[];
  error?: string;
};

/**
 * Capture all [data-widget-key] elements in the document, export each as a
 * PNG, and POST them individually to /jobs/{jobId}/widget-pngs.
 */
export async function captureAndSaveAllWidgets(
  baseUrl: string,
  jobId: number,
): Promise<CaptureResult> {
  const pngs: Record<string, string> = {};
  const containers = document.querySelectorAll("[data-widget-key]");

  for (const el of Array.from(containers)) {
    const widgetId = el.getAttribute("data-widget-key");
    if (!widgetId) continue;
    try {
      const exporter = getWidgetPngExporter(widgetId);
      if (exporter) {
        const pngData = await exporter();
        if (pngData) {
          pngs[widgetId] = pngData;
          continue;
        }
      }
      const svg = findLargestSvg(el as HTMLElement);
      if (svg) {
        pngs[widgetId] = await captureSvgToPngDataUrl(svg);
      }
    } catch {
      // skip widgets that fail to render
    }
  }

  let saved = 0;
  let failed = 0;
  let lastError = "";

  for (const [widgetId, pngData] of Object.entries(pngs)) {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/widget-pngs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widget_id: widgetId, png_data: pngData }),
      });
      if (res.ok) {
        saved++;
      } else {
        failed++;
        const body = await res.json().catch(() => ({})) as { detail?: string };
        lastError = body.detail ?? `HTTP ${res.status}`;
      }
    } catch (e) {
      failed++;
      lastError = String(e);
    }
  }

  return {
    saved,
    failed,
    widgetIds: Object.keys(pngs),
    error: failed > 0 ? lastError : undefined,
  };
}
