"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, clearAllTokens } from "@/lib/auth";

// Forces a client portal user back to /login after an hour with no real
// interaction, so a tab left open overnight doesn't sit "logged in"
// indefinitely -- both for security hygiene and so the CRM Dashboard's
// "On Portal" indicator doesn't get stuck green. This is a genuine forced
// logout (matches what was asked for), backed independently by the server
// deriving the same "currently active" status from client_portal_sessions.
// last_activity_at staleness (services/portal.py get_portal_status_summary),
// so a closed tab or a JS failure here still self-heals within the hour
// even though this code never got to run for it.
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

export default function PortalInactivityLogout() {
  const router = useRouter();
  const lastInteraction = useRef(Date.now());

  useEffect(() => {
    const markActive = () => { lastInteraction.current = Date.now(); };
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, markActive, { passive: true }));

    const interval = setInterval(() => {
      if (Date.now() - lastInteraction.current < INACTIVITY_LIMIT_MS) return;
      void apiFetch("/portal/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "timeout" }),
      })
        .catch(() => { /* non-fatal -- log out locally regardless */ })
        .finally(() => {
          clearAllTokens();
          router.replace("/login");
        });
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, markActive));
      clearInterval(interval);
    };
  }, [router]);

  return null;
}
