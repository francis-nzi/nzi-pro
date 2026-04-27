const DEFAULT_LOCALE = "en-GB";

function formatNumber(value: number | string | null | undefined, decimals = 1, locale = DEFAULT_LOCALE): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatEmissions(value: number | string | null | undefined, options: { decimals?: number; locale?: string } = {}): string {
  return formatNumber(value, options.decimals ?? 1, options.locale);
}

export function formatCurrency(
  value: number | string | null | undefined,
  currency = "GBP",
  options: { decimals?: number; locale?: string } = {},
): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return currency === "GBP" ? "£0.00" : `0.00 ${currency}`;
  return new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: options.decimals ?? 2,
    maximumFractionDigits: options.decimals ?? 2,
  }).format(numeric);
}

export function formatPercent(value: number | string | null | undefined, options: { decimals?: number; locale?: string } = {}): string {
  return `${formatNumber(value, options.decimals ?? 1, options.locale)}%`;
}

export function formatHours(value: number | string | null | undefined, options: { decimals?: number; locale?: string } = {}): string {
  return `${formatNumber(value, options.decimals ?? 1, options.locale)}h`;
}

export function formatDate(value: string | Date | null | undefined, options: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(DEFAULT_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options,
  });
}

export function formatMonth(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(DEFAULT_LOCALE, { month: "short", year: "2-digit" });
}

export { formatNumber };
