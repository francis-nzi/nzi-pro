"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  FileText,
  Files,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Shield,
  Zap,
} from "lucide-react";
import { apiFetch, clearAllTokens, getBestToken } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import PortalStatusBar from "@/components/PortalStatusBar";

type PortalUser = {
  portal_user_id: number | null;
  full_name: string;
  email: string;
  client_db_id: number;
  is_staff?: boolean;
};

type NavConfig = {
  dashboard?: boolean;
  portfolio?: boolean;
  data?: boolean;
  data_entry?: boolean;
  reports?: boolean;
  actions?: boolean;
  insights?: boolean;
  files?: boolean;
  governance?: boolean;
};

type NavItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  tab: string;
};

const ALL_NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard",  icon: <LayoutDashboard className="h-5 w-5" />, tab: "dashboard" },
  { key: "portfolio", label: "Portfolio",  icon: <BarChart3 className="h-5 w-5" />,       tab: "portfolio" },
  { key: "data",      label: "Data",       icon: <BarChart3 className="h-5 w-5" />,       tab: "data" },
  { key: "data_entry",label: "Data Entry", icon: <ClipboardList className="h-5 w-5" />,   tab: "data_entry" },
  { key: "reports",   label: "Reports",    icon: <FileText className="h-5 w-5" />,         tab: "reports" },
  { key: "actions",   label: "Actions",    icon: <Zap className="h-5 w-5" />,              tab: "actions" },
  { key: "insights",  label: "Insights",   icon: <Lightbulb className="h-5 w-5" />,        tab: "insights" },
  { key: "files",     label: "Files",      icon: <Files className="h-5 w-5" />,            tab: "files" },
  { key: "governance",label: "Governance", icon: <Shield className="h-5 w-5" />,           tab: "governance" },
];

export type { NavConfig };

export default function PortalShell({
  children,
  activeTab,
  onTabChange,
}: {
  children: React.ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<PortalUser | null>(null);
  const [navConfig, setNavConfig] = useState<NavConfig>({});
  const [navLoaded, setNavLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hiddenSections, setHiddenSections] = useState<string[]>([]);

  useEffect(() => {
    if (!getBestToken()) {
      router.replace("/login");
      return;
    }
    apiFetch("/portal/auth/me")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: {
        user: PortalUser;
        must_accept_tac?: boolean;
        mfa_setup_required?: boolean;
        nav_config?: NavConfig;
      }) => {
        if (d.must_accept_tac) { router.replace("/accept-terms"); return; }
        if (d.mfa_setup_required) { router.replace("/setup-mfa"); return; }
        setUser(d.user);
        setNavConfig(d.nav_config ?? {});
        setNavLoaded(true);
      })
      .catch(() => { clearAllTokens(); router.replace("/login"); });

    // Site-scoped portal users don't get Reports/Files/Actions/Insights at
    // all -- see CLIENT_PORTAL_GOVERNANCE_ENDPOINT_AUDIT.md §3. The backend
    // enforces this on every request regardless; this just keeps the nav
    // from advertising sections that would 403.
    apiFetch("/portal/me")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { hidden_sections?: string[] }) => setHiddenSections(d.hidden_sections ?? []))
      .catch(() => setHiddenSections([]));
  }, [router]);

  function handleLogout() {
    clearAllTokens();
    router.replace("/login");
  }

  const currentTab = activeTab ?? searchParams.get("tab") ?? "dashboard";
  const isDashboard = pathname === "/dashboard" || pathname === "/";
  const sidebarBg = "var(--portal-sidebar)";

  const visibleNav = useMemo(() => {
    // Don't flash every item (including ones that should stay hidden) while
    // /portal/auth/me is still in flight -- show nothing until nav_config
    // has actually loaded.
    if (!navLoaded) return [];
    return ALL_NAV_ITEMS.filter((item) => {
      if (hiddenSections.includes(item.key)) return false;
      const cfg = navConfig as Record<string, boolean>;
      if (Object.keys(navConfig).length === 0) return true;
      return cfg[item.key] !== false;
    });
  }, [navConfig, navLoaded, hiddenSections]);
  const visibleNavTabs = useMemo(() => visibleNav.map((item) => item.tab), [visibleNav]);

  useEffect(() => {
    if (!navLoaded || !isDashboard) return;
    if (visibleNavTabs.length === 0) return;
    if (!visibleNavTabs.includes(currentTab)) {
      router.replace(`/dashboard?tab=${visibleNavTabs[0]}`, { scroll: false });
    }
  }, [currentTab, isDashboard, navLoaded, router, visibleNavTabs]);

  function handleNavClick(tab: string) {
    setSidebarOpen(false);
    if (onTabChange) {
      onTabChange(tab);
    } else {
      router.push(`/dashboard?tab=${tab}`);
    }
  }

  const SidebarContent = (
    <aside className="flex h-full flex-col" style={{ backgroundColor: sidebarBg }}>
      <div className="flex items-center gap-3 border-b border-white/10 bg-white px-5 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="flex h-11 items-center rounded-md border border-gray-200 bg-white px-2.5 shadow-sm">
          <img
            src="/api/backend/system-settings/logo/file"
            alt="Net Zero International"
            className="h-7 w-auto object-contain"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        </div>
        <span className="text-sm font-bold text-gray-900 leading-tight">NZ Insights Pro</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {isDashboard
          ? visibleNav.map(item => {
              const isActive = currentTab === item.tab;
              return (
                <button
                  key={item.key}
                  onClick={() => handleNavClick(item.tab)}
                  className={[
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left",
                    isActive
                      ? "bg-white/15 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                >
                  <span className={isActive ? "text-white" : "text-white/60"}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })
          : (
            <button
              onClick={() => router.push("/dashboard")}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left"
            >
              <span className="text-white/60"><LayoutDashboard className="h-5 w-5" /></span>
              Back to Portal
            </button>
          )
        }
      </nav>

      {user && (
        <div className="border-t border-white/10 px-4 py-4 space-y-2">
          {user.is_staff && (
            <Badge className="w-full justify-center border-transparent bg-orange-500/20 text-orange-200">
              Staff preview
            </Badge>
          )}
          <div className="text-xs text-white/50 truncate">{user.full_name}</div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-white/50 hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </aside>
  );

  return (
    <div className="min-h-screen flex">
      <div className="hidden md:flex md:w-56 md:flex-shrink-0 md:flex-col md:fixed md:inset-y-0">
        {SidebarContent}
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-50 w-56 h-full">{SidebarContent}</div>
        </div>
      )}

      <div className="min-w-0 flex-1 flex flex-col md:ml-56">
        <div
          className="md:hidden flex items-center gap-3 px-4 py-3 text-white"
          style={{ backgroundColor: sidebarBg }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-white/80 hover:text-white"
            aria-label="Open navigation"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex h-10 items-center rounded-md border border-gray-200 bg-white px-2.5 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/api/backend/system-settings/logo/file"
              alt="Net Zero International"
              className="h-6 w-auto object-contain"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <span className="text-sm font-bold">NZ Insights Pro</span>
        </div>

        {user && <PortalStatusBar />}

        <main className="min-w-0 flex-1 px-6 py-8">
          {children}
        </main>

        <footer className="border-t border-gray-200 bg-white py-3 text-center text-xs text-gray-400">
          NZ Insights Pro &middot; Net Zero International
        </footer>
      </div>
    </div>
  );
}
