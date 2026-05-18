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

type JobSetupOverviewSectionProps = {
  hidden?: boolean;
  jobId: number;
  busy: boolean;
  status: string;
  selectedMilestoneTemplateId: string;
  jobTitle: string;
  jobStatus: string;
  jobType: string;
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
}: JobSetupOverviewSectionProps) {
  return (
    <div className={`space-y-6 ${hidden ? "hidden" : ""}`}>
      <Card id="job-details-section">
        <CardHeader>
          <CardTitle>Job Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="jobTitle">Job Title / Description</Label>
            <Input id="jobTitle" value={jobTitle} onChange={(e) => onJobTitleChange(e.target.value)} placeholder="Enter job title..." />
          </div>

          <div className="space-y-2">
            <Label htmlFor="jobStatus">Status</Label>
            <Select value={jobStatus} onValueChange={onJobStatusChange}>
              <SelectTrigger id="jobStatus">
                <SelectValue placeholder="Select status..." />
              </SelectTrigger>
              <SelectContent>
                {jobStatuses.map((statusItem) => (
                  <SelectItem key={statusItem.status_id} value={statusItem.name}>
                    {statusItem.name}
                  </SelectItem>
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
                  <SelectItem key={jt.job_type_id} value={jt.name}>
                    {jt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              This controls how the job is grouped on client pages and in reporting.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="originalPortfolio">Original Portfolio</Label>
            <SearchableStringSelect
              id="originalPortfolio"
              value={originalPortfolio || "NZI"}
              options={portfolios}
              placeholder="Search portfolios..."
              noMatchesText="Type a portfolio name and press Enter"
              onValueChange={onOriginalPortfolioChange}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to NZI and is used to record the original portfolio for this job.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="crmName">CRM Name</Label>
            <Select value={crmName || "__none__"} onValueChange={(v) => onCrmNameChange(v === "__none__" ? "" : v)}>
              <SelectTrigger id="crmName">
                <SelectValue placeholder="Select team member..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {teamMembers.map((member) => (
                  <SelectItem key={member.user_id} value={member.full_name}>
                    {member.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="milestoneTemplate">Milestone Template</Label>
            <Select value={selectedMilestoneTemplateId || "__none__"} onValueChange={onMilestoneTemplateChange}>
              <SelectTrigger id="milestoneTemplate">
                <SelectValue placeholder="Select milestone template..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {milestoneTemplates.map((template) => (
                  <SelectItem key={template.template_id} value={String(template.template_id)}>
                    {template.template_name || `Template ${template.template_id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Changing the template will recalculate milestones from the later of Job Start Date and Reporting Period Start Date.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="jobStartDate">Start Date</Label>
              <Input id="jobStartDate" type="date" value={jobStartDate} onChange={(e) => onJobStartDateChange(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jobEndDate">End Date</Label>
              <Input id="jobEndDate" type="date" value={jobEndDate} onChange={(e) => onJobEndDateChange(e.target.value)} />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="text-sm font-medium">Reporting Period</div>
            <div className="text-xs text-muted-foreground">
              Datasets will be auto-selected based on this period. System supports multi-year periods (e.g., Aug 2024 – Jul 2025).
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="periodStart">Period Start</Label>
                <Input id="periodStart" type="date" value={reportingPeriodStart} onChange={(e) => onReportingPeriodStartChange(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="periodEnd">Period End</Label>
                <Input id="periodEnd" type="date" value={reportingPeriodEnd} onChange={(e) => onReportingPeriodEndChange(e.target.value)} />
                {periodEndMonthMismatch ? (
                  <p className="text-xs text-amber-700">
                    The chosen Period End month does not align with the client&apos;s Year End month, as defined in the client&apos;s file
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={onSaveReportingPeriod} disabled={busy}>
                Save reporting period
              </Button>
            </div>
          </div>

          <div className="border-t pt-2 space-y-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Job ID:</span> {Number.isFinite(jobId) ? jobId : "-"}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Reporting Period:</span>{" "}
              {reportingPeriodDisplay || "-"}
              {benchmarkPeriodLabel ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                  {benchmarkPeriodLabel}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={onSaveJobDetails} disabled={busy}>
              Save Job Details
            </Button>
          </div>

          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
