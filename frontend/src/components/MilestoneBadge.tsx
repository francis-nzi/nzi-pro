import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { milestoneBadgeClass, milestoneLabel, MilestoneStatus } from "@/lib/status-utils";

type MilestoneBadgeProps = {
  status?: MilestoneStatus;
  label?: string;
  className?: string;
};

export default function MilestoneBadge({ status, label, className }: MilestoneBadgeProps) {
  const display = label ?? milestoneLabel(status);

  return (
    <Badge className={cn("border text-xs font-semibold", milestoneBadgeClass(status), className)}>
      {display}
    </Badge>
  );
}