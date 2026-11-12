// ─── Shared helpers for API-level tests (env must be imported first!) ───────

import { execSync } from "node:child_process";
import { db } from "@/lib/db";

const g = globalThis as unknown as { __hfTestSchema?: Promise<void> };

/** Materialize the Prisma schema in the shared test database (once). */
export function ensureSchema(): Promise<void> {
  g.__hfTestSchema ??= new Promise<void>((resolve, reject) => {
    try {
      execSync("bunx prisma db push --skip-generate", {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["ignore", "ignore", "pipe"],
      });
      resolve();
    } catch (err) {
      reject(err);
    }
  });
  return g.__hfTestSchema;
}

/** Wipe all rows — used by stateful tests so they don't depend on run order. */
export async function resetDb(): Promise<void> {
  await db.expense.deleteMany({});
  await db.income.deleteMany({});
}
