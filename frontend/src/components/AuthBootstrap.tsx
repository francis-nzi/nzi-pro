"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiUrl, hasAuthState, installAuthFetchPatch, mustAcceptPortalTerms, mustChangePassword } from "@/lib/auth-client";

function appendNext(path: string, next: string): string {
  return `${path}?next=${encodeURIComponent(next)}`;
}

function buildRequiredFlow(nextTarget: string, flags: { mustChangePassword: boolean; mustAcceptPortalTerms: boolean; mfaSetupRequired: boolean }): string {
  let target = nextTarget;
  if (flags.mfaSetupRequired) {
    target = `/account/mfa-setup?next=${encodeURIComponent(target)}`;
  }
  if (flags.mustAcceptPortalTerms) {
    target = appendNext("/accept-terms", target);
  }
  if (flags.mustChangePassword) {
    target = appendNext("/change-password", target);
  }
  return target;
}

export function AuthBootstrap() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    installAuthFetchPatch();
  }, []);

  useEffect(() => {
    const isLoginPage = pathname === "/login";
    const isChangePasswordPage = pathname === "/change-password";
    const isAcceptTermsPage = pathname === "/accept-terms";
    const isAccountSettingsPage = pathname === "/account/settings";
    const isMfaSetupPage = pathname === "/account/mfa-setup";
    const isPublicPage =
      pathname === "/login" ||
      pathname === "/legal" ||
      pathname?.startsWith("/legal/") ||
      pathname === "/support/legal" ||
      pathname?.startsWith("/support/legal/");
    const loggedIn = hasAuthState();
    const mustChange = mustChangePassword();
    const mustAcceptTerms = mustAcceptPortalTerms();
    const currentNext =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : pathname || "/";
    const loginNext = searchParams?.get("next") || "/";
    const desiredNext = isLoginPage ? loginNext : currentNext;

    if (!loggedIn && !isPublicPage) {
      router.replace(`/login?next=${encodeURIComponent(desiredNext)}`);
      return;
    }

    if (!loggedIn) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(apiUrl("/auth/me"), {
          credentials: "include",
          headers: { "X-NZI-Skip-Auth-Redirect": "1" },
        });
        if (cancelled) return;
        if (!res.ok) {
          let detailText = "";
          try {
            const payload = await res.json();
            detailText = String(payload?.detail || payload?.message || "").trim().toLowerCase();
          } catch {
            detailText = "";
          }

          if (res.status === 403) {
            if (detailText.includes("password") && !isChangePasswordPage) {
              router.replace(`/change-password?next=${encodeURIComponent(desiredNext)}`);
            } else if (detailText.includes("mfa") && !isMfaSetupPage) {
              router.replace(`/account/mfa-setup?next=${encodeURIComponent(desiredNext)}`);
            } else if (detailText.includes("term") && !isAcceptTermsPage) {
              router.replace(buildRequiredFlow(desiredNext, {
                mustChangePassword: false,
                mustAcceptPortalTerms: true,
                mfaSetupRequired: false,
              }));
            }
            return;
          }

          if (res.status === 401 && !isPublicPage && !isLoginPage) {
            router.replace(`/login?next=${encodeURIComponent(desiredNext)}`);
          }
          return;
        }
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;
        const user = payload?.user || {};
        const needsPasswordChange = Boolean(user?.must_change_password || payload?.must_change_password || mustChange);
        const needsTerms = Boolean(payload?.must_accept_portal_terms || mustAcceptTerms);
        const needsMfaSetup = Boolean(user?.mfa_setup_required || payload?.mfa_setup_required);

        if (needsPasswordChange) {
          if (!isChangePasswordPage) {
            router.replace(
              buildRequiredFlow(desiredNext, {
                mustChangePassword: true,
                mustAcceptPortalTerms: needsTerms,
                mfaSetupRequired: needsMfaSetup,
              })
            );
          }
          return;
        }

        if (needsTerms) {
          if (!isAcceptTermsPage) {
            router.replace(
              buildRequiredFlow(desiredNext, {
                mustChangePassword: false,
                mustAcceptPortalTerms: true,
                mfaSetupRequired: needsMfaSetup,
              })
            );
          }
          return;
        }

        if (needsMfaSetup) {
          if (!isMfaSetupPage) {
            router.replace(`/account/mfa-setup?next=${encodeURIComponent(desiredNext)}`);
          }
          return;
        }

        if (isLoginPage) {
          router.replace(desiredNext || "/");
          return;
        }

        if (isChangePasswordPage && !needsPasswordChange) {
          router.replace(loginNext || "/");
          return;
        }

        if (isAcceptTermsPage && !needsTerms) {
          router.replace(loginNext || "/");
          return;
        }
      } catch {
        if (cancelled) return;
        if (!isPublicPage && !isLoginPage && loggedIn) {
          router.replace(`/login?next=${encodeURIComponent(desiredNext)}`);
          return;
        }
        if (mustChange && !isChangePasswordPage) {
          router.replace("/change-password");
          return;
        }
        if (mustAcceptTerms && !isAcceptTermsPage) {
          router.replace("/accept-terms");
          return;
        }
        if (isLoginPage) {
          router.replace(loginNext || "/");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router, searchParams]);

  return null;
}
