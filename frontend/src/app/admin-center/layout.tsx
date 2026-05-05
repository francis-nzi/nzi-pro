"use client";

import Link from "next/link";
import { PropsWithChildren, useEffect, useState } from "react";

import { apiUrl } from "@/lib/auth-client";
import { useAuthSession } from "@/components/AuthContext";

type AccessState = "loading" | "allowed" | "denied";

function hasAdminAccess(user: Record<string, unknown> | null | undefined): boolean {
  if (!user) return false;
  const permissions = Array.isArray(user.effective_permissions)
    ? user.effective_permissions
    : Array.isArray(user.permissions)
      ? user.permissions
      : [];
  const role = String(user.role || "").trim().toLowerCase();
  const currentOrg = (user.current_org as Record<string, unknown> | null | undefined) || null;
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

export default function AdminCenterLayout({ children }: PropsWithChildren) {
  const authSession = useAuthSession();
  const [accessState, setAccessState] = useState<AccessState>("loading");

  useEffect(() => {
    let cancelled = false;

    if (authSession) {
      if (!authSession.ready) {
        setAccessState("loading");
        return () => {
          cancelled = true;
        };
      }

      const payload = authSession.payload || {};
      const user = payload?.user || {};
      const currentOrg = payload?.current_org || {};
      const mergedUser = { ...user, current_org: currentOrg };
      setAccessState(hasAdminAccess(mergedUser) ? "allowed" : "denied");
      return () => {
        cancelled = true;
      };
    }

    async function checkAccess() {
      try {
        const res = await fetch(apiUrl("/auth/me"), {
          credentials: "include",
          headers: { "X-NZI-Skip-Auth-Redirect": "1" },
        });
        if (!res.ok) {
          if (!cancelled) setAccessState("denied");
          return;
        }
        const payload = await res.json().catch(() => ({}));
        const user = payload?.user || {};
        const currentOrg = payload?.current_org || {};
        const mergedUser = { ...user, current_org: currentOrg };
        if (!cancelled) setAccessState(hasAdminAccess(mergedUser) ? "allowed" : "denied");
      } catch {
        if (!cancelled) setAccessState("denied");
      }
    }

    void checkAccess();
    return () => {
      cancelled = true;
    };
  }, [authSession]);

  if (accessState === "loading") {
    return <div className="mx-auto max-w-7xl px-6 py-10 text-sm text-muted-foreground">Checking admin access...</div>;
  }

  if (accessState === "denied") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-2xl border bg-background p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">Access denied</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Your account does not currently have permission to access the Admin Center.
          </p>
          <div className="mt-6">
            <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Return to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
