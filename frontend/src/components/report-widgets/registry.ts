export const REPORT_WIDGET_IDS = {
  scopeCategoryComparison: "scope_category_comparison",
  emissionsReductionPathway: "emissions_reduction_pathway",
  emissionsByActivity: "emissions_by_activity",
  intensityPathway: "intensity_pathway",
  emissionsScopeDonut: "emissions_scope_donut",
  scopeYearOnYearBar: "scope_year_on_year_bar",
} as const;

export type ReportWidgetId = (typeof REPORT_WIDGET_IDS)[keyof typeof REPORT_WIDGET_IDS];
