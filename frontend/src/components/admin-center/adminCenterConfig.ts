import {
  ADMIN_DOMAINS,
  ADMIN_MODULES,
  DOMAIN_COPY,
  getCriticalAdminModules,
  getPriorityAdminModules,
  type AdminDomain,
  type AdminModule,
} from "@/components/admin/adminModuleCatalog";

export type { AdminDomain, AdminModule } from "@/components/admin/adminModuleCatalog";

export const ADMIN_CENTER_RECENTLY_VISITED_KEY = "nzi.admin-center.recently-visited";
export const ADMIN_CENTER_RECENTLY_VISITED_EVENT = "nzi-admin-center-recently-visited";

export type AdminCenterVisitedItem = {
  href: string;
  title: string;
  domain: AdminDomain;
  visitedAt: string;
};

export type AdminCenterGroup = {
  domain: AdminDomain;
  label: string;
  subtitle: string;
  count: number;
};

export const ADMIN_CENTER_GROUPS: AdminCenterGroup[] = ADMIN_DOMAINS.map((domain) => ({
  domain,
  label: domain,
  subtitle: DOMAIN_COPY[domain].summary,
  count: ADMIN_MODULES.filter((module) => module.domain === domain).length,
}));

export const ADMIN_CENTER_MODULES: AdminModule[] = ADMIN_MODULES;
export const ADMIN_CENTER_MODULE_COUNT = ADMIN_CENTER_MODULES.length;
export const ADMIN_CENTER_PRIORITY_MODULES = getPriorityAdminModules();
export const ADMIN_CENTER_CRITICAL_MODULES = getCriticalAdminModules();

export function getAdminCenterGroup(domain: AdminDomain): AdminCenterGroup {
  return ADMIN_CENTER_GROUPS.find((group) => group.domain === domain) || ADMIN_CENTER_GROUPS[0];
}

export function getAdminCenterModulesByDomain(domain: AdminDomain): AdminModule[] {
  return ADMIN_CENTER_MODULES.filter((module) => module.domain === domain);
}

export function getAdminCenterPriorityModules(): AdminModule[] {
  return ADMIN_CENTER_PRIORITY_MODULES;
}

export function getAdminCenterCriticalModule(): AdminModule | null {
  return ADMIN_CENTER_CRITICAL_MODULES[0] || null;
}

export function getAdminCenterModuleByHref(href: string): AdminModule | null {
  const normalized = href.endsWith("/") && href !== "/" ? href.slice(0, -1) : href;
  return ADMIN_CENTER_MODULES.find((module) => normalized === module.href || normalized.startsWith(`${module.href}/`)) ?? null;
}

function readVisitedPayload(): AdminCenterVisitedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ADMIN_CENTER_RECENTLY_VISITED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        href: String(item?.href || "").trim(),
        title: String(item?.title || "").trim(),
        domain: String(item?.domain || "").trim() as AdminDomain,
        visitedAt: String(item?.visitedAt || "").trim(),
      }))
      .filter((item) => item.href && item.title && item.visitedAt) as AdminCenterVisitedItem[];
  } catch {
    return [];
  }
}

function writeVisitedPayload(items: AdminCenterVisitedItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_CENTER_RECENTLY_VISITED_KEY, JSON.stringify(items.slice(0, 3)));
  } catch {
    // Ignore storage failures.
  }
}

export function readAdminCenterRecentlyVisited(): AdminCenterVisitedItem[] {
  return readVisitedPayload();
}

export function recordAdminCenterVisit(module: AdminModule): AdminCenterVisitedItem[] {
  if (typeof window === "undefined") return [];
  const visitedAt = new Date().toISOString();
  const existing = readVisitedPayload().filter((item) => item.href !== module.href);
  const next: AdminCenterVisitedItem[] = [
    {
      href: module.href,
      title: module.title,
      domain: module.domain,
      visitedAt,
    },
    ...existing,
  ].slice(0, 3);
  writeVisitedPayload(next);
  window.dispatchEvent(new Event(ADMIN_CENTER_RECENTLY_VISITED_EVENT));
  return next;
}
