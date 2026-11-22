// Proxies /device/* to the device-flow server (API_URL), streaming the response.
// The SSE stream (GET /device/events) passes through without buffering.
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const API_URL = process.env.API_URL ?? "http://localhost:3100";

// "cookie" carries the browser-binding cookie in; set-cookie comes back out below.
// "origin" tells the API which page asked for the login (shown on the consent screen).
const FORWARDED_HEADERS = ["content-type", "authorization", "user-agent", "accept", "cookie", "origin"];

async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const target = `${API_URL.replace(/\/+$/, "")}/device/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Pass the client address along, if an upstream proxy provided one. Don't
  // invent one: the API only trusts this header when TRUST_PROXY is set.
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    cache: "no-store",
    signal: req.signal,
  });

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  // The browser-binding cookie must reach the browser: it is scoped to /device,
  // which is this proxy's path too.
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }
  responseHeaders.set("cache-control", "no-cache, no-transform");
  responseHeaders.set("x-accel-buffering", "no");

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { proxy as GET, proxy as POST };
