export function formatEmissions(val: number | string | undefined): string {
  const n = Number(val ?? 0);
  if (!isFinite(n) || isNaN(n)) return "0.0";
  return n.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
