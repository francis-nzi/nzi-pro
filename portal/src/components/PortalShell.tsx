"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { apiFetch, clearToken, getToken } from "@/lib/auth";
import PortalStatusBar from "@/components/PortalStatusBar";

type PortalUser = {
  portal_user_id: number;
  full_name: string;
  email: string;
  client_db_id: number;
};

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<PortalUser | null>(null);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    apiFetch("/portal/auth/me")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { user: PortalUser }) => setUser(d.user))
      .catch(() => { clearToken(); router.replace("/login"); });
  }, [router]);

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/api/backend/system-settings/logo/file"
              alt="Net Zero International"
              className="h-8 w-auto object-contain"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            <span className="text-xl font-bold" style={{ color: "#F26624" }}>NZ Insights Pro</span>
          </div>
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 hidden sm:inline">{user.full_name}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </div>
          )}
        </div>
      </header>
      {user && <PortalStatusBar />}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-gray-200 bg-white py-4 text-center text-xs text-gray-400">
        NZ Insights Pro · Net Zero International
      </footer>
    </div>
  );
}
