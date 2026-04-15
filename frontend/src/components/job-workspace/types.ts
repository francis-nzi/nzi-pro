export type WorkspaceBreadcrumb = {
  label: string;
  href?: string;
};

export type WorkspaceGroupKey =
  | "setup"
  | "data"
  | "outputs"
  | "report"
  | "analysis"
  | "insights"
  | "communications"
  | "financial"
  | "admin";

export type WorkspaceTab = {
  key: WorkspaceGroupKey;
  label: string;
  countBadge?: string | number;
  disabled?: boolean;
  href?: string;
};

export type WorkspaceTabKey = WorkspaceGroupKey;

export type WorkspaceSubtab = {
  key: string;
  label: string;
  countBadge?: string | number;
  disabled?: boolean;
  href?: string;
};

export type WorkspaceEmissionsSummaryData = {
  totalTco2e: number | null;
  scope1Tco2e: number | null;
  scope2Tco2e: number | null;
  scope3Tco2e: number | null;
  label?: string;
  isSample?: boolean;
  note?: string;
};

export type JobWorkspaceJob = {
  jobId: number;
  jobNumber: string;
  jobTitle: string;
  clientName: string;
  clientDbId?: number;
  reportingPeriodLabel: string;
  benchmarkPeriodLabel?: string;
  statusLabel: string;
  ownerLabel: string;
  crmLabel?: string;
  setupCompletionLabel?: string;
  setupCompletionClassName?: string;
};
