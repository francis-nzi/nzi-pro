import type { JobWorkspaceJob, WorkspaceEmissionsSummaryData, WorkspaceSubtab, WorkspaceTabKey } from "./types";

export const sampleJob: JobWorkspaceJob = {
  jobId: 556,
  jobNumber: "J000556",
  jobTitle: "Carbon Reduction Plan",
  clientName: "First Event",
  reportingPeriodLabel: "01 Feb 2025 - 31 Jan 2026",
  statusLabel: "Open",
  ownerLabel: "Tina Hartley",
  crmLabel: "Sample job context",
};

export const sampleEmissionsSummary: WorkspaceEmissionsSummaryData = {
  totalTco2e: 61.67,
  scope1Tco2e: 3.34,
  scope2Tco2e: 0.55,
  scope3Tco2e: 57.78,
  label: "Current job totals",
  isSample: true,
  note: "Sample preview only",
};

export const workspaceTabs: Array<{ key: WorkspaceTabKey; label: string; countBadge?: string | number }> = [
  { key: "setup", label: "Setup" },
  { key: "data", label: "Data" },
  { key: "outputs", label: "Outputs" },
  { key: "report", label: "Report" },
  { key: "analysis", label: "Analysis" },
  { key: "communications", label: "Communications" },
  { key: "financial", label: "Financial" },
];

export const workspaceSubtabs: Record<WorkspaceTabKey, WorkspaceSubtab[]> = {
  setup: [
    { key: "job-details", label: "Job Details" },
    { key: "custom-fields", label: "Custom Fields" },
    { key: "report-variables", label: "Job Report Variables" },
  ],
  data: [
    { key: "data-entry", label: "Data Entry" },
    { key: "employee-commuting", label: "Employee Commuting" },
    { key: "asset-register", label: "Asset Register" },
    { key: "business-travel", label: "Business Travel" },
    { key: "data-upload", label: "Data Upload" },
    { key: "custom-dataset", label: "Custom Dataset" },
    { key: "job-only-factors", label: "Job-Only Factors" },
    { key: "spend-data", label: "Spend Data" },
  ],
  outputs: [
    { key: "data-output", label: "Data Output" },
    { key: "actions", label: "Actions" },
    { key: "report", label: "Report" },
  ],
  report: [
    { key: "draft", label: "Draft" },
    { key: "preview", label: "Preview" },
    { key: "export", label: "Export" },
  ],
  analysis: [{ key: "lca", label: "Life Cycle Analysis" }],
  communications: [
    { key: "timeline", label: "Timeline" },
    { key: "inbox", label: "Inbox" },
    { key: "notes", label: "Notes" },
    { key: "email", label: "Email" },
    { key: "tasks", label: "Tasks" },
    { key: "automation", label: "Automation" },
  ],
  financial: [
    { key: "quotes", label: "Quotes" },
    { key: "invoices", label: "Invoices" },
    { key: "other-costs", label: "Other Costs" },
    { key: "profit-loss", label: "Profit & Loss" },
  ],
};

