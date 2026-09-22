export type DataOutputExportContext = {
  job_number: string;
  client_name: string;
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
  reporting_year?: number | null;
};

function safePart(value: string) {
  return String(value || "").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "").replace(/\s+/g, " ").trim() || "Unknown";
}

export function dataOutputFilename(context: DataOutputExportContext, descriptor: string, site?: string) {
  const start = context.reporting_period_start?.slice(0, 4) || String(context.reporting_year || "?");
  const end = context.reporting_period_end?.slice(0, 4) || String(context.reporting_year || "?");
  return `${safePart(context.job_number)} ${safePart(context.client_name)} ${safePart(descriptor)} ${start}-${end}${site ? ` ${safePart(site)}` : ""}.csv`;
}

export function csvCell(value: string | number | null | undefined) {
  let text = String(value ?? "");
  // Preserve numbers, while preventing spreadsheet software interpreting labels as formulas.
  if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(text) && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '\"\"')}"` : text;
}

export function exportContextRows(context: DataOutputExportContext, site?: string): (string | number)[][] {
  return [
    ["Client Name", context.client_name],
    ["Job Number", context.job_number],
    ["Reporting Period", `${context.reporting_period_start || "?"} to ${context.reporting_period_end || "?"}`],
    ["Reporting Year", context.reporting_year || ""],
    ["Site Name", site || "All Sites"],
    [],
  ];
}
