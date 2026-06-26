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
  const preferredSvgs = Array.from(
    container.querySelectorAll("svg.recharts-surface, .recharts-wrapper svg"),
  ) as SVGSVGElement[];
  const svgs = preferredSvgs.length
    ? preferredSvgs
    : (Array.from(container.querySelectorAll("svg")) as SVGSVGElement[]);
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

export type ChartExportTableLayout = {
  chartAreaWidth?: number;
  tableGap?: number;
  tableTopOffset?: number;
  labelWidth?: number;
  valueWidth?: number;
  rowHeight?: number;
  rowGap?: number;
  centerVertically?: boolean;
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
  tableLayout?: ChartExportTableLayout;
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
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
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

async function composeChartAsPngDataUrl({
  svg,
  title,
  subtitle,
  legendItems = [],
  tableRows = [],
  callout = null,
  canvasWidth,
  centerChart = true,
  tableLayout = {},
}: Omit<DownloadChartAsPngOptions, "filename">): Promise<string> {
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

  const loadPromise = new Promise<string>((resolve, reject) => {
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

        const chartTop = headerHeight + 24;
        const chartAreaWidth = hasTable ? (tableLayout.chartAreaWidth ?? 560) : outputWidth;
        const tableGap = tableLayout.tableGap ?? 24;
        const tableTopOffset = tableLayout.tableTopOffset ?? 40;
        const labelWidth = tableLayout.labelWidth ?? 130;
        const valueWidth = tableLayout.valueWidth ?? 170;
        const rowHeight = tableLayout.rowHeight ?? 42;
        const rowGap = tableLayout.rowGap ?? 6;
        const tableRowsHeight = hasTable ? Math.max(0, tableRows.length * (rowHeight + rowGap) - rowGap) : 0;
        const calloutHeight = callout?.text ? 34 : 0;
        const tableHeight = hasTable ? tableRowsHeight + calloutHeight : 0;
        const chartScale = hasTable ? Math.min(1, chartAreaWidth / width) : 1;
        const renderedChartWidth = Math.max(1, Math.round(width * chartScale));
        const renderedChartHeight = Math.max(1, Math.round(height * chartScale));
        const contentHeight = hasTable && tableLayout.centerVertically ? Math.max(renderedChartHeight, tableHeight) : renderedChartHeight;
        const chartX = centerChart ? Math.max(0, Math.floor((chartAreaWidth - renderedChartWidth) / 2)) : 0;
        const chartGroupWidth = chartAreaWidth + tableGap + labelWidth + valueWidth;
        const chartLeft = hasTable
          ? (tableLayout.centerVertically
            ? Math.max(24, Math.floor((outputWidth - chartGroupWidth) / 2))
            : 24)
          : 0;
        const finalChartX = chartLeft + chartX;

        canvas.width = outputWidth;
        canvas.height = headerHeight + contentHeight + 24;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#6b7280";
        ctx.font = "600 18px Arial, sans-serif";
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "center";
        ctx.fillText(title, outputWidth / 2, 40);
        ctx.textAlign = "left";

        let y = 40;
        if (subtitle) {
          ctx.fillStyle = "#6b7280";
          ctx.font = "12px Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(subtitle, outputWidth / 2, 60);
          ctx.textAlign = "left";
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

        if (hasTable) {
          const tableX = chartLeft + chartAreaWidth + tableGap;
          const tableTop = tableLayout.centerVertically
            ? chartTop + Math.floor((contentHeight - tableHeight) / 2)
            : chartTop + tableTopOffset;
          let rowY = tableTop;
          const chartY = tableLayout.centerVertically
            ? chartTop + Math.floor((contentHeight - renderedChartHeight) / 2)
            : chartTop;

          ctx.drawImage(image, finalChartX, chartY, renderedChartWidth, renderedChartHeight);

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
            const pillWidth = valueWidth + labelWidth;
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
          const chartSpacer = callout?.text ? 44 : 0;
          const chartX = centerChart ? Math.max(0, Math.floor((outputWidth - width) / 2)) : 0;
          canvas.height = headerHeight + chartSpacer + height + 24;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.fillStyle = "#6b7280";
          ctx.font = "600 18px Arial, sans-serif";
          ctx.textBaseline = "alphabetic";
          ctx.textAlign = "center";
          ctx.fillText(title, outputWidth / 2, 40);
          ctx.textAlign = "left";

          y = 40;
          if (subtitle) {
            ctx.fillStyle = "#6b7280";
            ctx.font = "12px Arial, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(subtitle, outputWidth / 2, 60);
            ctx.textAlign = "left";
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

          if (callout?.text) {
            const paddingX = 12;
            ctx.font = "600 13px Arial, sans-serif";
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
            ctx.fillText(callout.text, pillX + paddingX, pillY + 19);
          }

          ctx.drawImage(image, chartX, headerHeight + chartSpacer, width, height);
        }

        resolve(canvas.toDataURL("image/png"));
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
  return await loadPromise;
}

export async function downloadChartAsPng({
  filename,
  ...options
}: DownloadChartAsPngOptions): Promise<void> {
  const pngUrl = await composeChartAsPngDataUrl(options);
  try {
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = filename;
    a.click();
  } finally {
    // data URLs do not need explicit revocation
  }
}

export async function renderChartAsPngDataUrl(
  options: Omit<DownloadChartAsPngOptions, "filename">,
): Promise<string> {
  return composeChartAsPngDataUrl(options);
}
