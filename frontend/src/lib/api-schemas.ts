/**
 * Zod schemas for critical API responses.
 *
 * Parse every response through the relevant schema immediately after fetch.
 * A parse failure throws a ZodError which surfaces in the browser console
 * as a clear "field X missing / wrong type" message rather than a silent
 * undefined → 0 display bug.
 *
 * Usage:
 *   import { ScopeTotalsSchema } from "@/lib/api-schemas";
 *   const totals = ScopeTotalsSchema.parse(await res.json());
 */

import { z } from "zod";

// ── /jobs/{id}/scope-totals ──────────────────────────────────────────────────
export const ScopeTotalsSchema = z.object({
  scope_1: z.number(),
  scope_2: z.number(),
  scope_3: z.number(),
  total: z.number(),
});
export type ScopeTotals = z.infer<typeof ScopeTotalsSchema>;

// ── /jobs/{id}/report-data-check ────────────────────────────────────────────
const IntegrityIssueSchema = z.object({
  level: z.enum(["scope", "category", "row"]),
  label: z.string(),
  canonical: z.number(),
  report: z.number(),
  diff: z.number(),
});

export const ReportDataCheckSchema = z.object({
  status: z.enum(["pass", "fail", "no_data"]),
  canonical_total: z.number(),
  report_total: z.number(),
  issue_count: z.number(),
  scope_issues: z.number(),
  category_issues: z.number(),
  row_issues: z.number(),
  issues: z.array(IntegrityIssueSchema),
});
export type ReportDataCheck = z.infer<typeof ReportDataCheckSchema>;

// ── /jobs/{id}/live-report-data (key fields only) ───────────────────────────
// Full LiveData type has many optional fields; we validate just the fields
// that caused silent bugs when missing (emissions figures, scope totals).
const CategoryRowSchema = z.object({
  scope: z.string(),
  category: z.string(),
  emissions: z.union([z.number(), z.string()]),
  original_id: z.string().nullable().optional(),
  report_label: z.string().nullable().optional(),
});

const AppendixRowSchema = z.object({
  scope: z.string().optional(),
  category: z.string().optional(),
  emissions: z.union([z.number(), z.string()]),
  original_id: z.string().nullable().optional(),
});

export const LiveReportSummarySchema = z.object({
  current_total: z.number().nullable().optional(),
}).passthrough();

export const LiveReportDataSchema = z.object({
  categories: z.array(CategoryRowSchema).optional(),
  appendix_rows: z.array(AppendixRowSchema).optional(),
  summary: LiveReportSummarySchema.optional(),
  scope_totals: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  report_metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export type LiveReportData = z.infer<typeof LiveReportDataSchema>;

// ── Safe parse helper ────────────────────────────────────────────────────────
/**
 * Parses `data` through `schema`. On failure, logs a warning to the console
 * (visible in browser devtools) and returns the raw data cast to T so the
 * page continues to function. This avoids a hard crash while still surfacing
 * the schema mismatch during development.
 */
export function safeParse<T>(schema: z.ZodSchema<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(
      `[api-schemas] ${label} response did not match schema — check for missing or renamed fields:`,
      result.error.format(),
    );
    return data as T;
  }
  return result.data;
}
