export function sanitizeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
}

export function buildPngFilename(title: string): string {
  const safeTitle = sanitizeFilename(title) || "chart";
  return `${safeTitle}.png`;
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

export async function downloadSvgAsPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width || Number(svg.getAttribute("width") || 1200)));
  const height = Math.max(1, Math.ceil(rect.height || Number(svg.getAttribute("height") || 800)));

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
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas rendering is unavailable.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);

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
