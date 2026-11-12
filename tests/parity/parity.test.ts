// ─── Cross-version parity suite ─────────────────────────────────────────────
//
// Proves the web implementation (Next.js API + Prisma) and the Rust desktop
// core (finances-core) produce **equivalent externally observable results**
// for the same inputs — the summary math, the reconciliation of paid splits
// and even the display ordering.
//
// Pipeline:
//   1. The shared fixtures in `scenarios.json` are pushed through the REAL
//      web route handlers into a temp SQLite database.
//   2. The same fixtures are pushed through the Rust core by
//      `cargo test -p finances-core --test parity_export`, which writes
//      /tmp/hf-parity-rust.json.
//   3. This test compares both outputs field by field (money within half a
//      cent — both sides are 2-decimal values, so any real divergence of
//      one cent fails).
//
// Run: bun test tests/parity/parity.test.ts

import "../api/helpers/env"; // MUST be first: sets DATABASE_URL before any app import
import { describe, expect, test, beforeAll } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { ensureSchema, resetDb } from "../api/helpers/test-db";

const RUST_OUT = "/tmp/hf-parity-rust.json";
const MONTH = "2026-11";

let GET: typeof import("@/app/api/finance/route").GET;
let POST_EXPENSE: typeof import("@/app/api/expenses/route").POST;
let POST_INCOME: typeof import("@/app/api/income/route").POST;

interface Scenario {
  name: string;
  month: string;
  incomes: Array<{ person: "joao" | "anna"; amount: number; mealCard: number }>;
  expenses: Array<Record<string, unknown>>;
}

interface Result {
  name: string;
  summary: Record<string, unknown>;
  expenseOrder: string[];
}

beforeAll(async () => {
  await ensureSchema();
  ({ GET } = await import("@/app/api/finance/route"));
  ({ POST: POST_EXPENSE } = await import("@/app/api/expenses/route"));
  ({ POST: POST_INCOME } = await import("@/app/api/income/route"));
});

async function runWebScenarios(): Promise<Result[]> {
  const scenarios: { scenarios: Scenario[] } = JSON.parse(
    readFileSync("tests/parity/scenarios.json", "utf8"),
  );
  const results: Result[] = [];

  for (const scenario of scenarios.scenarios) {
    // Fresh state per scenario — the Rust side uses a fresh in-memory store
    // per scenario, so the web side must too (scenarios may share a month).
    await resetDb();

    for (const income of scenario.incomes) {
      const res = await POST_INCOME(
        new NextRequest("http://localhost:3000/api/income", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...income, month: scenario.month }),
        }),
      );
      expect(res.status, `income ${income.person} (${scenario.name})`).toBe(200);
    }
    for (const expense of scenario.expenses) {
      const res = await POST_EXPENSE(
        new NextRequest("http://localhost:3000/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...expense, month: scenario.month }),
        }),
      );
      expect(res.status, `expense ${String(expense.name)} (${scenario.name})`).toBe(201);
    }

    const res = await GET(
      new NextRequest(`http://localhost:3000/api/finance?month=${scenario.month}`, {
        method: "GET",
        headers: { "x-forwarded-for": "10.0.0.1, 203.0.113.5" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    results.push({
      name: scenario.name,
      summary: body.summary,
      expenseOrder: (body.expenses as Array<{ name: string }>).map((e) => e.name),
    });
  }
  return results;
}

function runRustScenarios(): void {
  // cargo may not be on the default PATH of every environment.
  const cargo = ["cargo", "/home/z/.cargo/bin/cargo"].find(
    (c) => existsSync(c) || isOnPath(c),
  );
  if (!cargo) throw new Error("cargo not found — the Rust toolchain is required for parity tests");
  execSync(`${cargo} test -p finances-core --test parity_export`, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env },
  });
}

function isOnPath(bin: string): boolean {
  try {
    execSync(`${bin} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Numbers within half a cent are equal (both sides are 2-decimal values). */
function deepEqual(a: unknown, b: unknown, path: string): string[] {
  const problems: string[] = [];
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) >= 0.005) problems.push(`${path}: web=${a} rust=${b}`);
    return problems;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      problems.push(`${path}: length ${a.length} (web) vs ${b.length} (rust)`);
      return problems;
    }
    a.forEach((v, i) => problems.push(...deepEqual(v, b[i], `${path}[${i}]`)));
    return problems;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) {
      problems.push(`${path}: keys differ web=${ka.join(",")} rust=${kb.join(",")}`);
      return problems;
    }
    for (const k of ka) {
      problems.push(
        ...deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`),
      );
    }
    return problems;
  }
  if (a !== b) problems.push(`${path}: web=${JSON.stringify(a)} rust=${JSON.stringify(b)}`);
  return problems;
}

/** Strip implementation-specific ids from nested expense copies (the record
 *  CONTENT must match; each system generates its own primary keys). */
function stripIds(summary: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(summary) as Record<string, unknown>;
  for (const key of ["upcoming", "overdue"]) {
    if (Array.isArray(clone[key])) {
      clone[key] = (clone[key] as Array<Record<string, unknown>>).map(
        ({ id: _id, ...rest }) => rest,
      );
    }
  }
  return clone;
}

describe("cross-version parity (web ↔ rust)", () => {
  test("both implementations produce identical summaries and ordering", async () => {
    const web = await runWebScenarios();
    runRustScenarios();
    expect(existsSync(RUST_OUT)).toBe(true);
    const rust: Result[] = JSON.parse(readFileSync(RUST_OUT, "utf8"));

    expect(rust).toHaveLength(web.length);
    for (let i = 0; i < web.length; i++) {
      expect(rust[i].name, "scenario order").toBe(web[i].name);
      const problems = deepEqual(
        stripIds(web[i].summary),
        stripIds(rust[i].summary),
        `${web[i].name}.summary`,
      );
      expect(problems, `${web[i].name}: summary differences`).toEqual([]);
      expect(rust[i].expenseOrder, `${web[i].name}: display order`).toEqual(web[i].expenseOrder);
    }
  });
});
