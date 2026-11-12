// ─── Web API integration tests ───────────────────────────────────────────────
//
// Exercise the REAL route handlers (src/app/api/**) against a REAL SQLite
// database (Prisma schema pushed to a temp file). No mocks — this is the
// same code path the production server runs.
//
// Run: bun test tests/api/web-api.test.ts
// Uses the shared throwaway test database (tests/api/helpers) — the
// developer database is never touched.

import "./helpers/env"; // MUST be first: sets DATABASE_URL before any app import
import { describe, expect, test, beforeAll } from "bun:test";
import { NextRequest } from "next/server";
import { ensureSchema, resetDb } from "./helpers/test-db";

let GET: typeof import("@/app/api/finance/route").GET;
let POST_EXPENSE: typeof import("@/app/api/expenses/route").POST;
let PATCH_EXPENSE: typeof import("@/app/api/expenses/[id]/route").PATCH;
let DELETE_EXPENSE: typeof import("@/app/api/expenses/[id]/route").DELETE;
let POST_INCOME: typeof import("@/app/api/income/route").POST;

beforeAll(async () => {
  // Materialize the Prisma schema in the shared test database, then import
  // the handlers.
  await ensureSchema();
  ({ GET } = await import("@/app/api/finance/route"));
  ({ POST: POST_EXPENSE } = await import("@/app/api/expenses/route"));
  ({ PATCH: PATCH_EXPENSE, DELETE: DELETE_EXPENSE } = await import("@/app/api/expenses/[id]/route"));
  ({ POST: POST_INCOME } = await import("@/app/api/income/route"));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function idRequest(id: string, method: "PATCH" | "DELETE", body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/expenses/${id}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const MONTH = "2026-11";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function postExpense(body: Record<string, unknown>): Promise<Response> {
  return POST_EXPENSE(jsonRequest("/api/expenses", "POST", { ...body, month: MONTH }));
}

async function getFinance(): Promise<{
  status: number;
  body: {
    month: string;
    expenses: Array<Record<string, unknown>>;
    incomes: Array<Record<string, unknown>>;
    availableMonths: string[];
    summary: Record<string, any>;
    meta: { today: string };
  };
}> {
  const res = await GET(jsonRequest(`/api/finance?month=${MONTH}`, "GET"));
  return { status: res.status, body: await res.json() };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/finance", () => {
  test("empty month returns a zeroed summary (no crash)", async () => {
    const { status, body } = await getFinance();
    expect(status).toBe(200);
    expect(body.month).toBe(MONTH);
    expect(body.expenses).toEqual([]);
    expect(body.incomes).toEqual([]);
    expect(body.summary.totalIncome).toBe(0);
    expect(body.summary.totalExpenses).toBe(0);
    expect(body.summary.joao.committedPct).toBe(0);
    // Web parity with the desktop: the current month is always offered.
    expect(body.availableMonths).toContain(currentMonth());
    expect(body.meta.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("POST /api/expenses — validation", () => {
  test.each([
    [{ name: "X", amount: 0 }, "zero amount"],
    [{ name: "X", amount: -5 }, "negative amount"],
    [{ name: "X", amount: "12.50" }, "numeric string amount"],
    [{ name: "X", amount: true }, "boolean amount"],
    [{ name: "X", amount: 10_000_001 }, "over-limit amount"],
    [{ name: "", amount: 10 }, "empty name"],
    [{ name: "   ", amount: 10 }, "whitespace name"],
    [{ name: "x".repeat(121), amount: 10 }, "over-long name"],
    [{ name: "X", amount: 10, dueDate: "2026-02-31" }, "impossible due date"],
    [{ name: "X", amount: 10, paid: "false" }, "string paid"],
    [{ name: "X", amount: 10, responsible: "admin" }, "invalid responsible"],
    [{ name: "X", amount: 10, kind: "transfer" }, "invalid kind"],
    [{}, "missing everything"],
  ])("rejects %s (%s)", async (body) => {
    const res = await postExpense(body);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(typeof data.error).toBe("string");
  });

  test("strips unknown fields (no mass assignment)", async () => {
    const res = await postExpense({
      name: "Mass", amount: 10, id: "injected", month: MONTH, createdAt: "2000-01-01",
    });
    expect(res.status).toBe(201);
    const { expense } = await res.json();
    expect(expense.id).not.toBe("injected");
    expect(expense.createdAt).not.toBe("2000-01-01");
  });

  test("invalid month falls back to current month", async () => {
    const res = await postExpense({ name: "Fallback", amount: 10, month: "2026-13" });
    expect(res.status).toBe(201);
    const { expense } = await res.json();
    expect(expense.month).toBe(currentMonth());
  });
});

describe("expense lifecycle — create → read → patch → delete", () => {
  test("full lifecycle with shared paid split", async () => {
    // Create
    const created = await postExpense({
      name: "Electricidade", amount: 120.35, category: "Utilities",
      joaoPaid: 70.5, dueDate: "2026-11-08", notes: "luz de novembro",
    });
    expect(created.status).toBe(201);
    const { expense } = await created.json();
    expect(expense.joaoPaid).toBe(70.5);
    expect(expense.annaPaid).toBeCloseTo(49.85, 10);
    expect(expense.joaoShare).toBeCloseTo(58.6, 5);

    // Read via /api/finance
    const finance = await getFinance();
    const stored = finance.body.expenses.find((e) => e.id === expense.id);
    expect(stored).toBeDefined();
    expect(stored!.amount).toBe(120.35);

    // Toggle paid
    const paid = await PATCH_EXPENSE(
      idRequest(expense.id, "PATCH", { paid: true }),
      { params: Promise.resolve({ id: expense.id }) },
    );
    expect(paid.status).toBe(200);
    expect((await paid.json()).expense.paid).toBe(true);

    // Change amount → stored split is rescaled proportionally
    const resized = await PATCH_EXPENSE(
      idRequest(expense.id, "PATCH", { amount: 240.7 }),
      { params: Promise.resolve({ id: expense.id }) },
    );
    expect(resized.status).toBe(200);
    const updated = (await resized.json()).expense;
    expect(updated.amount).toBe(240.7);
    expect(updated.joaoPaid + updated.annaPaid).toBeCloseTo(240.7, 10);

    // Delete
    const deleted = await DELETE_EXPENSE(
      idRequest(expense.id, "DELETE"),
      { params: Promise.resolve({ id: expense.id }) },
    );
    expect(deleted.status).toBe(200);
    const after = await getFinance();
    expect(after.body.expenses.find((e) => e.id === expense.id)).toBeUndefined();
  });

  test("PATCH of an unknown id → 404", async () => {
    const res = await PATCH_EXPENSE(
      idRequest("cmh2xj0qg000914idck1b6l8l", "PATCH", { paid: true }),
      { params: Promise.resolve({ id: "cmh2xj0qg000914idck1b6l8l" }) },
    );
    expect(res.status).toBe(404);
  });

  test("DELETE of an unknown id → 404", async () => {
    const res = await DELETE_EXPENSE(
      idRequest("cmh2xj0qg000914idck1b6l8l", "DELETE"),
      { params: Promise.resolve({ id: "cmh2xj0qg000914idck1b6l8l" }) },
    );
    expect(res.status).toBe(404);
  });

  test("PATCH with an empty/unknown-only body → 400", async () => {
    const created = await postExpense({ name: "Tmp", amount: 5 });
    const { expense } = await created.json();
    const res = await PATCH_EXPENSE(
      idRequest(expense.id, "PATCH", { irrelevantField: "x" }),
      { params: Promise.resolve({ id: expense.id }) },
    );
    expect(res.status).toBe(400);
  });

  test("PATCH with an invalid id (injection-looking) → 400", async () => {
    const res = await PATCH_EXPENSE(
      idRequest("x' OR '1'='1", "PATCH", { paid: true }),
      { params: Promise.resolve({ id: "x' OR '1'='1" }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/income", () => {
  test("upsert creates then preserves the other field", async () => {
    const first = await POST_INCOME(
      jsonRequest("/api/income", "POST", { person: "joao", month: MONTH, amount: 2000 }),
    );
    expect(first.status).toBe(200);
    expect((await first.json()).income.amount).toBe(2000);

    const second = await POST_INCOME(
      jsonRequest("/api/income", "POST", { person: "joao", month: MONTH, mealCard: 50.5 }),
    );
    expect(second.status).toBe(200);
    const { income } = await second.json();
    expect(income.amount).toBe(2000); // preserved
    expect(income.mealCard).toBe(50.5);

    const finance = await getFinance();
    const joao = finance.body.incomes.find((i) => i.person === "joao");
    expect(joao).toEqual({ id: income.id, person: "joao", month: MONTH, amount: 2000, mealCard: 50.5 });
  });

  test("rejects invalid person and negative values", async () => {
    const bad1 = await POST_INCOME(
      jsonRequest("/api/income", "POST", { person: "admin", month: MONTH, amount: 10 }),
    );
    expect(bad1.status).toBe(400);
    const bad2 = await POST_INCOME(
      jsonRequest("/api/income", "POST", { person: "joao", month: MONTH, amount: -1 }),
    );
    expect(bad2.status).toBe(400);
    const bad3 = await POST_INCOME(
      jsonRequest("/api/income", "POST", { person: "joao", month: MONTH }),
    );
    expect(bad3.status).toBe(400);
  });
});

describe("summary math over the API (balance rules)", () => {
  beforeAll(resetDb);

  test("unpaid bills occupy the balance; credits add to income", async () => {
    // Rent 800 shared 50/50 unpaid + Gym 50 joao + Bonus 250 credit joao.
    await postExpense({ name: "Renda", amount: 800, category: "Housing" });
    await postExpense({ name: "Ginásio", amount: 50, responsible: "joao" });
    await postExpense({ name: "Bónus", amount: 250, kind: "credit", responsible: "joao" });
    await POST_INCOME(jsonRequest("/api/income", "POST", { person: "joao", month: MONTH, amount: 2000 }));
    await POST_INCOME(jsonRequest("/api/income", "POST", { person: "anna", month: MONTH, amount: 1800 }));

    const { body } = await getFinance();
    expect(body.summary.joao.income).toBe(2250); // 2000 + 250 credit
    expect(body.summary.joao.totalExpenses).toBe(450); // 400 rent + 50 gym
    expect(body.summary.joao.available).toBe(1800);
    expect(body.summary.anna.totalExpenses).toBe(400);
    expect(body.summary.anna.available).toBe(1400);
    expect(body.summary.totalAvailable).toBe(3200);
    expect(body.summary.unpaidCount).toBe(2); // credits are not bills
    expect(body.summary.expenseCount).toBe(2);
  });
});

describe("security behaviour through the API", () => {
  test("SQL injection payload in name is stored verbatim and stays inert", async () => {
    const payload = "x'); DROP TABLE Expense;--";
    const res = await postExpense({ name: payload, amount: 10 });
    expect(res.status).toBe(201);
    const { expense } = await res.json();
    expect(expense.name).toBe(payload);

    // The table is intact — normal queries still work and the payload row
    // is the only new one.
    const finance = await getFinance();
    expect(finance.status).toBe(200);
    expect(finance.body.expenses.filter((e) => e.name === payload)).toHaveLength(1);
  });

  test("NoSQL/operator payloads in notes are just text", async () => {
    const res = await postExpense({
      name: "Notas", amount: 10,
      notes: "' OR '1'='1 -- {$gt: 1}",
    });
    expect(res.status).toBe(201);
    expect((await res.json()).expense.notes).toBe("' OR '1'='1 -- {$gt: 1}");
  });

  test("control characters are stripped from stored text", async () => {
    const res = await postExpense({ name: "Limpo\u0007", amount: 10, notes: "a\u0000b" });
    const data: any = await res.json();
    expect(res.status, JSON.stringify(data)).toBe(201);
    expect(data.expense.name).toBe("Limpo");
    expect(data.expense.notes).toBe("ab");
  });
});

describe("stability", () => {
  beforeAll(resetDb);

  test("duplicate submissions create distinct entries (documented behaviour)", async () => {
    const a = await postExpense({ name: "Duplicado", amount: 9.99 });
    const b = await postExpense({ name: "Duplicado", amount: 9.99 });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const { expense: ea } = await a.json();
    const { expense: eb } = await b.json();
    expect(ea.id).not.toBe(eb.id);
  });

  test("10 concurrent creates all succeed and are all stored", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        postExpense({ name: `Concorrente ${i}`, amount: 1 + i }),
      ),
    );
    for (const res of results) expect(res.status).toBe(201);
    const finance = await getFinance();
    const stored = finance.body.expenses.filter((e) => String(e.name).startsWith("Concorrente"));
    expect(stored).toHaveLength(10);
  });

  test("equal due dates sort deterministically by name (regression)", async () => {
    await postExpense({ name: "Zé", amount: 10, dueDate: "2026-11-15" });
    await postExpense({ name: "Ana", amount: 20, dueDate: "2026-11-15" });
    await postExpense({ name: "Bruno", amount: 30, dueDate: "2026-11-15" });
    const finance = await getFinance();
    const sameDay = finance.body.expenses
      .filter((e) => e.dueDate === "2026-11-15")
      .map((e) => String(e.name));
    expect(sameDay).toEqual([...sameDay].sort((a, b) => a.localeCompare(b)));
    expect(sameDay.indexOf("Ana")).toBeLessThan(sameDay.indexOf("Zé"));
  });

  test("malformed JSON body → 400, not a 500", async () => {
    const res = await POST_EXPENSE(
      new NextRequest("http://localhost:3000/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
