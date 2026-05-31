import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SearchableStringSelect from "@/components/SearchableStringSelect";
import { Badge } from "@/components/ui/badge";
import { formatJobFamilyLabel, getJobFamilyDescription, jobFamilyBadgeClassName } from "@/lib/job-family";

type JobSetupOverviewSectionProps = {
  hidden?: boolean;
  jobId: number;
  busy: boolean;
  status: string;
  selectedMilestoneTemplateId: string;
  jobTitle: string;
  jobStatus: string;
  jobType: string;
  jobFamily?: string | null;
  originalPortfolio: string;
  crmName: string;
  jobStartDate: string;
  jobEndDate: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  reportingPeriodDisplay: string;
  benchmarkPeriodLabel?: string;
  periodEndMonthMismatch: boolean;
  milestoneTemplates: Array<{ template_id: number; template_name: string | null; is_default?: boolean | null }>;
  jobStatuses: Array<{ status_id: number; name: string }>;
  jobTypes: Array<{ job_type_id: number; name: string }>;
  portfolios: string[];
  teamMembers: Array<{ user_id: string; full_name: string }>;
  onJobTitleChange: (value: string) => void;
  onJobStatusChange: (value: string) => void;
  onJobTypeChange: (value: string) => void;
  onOriginalPortfolioChange: (value: string) => void;
  onCrmNameChange: (value: string) => void;
  onMilestoneTemplateChange: (value: string) => void;
  onJobStartDateChange: (value: string) => void;
  onJobEndDateChange: (value: string) => void;
  onReportingPeriodStartChange: (value: string) => void;
  onReportingPeriodEndChange: (value: string) => void;
  onSaveJobDetails: () => void;
  onSaveReportingPeriod: () => void;
  onApplyTemplate?: () => void;
};

export default function JobSetupOverviewSection({
  hidden,
  jobId,
  busy,
  status,
  selectedMilestoneTemplateId,
  jobTitle,
  jobStatus,
  jobType,
  jobFamily,
  originalPortfolio,
  crmName,
  jobStartDate,
  jobEndDate,
  reportingPeriodStart,
  reportingPeriodEnd,
  reportingPeriodDisplay,
  benchmarkPeriodLabel,
  periodEndMonthMismatch,
  milestoneTemplates,
  jobStatuses,
  jobTypes,
  portfolios,
  teamMembers,
  onJobTitleChange,
  onJobStatusChange,
  onJobTypeChange,
  onOriginalPortfolioChange,
  onCrmNameChange,
  onMilestoneTemplateChange,
  onJobStartDateChange,
  onJobEndDateChange,
  onReportingPeriodStartChange,
  onReportingPeriodEndChange,
  onSaveJobDetails,
  onSaveReportingPeriod,
  onApplyTemplate,
}: JobSetupOverviewSectionProps) {
  const handleSave = () => {
    onSaveJobDetails();
    onSaveReportingPeriod();
  };

  return (
    <div className={`space-y-6 ${hidden ? "hidden" : ""}`}>
      <Card id="job-details-section">
        <CardHeader>
          <CardTitle>Job Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Job Title — full width */}
          <div className="space-y-2">
            <Label htmlFor="jobTitle">Job Title / Description</Label>
            <Input id="jobTitle" value={jobTitle} onChange={(e) => onJobTitleChange(e.target.value)} placeholder="Enter job title..." />
          </div>

          {/* Status | Job Type */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="jobStatus">Status</Label>
              <Select value={jobStatus} onValueChange={onJobStatusChange}>
                <SelectTrigger id="jobStatus">
                  <SelectValue placeholder="Select status..." />
                </SelectTrigger>
                <SelectContent>
                  {jobStatuses.map((s) => (
                    <SelectItem key={s.status_id} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="jobType">Job Type</Label>
              <Select value={jobType || "__none__"} onValueChange={(v) => onJobTypeChange(v === "__none__" ? "" : v)}>
                <SelectTrigger id="jobType">
                  <SelectValue placeholder="Select job type..." />
                </SelectTrigger>
                <SelectContent>
                  {jobType && !jobTypes.some((jt) => jt.name === jobType) ? (
                    <SelectItem value={jobType}>{jobType}</SelectItem>
                  ) : null}
                  {jobTypes.map((jt) => (
                    <SelectItem key={jt.job_type_id} value={jt.name}>{jt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {jobType && onApplyTemplate ? (
                <button
                  type="button"
                  onClick={onApplyTemplate}
                  className="text-xs text-[#1c5026] hover:underline"
                >
                  Create items from template
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">Controls how the job is grouped on client pages and in reporting.</p>
              )}
              {jobFamily ? (
                <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                  <span>Family:</span>
                  <Badge variant="outline" className={jobFamilyBadgeClassName(jobFamily)}>
                    {formatJobFamilyLabel(jobFamily)}
                  </Badge>
                  <span>{getJobFamilyDescription(jobFamily)}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Original Portfolio | CRM Name */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="originalPortfolio">Original Portfolio</Label>
              <SearchableStringSelect
                id="originalPortfolio"
                value={originalPortfolio || "NZI"}
                options={(() => {
                  const base = portfolios.length > 0 ? portfolios : ["NZI", "NZN"];
                  const cur = (originalPortfolio || "NZI").trim();
                  return cur && !base.includes(cur) ? [cur, ...base] : base;
                })()}
                placeholder="Search portfolios..."
                noMatchesText="Type a portfolio name and press Enter"
                onValueChange={onOriginalPortfolioChange}
              />
              <p className="text-xs text-muted-foreground">Defaults to NZI and records the original portfolio for this job.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="crmName">CRM Name</Label>
              <Select value={crmName || "__none__"} onValueChange={(v) => onCrmNameChange(v === "__none__" ? "" : v)}>
                <SelectTrigger id="crmName">
                  <SelectValue placeholder="Select team member..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.user_id} value={m.full_name}>{m.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Job Start Date | Job End Date */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="jobStartDate">Job Start Date</Label>
              <Input id="jobStartDate" type="date" value={jobStartDate} onChange={(e) => onJobStartDateChange(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jobEndDate">Job End Date</Label>
              <Input id="jobEndDate" type="date" value={jobEndDate} onChange={(e) => onJobEndDateChange(e.target.value)} />
            </div>
          </div>

          {/* Milestone Template — full width */}
          <div className="space-y-2">
            <Label htmlFor="milestoneTemplate">Milestone Template</Label>
            <Select value={selectedMilestoneTemplateId || "__none__"} onValueChange={onMilestoneTemplateChange}>
              <SelectTrigger id="milestoneTemplate">
                <SelectValue placeholder="Select milestone template..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {milestoneTemplates.map((t) => (
                  <SelectItem key={t.template_id} value={String(t.template_id)}>
                    {t.template_name || `Template ${t.template_id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Changing the template will recalculate milestones from the later of Job Start Date and Reporting Period Start Date.
            </p>
          </div>

          {/* Reporting Period */}
          <div className="border-t pt-4 space-y-3">
            <div className="text-sm font-medium">Reporting Period</div>
            <p className="text-xs text-muted-foreground">
              Datasets will be auto-selected based on this period. System supports multi-year periods (e.g., Aug 2024 – Jul 2025).
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="periodStart">Period Start</Label>
                <Input id="periodStart" type="date" value={reportingPeriodStart} onChange={(e) => onReportingPeriodStartChange(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="periodEnd">Period End</Label>
                <Input id="periodEnd" type="date" value={reportingPeriodEnd} onChange={(e) => onReportingPeriodEndChange(e.target.value)} />
                {periodEndMonthMismatch ? (
                  <p className="text-xs text-amber-700">
                    The chosen Period End month does not align with the client&apos;s Year End month.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* Meta info */}
          <div className="border-t pt-3 grid gap-1 md:grid-cols-2 text-sm text-muted-foreground">
            <div><span className="font-medium text-foreground">Job ID:</span> {Number.isFinite(jobId) ? jobId : "-"}</div>
            <div>
              <span className="font-medium text-foreground">Reporting Period:</span>{" "}
              {reportingPeriodDisplay || "-"}
              {benchmarkPeriodLabel ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                  {benchmarkPeriodLabel}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            {status ? <span className="text-sm text-muted-foreground">{status}</span> : null}
            <Button onClick={handleSave} disabled={busy}>
              Save Job Details
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
