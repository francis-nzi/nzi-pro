export type JobFamily = "crp" | "training" | "consultancy" | "lca" | "pcf";

const FAMILY_LABELS: Record<string, string> = {
  crp: "CRP",
  training: "Training",
  consultancy: "Consultancy",
  lca: "LCA",
  pcf: "PCF",
};

const FAMILY_DESCRIPTIONS: Record<string, string> = {
  crp: "Carbon reduction plan workflow",
  training: "Training delivery and session details",
  consultancy: "Advisory engagement scope and deliverables",
  lca: "Life cycle assessment modelling and outputs",
  pcf: "Product carbon footprinting engagement",
};

export function formatJobFamilyLabel(value?: string | null): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Unassigned";
  return FAMILY_LABELS[raw] || raw.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function jobFamilyBadgeClassName(value?: string | null): string {
  const family = String(value || "").trim().toLowerCase();
  switch (family) {
    case "crp":
      return "border-green-200 bg-green-50 text-green-800";
    case "training":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "consultancy":
      return "border-violet-200 bg-violet-50 text-violet-800";
    case "lca":
      return "border-orange-200 bg-orange-50 text-orange-800";
    case "pcf":
      return "border-teal-200 bg-teal-50 text-teal-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export function getJobFamilyDescription(value?: string | null): string {
  const family = String(value || "").trim().toLowerCase();
  return FAMILY_DESCRIPTIONS[family] || "General job workflow";
}

export function inferJobFamilyFromJobTypeName(value?: string | null): JobFamily {
  const name = String(value || "").trim().toLowerCase();
  if (!name) return "crp";
  if (name.includes("training")) return "training";
  if (name.includes("consult")) return "consultancy";
  if (name.includes("policy development")) return "consultancy";
  if (name.includes("strategy workshop")) return "consultancy";
  if (name.includes("monthly support services")) return "consultancy";
  if (name.includes("support services")) return "consultancy";
  if (name.includes("life cycle")) return "lca";
  if (name.includes("product carbon") || name.includes("pcf")) return "pcf";
  return "crp";
}
