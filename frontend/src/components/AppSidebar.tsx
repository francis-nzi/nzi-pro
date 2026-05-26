"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Briefcase,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Shield,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiUrl, clearAuthState } from "@/lib/auth-client";
import { useTheme } from "@/components/ThemeProvider";
import { useAuthSession } from "@/components/AuthContext";

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
  { label: "Milestone Templates",     href: "/admin-center/milestone-templates", domain: "Reporting & Delivery" },
  { label: "Automation Rules",        href: "/admin-center/automations",   domain: "Reporting & Delivery" },
  { label: "Action Options",          href: "/admin-center/actions-options",domain: "Reporting & Delivery" },
  { label: "Missing Data",            href: "/admin-center/missing-data",  domain: "Reporting & Delivery" },
  { label: "Theme Settings",          href: "/admin-center/theme",         domain: "System & Governance" },
  { label: "Custom Fields",           href: "/admin-center/custom-fields", domain: "System & Governance" },
  { label: "System Settings",         href: "/admin-center/settings",      domain: "System & Governance" },
  { label: "Import / Export",         href: "/admin-center/import-export", domain: "System & Governance" },
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

function Tooltip({ label, visible }: { label: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity">
      {label}
    </div>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme } = useTheme();
  const authSession = useAuthSession();
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState(false);
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
      if (!next) { setAdminCenterOpen(false); setHelpOpen(false); }
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
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {expanded && <span className="truncate">{label}</span>}
                </Link>
                <Tooltip label={label} visible={!expanded} />
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
            <div className="group relative">
              <button
                type="button"
                className={cn(
                  "flex h-10 w-full items-center rounded-md transition-colors text-sm font-medium",
                  expanded ? "gap-3 px-3" : "justify-center",
                  isAdminCenterRoute ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                style={isAdminCenterRoute ? { backgroundColor: accentColor } : undefined}
                onClick={() => {
                  if (!expanded) {
                    router.push("/admin-center");
                  } else {
                    setAdminCenterOpen((v) => !v);
                  }
                }}
              >
                <Shield className="h-4 w-4 flex-shrink-0" />
                {expanded && (
                  <>
                    <span className="flex-1 truncate text-left">Admin Center</span>
                    {adminCenterOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </>
                )}
              </button>
              <Tooltip label="Admin Center" visible={!expanded} />
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
            >
              <HelpCircle className="h-4 w-4 flex-shrink-0" />
              {expanded && (
                <>
                  <span className="flex-1 truncate text-left">Help</span>
                  {helpOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </>
              )}
            </button>
            <Tooltip label="Help" visible={!expanded} />
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
                  onClick={() => { clearAuthState(); router.replace("/login"); }}
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
    </aside>
  );
}
