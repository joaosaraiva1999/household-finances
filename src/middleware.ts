// ─── Edge security middleware ────────────────────────────────────────────────
//
// Applies to every request (except Next static assets):
//   1. Security headers on all responses (CSP, frame, MIME, referrer, …).
//   2. Nonce-based strict CSP for pages in production (Next injects the
//      nonce into its own scripts automatically).
//   3. Same-origin enforcement for mutating API calls (CSRF defense-in-depth).
//   4. Request body size cap for API mutations (DoS guard).
//   5. In-memory sliding-window rate limiting for /api (per client IP).
//
// NOTE: the rate limiter is per server instance — the app is deployed as a
// single small instance, which is exactly the intended scope. See SECURITY.md.

import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const MAX_BODY_BYTES = 65_536; // 64 KiB — payloads here are tiny JSON objects
const WINDOW_MS = 10_000;
const MAX_MUTATIONS_PER_WINDOW = 30;
const MAX_API_REQUESTS_PER_WINDOW = 120;

/** Sliding-window buckets, keyed by client IP + class. */
const buckets = new Map<string, number[]>();

function rateLimited(key: string, max: number, now: number): boolean {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) {
      if (!v.some((t) => now - t < WINDOW_MS)) buckets.delete(k);
    }
  }
  return false;
}

/**
 * Best-effort client IP: behind the Caddy reverse proxy the trusted hop
 * appends the real client address as the LAST entry of X-Forwarded-For
 * (client-supplied values come first and are not trusted).
 */
function clientKey(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "local";
}

/** Reject cross-site mutating requests (browsers always send Origin on POST). */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, tests)
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function baseSecurityHeaders(response: NextResponse): NextResponse {
  const h = response.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-DNS-Prefetch-Control", "off");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  if (process.env.NODE_ENV === "production") {
    // Ignored over plain HTTP, enforced once served over HTTPS.
    h.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api");
  const mutating = MUTATING_METHODS.has(request.method);
  const now = Date.now();

  // ── API hardening ────────────────────────────────────────────────────────
  if (isApi) {
    const key = clientKey(request);

    if (rateLimited(`api:${key}`, MAX_API_REQUESTS_PER_WINDOW, now)) {
      return baseSecurityHeaders(
        NextResponse.json(
          { error: "Too many requests, slow down" },
          { status: 429, headers: { "Retry-After": "10" } },
        ),
      );
    }

    if (mutating) {
      if (!isSameOrigin(request)) {
        return baseSecurityHeaders(
          NextResponse.json(
            { error: "Cross-origin request blocked" },
            { status: 403 },
          ),
        );
      }
      const length = Number(request.headers.get("content-length") ?? 0);
      if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
        return baseSecurityHeaders(
          NextResponse.json({ error: "Payload too large" }, { status: 413 }),
        );
      }
      if (rateLimited(`mut:${key}`, MAX_MUTATIONS_PER_WINDOW, now)) {
        return baseSecurityHeaders(
          NextResponse.json(
            { error: "Too many changes in a short period, slow down" },
            { status: 429, headers: { "Retry-After": "10" } },
          ),
        );
      }
    }
  }

  // ── Content-Security-Policy ──────────────────────────────────────────────
  // Pages are STATICALLY prerendered (fast, and required for the Tauri
  // desktop export), so a nonce-based strict CSP is impossible: prebuilt
  // HTML cannot carry a per-request nonce and 'strict-dynamic' would block
  // every script — React would never hydrate and the page would be inert
  // (verified by the automated browser E2E test). The policy below keeps
  // every structural restriction (no framing, no objects, no base hijack,
  // no cross-origin forms) while allowing only first-party and inline
  // bootstrap scripts. XSS defense-in-depth is provided by React
  // auto-escaping + zod validation + no dangerouslySetInnerHTML (see
  // SECURITY.md). API responses keep a fully locked-down CSP.
  const pageCsp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join("; ");

  const response = NextResponse.next({ request });

  if (isApi) {
    // JSON endpoints never host active content.
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
  } else if (process.env.NODE_ENV === "production") {
    // Dev needs inline + eval for HMR, so the page CSP is production-only.
    response.headers.set("Content-Security-Policy", pageCsp);
  }

  return baseSecurityHeaders(response);
}

export const config = {
  // Everything except Next.js build assets and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt).*)"],
};
