import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusBadgeClass } from "@/lib/status-utils";

type StatusBadgeProps = {
  status?: string | null;
  label?: string;
  className?: string;
};

export default function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const display = label ?? (status && status.trim() ? status : "Unknown");

  return (
    <Badge className={cn("border text-xs font-semibold", statusBadgeClass(status), className)}>
      {display}
    </Badge>
  );
}