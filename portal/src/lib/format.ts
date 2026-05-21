export function formatEmissions(val: number | string | undefined): string {
  const n = Number(val ?? 0);
  if (!isFinite(n) || isNaN(n)) return "0.0";
  return n.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
