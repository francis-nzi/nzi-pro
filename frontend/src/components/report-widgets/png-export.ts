export function sanitizeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
}

export function buildPngFilename(title: string, clientName?: string | null): string {
  const safeTitle = sanitizeFilename(title) || "chart";
  const safeClient = clientName ? sanitizeFilename(clientName) : "";

  if (!safeClient) return `${safeTitle}.png`;

  const normalizedTitle = safeTitle.toLowerCase();
  const normalizedClient = safeClient.toLowerCase();
  if (normalizedTitle === normalizedClient) return `${safeClient}.png`;

  if (normalizedTitle.startsWith(`${normalizedClient} `)) {
    const remainder = safeTitle.slice(safeClient.length).trim().replace(/^[-–—:]+/, "").trim();
    return `${safeClient}${remainder ? ` - ${remainder}` : ""}.png`;
  }

  return `${safeClient} - ${safeTitle}.png`;
}

export function findLargestSvg(container: HTMLElement | null): SVGSVGElement | null {
  if (!container) return null;
  const svgs = Array.from(container.querySelectorAll("svg")) as SVGSVGElement[];
  if (!svgs.length) return null;

  return svgs
    .map((svg) => ({ svg, rect: svg.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]?.svg ?? null;
}

export type ChartExportLegendItem = {
  label: string;
  color: string;
};

export type ChartExportCallout = {
  text: string;
  fill?: string;
  textColor?: string;
  borderColor?: string;
  backgroundColor?: string;
};

export type ChartExportTableRow = {
  label: string;
  value: string;
  percent?: string;
  color?: string;
  isTotal?: boolean;
};

type DownloadChartAsPngOptions = {
  svg: SVGSVGElement;
  filename: string;
  title: string;
  subtitle?: string;
  legendItems?: ChartExportLegendItem[];
  tableRows?: ChartExportTableRow[];
  callout?: ChartExportCallout | null;
  canvasWidth?: number;
  centerChart?: boolean;
};

function measureLegendRows(ctx: CanvasRenderingContext2D, width: number, items: ChartExportLegendItem[]): ChartExportLegendItem[][] {
  const rows: ChartExportLegendItem[][] = [];
  let current: ChartExportLegendItem[] = [];
  let currentWidth = 0;
  const itemGap = 20;
  const dotWidth = 16;

  for (const item of items) {
    const itemWidth = dotWidth + ctx.measureText(item.label).width + itemGap;
    if (current.length > 0 && currentWidth + itemWidth > width) {
      rows.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(item);
    currentWidth += itemWidth;
  }

  if (current.length) rows.push(current);
  return rows;
}

/**
 * Capture an SVG chart element as a base64 PNG data URL (no download triggered).
 * Returns a full data URL: "data:image/png;base64,..."
 */
export async function captureSvgToPngDataUrl(svg: SVGSVGElement): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.ceil(rect.width || Number(svg.getAttribute("width") || 800)));
  const h = Math.max(1, Math.ceil(rect.height || Number(svg.getAttribute("height") || 600)));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));

  const svgText = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        // 2× for retina / high-DPI output
        canvas.width = w * 2;
        canvas.height = h * 2;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(2, 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to render SVG")); };
    img.src = url;
  });
}

export async function downloadChartAsPng({
  svg,
  filename,
  title,
  subtitle,
  legendItems = [],
  tableRows = [],
  callout = null,
  canvasWidth,
  centerChart = true,
}: DownloadChartAsPngOptions): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width || Number(svg.getAttribute("width") || 1200)));
  const height = Math.max(1, Math.ceil(rect.height || Number(svg.getAttribute("height") || 800)));
  const outputWidth = Math.max(width, canvasWidth ?? width);

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const svgText = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";

  const loadPromise = new Promise<void>((resolve, reject) => {
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas rendering is unavailable.");

        ctx.font = "600 18px Arial, sans-serif";
        const titleHeight = 22;
        const subtitleHeight = subtitle ? 16 : 0;
        const hasTable = tableRows.length > 0;
        const legendRows = legendItems.length && !hasTable ? measureLegendRows(ctx, outputWidth - 48, legendItems) : [];
        const legendHeight = legendRows.length ? legendRows.length * 24 + 8 : 0;
        const headerHeight = 24 + titleHeight + (subtitleHeight ? 8 + subtitleHeight : 0) + (legendHeight ? 12 + legendHeight : 0) + 16;

        canvas.width = outputWidth;
        canvas.height = headerHeight + height + 24;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#111827";
        ctx.font = "600 18px Arial, sans-serif";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(title, 24, 40);

        let y = 40;
        if (subtitle) {
          ctx.fillStyle = "#6b7280";
          ctx.font = "12px Arial, sans-serif";
          ctx.fillText(subtitle, 24, 60);
          y = 60;
        }

        if (legendRows.length) {
          const dotRadius = 5;
          const rowGap = 24;
          let legendY = y + 32;
          ctx.font = "14px Arial, sans-serif";
          for (const row of legendRows) {
            let x = 24;
            for (const item of row) {
              ctx.beginPath();
              ctx.fillStyle = item.color;
              ctx.arc(x + dotRadius, legendY - 5, dotRadius, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#111827";
              ctx.fillText(item.label, x + 16, legendY);
              x += 16 + ctx.measureText(item.label).width + 20;
            }
            legendY += rowGap;
          }
          y = legendY - 8;
        }

        const chartTop = headerHeight + 24;
        const chartAreaWidth = hasTable ? 560 : outputWidth;
        const chartX = centerChart ? Math.max(0, Math.floor((chartAreaWidth - width) / 2)) : 0;
        const chartLeft = hasTable ? 24 : 0;
        const finalChartX = chartLeft + chartX;

        if (hasTable) {
          const tableX = chartLeft + chartAreaWidth + 24;
          const tableTop = chartTop + 40;
          const labelWidth = 130;
          const valueWidth = 170;
          const rowHeight = 42;
          const rowGap = 6;
          let rowY = tableTop;

          ctx.drawImage(image, finalChartX, chartTop, width, height);

          for (const row of tableRows) {
            if (row.isTotal) {
              ctx.strokeStyle = "#e5e7eb";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(tableX, rowY - 8);
              ctx.lineTo(tableX + labelWidth + valueWidth, rowY - 8);
              ctx.stroke();
            }

            if (row.color) {
              ctx.beginPath();
              ctx.fillStyle = row.color;
              ctx.arc(tableX + 6, rowY + 9, 5, 0, Math.PI * 2);
              ctx.fill();
            }

            ctx.fillStyle = "#111827";
            ctx.font = row.isTotal ? "600 14px Arial, sans-serif" : "14px Arial, sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(row.label, tableX + 18, rowY + 12);

            ctx.textAlign = "right";
            ctx.fillText(row.value, tableX + labelWidth + valueWidth - 8, rowY + 12);
            if (row.percent) {
              ctx.fillStyle = "#6b7280";
              ctx.font = "12px Arial, sans-serif";
              ctx.fillText(row.percent, tableX + labelWidth + valueWidth - 8, rowY + 28);
            }
            ctx.textAlign = "left";

            rowY += rowHeight + rowGap;
          }

          if (callout?.text) {
            const paddingX = 12;
            const pillWidth = Math.min(valueWidth + labelWidth, ctx.measureText(callout.text).width + paddingX * 2);
            const pillHeight = 28;
            const pillX = tableX;
            const pillY = rowY + 6;
            const radius = 14;
            const bg = callout.backgroundColor ?? "#fee2e2";
            const border = callout.borderColor ?? "#fecaca";
            const fg = callout.textColor ?? "#b91c1c";

            ctx.beginPath();
            ctx.moveTo(pillX + radius, pillY);
            ctx.lineTo(pillX + pillWidth - radius, pillY);
            ctx.quadraticCurveTo(pillX + pillWidth, pillY, pillX + pillWidth, pillY + radius);
            ctx.lineTo(pillX + pillWidth, pillY + pillHeight - radius);
            ctx.quadraticCurveTo(pillX + pillWidth, pillY + pillHeight, pillX + pillWidth - radius, pillY + pillHeight);
            ctx.lineTo(pillX + radius, pillY + pillHeight);
            ctx.quadraticCurveTo(pillX, pillY + pillHeight, pillX, pillY + pillHeight - radius);
            ctx.lineTo(pillX, pillY + radius);
            ctx.quadraticCurveTo(pillX, pillY, pillX + radius, pillY);
            ctx.closePath();
            ctx.fillStyle = bg;
            ctx.fill();
            ctx.strokeStyle = border;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = fg;
            ctx.font = "600 13px Arial, sans-serif";
            ctx.fillText(callout.text, pillX + paddingX, pillY + 19);
          }
        } else {
          if (callout?.text) {
            const paddingX = 12;
            const textWidth = ctx.measureText(callout.text).width;
            const pillWidth = Math.min(canvas.width - 48, textWidth + paddingX * 2);
            const pillHeight = 28;
            const pillX = 24;
            const pillY = y + 12;
            const radius = 14;
            const bg = callout.backgroundColor ?? "#fee2e2";
            const border = callout.borderColor ?? "#fecaca";
            const fg = callout.textColor ?? "#b91c1c";

            ctx.beginPath();
            ctx.moveTo(pillX + radius, pillY);
            ctx.lineTo(pillX + pillWidth - radius, pillY);
            ctx.quadraticCurveTo(pillX + pillWidth, pillY, pillX + pillWidth, pillY + radius);
            ctx.lineTo(pillX + pillWidth, pillY + pillHeight - radius);
            ctx.quadraticCurveTo(pillX + pillWidth, pillY + pillHeight, pillX + pillWidth - radius, pillY + pillHeight);
            ctx.lineTo(pillX + radius, pillY + pillHeight);
            ctx.quadraticCurveTo(pillX, pillY + pillHeight, pillX, pillY + pillHeight - radius);
            ctx.lineTo(pillX, pillY + radius);
            ctx.quadraticCurveTo(pillX, pillY, pillX + radius, pillY);
            ctx.closePath();
            ctx.fillStyle = bg;
            ctx.fill();
            ctx.strokeStyle = border;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = fg;
            ctx.font = "600 13px Arial, sans-serif";
            ctx.fillText(callout.text, pillX + paddingX, pillY + 19);
            y = pillY + pillHeight;
          }

          const chartX = centerChart ? Math.max(0, Math.floor((outputWidth - width) / 2)) : 0;
          ctx.drawImage(image, chartX, headerHeight, width, height);
        }

        canvas.toBlob((pngBlob) => {
          if (!pngBlob) {
            reject(new Error("Unable to generate PNG."));
            return;
          }
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement("a");
          a.href = pngUrl;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(pngUrl);
          resolve();
        }, "image/png");
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to render chart image."));
    };
  });

  image.src = url;
  await loadPromise;
}
