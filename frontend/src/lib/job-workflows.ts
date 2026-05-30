import { formatJobFamilyLabel, type JobFamily } from "@/lib/job-family";

export type JobWorkflowDefinition = {
  family: JobFamily;
  label: string;
  description: string;
  stages: string[];
  usesScopeDatasets: boolean;
};

const WORKFLOWS: Record<JobFamily, JobWorkflowDefinition> = {
  crp: {
    family: "crp",
    label: "Carbon Reduction Plan",
    description: "Uses the existing carbon reporting workflow with scope dataset assignment.",
    stages: ["Setup", "Reporting Period", "Scope Datasets"],
    usesScopeDatasets: true,
  },
  training: {
    family: "training",
    label: "Training",
    description: "Best suited to sessions, materials, attendees, and delivery tracking.",
    stages: ["Setup", "Delivery Period", "Workflow Preview"],
    usesScopeDatasets: false,
  },
  consultancy: {
    family: "consultancy",
    label: "Consultancy",
    description: "Best suited to advisory, workshops, reviews, and deliverables tracking.",
    stages: ["Setup", "Delivery Period", "Workflow Preview"],
    usesScopeDatasets: false,
  },
  lca: {
    family: "lca",
    label: "Life Cycle Analysis",
    description: "Best suited to product scopes, assumptions, methods, and data sources.",
    stages: ["Setup", "Delivery Period", "Workflow Preview"],
    usesScopeDatasets: false,
  },
  pcf: {
    family: "pcf",
    label: "Product Carbon Footprinting",
    description: "Best suited to product boundaries, functional units, and footprinting outputs.",
    stages: ["Setup", "Delivery Period", "Workflow Preview"],
    usesScopeDatasets: false,
  },
};

export function normalizeJobFamily(value?: string | null): JobFamily {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "training" || raw === "consultancy" || raw === "lca" || raw === "pcf") return raw;
  return "crp";
}

export function getJobWorkflowDefinition(value?: string | null): JobWorkflowDefinition {
  return WORKFLOWS[normalizeJobFamily(value)] || WORKFLOWS.crp;
}

export function getJobWorkflowFamilyLabel(value?: string | null): string {
  return formatJobFamilyLabel(normalizeJobFamily(value));
}
