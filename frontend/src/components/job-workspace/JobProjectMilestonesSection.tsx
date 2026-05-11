import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import MilestoneRow from "@/components/job-workspace/MilestoneRow";

type BaseMilestone = {
  dueDate?: string | null;
  status?: string | null;
  completedAt?: string | null;
  completedBy?: string | null;
};

type AdditionalMilestoneItem = {
  itemId: number;
  key: string;
  label: string;
  dueDate: string;
  status: string;
  completedAt?: string | null;
  completedBy?: string | null;
};

type JobProjectMilestonesSectionProps = {
  hidden?: boolean;
  loading: boolean;
  milestoneNames: [string, string, string];
  baseMilestones: {
    dataCollection?: BaseMilestone;
    firstDraft?: BaseMilestone;
    finalReport?: BaseMilestone;
  };
  additionalMilestoneItems: AdditionalMilestoneItem[];
  additionalMilestonesEditable: boolean;
  currentJobId: number | null;
  onToggleBaseMilestone: (kind: "data_collection" | "first_draft" | "final_report", completed: boolean) => Promise<void>;
  onToggleAdditionalMilestone: (itemId: number, completed: boolean) => Promise<void>;
};

export default function JobProjectMilestonesSection({
  hidden,
  loading,
  milestoneNames,
  baseMilestones,
  additionalMilestoneItems,
  additionalMilestonesEditable,
  currentJobId,
  onToggleBaseMilestone,
  onToggleAdditionalMilestone,
}: JobProjectMilestonesSectionProps) {
  const [milestone1Name, milestone2Name, milestone3Name] = milestoneNames;
  const shouldShow =
    Boolean(baseMilestones.dataCollection?.dueDate) ||
    Boolean(baseMilestones.firstDraft?.dueDate) ||
    Boolean(baseMilestones.finalReport?.dueDate) ||
    additionalMilestoneItems.length > 0;

  if (hidden || !shouldShow) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Milestones</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading milestone templates...</div>
        ) : (
          <div className="space-y-4">
            {baseMilestones.dataCollection?.dueDate ? (
              <MilestoneRow
                label={milestone1Name}
                dueDate={baseMilestones.dataCollection.dueDate}
                status={baseMilestones.dataCollection.status || "green"}
                completedAt={baseMilestones.dataCollection.completedAt}
                completedBy={baseMilestones.dataCollection.completedBy}
                onToggle={(completed) => onToggleBaseMilestone("data_collection", completed)}
              />
            ) : null}
            {baseMilestones.firstDraft?.dueDate ? (
              <MilestoneRow
                label={milestone2Name}
                dueDate={baseMilestones.firstDraft.dueDate}
                status={baseMilestones.firstDraft.status || "green"}
                completedAt={baseMilestones.firstDraft.completedAt}
                completedBy={baseMilestones.firstDraft.completedBy}
                onToggle={(completed) => onToggleBaseMilestone("first_draft", completed)}
              />
            ) : null}
            {baseMilestones.finalReport?.dueDate ? (
              <MilestoneRow
                label={milestone3Name}
                dueDate={baseMilestones.finalReport.dueDate}
                status={baseMilestones.finalReport.status || "green"}
                completedAt={baseMilestones.finalReport.completedAt}
                completedBy={baseMilestones.finalReport.completedBy}
                onToggle={(completed) => onToggleBaseMilestone("final_report", completed)}
              />
            ) : null}
            {additionalMilestoneItems.length > 0 ? (
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Additional template milestones
                </div>
                <div className="space-y-3">
                  {additionalMilestoneItems.map((item) => (
                    <MilestoneRow
                      key={item.key}
                      label={item.label}
                      dueDate={item.dueDate}
                      status={item.status}
                      completedAt={item.completedAt}
                      completedBy={item.completedBy}
                      onToggle={
                        additionalMilestonesEditable && currentJobId != null
                          ? (completed) => onToggleAdditionalMilestone(item.itemId, completed)
                          : undefined
                      }
                      readOnly={!additionalMilestonesEditable}
                      helperText={
                        additionalMilestonesEditable
                          ? "Shown from the selected template"
                          : "Save the milestone template to complete these items"
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
