export const REPORT_WIDGET_IDS = {
  scopeCategoryComparison: "scope_category_comparison",
  emissionsReductionPathway: "emissions_reduction_pathway",
  intensityPathway: "intensity_pathway",
  emissionsScopeDonut: "emissions_scope_donut",
} as const;

export type ReportWidgetId = (typeof REPORT_WIDGET_IDS)[keyof typeof REPORT_WIDGET_IDS];
