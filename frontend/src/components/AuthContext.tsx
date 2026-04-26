"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type AuthCurrentOrg = Record<string, unknown> | null;

export type AuthPayload = {
  user?: Record<string, unknown>;
  current_org?: AuthCurrentOrg;
  [key: string]: unknown;
} | null;

type AuthContextValue = {
  ready: boolean;
  payload: AuthPayload;
  setAuthSession: (payload: AuthPayload) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<AuthPayload>(null);
  const setAuthSession = useCallback((nextPayload: AuthPayload) => {
    setPayload(nextPayload);
    setReady(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      payload,
      setAuthSession,
    }),
    [payload, ready, setAuthSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession(): AuthContextValue | null {
  return useContext(AuthContext);
}
