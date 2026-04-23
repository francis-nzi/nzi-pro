"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { apiUrl, clearAuthState, getAuthUserIdentifier, hasAuthState } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";

const ADMIN_DOMAINS = [
  "People & Access",
  "Reference Data",
  "Reporting & Delivery",
  "System & Governance",
] as const;

const ADMIN_QUICK_LINKS: Array<{
  label: string;
  href: string;
  domain: (typeof ADMIN_DOMAINS)[number];
}> = [
  { label: "Organisation Management", href: "/admin/organisations", domain: "People & Access" },
  { label: "Team Management", href: "/admin/team", domain: "People & Access" },
  { label: "Lookups", href: "/admin/lookups", domain: "Reference Data" },
  { label: "Job Items", href: "/admin/job-items", domain: "Reference Data" },
  { label: "Suppliers", href: "/admin/suppliers", domain: "Reference Data" },
  { label: "Datasets & Factors", href: "/admin/datasets", domain: "Reference Data" },
  { label: "Reusable Factors", href: "/admin/custom-factors", domain: "Reference Data" },
  { label: "Templates", href: "/admin/templates", domain: "Reporting & Delivery" },
  { label: "Milestone Templates", href: "/admin/milestone-templates", domain: "Reporting & Delivery" },
  { label: "Automation Rules", href: "/admin/automations", domain: "Reporting & Delivery" },
  { label: "Action Options", href: "/admin/actions-options", domain: "Reporting & Delivery" },
  { label: "Missing Data", href: "/admin/missing-data", domain: "Reporting & Delivery" },
  { label: "Theme Settings", href: "/admin/theme", domain: "System & Governance" },
  { label: "Custom Fields", href: "/admin/custom-fields", domain: "System & Governance" },
  { label: "System Settings", href: "/admin/settings", domain: "System & Governance" },
  { label: "Import / Export", href: "/admin/import-export", domain: "System & Governance" },
  { label: "Email Outbox", href: "/admin/email-outbox", domain: "System & Governance" },
  { label: "Archive Management", href: "/admin/archive", domain: "System & Governance" },
];

const HELP_LINKS = [
  { label: "Support", href: "/support" },
  { label: "Methodology", href: "/support/methodology" },
  { label: "Legal", href: "/support/legal" },
  { label: "Data Bank", href: "/support/data-bank" },
  { label: "Feedback", href: "/feedback" },
] as const;

type NavOrganisation = {
  org_id: string;
  name?: string | null;
  slug?: string | null;
  archived?: boolean | null;
  is_active_org?: boolean;
};

function hasAdminAccessFromPayload(user: Record<string, unknown> | null | undefined): boolean {
  if (!user) return false;
  const permissions = Array.isArray(user.effective_permissions) ? user.effective_permissions : [];
  const role = String(user.role || "").trim().toLowerCase();
  return (
    Boolean(user.is_super_admin) ||
    permissions.includes("admin.access") ||
    role === "superadmin" ||
    role === "admin"
  );
}

export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoErrorUrl, setLogoErrorUrl] = useState<string | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [authUi, setAuthUi] = useState<{ ready: boolean; authed: boolean; userId: string; adminAccess: boolean }>({
    ready: false,
    authed: false,
    userId: "",
    adminAccess: false,
  });
  const [orgUi, setOrgUi] = useState<{
    currentOrgId: string;
    currentOrgLabel: string;
    currentOrgSlug: string;
    currentOrgRole: string;
    organisations: NavOrganisation[];
  }>({
    currentOrgId: "",
    currentOrgLabel: "",
    currentOrgSlug: "",
    currentOrgRole: "",
    organisations: [],
  });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const authed = hasAuthState();
        const userId = getAuthUserIdentifier() || "";
        let adminAccess = false;
        let currentOrgId = "";
        let currentOrgLabel = "";
        let currentOrgSlug = "";
        let currentOrgRole = "";
        let organisations: NavOrganisation[] = [];

        if (authed) {
          try {
            const res = await fetch(apiUrl("/auth/me"), { credentials: "include" });
            if (res.ok) {
              const payload = await res.json().catch(() => ({}));
              const user = payload?.user || {};
              const currentOrg = payload?.current_org || {};
              adminAccess = hasAdminAccessFromPayload(user);
              currentOrgId = String(currentOrg?.org_id || user?.org_id || "").trim();
              currentOrgLabel = String(currentOrg?.name || currentOrgId || "").trim();
              currentOrgSlug = String(currentOrg?.slug || "").trim();
              currentOrgRole = String(currentOrg?.role || "").trim();
              if (adminAccess) {
                try {
                  const orgRes = await fetch(apiUrl("/admin/organisations"), { credentials: "include" });
                  if (orgRes.ok) {
                    const orgPayload = await orgRes.json().catch(() => ({}));
                    organisations = Array.isArray(orgPayload?.items) ? orgPayload.items : [];
                    const activeOrg =
                      organisations.find((item) => item.is_active_org) ||
                      organisations.find((item) => item.org_id === orgPayload?.active_org_id) ||
                      null;
                    if (activeOrg) {
                      currentOrgId = String(activeOrg.org_id || currentOrgId || "").trim();
                      currentOrgLabel = String(activeOrg.name || activeOrg.org_id || currentOrgLabel || "").trim();
                      currentOrgSlug = String(activeOrg.slug || "").trim();
                    }
                  }
                } catch {
                  organisations = [];
                }
              }
            }
          } catch {
            adminAccess = false;
          }
        }

        if (!cancelled) {
          setAuthUi({
            ready: true,
            authed,
            userId,
            adminAccess,
          });
          setOrgUi({
            currentOrgId,
            currentOrgLabel,
            currentOrgSlug,
            currentOrgRole,
            organisations,
          });
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pathname]);

  useEffect(() => {
    const timer = window.setTimeout(() => setProfileOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!profileOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (profileMenuRef.current && target && !profileMenuRef.current.contains(target)) {
        setProfileOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

  async function switchOrganisation(orgId: string) {
    const trimmedOrgId = String(orgId || "").trim();
    if (!trimmedOrgId || trimmedOrgId === orgUi.currentOrgId) {
      setProfileOpen(false);
      return;
    }

    setSwitchingOrgId(trimmedOrgId);
    try {
      const res = await fetch(apiUrl(`/admin/organisations/${encodeURIComponent(trimmedOrgId)}/switch`), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Unable to switch organisation");
      }
      setProfileOpen(false);
      window.location.reload();
    } catch {
      setSwitchingOrgId(null);
    }
  }

  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/insights", label: "Insights" },
    { href: "/clients", label: "Clients" },
    { href: "/jobs", label: "Jobs" },
    { href: "/time", label: "Time" },
    { href: "/business-development", label: "Sales" },
    { href: "/support", label: "Help" },
  ];
  if (authUi.adminAccess) {
    links.splice(6, 0, { href: "/admin", label: "Admin" });
  }
  const isAdminRoute = pathname === "/admin" || pathname?.startsWith("/admin/");
  const isHelpRoute =
    pathname === "/support" ||
    pathname?.startsWith("/support/") ||
    pathname === "/feedback" ||
    pathname?.startsWith("/feedback/");
  const currentOrgBadge = orgUi.currentOrgLabel || orgUi.currentOrgId || "";
  const currentOrgRoleLabel = orgUi.currentOrgRole ? ` • ${orgUi.currentOrgRole}` : "";
  const accentColor = theme?.button_color || theme?.primary_color || "#1c5026";
  const logoUrl = useMemo(() => {
    const raw = String(theme?.logo_url || "").trim();
    if (!raw) return "/api/backend/system-settings/logo/file";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/uploads/system/nzi-logo")) return "/api/backend/system-settings/logo/file";
    if (raw.startsWith("/uploads/")) return `/api/backend${raw}`;
    return raw;
  }, [theme?.logo_url]);

  if (
    pathname === "/login" ||
    pathname === "/change-password" ||
    pathname === "/legal" ||
    pathname?.startsWith("/legal/")
  ) {
    return null;
  }

  return (
    <nav className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            {logoErrorUrl !== logoUrl ? (
              <img
                src={logoUrl}
                alt="NZ Insights Pro"
                className="h-8 w-auto object-contain"
                onError={() => setLogoErrorUrl(logoUrl)}
              />
            ) : null}
            <span className="text-xl font-bold">NZ Insights Pro</span>
          </Link>

          <div className="flex items-center gap-1">
            {links.map((link) => {
              const isActive =
                link.label === "Help"
                  ? isHelpRoute
                  : pathname === link.href || pathname?.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "text-white"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  style={isActive ? { backgroundColor: accentColor } : undefined}
                >
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!authUi.ready ? (
            <div className="h-9 w-24" aria-hidden />
          ) : authUi.authed ? (
            <div ref={profileMenuRef} className="relative flex items-center gap-2">
              {currentOrgBadge ? (
                authUi.adminAccess ? (
                  <button
                    type="button"
                    className="hidden rounded-full border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-foreground hover:text-foreground md:inline-flex"
                    onClick={() => setProfileOpen((v) => !v)}
                    aria-label="Open organisation menu"
                  >
                    Org: {currentOrgBadge}
                  </button>
                ) : (
                  <div className="hidden rounded-full border px-3 py-1.5 text-xs font-semibold text-muted-foreground md:inline-flex">
                    Org: {currentOrgBadge}
                  </div>
                )
              ) : null}
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                onClick={() => setProfileOpen((v) => !v)}
                aria-label="Open account menu"
                style={{ backgroundColor: accentColor }}
              >
                {(authUi.userId || "U").trim().charAt(0).toUpperCase() || "U"}
              </button>
              {profileOpen ? (
                <div className="absolute right-0 z-50 mt-2 w-80 rounded-md border bg-background p-2 shadow-lg">
                  <div className="rounded px-2 py-1.5 text-xs text-muted-foreground">Signed in as</div>
                  <div className="truncate px-2 pb-2 text-sm font-medium">{authUi.userId}</div>
                  {currentOrgBadge ? (
                    <div className="mb-2 rounded border bg-muted/20 px-2 py-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current organisation</div>
                      <div className="truncate text-sm font-medium">
                        {currentOrgBadge}
                        {currentOrgRoleLabel}
                      </div>
                      {orgUi.currentOrgSlug ? (
                        <div className="text-xs text-muted-foreground">Slug: {orgUi.currentOrgSlug}</div>
                      ) : null}
                      {orgUi.currentOrgId ? (
                        <div className="text-xs text-muted-foreground">Org ID: {orgUi.currentOrgId}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {authUi.adminAccess && orgUi.organisations.length > 1 ? (
                    <div className="mb-2 rounded border bg-muted/20 px-2 py-2">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Switch organisation</div>
                      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                        {orgUi.organisations.map((org) => {
                          const isActive = org.org_id === orgUi.currentOrgId || Boolean(org.is_active_org);
                          return (
                            <button
                              key={org.org_id}
                              type="button"
                              className={cn(
                                "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition",
                                isActive ? "bg-primary/10 text-foreground" : "hover:bg-muted"
                              )}
                              onClick={() => void switchOrganisation(org.org_id)}
                              disabled={switchingOrgId === org.org_id}
                            >
                              <span className="truncate">{org.name || org.slug || org.org_id}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {switchingOrgId === org.org_id ? "..." : isActive ? "Active" : "Switch"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" asChild>
                        <Link href="/admin/organisations" onClick={() => setProfileOpen(false)}>
                          Manage organisations
                        </Link>
                      </Button>
                    </div>
                  ) : authUi.adminAccess ? (
                    <Button variant="ghost" size="sm" className="mb-2 w-full justify-start" asChild>
                      <Link href="/admin/organisations" onClick={() => setProfileOpen(false)}>
                        Manage organisations
                      </Link>
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
                    <Link href="/account/settings" onClick={() => setProfileOpen(false)}>User Admin</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => {
                      clearAuthState();
                      router.replace("/login");
                    }}
                  >
                    Sign out
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          )}
        </div>
      </div>
      {isAdminRoute && authUi.adminAccess ? (
        <div className="border-t bg-muted/20">
          <div className="mx-auto w-full max-w-7xl px-6 py-4">
            <div className="mb-3 text-sm font-semibold text-foreground">Admin Areas</div>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {ADMIN_DOMAINS.map((domain) => (
                <div key={domain}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{domain}</div>
                  <div className="space-y-1">
                    {ADMIN_QUICK_LINKS.filter((x) => x.domain === domain).map((link) => {
                      const isActive = pathname === link.href || pathname?.startsWith(`${link.href}/`);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={cn(
                            "block rounded px-2 py-1 text-sm",
                            isActive ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                          style={isActive ? { backgroundColor: accentColor } : undefined}
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {isHelpRoute ? (
        <div className="border-t bg-muted/20">
          <div className="mx-auto w-full max-w-7xl px-6 py-4">
            <div className="mb-3 text-sm font-semibold text-foreground">Help</div>
            <div className="flex flex-wrap gap-2">
              {HELP_LINKS.map((link) => {
                const isActive = pathname === link.href || pathname?.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "rounded px-3 py-1.5 text-sm",
                      isActive ? "text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    style={isActive ? { backgroundColor: accentColor } : undefined}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}


