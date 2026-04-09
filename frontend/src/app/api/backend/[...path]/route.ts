import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function backendBase(): string {
  const explicit = (
    process.env.BACKEND_API_BASE_URL ||
    process.env.API_BASE_URL ||
    ""
  ).trim();

  if (explicit && /^https?:\/\//i.test(explicit)) {
    return explicit.replace(/\/+$/, "");
  }

  return "http://127.0.0.1:8000";
}

function forwardHeaders(req: NextRequest): Headers {
  const headers = new Headers();

  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);

  const xUserEmail = req.headers.get("x-user-email");
  if (xUserEmail) headers.set("x-user-email", xUserEmail);

  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);

  return headers;
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  try {
    const method = req.method.toUpperCase();
    const qs = req.nextUrl.search || "";
    const subPath = path.join("/");
    const target = `${backendBase()}/${subPath}${qs}`;
    const probeRedirect = req.nextUrl.searchParams.get("probe_redirect") === "1";

    const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
    const res = await fetch(target, {
      method,
      headers: forwardHeaders(req),
      body,
      redirect: probeRedirect ? "manual" : "follow",
    });

    const payload = await res.arrayBuffer();
    const outHeaders = new Headers();
    const contentType = res.headers.get("content-type");
    if (contentType) outHeaders.set("content-type", contentType);
    if (probeRedirect) {
      outHeaders.set("x-proxy-probe-status", String(res.status));
      const location = res.headers.get("location");
      if (location) {
        outHeaders.set("x-proxy-probe-location", location);
      }
    }

    return new NextResponse(payload, {
      status: res.status,
      headers: outHeaders,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Proxy route failure";
    return NextResponse.json({ detail }, { status: 500 });
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(req, path || []);
}

export async function POST(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(req, path || []);
}

export async function PUT(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(req, path || []);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(req, path || []);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(req, path || []);
}
