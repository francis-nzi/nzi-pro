export const JOB_SCOPE_REFRESH_EVENT = "nzi-job-scope-refresh";

export type JobScopeRefreshDetail = {
  source?: string;
};

export function dispatchJobScopeRefresh(source: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<JobScopeRefreshDetail>(JOB_SCOPE_REFRESH_EVENT, {
      detail: { source },
    })
  );
}
