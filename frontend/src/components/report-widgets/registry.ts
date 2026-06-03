export const REPORT_WIDGET_IDS = {
  scopeCategoryComparison: "scope_category_comparison",
  emissionsReductionPathway: "emissions_reduction_pathway",
} as const;

export type ReportWidgetId = (typeof REPORT_WIDGET_IDS)[keyof typeof REPORT_WIDGET_IDS];
