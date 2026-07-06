const TOKEN_KEY = "nzinsights_token";
const PARTIAL_TOKEN_KEY = "nzinsights_partial_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(PARTIAL_TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getPartialToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PARTIAL_TOKEN_KEY);
}

export function setPartialToken(token: string): void {
  localStorage.setItem(PARTIAL_TOKEN_KEY, token);
}

export function clearPartialToken(): void {
  localStorage.removeItem(PARTIAL_TOKEN_KEY);
}

/** Returns the best available token: full session preferred, partial as fallback. */
export function getBestToken(): string | null {
  return getToken() ?? getPartialToken();
}

export function clearAllTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PARTIAL_TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getBestToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function apiBase(): string {
  return "/api/backend";
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...authHeaders(), ...(init.headers as Record<string, string> ?? {}) };
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers });
  if (response.status === 401 && typeof window !== "undefined") {
    clearAllTokens();
    window.location.href = "/login";
  }
  return response;
}
