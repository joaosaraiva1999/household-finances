/**
 * Desktop bridge: intercepts the web app's `fetch("/api/...")` calls and
 * routes them to the Rust backend via Tauri `invoke()`.
 *
 * This keeps the entire existing frontend unchanged — it still talks the
 * exact same HTTP/JSON contract; only the transport is local IPC instead
 * of a network request. When not running inside Tauri this module is a
 * no-op and the web app keeps using real HTTP.
 */
import { invoke } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const IS_DESKTOP =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readBody(init?: RequestInit): Promise<Record<string, unknown>> {
  if (!init?.body) return {};
  try {
    return JSON.parse(String(init.body));
  } catch {
    return {};
  }
}

if (IS_DESKTOP) {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (
      init?.method ??
      (typeof input !== "string" && !(input instanceof URL) ? input.method : undefined) ??
      "GET"
    ).toUpperCase();

    try {
      // GET /api/finance?month=YYYY-MM
      if (url.startsWith("/api/finance") && method === "GET") {
        const month = new URL(url, "tauri://app").searchParams.get("month");
        const data = await invoke("finance_get", { month });
        return json(200, data);
      }

      // POST /api/income
      if (url === "/api/income" && method === "POST") {
        const data = await invoke("income_set", await readBody(init));
        return json(200, data);
      }

      // POST /api/expenses
      if (url === "/api/expenses" && method === "POST") {
        const data = await invoke("expense_create", {
          payload: await readBody(init),
        });
        return json(201, data);
      }

      // PATCH/DELETE /api/expenses/:id
      const match = url.match(/^\/api\/expenses\/([^/?#]+)$/);
      if (match && method === "PATCH") {
        const data = await invoke("expense_update", {
          id: decodeURIComponent(match[1]),
          payload: await readBody(init),
        });
        return json(200, data);
      }
      if (match && method === "DELETE") {
        const data = await invoke("expense_delete", {
          id: decodeURIComponent(match[1]),
        });
        return json(200, data);
      }

      // Anything else falls through (local assets only).
      return nativeFetch(input, init);
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Erro inesperado";
      return json(400, { error: message });
    }
  };
}
