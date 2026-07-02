"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  BarChart2,
  BarChart3,
  Briefcase,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Clock,
  CreditCard,
  Database,
  FileText,
  HelpCircle,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  MessageCircle,
  MonitorSmartphone,
  Settings2,
  Shield,
  ShieldCheck,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiUrl, performLogout } from "@/lib/auth-client";
import { useTheme } from "@/components/ThemeProvider";
import { useAuthSession } from "@/components/AuthContext";
import { JOB_TAB_TO_GROUP } from "@/lib/job-workspace";

const ADMIN_CENTER_DOMAINS = [
  "People & Access",
  "Reference Data",
  "Reporting & Delivery",
  "System & Governance",
] as const;

const ADMIN_CENTER_LINKS = [
  { label: "Organisation Management", href: "/admin-center/organisations", domain: "People & Access" },
  { label: "Team Management",         href: "/admin-center/team",          domain: "People & Access" },
  { label: "Lookups",                 href: "/admin-center/lookups",       domain: "Reference Data" },
  { label: "Job Items",               href: "/admin-center/job-items",     domain: "Reference Data" },
  { label: "Suppliers",               href: "/admin-center/suppliers",     domain: "Reference Data" },
  { label: "Datasets & Factors",      href: "/admin-center/datasets",      domain: "Reference Data" },
  { label: "Reusable Factors",        href: "/admin-center/custom-factors",domain: "Reference Data" },
  { label: "Templates",               href: "/admin-center/templates",     domain: "Reporting & Delivery" },
  { label: "AI Prompts",              href: "/admin-center/ai-prompts",     domain: "Reporting & Delivery" },
  { label: "Milestone Templates",     href: "/admin-center/milestone-templates", domain: "Reporting & Delivery" },
  { label: "Automation Rules",        href: "/admin-center/automations",   domain: "Reporting & Delivery" },
  { label: "Action Options",          href: "/admin-center/actions-options",domain: "Reporting & Delivery" },
  { label: "Missing Data",            href: "/admin-center/missing-data",  domain: "Reporting & Delivery" },
  { label: "Theme Settings",          href: "/admin-center/theme",         domain: "System & Governance" },
  { label: "Custom Fields",           href: "/admin-center/custom-fields", domain: "System & Governance" },
  { label: "System Settings",         href: "/admin-center/settings",      domain: "System & Governance" },
  { label: "Import / Export",         href: "/admin-center/import-export", domain: "System & Governance" },
  { label: "Audit Log",               href: "/admin-center/audit-log",     domain: "System & Governance" },
  { label: "Email Outbox",            href: "/admin-center/email-outbox",  domain: "System & Governance" },
  { label: "Archive Management",      href: "/admin-center/archive",       domain: "System & Governance" },
] as const;

const HELP_LINKS = [
  { label: "Support",     href: "/support" },
  { label: "Methodology", href: "/support/methodology" },
  { label: "Legal",       href: "/support/legal" },
  { label: "Data Bank",   href: "/support/data-bank" },
  { label: "Feedback",    href: "/feedback" },
] as const;

const NAV_ITEMS = [
  { href: "/",                      label: "Dashboard", icon: LayoutDashboard },
  { href: "/insights",              label: "Insights",  icon: BarChart3 },
  { href: "/clients",               label: "Clients",   icon: Users },
  { href: "/jobs",                  label: "Jobs",      icon: Briefcase },
  { href: "/time",                  label: "Time",      icon: Clock },
  { href: "/business-development",  label: "Sales",     icon: TrendingUp },
] as const;

const BD_SECTIONS = [
  { key: "overview",          label: "Overview" },
  { key: "lead-generator",    label: "Lead Generator" },
  { key: "market-database",   label: "Market Database" },
  { key: "leads",             label: "Leads" },
  { key: "opportunities",     label: "Opportunities" },
  { key: "funnel-settings",   label: "Funnel Settings" },
] as const;

type NavOrganisation = {
  org_id: string;
  name?: string | null;
  slug?: string | null;
  is_active_org?: boolean;
};

function hasAdminAccess(
  user: Record<string, unknown>,
  currentOrg: Record<string, unknown>,
): boolean {
  const permissions = Array.isArray(user.effective_permissions)
    ? user.effective_permissions
    : Array.isArray(user.permissions)
      ? user.permissions
      : [];
  const role = String(user.role || "").trim().toLowerCase();
  const currentOrgRole = String(currentOrg?.role || "").trim().toLowerCase();
  return (
    Boolean(user.is_super_admin) ||
    Boolean(currentOrg?.is_owner) ||
    permissions.includes("admin.access") ||
    role === "superadmin" ||
    role === "admin" ||
    currentOrgRole === "superadmin" ||
    currentOrgRole === "admin" ||
    currentOrgRole === "owner"
  );
}

type JobNavSubtab = { key: string; label: string; href: (id: number) => string };
type JobNavGroup = { key: string; label: string; icon: React.ComponentType<{ className?: string }>; href: (id: number) => string; subtabs: JobNavSubtab[] };

const JOB_NAV_GROUPS: JobNavGroup[] = [
  { key: "setup", label: "Setup", icon: Settings2, href: (j) => `/jobs/${j}/setup`,
    subtabs: [
      { key: "setup-overview",      label: "Setup Overview", href: (j) => `/jobs/${j}/setup` },
      { key: "setup-custom-fields", label: "Custom Fields",  href: (j) => `/jobs/${j}/setup` },
    ],
  },
  { key: "data", label: "Data", icon: Database, href: (j) => `/jobs/${j}/data-entry`,
    subtabs: [
      { key: "data-entry",         label: "Data Entry",         href: (j) => `/jobs/${j}/data-entry` },
      { key: "employee-commuting", label: "Employee Commuting", href: (j) => `/jobs/${j}/data-entry/employee-commuting` },
      { key: "asset-register",     label: "Asset Register",     href: (j) => `/jobs/${j}/data-entry/asset-register` },
      { key: "business-travel",    label: "Business Travel",    href: (j) => `/jobs/${j}/data-entry/business-travel` },
      { key: "upload",             label: "Data Upload",        href: (j) => `/jobs/${j}?tab=upload` },
      { key: "custom-dataset",     label: "Custom Dataset",     href: (j) => `/jobs/${j}/data-entry/custom-dataset` },
      { key: "custom-factors",     label: "Job-Only Factors",   href: (j) => `/jobs/${j}/data-entry/custom-factors` },
      { key: "spend-data",         label: "Spend Data",         href: (j) => `/jobs/${j}/data-entry/spend-data` },
      { key: "notes",              label: "Notes",              href: (j) => `/jobs/${j}/data-entry/notes` },
    ],
  },
  { key: "outputs", label: "Outputs", icon: BarChart2, href: (j) => `/jobs/${j}/outputs`,
    subtabs: [
      { key: "data-output", label: "Data Output", href: (j) => `/jobs/${j}/outputs` },
      { key: "actions",     label: "Actions",     href: (j) => `/jobs/${j}?tab=actions` },
    ],
  },
  { key: "report", label: "Report", icon: FileText, href: (j) => `/jobs/${j}/report-new`,
    subtabs: [
      { key: "report-new",       label: "Report Preparation", href: (j) => `/jobs/${j}/report-new` },
      { key: "advanced-reports", label: "Report Printing",    href: (j) => `/jobs/${j}/advanced-reports` },
      { key: "client-review",    label: "Client Review",      href: (j) => `/jobs/${j}/client-review` },
    ],
  },
  { key: "analysis", label: "Analysis", icon: TrendingUp, href: (j) => `/jobs/${j}/lca`,
    subtabs: [{ key: "lca", label: "Life Cycle Analysis", href: (j) => `/jobs/${j}/lca` }],
  },
  { key: "insights", label: "Insights", icon: Lightbulb, href: (j) => `/jobs/${j}/insights`, subtabs: [] },
  { key: "job-tasks", label: "Tasks", icon: ClipboardList, href: (j) => `/jobs/${j}/tasks`, subtabs: [] },
  { key: "portal", label: "Portal", icon: MonitorSmartphone, href: (j) => `/jobs/${j}/portal-management`, subtabs: [] },
  { key: "communications", label: "Comms", icon: MessageCircle, href: (j) => `/jobs/${j}/communications/timeline`,
    subtabs: [
      { key: "communications-timeline",   label: "Timeline",     href: (j) => `/jobs/${j}/communications/timeline` },
      { key: "communications-inbox",      label: "Inbox",        href: (j) => `/jobs/${j}/communications/inbox` },
      { key: "communications-email",      label: "Email",        href: (j) => `/jobs/${j}/communications/email` },
      { key: "communications-automation", label: "Automation",   href: (j) => `/jobs/${j}/communications/automation` },
      { key: "communications-crm",        label: "CRM Timeline", href: (j) => `/jobs/${j}/communications/crm` },
    ],
  },
  { key: "financial", label: "Financial", icon: CreditCard, href: (j) => `/jobs/${j}/financial/quotes`,
    subtabs: [
      { key: "financial-quotes",      label: "Quotes",        href: (j) => `/jobs/${j}/financial/quotes` },
      { key: "financial-invoices",    label: "Invoices",      href: (j) => `/jobs/${j}/financial/invoices` },
      { key: "financial-other-costs", label: "Other Costs",   href: (j) => `/jobs/${j}/financial/other-costs` },
      { key: "financial-profit-loss", label: "Profit & Loss", href: (j) => `/jobs/${j}/financial/profit-loss` },
    ],
  },
  { key: "admin", label: "Job Admin", icon: ShieldCheck, href: (j) => `/jobs/${j}/admin/files`,
    subtabs: [
      { key: "files",       label: "Files",        href: (j) => `/jobs/${j}/admin/files` },
      { key: "time",        label: "Time Entries", href: (j) => `/jobs/${j}/admin/time` },
      { key: "certificate", label: "Certificate",  href: (j) => `/jobs/${j}/admin/certificate` },
    ],
  },
];

function getJobActiveGroup(pathname: string, jobId: number): string {
  const b = `/jobs/${jobId}`;
  if (pathname?.startsWith(`${b}/data-entry`)) return "data";
  if (pathname?.startsWith(`${b}/outputs`)) return "outputs";
  if (pathname?.startsWith(`${b}/report-new`) || pathname?.startsWith(`${b}/advanced-reports`) || pathname?.startsWith(`${b}/client-review`)) return "report";
  if (pathname?.startsWith(`${b}/lca`)) return "analysis";
  if (pathname?.startsWith(`${b}/insights`)) return "insights";
  if (pathname?.startsWith(`${b}/tasks`)) return "job-tasks";
  if (pathname?.startsWith(`${b}/portal-management`)) return "portal";
  if (pathname?.startsWith(`${b}/communications`)) return "communications";
  if (pathname?.startsWith(`${b}/financial`)) return "financial";
  if (pathname?.startsWith(`${b}/admin`)) return "admin";
  return "setup";
}

function getJobActiveSubtab(pathname: string): string {
  if (pathname?.includes("/data-entry/employee-commuting")) return "employee-commuting";
  if (pathname?.includes("/data-entry/asset-register")) return "asset-register";
  if (pathname?.includes("/data-entry/business-travel")) return "business-travel";
  if (pathname?.includes("/data-entry/custom-dataset")) return "custom-dataset";
  if (pathname?.includes("/data-entry/custom-factors")) return "custom-factors";
  if (pathname?.includes("/data-entry/notes")) return "notes";
  if (pathname?.includes("/data-entry/spend-data")) return "spend-data";
  if (pathname?.includes("/data-entry")) return "data-entry";
  if (pathname?.includes("/report-new")) return "report-new";
  if (pathname?.includes("/advanced-reports")) return "advanced-reports";
  if (pathname?.includes("/client-review")) return "client-review";
  if (pathname?.includes("/communications/timeline")) return "communications-timeline";
  if (pathname?.includes("/communications/inbox")) return "communications-inbox";
  if (pathname?.includes("/communications/email")) return "communications-email";
  if (pathname?.includes("/tasks")) return "job-tasks";
  if (pathname?.includes("/communications/automation")) return "communications-automation";
  if (pathname?.includes("/communications/crm")) return "communications-crm";
  if (pathname?.includes("/financial/quotes")) return "financial-quotes";
  if (pathname?.includes("/financial/invoices")) return "financial-invoices";
  if (pathname?.includes("/financial/other-costs")) return "financial-other-costs";
  if (pathname?.includes("/financial/profit-loss")) return "financial-profit-loss";
  if (pathname?.includes("/lca")) return "lca";
  if (pathname?.includes("/admin/files")) return "files";
  if (pathname?.includes("/admin/time")) return "time";
  if (pathname?.includes("/admin/certificate")) return "certificate";
  if (pathname?.includes("/setup")) return "setup-overview";
  return "";
}

function BdSubNav({ accentColor, pathname }: { accentColor: string; pathname: string }) {
  const searchParams = useSearchParams();
  const activeSection = searchParams.get("section") || "overview";
  if (pathname !== "/business-development") return null;
  return (
    <div className="ml-3 mt-0.5 border-l border-border pl-3 py-1 space-y-0.5">
      {BD_SECTIONS.map((section) => {
        const sectionActive = activeSection === section.key;
        return (
          <Link
            key={section.key}
            href={`/business-development?section=${section.key}`}
            className={cn(
              "block rounded px-2 py-1 text-xs transition-colors",
              sectionActive ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            style={sectionActive ? { backgroundColor: accentColor } : undefined}
          >
            {section.label}
          </Link>
        );
      })}
    </div>
  );
}

function NavTooltip({ label, pos }: { label: string; pos: { top: number; left: number } }) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md"
      style={{ top: pos.top, left: pos.left, transform: "translateY(-50%)" }}
    >
      {label}
    </div>,
    document.body
  );
}

function AppSidebarContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { theme } = useTheme();
  const authSession = useAuthSession();
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const [jobOpenTaskCount, setJobOpenTaskCount] = useState<number | null>(null);
  const showTooltip = (e: React.MouseEvent<HTMLElement>, label: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTooltip({ label, top: r.top + r.height / 2, left: r.right + 8 });
  };
  const hideTooltip = () => setTooltip(null);
  const [adminCenterOpen, setAdminCenterOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  const [authUi, setAuthUi] = useState({
    ready: false,
    authed: false,
    userId: "",
    userInitial: "U",
    adminAccess: false,
  });
  const [orgUi, setOrgUi] = useState({
    currentOrgId: "",
    currentOrgLabel: "",
    currentOrgSlug: "",
    currentOrgRole: "",
    organisations: [] as NavOrganisation[],
  });

  // Restore expanded preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar-expanded");
      if (saved !== null) setExpanded(saved === "true");
    } catch { /* */ }
  }, []);

  function toggleExpanded() {
    setExpanded((v) => {
      const next = !v;
      try { localStorage.setItem("sidebar-expanded", String(next)); } catch { /* */ }
      if (!next) { setAdminCenterOpen(false); setHelpOpen(false); } else { setTooltip(null); }
      return next;
    });
  }

  // Load auth state
  useEffect(() => {
    let cancelled = false;

    if (authSession) {
      if (!authSession.ready) return () => { cancelled = true; };
      const payload = authSession.payload || {};
      const user = (payload?.user || {}) as Record<string, unknown>;
      const currentOrg = (payload?.current_org || {}) as Record<string, unknown>;
      const adminAccess = hasAdminAccess(user, currentOrg);
      const userId = String(user?.email || user?.user_id || "").trim();
      if (!cancelled) {
        setAuthUi({ ready: true, authed: Boolean(authSession.payload), userId, userInitial: userId.charAt(0).toUpperCase() || "U", adminAccess });
        setOrgUi({
          currentOrgId: String(currentOrg?.org_id || user?.org_id || "").trim(),
          currentOrgLabel: String(currentOrg?.name || "").trim(),
          currentOrgSlug: String(currentOrg?.slug || "").trim(),
          currentOrgRole: String(currentOrg?.role || "").trim(),
          organisations: [],
        });
      }
      return () => { cancelled = true; };
    }

    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(apiUrl("/auth/me"), {
            credentials: "include",
            headers: { "X-NZI-Skip-Auth-Redirect": "1" },
          });
          if (!res.ok || cancelled) return;
          const payload = await res.json().catch(() => ({}));
          const user = payload?.user || {};
          const currentOrg = payload?.current_org || {};
          const adminAccess = hasAdminAccess(user, currentOrg);
          const userId = String(user?.email || user?.user_id || "").trim();
          let orgs: NavOrganisation[] = [];
          if (adminAccess) {
            try {
              const orgRes = await fetch(apiUrl("/admin/organisations"), {
                credentials: "include",
                headers: { "X-NZI-Skip-Auth-Redirect": "1" },
              });
              if (orgRes.ok) {
                const orgPayload = await orgRes.json().catch(() => ({}));
                orgs = Array.isArray(orgPayload?.items) ? orgPayload.items : [];
              }
            } catch { /* */ }
          }
          if (!cancelled) {
            setAuthUi({ ready: true, authed: true, userId, userInitial: userId.charAt(0).toUpperCase() || "U", adminAccess });
            setOrgUi({
              currentOrgId: String(currentOrg?.org_id || user?.org_id || "").trim(),
              currentOrgLabel: String(currentOrg?.name || "").trim(),
              currentOrgSlug: String(currentOrg?.slug || "").trim(),
              currentOrgRole: String(currentOrg?.role || "").trim(),
              organisations: orgs,
            });
          }
        } catch { /* */ }
      })();
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pathname, authSession]);

  useEffect(() => { setProfileOpen(false); }, [pathname]);

  // Auto-open Admin Center accordion when on any admin-center route
  useEffect(() => {
    if (pathname === "/admin-center" || pathname?.startsWith("/admin-center/")) {
      setAdminCenterOpen(true);
    }
  }, [pathname]);

  useEffect(() => {
    if (!profileOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setProfileOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

  async function switchOrganisation(orgId: string) {
    if (!orgId || orgId === orgUi.currentOrgId) { setProfileOpen(false); return; }
    setSwitchingOrgId(orgId);
    try {
      const res = await fetch(apiUrl(`/admin/organisations/${encodeURIComponent(orgId)}/switch`), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      setProfileOpen(false);
      window.location.reload();
    } catch {
      setSwitchingOrgId(null);
    }
  }

  const accentColor = theme?.button_color || theme?.primary_color || "#1c5026";

  const jobRouteMatch = pathname ? /^\/jobs\/(\d+)(\/.*)?$/.exec(pathname) : null;
  const isOnJobRoute = Boolean(jobRouteMatch);
  const jobIdFromPath = jobRouteMatch ? Number(jobRouteMatch[1]) : null;
  const tabParam = searchParams.get("tab") || "";
  const activeJobGroup =
    isOnJobRoute && jobIdFromPath
      ? pathname === `/jobs/${jobIdFromPath}` && tabParam
        ? JOB_TAB_TO_GROUP[tabParam] ?? "setup"
        : getJobActiveGroup(pathname!, jobIdFromPath)
      : "";
  const activeJobSubtab =
    isOnJobRoute && pathname
      ? pathname === `/jobs/${jobIdFromPath}` && tabParam
        ? tabParam
        : getJobActiveSubtab(pathname)
      : "";

  useEffect(() => {
    if (!isOnJobRoute || !jobIdFromPath) { setJobOpenTaskCount(null); return; }
    let cancelled = false;
    async function fetchCount() {
      try {
        const res = await fetch(apiUrl(`/jobs/${jobIdFromPath}/tasks/open-count`), {
          credentials: "include",
          headers: { "X-NZI-Skip-Auth-Redirect": "1" },
        });
        if (res.ok) {
          const data = (await res.json()) as { count: number };
          if (!cancelled) setJobOpenTaskCount(data.count);
        }
      } catch { /* non-fatal */ }
    }
    void fetchCount();
    return () => { cancelled = true; };
  }, [jobIdFromPath, isOnJobRoute]);

  const logoUrl = (() => {
    const raw = String(theme?.logo_url || "").trim();
    if (!raw) return "/api/backend/system-settings/logo/file";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/uploads/system/nzi-logo")) return "/api/backend/system-settings/logo/file";
    if (raw.startsWith("/uploads/")) return `/api/backend${raw}`;
    return raw;
  })();

  const hiddenRoutes = ["/login", "/change-password", "/legal"];
  if (hiddenRoutes.some((r) => pathname === r || pathname?.startsWith(r + "/"))) return null;

  const isAdminCenterRoute = pathname === "/admin-center" || pathname?.startsWith("/admin-center/");
  const isHelpRoute =
    pathname === "/support" || pathname?.startsWith("/support/") ||
    pathname === "/feedback" || pathname?.startsWith("/feedback/");

  function isActive(href: string, label?: string): boolean {
    if (label === "Help") return isHelpRoute;
    if (href === "/") return pathname === "/";
    return pathname === href || Boolean(pathname?.startsWith(href + "/"));
  }

  const currentOrgLabel = orgUi.currentOrgLabel || orgUi.currentOrgId || "";

  return (
    <aside
      className={cn(
        "print:hidden sticky top-0 flex h-screen flex-shrink-0 flex-col border-r bg-background transition-all duration-300 overflow-hidden",
        expanded ? "w-60" : "w-16"
      )}
    >
      {/* Logo */}
      <div className={cn("flex h-16 flex-shrink-0 items-center border-b", expanded ? "px-4 gap-3" : "justify-center")}>
        <Link href="/" className="flex items-center gap-2.5 min-w-0">
          {!logoError ? (
            <img
              src={logoUrl}
              alt="NZ Insights Pro"
              className="h-7 w-7 flex-shrink-0 object-contain"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="h-7 w-7 flex-shrink-0 rounded-full bg-emerald-700 flex items-center justify-center text-white text-xs font-bold">N</div>
          )}
          {expanded && <span className="text-sm font-bold leading-tight truncate">NZ Insights Pro</span>}
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
        {isOnJobRoute && jobIdFromPath ? (
          <>
            {/* Back to all jobs */}
            <div className="group relative">
              <Link
                href="/jobs"
                className={cn(
                  "flex h-10 w-full items-center rounded-md transition-colors text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                  expanded ? "gap-3 px-3" : "justify-center"
                )}
                onMouseEnter={!expanded ? e => showTooltip(e, "All Jobs") : undefined}
                onMouseLeave={!expanded ? hideTooltip : undefined}
              >
                <ChevronLeft className="h-4 w-4 flex-shrink-0" />
                {expanded && <span className="truncate">All Jobs</span>}
              </Link>
            </div>

            {expanded && (
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Job Workspace
              </div>
            )}

            {JOB_NAV_GROUPS.map((group) => {
              const Icon = group.icon;
              const groupHref = group.href(jobIdFromPath);
              const isGroupActive = activeJobGroup === group.key;
              const hasSubtabs = isGroupActive && group.subtabs.length > 0;
              const groupLabel = group.key === "job-tasks" && jobOpenTaskCount !== null && jobOpenTaskCount > 0
                ? `Tasks (${jobOpenTaskCount})`
                : group.label;
              return (
                <div key={group.key}>
                  <div className="group relative">
                    <Link
                      href={groupHref}
                      className={cn(
                        "flex h-10 w-full items-center rounded-md transition-colors text-sm font-medium",
                        expanded ? "gap-3 px-3" : "justify-center",
                        isGroupActive ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      style={isGroupActive ? { backgroundColor: accentColor } : undefined}
                      onMouseEnter={!expanded ? e => showTooltip(e, groupLabel) : undefined}
                      onMouseLeave={!expanded ? hideTooltip : undefined}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {expanded && <span className="truncate">{groupLabel}</span>}
                    </Link>
                  </div>
                  {expanded && hasSubtabs && (
                    <div className="ml-3 mt-0.5 border-l border-border pl-3 py-1 space-y-0.5">
                      {group.subtabs.map((subtab) => {
                        const isSubActive = activeJobSubtab === subtab.key;
                        return (
                          <Link
                            key={subtab.key}
                            href={subtab.href(jobIdFromPath)}
                            className={cn(
                              "block rounded px-2 py-1 text-xs transition-colors",
                              isSubActive ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                            style={isSubActive ? { backgroundColor: accentColor } : undefined}
                          >
                            {subtab.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <>
            {/* Main nav */}
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = isActive(href, label);
              const onSalesRoute = href === "/business-development" && pathname === "/business-development";
              return (
                <div key={href}>
                  <div className="group relative">
                    <Link
                      href={href}
                      className={cn(
                        "flex h-10 w-full items-center rounded-md transition-colors text-sm font-medium",
                        expanded ? "gap-3 px-3" : "justify-center",
                        active ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      style={active ? { backgroundColor: accentColor } : undefined}
                      onMouseEnter={!expanded ? e => showTooltip(e, label) : undefined}
                      onMouseLeave={!expanded ? hideTooltip : undefined}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {expanded && <span className="truncate">{label}</span>}
                    </Link>
                  </div>
                  {expanded && onSalesRoute && (
                    <Suspense fallback={null}>
                      <BdSubNav accentColor={accentColor} pathname={pathname} />
                    </Suspense>
                  )}
                </div>
              );
            })}

            {/* Admin Center */}
            {authUi.adminAccess && (
              <div>
                <div className="group relative flex items-center rounded-md">
                  <Link
                    href="/admin-center"
                    className={cn(
                      "flex h-10 flex-1 items-center rounded-md transition-colors text-sm font-medium",
                      expanded ? "gap-3 px-3" : "justify-center",
                      isAdminCenterRoute ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    style={isAdminCenterRoute ? { backgroundColor: accentColor } : undefined}
                    onMouseEnter={!expanded ? e => showTooltip(e, "Admin Center") : undefined}
                    onMouseLeave={!expanded ? hideTooltip : undefined}
                  >
                    <Shield className="h-4 w-4 flex-shrink-0" />
                    {expanded && <span className="flex-1 truncate">Admin Center</span>}
                  </Link>
                  {expanded && (
                    <button
                      type="button"
                      aria-label="Toggle Admin Center menu"
                      className={cn(
                        "flex h-10 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors",
                        isAdminCenterRoute ? "text-white/80 hover:text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      style={isAdminCenterRoute ? { backgroundColor: accentColor } : undefined}
                      onClick={() => setAdminCenterOpen((v) => !v)}
                    >
                      {adminCenterOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>

                {expanded && adminCenterOpen && (
                  <div className="ml-3 mt-0.5 space-y-3 border-l border-border pl-3 py-2">
                    {ADMIN_CENTER_DOMAINS.map((domain) => (
                      <div key={domain}>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                          {domain}
                        </div>
                        <div className="space-y-0.5">
                          {ADMIN_CENTER_LINKS.filter((l) => l.domain === domain).map((link) => {
                            const active = pathname === link.href || pathname?.startsWith(link.href + "/");
                            return (
                              <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                  "block rounded px-2 py-1 text-xs transition-colors",
                                  active ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                                style={active ? { backgroundColor: accentColor } : undefined}
                              >
                                {link.label}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Help */}
            <div>
              <div className="group relative">
                <button
                  type="button"
                  className={cn(
                    "flex h-10 w-full items-center rounded-md transition-colors text-sm font-medium",
                    expanded ? "gap-3 px-3" : "justify-center",
                    isHelpRoute ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  style={isHelpRoute ? { backgroundColor: accentColor } : undefined}
                  onClick={() => {
                    if (!expanded) { router.push("/support"); } else { setHelpOpen((v) => !v); }
                  }}
                  onMouseEnter={!expanded ? e => showTooltip(e, "Help") : undefined}
                  onMouseLeave={!expanded ? hideTooltip : undefined}
                >
                  <HelpCircle className="h-4 w-4 flex-shrink-0" />
                  {expanded && (
                    <>
                      <span className="flex-1 truncate text-left">Help</span>
                      {helpOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </>
                  )}
                </button>
              </div>
              {expanded && helpOpen && (
                <div className="ml-3 mt-0.5 border-l border-border pl-3 py-1 space-y-0.5">
                  {HELP_LINKS.map((link) => {
                    const active = pathname === link.href || pathname?.startsWith(link.href + "/");
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={cn(
                          "block rounded px-2 py-1 text-xs transition-colors",
                          active ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                        style={active ? { backgroundColor: accentColor } : undefined}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </nav>

      {/* Bottom: user + toggle */}
      <div className="flex-shrink-0 border-t">
        {authUi.ready && authUi.authed && (
          <div ref={profileMenuRef} className="relative">
            {profileOpen && (
              <div className={cn(
                "absolute bottom-full left-2 right-2 mb-1 rounded-md border bg-background p-2 shadow-lg z-50",
                !expanded && "left-14 right-auto w-72"
              )}>
                <div className="px-2 py-1 text-xs text-muted-foreground">Signed in as</div>
                <div className="truncate px-2 pb-2 text-sm font-medium">{authUi.userId}</div>
                {currentOrgLabel && (
                  <div className="mb-2 rounded border bg-muted/20 px-2 py-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organisation</div>
                    <div className="truncate text-sm font-medium">{currentOrgLabel}</div>
                    {orgUi.currentOrgRole && <div className="text-xs text-muted-foreground">{orgUi.currentOrgRole}</div>}
                  </div>
                )}
                {authUi.adminAccess && orgUi.organisations.length > 1 && (
                  <div className="mb-2 rounded border bg-muted/20 px-2 py-2">
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Switch organisation</div>
                    <div className="max-h-40 space-y-0.5 overflow-y-auto">
                      {orgUi.organisations.map((org) => {
                        const active = org.org_id === orgUi.currentOrgId || Boolean(org.is_active_org);
                        return (
                          <button
                            key={org.org_id}
                            type="button"
                            className={cn(
                              "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition",
                              active ? "bg-primary/10 text-foreground" : "hover:bg-muted"
                            )}
                            onClick={() => void switchOrganisation(org.org_id)}
                            disabled={switchingOrgId === org.org_id}
                          >
                            <span className="truncate">{org.name || org.slug || org.org_id}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {switchingOrgId === org.org_id ? "..." : active ? "Active" : "Switch"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <Link
                  href="/account/settings"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => setProfileOpen(false)}
                >
                  <User className="h-3.5 w-3.5" />
                  User settings
                </Link>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-muted"
                  onClick={async () => { await performLogout(); router.replace("/login"); }}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-3 px-3 py-3 hover:bg-muted transition-colors",
                !expanded && "justify-center"
              )}
              onClick={() => setProfileOpen((v) => !v)}
              aria-label="Account menu"
            >
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: accentColor }}
              >
                {authUi.userInitial}
              </div>
              {expanded && (
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-xs font-medium">{authUi.userId}</div>
                  {currentOrgLabel && <div className="truncate text-[10px] text-muted-foreground">{currentOrgLabel}</div>}
                </div>
              )}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={toggleExpanded}
          className={cn(
            "flex h-10 w-full items-center gap-2 border-t px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
            !expanded && "justify-center"
          )}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {expanded ? (
            <><ChevronLeft className="h-4 w-4 flex-shrink-0" /><span>Collapse</span></>
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0" />
          )}
        </button>
      </div>

      {tooltip && <NavTooltip label={tooltip.label} pos={tooltip} />}
    </aside>
  );
}

export function AppSidebar() {
  return (
    <Suspense fallback={null}>
      <AppSidebarContent />
    </Suspense>
  );
}
