import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];
const FORCE_CHANGE_PATH = "/change-password";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/public") ||
    pathname.startsWith("/uploads") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasToken = Boolean(request.cookies.get("nzi_token")?.value);
  const hasUser = Boolean(request.cookies.get("nzi_user")?.value);
  const mustChangePassword = request.cookies.get("nzi_force_pw_change")?.value === "1";
  const isAuthed = hasToken || hasUser;

  if (!isAuthed && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthed && mustChangePassword && pathname !== FORCE_CHANGE_PATH) {
    return NextResponse.redirect(new URL(FORCE_CHANGE_PATH, request.url));
  }

  if (isAuthed && !mustChangePassword && pathname === FORCE_CHANGE_PATH) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isAuthed && pathname === "/login") {
    const requestedNext = request.nextUrl.searchParams.get("next") || "/";
    const next = requestedNext.startsWith("/") ? requestedNext : "/";
    return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api).*)"],
};
