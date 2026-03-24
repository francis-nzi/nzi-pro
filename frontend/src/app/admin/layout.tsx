"use client";

import Link from "next/link";
import { PropsWithChildren, useEffect, useState } from "react";

import { apiUrl } from "@/lib/auth-client";

type AccessState = "loading" | "allowed" | "denied";

export default function AdminLayout({ children }: PropsWithChildren) {
  const [accessState, setAccessState] = useState<AccessState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      try {
        const res = await fetch(apiUrl("/auth/me"), { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) setAccessState("denied");
          return;
        }
        const payload = await res.json().catch(() => ({}));
        const user = payload?.user || {};
        const permissions = Array.isArray(user?.effective_permissions) ? user.effective_permissions : [];
        const allowed = Boolean(user?.is_super_admin) || permissions.includes("admin.access");
        if (!cancelled) setAccessState(allowed ? "allowed" : "denied");
      } catch {
        if (!cancelled) setAccessState("denied");
      }
    }

    void checkAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  if (accessState === "loading") {
    return <div className="mx-auto max-w-7xl px-6 py-10 text-sm text-muted-foreground">Checking admin access...</div>;
  }

  if (accessState === "denied") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-2xl border bg-background p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">Access denied</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Your account does not currently have permission to access the Admin area.
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
