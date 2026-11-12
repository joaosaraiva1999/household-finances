// ─── Security middleware tests (src/middleware.ts) ──────────────────────────
//
// The middleware is pure request/response logic — exercised here directly
// with fabricated requests. Uses its own client IP (via X-Forwarded-For)
// so the in-memory rate-limit buckets don't clash with anything else.
//
// Run: bun test tests/api/middleware.test.ts

import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const IP = { "x-forwarded-for": "10.0.0.1, 203.0.113.7" }; // trusted hop last

function req(
  url: string,
  method = "GET",
  extraHeaders: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    // A real request always carries Host; the middleware compares it
    // against the Origin header for CSRF enforcement.
    headers: { host: "localhost:3000", ...IP, ...extraHeaders },
  });
}

describe("security headers", () => {
  test("applied to every response", () => {
    const res = middleware(req("/"));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
  });

  test("JSON API responses get a locked-down CSP", () => {
    const res = middleware(req("/api/finance?month=2026-11"));
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
});

describe("CSRF / same-origin enforcement", () => {
  test("cross-site mutating request is blocked with 403", () => {
    const res = middleware(
      req("/api/expenses", "POST", {
        "content-type": "application/json",
        origin: "https://evil.example",
      }),
    );
    expect(res.status).toBe(403);
  });

  test("same-origin mutating request passes", () => {
    const res = middleware(
      req("/api/expenses", "POST", {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      }),
    );
    expect(res.status).toBe(200); // NextResponse.next()
  });

  test("non-browser client without Origin passes", () => {
    const res = middleware(req("/api/expenses", "POST", { "content-type": "application/json" }));
    expect(res.status).toBe(200);
  });

  test("malformed Origin is blocked", () => {
    const res = middleware(
      req("/api/expenses", "POST", {
        "content-type": "application/json",
        origin: "not-a-url",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("payload size cap", () => {
  test("oversized mutation body is rejected with 413", () => {
    const res = middleware(
      req("/api/expenses", "POST", {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "content-length": String(65_537),
      }),
    );
    expect(res.status).toBe(413);
  });

  test("a normal body passes the size check", () => {
    const res = middleware(
      req("/api/expenses", "POST", {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "content-length": "512",
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("rate limiting", () => {
  test("mutations beyond the window limit are throttled (429)", () => {
    // This test consumes its own bucket; the limit is 30 per 10s window.
    let throttled = 0;
    for (let i = 0; i < 40; i++) {
      const res = middleware(
        req(`/api/expenses`, "POST", {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "x-forwarded-for": "10.0.0.1, 203.0.113.99", // dedicated bucket
        }),
      );
      if (res.status === 429) throttled++;
    }
    expect(throttled).toBeGreaterThan(0);
  });

  test("throttled responses carry Retry-After", () => {
    for (let i = 0; i < 35; i++) {
      const res = middleware(
        req(`/api/expenses`, "POST", {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "x-forwarded-for": "10.0.0.1, 203.0.113.77",
        }),
      );
      if (res.status === 429) {
        expect(res.headers.get("Retry-After")).toBe("10");
        return;
      }
    }
    throw new Error("expected to hit the mutation rate limit");
  });
});
