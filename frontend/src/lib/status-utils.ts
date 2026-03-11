export type MilestoneStatus = "green" | "amber" | "red" | "completed" | string | null | undefined;

export type StatusTone = "success" | "warning" | "danger" | "neutral";

const MILESTONE_TONE_MAP: Record<string, StatusTone> = {
  green: "success",
  amber: "warning",
  red: "danger",
  completed: "neutral",
};

const STATUS_TONE_MAP: Record<string, StatusTone> = {
  active: "success",
  inactive: "neutral",
  prospect: "warning",
  open: "neutral",
  "data gathering phase": "warning",
  "reporting phase": "success",
  "awaiting client input": "warning",
  completed: "success",
  archived: "neutral",
  cancelled: "danger",
};

export function toneForMilestone(status?: MilestoneStatus): StatusTone {
  const key = String(status ?? "").trim().toLowerCase();
  return MILESTONE_TONE_MAP[key] ?? "neutral";
}

export function toneForStatus(status?: string | null): StatusTone {
  const key = String(status ?? "").trim().toLowerCase();
  return STATUS_TONE_MAP[key] ?? "neutral";
}

export function milestoneDotClass(status?: MilestoneStatus): string {
  switch (toneForMilestone(status)) {
    case "success":
      return "bg-emerald-500";
    case "warning":
      return "bg-amber-500";
    case "danger":
      return "bg-rose-500";
    default:
      return "bg-slate-300";
  }
}

export function milestoneBadgeClass(status?: MilestoneStatus): string {
  switch (toneForMilestone(status)) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "danger":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export function milestoneLabel(status?: MilestoneStatus): string {
  const key = String(status ?? "").trim().toLowerCase();
  switch (key) {
    case "green":
      return "On track";
    case "amber":
      return "Due soon";
    case "red":
      return "Overdue";
    case "completed":
      return "Complete";
    default:
      return "No milestones";
  }
}

export function statusBadgeClass(status?: string | null): string {
  switch (toneForStatus(status)) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "danger":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}