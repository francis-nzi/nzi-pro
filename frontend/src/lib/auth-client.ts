"use client";

export const TOKEN_COOKIE = "nzi_token";
export const USER_COOKIE = "nzi_user";
export const FORCE_PASSWORD_CHANGE_COOKIE = "nzi_force_pw_change";

function cookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, maxAgeSeconds = 60 * 60 * 4): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

function clearCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function getToken(): string | null {
  return cookieValue(TOKEN_COOKIE);
}

export function getAuthUserIdentifier(): string | null {
  return cookieValue(USER_COOKIE);
}

export function hasAuthState(): boolean {
  return Boolean(getToken() || getAuthUserIdentifier());
}

export function setAuthState(token: string | null, userIdentifier: string | null): void {
  if (token) setCookie(TOKEN_COOKIE, token);
  else clearCookie(TOKEN_COOKIE);

  if (userIdentifier) setCookie(USER_COOKIE, userIdentifier);
  else clearCookie(USER_COOKIE);
}

export function clearAuthState(): void {
  clearCookie(TOKEN_COOKIE);
  clearCookie(USER_COOKIE);
  clearCookie(FORCE_PASSWORD_CHANGE_COOKIE);
}

export function setMustChangePassword(value: boolean): void {
  if (value) setCookie(FORCE_PASSWORD_CHANGE_COOKIE, "1");
  else clearCookie(FORCE_PASSWORD_CHANGE_COOKIE);
}

export function mustChangePassword(): boolean {
  return cookieValue(FORCE_PASSWORD_CHANGE_COOKIE) === "1";
}

function isApiRequest(url: string): boolean {
  return url.startsWith("/api/backend/") || url.includes("/api/backend/");
}

declare global {
  interface Window {
    __nziAuthFetchPatched?: boolean;
  }
}

export function installAuthFetchPatch(): void {
  if (typeof window === "undefined") return;
  if (window.__nziAuthFetchPatched) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let requestUrl = "";
    if (typeof input === "string") requestUrl = input;
    else if (input instanceof URL) requestUrl = input.toString();
    else if (input instanceof Request) requestUrl = input.url;

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const token = getToken();
    const userIdentifier = getAuthUserIdentifier();

    if (token && isApiRequest(requestUrl) && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    } else if (!token && userIdentifier && isApiRequest(requestUrl) && !headers.has("X-User-Email")) {
      headers.set("X-User-Email", userIdentifier);
    }

    const requestInit: RequestInit = { ...init, headers };
    if (isApiRequest(requestUrl)) {
      requestInit.credentials = requestInit.credentials ?? "include";
    }

    const response = await originalFetch(input, requestInit);

    if (isApiRequest(requestUrl) && response.status === 401) {
      clearAuthState();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.assign(`/login?next=${next}`);
      }
    }

    return response;
  };

  window.__nziAuthFetchPatched = true;
}
