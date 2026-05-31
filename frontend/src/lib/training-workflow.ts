export type TrainingDeliveryMode = "in_person" | "online" | "hybrid";
export type TrainingParticipantType = "client_contact" | "external_individual";
export type TrainingBookingStatus = "booked" | "confirmed" | "attended" | "no_show" | "cancelled" | "waitlist";
export type TrainingBookingSource = "manual" | "job_fee" | "invoice" | "free_place";
export type TrainingBillingStatus = "pending" | "included" | "invoiced" | "paid" | "waived";
export type TrainingEntitlementStatus = "available" | "reserved" | "consumed" | "cancelled" | "expired";
export type TrainingCourseRunStatus = "draft" | "scheduled" | "open" | "full" | "in_progress" | "completed" | "cancelled";

const TITLE_CASE = new Map<string, string>([
  ["in_person", "In Person"],
  ["online", "Online"],
  ["hybrid", "Hybrid"],
  ["client_contact", "Client Contact"],
  ["external_individual", "External Individual"],
  ["manual", "Manual"],
  ["job_fee", "Included in Job Fee"],
  ["invoice", "To Invoice"],
  ["free_place", "Free Place"],
  ["pending", "Pending"],
  ["included", "Included"],
  ["invoiced", "Invoiced"],
  ["paid", "Paid"],
  ["waived", "Waived"],
  ["available", "Available"],
  ["reserved", "Reserved"],
  ["consumed", "Consumed"],
  ["cancelled", "Cancelled"],
  ["expired", "Expired"],
  ["draft", "Draft"],
  ["scheduled", "Scheduled"],
  ["open", "Open"],
  ["full", "Full"],
  ["in_progress", "In Progress"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["booked", "Booked"],
  ["confirmed", "Confirmed"],
  ["attended", "Attended"],
  ["no_show", "No Show"],
  ["waitlist", "Waitlist"],
]);

function titleCase(value: string): string {
  return TITLE_CASE.get(value) || value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export function formatTrainingDeliveryMode(value?: string | null): string {
  return titleCase(String(value || "").trim().toLowerCase());
}

export function formatTrainingParticipantType(value?: string | null): string {
  return titleCase(String(value || "").trim().toLowerCase());
}

export function formatTrainingBookingSource(value?: string | null): string {
  return titleCase(String(value || "").trim().toLowerCase());
}

export function formatTrainingBookingStatus(value?: string | null): string {
  return titleCase(String(value || "").trim().toLowerCase());
}

export function formatTrainingBillingStatus(value?: string | null): string {
  return titleCase(String(value || "").trim().toLowerCase());
}

export function formatTrainingEntitlementStatus(value?: string | null): string {
  return titleCase(String(value || "").trim().toLowerCase());
}

export function formatTrainingCourseRunStatus(value?: string | null): string {
  return titleCase(String(value || "").trim().toLowerCase());
}

export const TRAINING_DELIVERY_MODE_OPTIONS: Array<{ value: TrainingDeliveryMode; label: string }> = [
  { value: "in_person", label: "In person" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Hybrid" },
];

export const TRAINING_PARTICIPANT_TYPE_OPTIONS: Array<{ value: TrainingParticipantType; label: string }> = [
  { value: "client_contact", label: "Client contact" },
  { value: "external_individual", label: "External individual" },
];

export const TRAINING_BOOKING_SOURCE_OPTIONS: Array<{ value: TrainingBookingSource; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "job_fee", label: "Included in job fee" },
  { value: "invoice", label: "To invoice" },
  { value: "free_place", label: "Free place" },
];

export const TRAINING_BOOKING_STATUS_OPTIONS: Array<{ value: TrainingBookingStatus; label: string }> = [
  { value: "booked", label: "Booked" },
  { value: "confirmed", label: "Confirmed" },
  { value: "attended", label: "Attended" },
  { value: "no_show", label: "No show" },
  { value: "cancelled", label: "Cancelled" },
  { value: "waitlist", label: "Waitlist" },
];

export const TRAINING_BILLING_STATUS_OPTIONS: Array<{ value: TrainingBillingStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "included", label: "Included" },
  { value: "invoiced", label: "Invoiced" },
  { value: "paid", label: "Paid" },
  { value: "waived", label: "Waived" },
];

export const TRAINING_ENTITLEMENT_STATUS_OPTIONS: Array<{ value: TrainingEntitlementStatus; label: string }> = [
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "consumed", label: "Consumed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

export const TRAINING_COURSE_RUN_STATUS_OPTIONS: Array<{ value: TrainingCourseRunStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "open", label: "Open" },
  { value: "full", label: "Full" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
