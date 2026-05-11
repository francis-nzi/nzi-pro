import { useState } from "react";

import { milestoneDotClass } from "@/lib/status-utils";

type MilestoneRowProps = {
  label: string;
  dueDate: string;
  status: string;
  completedAt?: string | null;
  completedBy?: string | null;
  onToggle?: (completed: boolean) => Promise<void>;
  readOnly?: boolean;
  helperText?: string;
};

export default function MilestoneRow({
  label,
  dueDate,
  status,
  completedAt,
  completedBy,
  onToggle,
  readOnly = false,
  helperText,
}: MilestoneRowProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const isCompleted = status === "completed";

  const statusColor = milestoneDotClass(status);

  const handleToggle = async () => {
    if (!onToggle || readOnly) return;
    setIsUpdating(true);
    try {
      await onToggle(!isCompleted);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex items-center gap-4 rounded-lg border p-3">
      <div className={`h-4 w-4 rounded-full ${statusColor}`} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          <span className="text-sm text-muted-foreground">
            {new Date(dueDate).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
        {completedAt && completedBy ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Completed by {completedBy} on {new Date(completedAt).toLocaleDateString("en-GB")}
          </div>
        ) : null}
      </div>
      {readOnly ? (
        <div className="flex items-center gap-2 rounded-full border border-dashed border-muted-foreground/30 px-3 py-1 text-xs text-muted-foreground">
          {helperText || "Template milestone"}
        </div>
      ) : (
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={handleToggle}
            disabled={isUpdating}
            className="h-5 w-5 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span className="text-sm">{isCompleted ? "Complete" : "Mark Complete"}</span>
        </label>
      )}
    </div>
  );
}
