"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hasAuthState, installAuthFetchPatch, mustChangePassword } from "@/lib/auth-client";

export function AuthBootstrap() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    installAuthFetchPatch();
  }, []);

  useEffect(() => {
    const isLoginPage = pathname === "/login";
    const isChangePasswordPage = pathname === "/change-password";
    const loggedIn = hasAuthState();
    const mustChange = mustChangePassword();

    if (!loggedIn && !isLoginPage) {
      const next = encodeURIComponent(
        typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : pathname || "/"
      );
      router.replace(`/login?next=${next}`);
      return;
    }

    if (loggedIn && mustChange && !isChangePasswordPage) {
      router.replace("/change-password");
      return;
    }

    if (loggedIn && !mustChange && isChangePasswordPage) {
      router.replace("/");
      return;
    }

    if (loggedIn && isLoginPage) {
      const next =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("next")
          : null;
      router.replace(next || "/");
    }
  }, [pathname, router]);

  return null;
}
