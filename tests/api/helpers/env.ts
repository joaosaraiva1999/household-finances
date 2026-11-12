// ─── Shared test-environment bootstrap ──────────────────────────────────────
//
// Bun executes every test file of a run inside ONE process with a shared
// module registry. Any file that needs the API/DB stack MUST import this
// module FIRST (ESM evaluates imports in declaration order) so that:
//
//   1. `DATABASE_URL` points at one process-wide throwaway SQLite file —
//      created once, reused by every API-level test file, regardless of
//      which file happens to load first;
//   2. query logging is silenced (NODE_ENV=production);
//   3. the developer database (`db/custom.db`) is never touched.
//
// This module has NO imports from the app — only node builtins — so its
// top-level code really does run before anything that reads the env.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type TestEnv = { dir: string };

const g = globalThis as unknown as { __hfTestEnv?: TestEnv };

if (!g.__hfTestEnv) {
  const dir = mkdtempSync(join(tmpdir(), "hf-web-tests-"));
  Object.assign(process.env, {
    DATABASE_URL: `file:${join(dir, "test.db")}`,
    NODE_ENV: "production",
  });
  g.__hfTestEnv = { dir };
}

export const TEST_ENV_DIR = g.__hfTestEnv.dir;
