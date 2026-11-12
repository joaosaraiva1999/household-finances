// ─── Unified transport: browser (Next.js API) or desktop (Tauri IPC) ─────────
//
// The exact same React frontend runs in two environments:
//
//   * Web    — Next.js server; data flows through /api/* route handlers
//              (Prisma + SQLite), secured by middleware + zod validation.
//   * Desktop — Tauri 2; data flows through Rust commands (finances-core:
//              rusqlite, integer cents, validation.rs), no network at all.
//
// Both backends speak the same JSON contract (the Rust side is pinned by
// golden tests in crates/finances-core/src/view.rs), so the hooks below only
// need to pick the pipe per call. Errors from Rust (`{ code, message }`)
// are normalized to `Error(message)` so UI code can treat them like the
// web's `{ error }` responses.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * True when running inside the Tauri WebView (desktop build).
 * Evaluated lazily so it is always `false` during SSR/prerender.
 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Invoke a Rust command, normalizing IPC errors to `Error(message)`. */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (err) {
    // Rust `AppError` serializes across IPC as { code, message }.
    if (err && typeof err === "object" && "message" in err) {
      throw new Error(String((err as { message: unknown }).message));
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Perform a read against the active backend.
 * `path` is a web API path (e.g. `/api/finance?month=2026-11`);
 * `command` is the Tauri command invoked on desktop.
 */
export async function read<T>(path: string, command: string, args?: Record<string, unknown>): Promise<T> {
  if (isDesktop()) return invoke<T>(command, args);
  const res = await fetch(path);
  return unwrap<T>(res);
}

/**
 * Perform a write against the active backend.
 * `body` is sent as JSON on web and passed as `input`/`patch` arguments on
 * desktop (mirroring the shape of the web request body).
 */
export async function write<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  command?: string,
  commandArgs?: Record<string, unknown>,
): Promise<T> {
  if (isDesktop()) {
    if (!command) throw new Error("Missing Tauri command for write");
    return invoke<T>(command, commandArgs);
  }
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function unwrap<T>(res: Response): Promise<T> {
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return parsed as T;
}
