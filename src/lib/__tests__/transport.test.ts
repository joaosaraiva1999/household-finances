// ─── Transport layer tests (src/lib/transport.ts) ───────────────────────────
//
// The transport picks the pipe per environment: fetch on the web, Tauri
// IPC in the desktop build. These tests pin BOTH paths and the error
// normalization contract, without a real server or Tauri runtime.
//
// Run: bun test src/lib/__tests__/transport.test.ts

import { describe, expect, test, afterEach } from "bun:test";
import { isDesktop, read, write } from "@/lib/transport";

type InvokeMock = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const g = globalThis as unknown as {
  window?: Record<string, unknown> & { __TAURI_INTERNALS__?: { invoke: InvokeMock } };
};

const realFetch = globalThis.fetch;

afterEach(() => {
  if (g.window) delete g.window.__TAURI_INTERNALS__;
  globalThis.fetch = realFetch;
});

// ─── Web path ────────────────────────────────────────────────────────────────

describe("web transport (fetch)", () => {
  test("isDesktop is false without Tauri internals", () => {
    expect(isDesktop()).toBe(false);
  });

  test("read() fetches the path and returns parsed JSON", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ month: "2026-11", ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const data = await read<{ month: string }>(
      "/api/finance?month=2026-11",
      "get_month_data",
      { month: "2026-11" },
    );
    expect(calledUrl).toBe("/api/finance?month=2026-11");
    expect(data.month).toBe("2026-11");
  });

  test("write() posts JSON with the right method and headers", async () => {
    let captured: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ expense: { id: "e1" } }), { status: 201 });
    }) as unknown as typeof fetch;
    const out = await write<{ expense: { id: string } }>(
      "/api/expenses",
      "POST",
      { name: "Test", amount: 5 },
      "create_expense",
      { input: { name: "Test", amount: 5 } },
    );
    expect(out.expense.id).toBe("e1");
    expect(captured?.method).toBe("POST");
    expect((captured?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(captured?.body).toBe(JSON.stringify({ name: "Test", amount: 5 }));
  });

  test("error responses throw Error(body.error)", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Name is required" }), { status: 400 })) as unknown as typeof fetch;
    expect(write("/api/expenses", "POST", {})).rejects.toThrow("Name is required");
  });

  test("non-JSON error bodies still produce a helpful message", async () => {
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    expect(read("/api/finance", "get_month_data")).rejects.toThrow("Request failed (500)");
  });
});

// ─── Desktop path (Tauri IPC) ────────────────────────────────────────────────

describe("desktop transport (Tauri IPC)", () => {
  function mockTauri(impl: InvokeMock): InvokeMock {
    const invoke: InvokeMock = impl;
    if (!g.window) g.window = {} as Record<string, unknown>;
    g.window.__TAURI_INTERNALS__ = { invoke };
    return invoke;
  }

  test("isDesktop is true when Tauri internals exist", () => {
    mockTauri(() => Promise.resolve({}));
    expect(isDesktop()).toBe(true);
  });

  test("read() invokes the command with the given args", async () => {
    let gotCmd = "";
    let gotArgs: Record<string, unknown> | undefined;
    mockTauri(async (cmd, args) => {
      gotCmd = cmd;
      gotArgs = args;
      return { month: "2026-10" };
    });
    const data = await read<{ month: string }>("/api/finance", "get_month_data", { month: "2026-10" });
    expect(gotCmd).toBe("get_month_data");
    expect(gotArgs).toEqual({ month: "2026-10" });
    expect(data.month).toBe("2026-10");
  });

  test("write() invokes the command (never fetch)", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    let gotCmd = "";
    let gotArgs: Record<string, unknown> | undefined;
    mockTauri(async (cmd, args) => {
      gotCmd = cmd;
      gotArgs = args;
      return { ok: true };
    });
    const out = await write<{ ok: boolean }>(
      "/api/expenses/ex1",
      "DELETE",
      undefined,
      "delete_expense",
      { id: "ex1" },
    );
    expect(fetchCalled).toBe(false);
    expect(gotCmd).toBe("delete_expense");
    expect(gotArgs).toEqual({ id: "ex1" });
    expect(out.ok).toBe(true);
  });

  test("Rust { code, message } errors normalize to Error(message)", async () => {
    mockTauri(async () => {
      throw { code: "VALIDATION", message: "Amount must be a positive number within limits" };
    });
    expect(
      write("/api/expenses", "POST", {}, "create_expense", { input: {} }),
    ).rejects.toThrow("Amount must be a positive number within limits");
  });

  test("string rejections normalize to Error", async () => {
    mockTauri(async () => {
      throw "Store busy";
    });
    expect(read("/api/finance", "get_month_data")).rejects.toThrow("Store busy");
  });
});
