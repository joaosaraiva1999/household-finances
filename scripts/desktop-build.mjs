// ─── Desktop (Tauri) production build ────────────────────────────────────────
//
// `next build` with BUILD_TARGET=desktop uses `output: "export"` (see
// next.config.ts): a fully static bundle that Tauri serves from the
// filesystem — no Node server, no network. Route handlers under src/app/api
// are web-only (the desktop frontend talks to the Rust core through Tauri
// IPC instead) and CANNOT be statically exported, so they are moved aside
// for the duration of the build and ALWAYS restored afterwards (try/finally,
// including on build failure or Ctrl-C of the node process).
//
// Web builds (`next build`) are untouched and keep their API routes.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import process from "node:process";

const API_DIR = "src/app/api";
// Lives at the project root: `.next` is wiped by next build and even a
// subfolder of node_modules proved unsafe. Untracked + always restored in
// `finally`; an interrupted run self-recovers on the next invocation.
const STASH_DIR = ".desktop-api-stash";

function stash() {
  if (existsSync(API_DIR)) {
    // A leftover from an interrupted previous run must not block us.
    if (existsSync(STASH_DIR)) rmSync(STASH_DIR, { recursive: true, force: true });
    renameSync(API_DIR, STASH_DIR);
    return true;
  }
  // Maybe a previous run crashed before `finally` could run — recover.
  if (existsSync(STASH_DIR)) return "recover";
  return false;
}

function restore() {
  if (existsSync(STASH_DIR)) {
    if (existsSync(API_DIR)) rmSync(API_DIR, { recursive: true, force: true });
    renameSync(STASH_DIR, API_DIR);
    console.log("[desktop-build] API routes restored.");
  }
}

// Node keeps `finally` blocks on SIGINT/SIGTERM, so the restore is reliable.
const stashed = stash();
if (stashed === "recover") {
  restore();
  console.error("[desktop-build] Recovered API routes from an interrupted build; re-run.");
  process.exit(1);
}

console.log(
  stashed
    ? "[desktop-build] API routes set aside (web-only) for static export…"
    : "[desktop-build] No API routes present, building…",
);

let ok = false;
try {
  const res = spawnSync("bunx", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, BUILD_TARGET: "desktop" },
    shell: process.platform === "win32",
  });
  ok = res.status === 0;
  if (ok) {
    console.log("[desktop-build] Static export ready in ./out (Tauri frontendDist).");
  } else {
    process.exitCode = res.status ?? 1;
  }
} finally {
  restore();
  if (!ok) console.error("[desktop-build] Build failed; API routes restored.");
}
