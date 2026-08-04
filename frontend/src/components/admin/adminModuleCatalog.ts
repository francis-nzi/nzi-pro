import type { LucideIcon } from "lucide-react";
import {
  ArchiveRestore,
  BadgeAlert,
  BellRing,
  Boxes,
  Building2,
  Clock3,
  Database,
  FileCog,
  FileSpreadsheet,
  Folders,
  Gauge,
  History,
  Layers3,
  LibraryBig,
  Mail,
  Megaphone,
  Palette,
  Receipt,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Truck,
  UploadCloud,
  Users,
  Workflow,
} from "lucide-react";

export type AdminDomain = "People & Access" | "Reference Data" | "Reporting & Delivery" | "System & Governance";

export type AdminModule = {
  title: string;
  description: string;
  href: string;
  cta: string;
  domain: AdminDomain;
  icon: LucideIcon;
  highlight?: boolean;
  critical?: boolean;
};

export const ADMIN_DOMAINS: AdminDomain[] = [
  "People & Access",
  "Reference Data",
  "Reporting & Delivery",
  "System & Governance",
];

export const ADMIN_MODULES: AdminModule[] = [
  {
    title: "Organisation Management",
    description: "Create organisations, manage membership, switch the active tenant, and review billing controls.",
    href: "/admin/organisations",
    cta: "Open organisations",
    domain: "People & Access",
    icon: Building2,
    highlight: true,
  },
  {
    title: "Portfolio Owners",
    description: "Manage portfolio owner companies, inspect their client networks, and open the portfolio-level dashboard.",
    href: "/admin/portfolios",
    cta: "Open portfolio owners",
    domain: "People & Access",
    icon: Building2,
    highlight: true,
  },
  {
    title: "Billing & Entitlements",
    description: "Review plan status, subscription state, usage limits, invoices, and billing events.",
    href: "/admin/billing",
    cta: "Review billing",
    domain: "People & Access",
    icon: ShieldCheck,
    highlight: true,
  },
  {
    title: "Team Management",
    description: "Manage NZI team members, roles, invitations, and access.",
    href: "/admin/team",
    cta: "Manage team",
    domain: "People & Access",
    icon: Users,
    highlight: true,
  },
  {
    title: "Lookups",
    description: "Maintain statuses, VAT rates, currencies, and other reference lists.",
    href: "/admin/lookups",
    cta: "Edit lookups",
    domain: "Reference Data",
    icon: Table2,
  },
  {
    title: "Job Type Templates",
    description: "Define the default scope items and budgeted hours for each job type. Used to auto-populate new jobs and as the basis for invoicing.",
    href: "/admin/job-type-templates",
    cta: "Edit templates",
    domain: "Reference Data",
    icon: FileSpreadsheet,
    highlight: true,
  },
  {
    title: "Job Items",
    description: "Manage service items used in jobs, quotes, and invoices.",
    href: "/admin/job-items",
    cta: "Open job items",
    domain: "Reference Data",
    icon: FileSpreadsheet,
  },
  {
    title: "Suppliers",
    description: "Manage suppliers, service items, agreed rates, and default VAT/UoM.",
    href: "/admin/suppliers",
    cta: "Manage suppliers",
    domain: "Reference Data",
    icon: Boxes,
  },
  {
    title: "LCA Supplier Library",
    description: "Global, geocoded suppliers, their locations, and the components they supply -- reused across every client's LCA transport legs.",
    href: "/admin/lca-suppliers",
    cta: "Manage suppliers",
    domain: "Reference Data",
    icon: Truck,
  },
  {
    title: "Datasets & Factors",
    description: "Manage conversion factor datasets and imports.",
    href: "/admin/datasets",
    cta: "Open datasets",
    domain: "Reference Data",
    icon: Database,
    highlight: true,
  },
  {
    title: "Reusable Factors",
    description: "Add reusable global and client-level factors for jobs.",
    href: "/admin/custom-factors",
    cta: "Manage factors",
    domain: "Reference Data",
    icon: Layers3,
  },
  {
    title: "Factor Definitions",
    description: "Edit descriptions (Category, Levels, Report Label) that propagate across all datasets and years via the normalised factor tables.",
    href: "/admin/factor-definitions",
    cta: "Edit definitions",
    domain: "Reference Data",
    icon: LibraryBig,
  },
  {
    title: "Spend Lines",
    description: "Curated Purchased Goods & Services categories with matching keywords, used to suggest a category from a client's raw GL/ledger line.",
    href: "/admin/spend-lines",
    cta: "Manage spend lines",
    domain: "Reference Data",
    icon: Receipt,
  },
  {
    title: "Templates",
    description: "Configure report and data capture templates.",
    href: "/admin/templates",
    cta: "Open templates",
    domain: "Reporting & Delivery",
    icon: FileCog,
    highlight: true,
  },
  {
    title: "AI Prompts",
    description: "Govern reusable AI prompt templates, client profiles, job overrides, and prompt previews.",
    href: "/admin/ai-prompts",
    cta: "Open AI prompts",
    domain: "Reporting & Delivery",
    icon: Sparkles,
    highlight: true,
  },
  {
    title: "Milestone Templates",
    description: "Define milestone schedules for each job type.",
    href: "/admin/milestone-templates",
    cta: "Plan milestones",
    domain: "Reporting & Delivery",
    icon: Clock3,
  },
  {
    title: "Automation Rules",
    description: "Configure CRM triggers, actions, and test runs.",
    href: "/admin/automations",
    cta: "Review automations",
    domain: "Reporting & Delivery",
    icon: Workflow,
  },
  {
    title: "Action Options",
    description: "Manage suggested carbon reduction actions used in job action plans and reports.",
    href: "/admin/actions-options",
    cta: "Edit actions",
    domain: "Reporting & Delivery",
    icon: Sparkles,
  },
  {
    title: "Theme Settings",
    description: "Control branding and visual settings.",
    href: "/admin/theme",
    cta: "Adjust theme",
    domain: "System & Governance",
    icon: Palette,
  },
  {
    title: "Custom Fields",
    description: "Define dynamic fields used across entities.",
    href: "/admin/custom-fields",
    cta: "Shape fields",
    domain: "System & Governance",
    icon: Folders,
  },
  {
    title: "System Settings",
    description: "Manage global application configuration.",
    href: "/admin/settings",
    cta: "Open settings",
    domain: "System & Governance",
    icon: Settings2,
  },
  {
    title: "Import / Export",
    description: "Run WorkflowMax trial/full imports and export migration snapshots.",
    href: "/admin/import-export",
    cta: "Run import/export",
    domain: "System & Governance",
    icon: UploadCloud,
    highlight: true,
  },
  {
    title: "Audit Log",
    description: "Review append-only changes made by team members across clients, jobs, sites, and data.",
    href: "/admin/audit-log",
    cta: "Inspect audit trail",
    domain: "System & Governance",
    icon: History,
  },
  {
    title: "Spend Factor Refresh Requests",
    description: "Approve or reject requests to move a job's DEFRA spend factors onto a revised dataset -- SuperAdmin approval required.",
    href: "/admin/spend-factor-refresh-requests",
    cta: "Review requests",
    domain: "System & Governance",
    icon: ShieldCheck,
    highlight: true,
  },
  {
    title: "Missing Data",
    description: "Find clients and jobs with blank fields, then update those values in one place.",
    href: "/admin/missing-data",
    cta: "Resolve missing data",
    domain: "Reporting & Delivery",
    icon: BadgeAlert,
  },
  {
    title: "Email Outbox",
    description: "Monitor outbound emails, delivery status, and failures across the platform.",
    href: "/admin/email-outbox",
    cta: "Review outbox",
    domain: "System & Governance",
    icon: Mail,
  },
  {
    title: "Tenant Usage Dashboard",
    description: "Review org capacity, archive state, and queue health at a glance.",
    href: "/admin/tenant-usage",
    cta: "Open usage dashboard",
    domain: "System & Governance",
    icon: Gauge,
  },
  {
    title: "Background Jobs",
    description: "Monitor queued PDF jobs, inspect failures, and replay safe jobs.",
    href: "/admin/background-jobs",
    cta: "Open job monitor",
    domain: "System & Governance",
    icon: BellRing,
  },
  {
    title: "Archive Management",
    description: "Restore or permanently remove archived records.",
    href: "/admin/archive",
    cta: "Manage archives",
    domain: "System & Governance",
    icon: ArchiveRestore,
    critical: true,
  },
  {
    title: "Broadcasting",
    description: "Send announcements and messages to client portals — global or targeted to individual clients.",
    href: "/admin/broadcasting",
    cta: "Manage broadcasts",
    domain: "System & Governance",
    icon: Megaphone,
  },
];

export const DOMAIN_COPY: Record<AdminDomain, { eyebrow: string; summary: string }> = {
  "People & Access": {
    eyebrow: "Who can do what",
    summary: "Tenancy, billing, and team access live here. Start with organisations or billing if you are setting up a new customer.",
  },
  "Reference Data": {
    eyebrow: "Shared building blocks",
    summary: "Keep dropdowns, datasets, suppliers, and factor libraries in one reliable place.",
  },
  "Reporting & Delivery": {
    eyebrow: "How work gets delivered",
    summary: "Templates, milestones, automations, and report actions shape the client experience and your internal workflow.",
  },
  "System & Governance": {
    eyebrow: "Platform control room",
    summary: "Use these tools for global configuration, compliance, monitoring, and recovery tasks.",
  },
};

export const ADMIN_MODULES_COUNT = ADMIN_MODULES.length;

export function getAdminModuleByHref(href: string): AdminModule | null {
  const normalized = href.endsWith("/") && href !== "/" ? href.slice(0, -1) : href;
  return ADMIN_MODULES.find((module) => normalized === module.href || normalized.startsWith(`${module.href}/`)) ?? null;
}

export function getAdminModulesByDomain(domain: AdminDomain): AdminModule[] {
  return ADMIN_MODULES.filter((module) => module.domain === domain);
}

export function getPriorityAdminModules(): AdminModule[] {
  return ADMIN_MODULES.filter((module) => module.highlight);
}

export function getCriticalAdminModules(): AdminModule[] {
  return ADMIN_MODULES.filter((module) => module.critical);
}
