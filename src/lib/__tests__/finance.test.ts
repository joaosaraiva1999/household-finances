// ─── Unit tests for src/lib/finance.ts (pure business logic) ────────────────
// Run: bun test src/lib/__tests__/finance.test.ts

import { describe, expect, test } from "bun:test";
import {
  computeSummary,
  currentMonthKey,
  daysUntil,
  isValidMonth,
  normalizePaidSplit,
  parseAmountInput,
  personShare,
  round2,
  sharePercentFromPaid,
  shiftMonth,
  toMonthKey,
  type ExpenseRecord,
  type IncomeRecord,
} from "@/lib/finance";

function expense(overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id: "e1",
    name: "Rent",
    amount: 800,
    kind: "expense",
    category: "Housing",
    responsible: "shared",
    joaoShare: 50,
    joaoPaid: null,
    annaPaid: null,
    dueDate: null,
    paid: false,
    notes: null,
    month: "2026-11",
    ...overrides,
  };
}

function income(overrides: Partial<IncomeRecord> = {}): IncomeRecord {
  return {
    id: "i1",
    person: "joao",
    month: "2026-11",
    amount: 2000,
    mealCard: 0,
    ...overrides,
  };
}

describe("month helpers", () => {
  test("toMonthKey uses UTC (regression: local drift)", () => {
    expect(toMonthKey(new Date(Date.UTC(2026, 10, 13)))).toBe("2026-11");
    expect(toMonthKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01");
  });

  test("shiftMonth crosses year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-11", 0)).toBe("2026-11");
  });

  test("isValidMonth rejects junk", () => {
    expect(isValidMonth("2026-11")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-1")).toBe(false);
    expect(isValidMonth("DROP")).toBe(false);
  });

  test("currentMonthKey returns a valid month", () => {
    expect(isValidMonth(currentMonthKey())).toBe(true);
  });
});

describe("parseAmountInput — EN and PT conventions", () => {
  test.each([
    ["85.40", 85.4],
    ["1,234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["1,234,567", 1234567],
    ["1234,5", 1234.5],
    ["€ 85,40", 85.4],
    ["9€", 9],
    [" 12 ", 12],
    ["0.99", 0.99],
  ])("parses %s → %s", (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected);
  });

  test.each(["", "   ", "abc", "1.2.3.4", "1e9", "12;5"])("rejects %s", (input) => {
    expect(Number.isNaN(parseAmountInput(input))).toBe(true);
  });
});

describe("money math", () => {
  test("round2 avoids float drift", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.0);
    expect(round2(2.675)).toBe(2.68);
  });

  test("personShare honours exact paid amounts", () => {
    const e = expense({ amount: 900, joaoPaid: 400, annaPaid: 500 });
    expect(personShare(e, "joao")).toBe(400);
    expect(personShare(e, "anna")).toBe(500);
  });

  test("personShare falls back to percentage", () => {
    const e = expense({ amount: 900, joaoShare: 25 });
    expect(personShare(e, "joao")).toBe(225);
    expect(personShare(e, "anna")).toBe(675);
  });

  test("personShare for personal expenses", () => {
    const e = expense({ amount: 50, responsible: "joao" });
    expect(personShare(e, "joao")).toBe(50);
    expect(personShare(e, "anna")).toBe(0);
  });

  test("credits split by percentage between both", () => {
    const e = expense({ amount: 100, kind: "credit", joaoShare: 30 });
    expect(personShare(e, "joao")).toBe(30);
    expect(personShare(e, "anna")).toBe(70);
  });

  test("normalizePaidSplit keeps the provided value and fills the remainder", () => {
    expect(normalizePaidSplit(900, 400, null)).toEqual({ joaoPaid: 400, annaPaid: 500 });
    expect(normalizePaidSplit(900, null, 100)).toEqual({ joaoPaid: 800, annaPaid: 100 });
    // Out-of-range values are clamped, never persisted raw.
    expect(normalizePaidSplit(900, 5000, null)).toEqual({ joaoPaid: 900, annaPaid: 0 });
    expect(normalizePaidSplit(900, -5, null)).toEqual({ joaoPaid: 0, annaPaid: 900 });
    expect(normalizePaidSplit(900, null, null)).toBeNull();
    expect(normalizePaidSplit(0, 10, null)).toBeNull();
  });

  test("sharePercentFromPaid", () => {
    expect(sharePercentFromPaid(400, 900)).toBe(44.4);
    expect(sharePercentFromPaid(900, 900)).toBe(100);
    expect(sharePercentFromPaid(0, 900)).toBe(0);
    expect(sharePercentFromPaid(100, 0)).toBe(50);
  });
});

describe("daysUntil", () => {
  test("negative for past, zero today, positive future (UTC-based)", () => {
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
    const yesterday = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000));
    const tomorrow = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86_400_000));
    expect(daysUntil(today)).toBe(0);
    expect(daysUntil(yesterday)).toBe(-1);
    expect(daysUntil(tomorrow)).toBe(1);
  });
});

describe("computeSummary — the balance rules", () => {
  test("unpaid bills still occupy the balance", () => {
    const expenses = [
      expense({ amount: 800 }),
      expense({ name: "Gym", amount: 50, responsible: "joao" }),
    ];
    const incomes = [
      income({ person: "joao", amount: 2000 }),
      income({ person: "anna", amount: 1800 }),
    ];
    const s = computeSummary(expenses, incomes);
    expect(s.joao.totalExpenses).toBe(450);
    expect(s.joao.available).toBe(1550);
    expect(s.anna.totalExpenses).toBe(400);
    expect(s.anna.available).toBe(1400);
    expect(s.unpaidCount).toBe(2);
    expect(s.paidCount).toBe(0);
    expect(s.totalAvailable).toBe(2950);
  });

  test("credits add to income, not expenses", () => {
    const expenses = [
      expense({ name: "Bonus", amount: 250, kind: "credit", responsible: "joao" }),
      expense({ name: "Coffee", amount: 4, responsible: "joao" }),
    ];
    const s = computeSummary(expenses, []);
    expect(s.joao.income).toBe(250);
    expect(s.joao.totalExpenses).toBe(4);
    expect(s.joao.available).toBe(246);
    expect(s.expenseCount).toBe(1);
  });

  test("exact paid split is honoured in the summary", () => {
    const expenses = [expense({ amount: 900, joaoPaid: 400, annaPaid: 500 })];
    const incomes = [income({ person: "joao", amount: 2000 }), income({ person: "anna", amount: 1800 })];
    const s = computeSummary(expenses, incomes);
    expect(s.joao.totalExpenses).toBe(400);
    expect(s.anna.totalExpenses).toBe(500);
  });

  test("committedPct is capped at 200 like the UI progress ring", () => {
    const expenses = [expense({ amount: 1000, responsible: "joao" })];
    const s = computeSummary(expenses, [income({ person: "joao", amount: 100 })]);
    expect(s.joao.committedPct).toBe(200);
  });

  test("empty month → zeroed summary, no crashes", () => {
    const s = computeSummary([], []);
    expect(s.totalIncome).toBe(0);
    expect(s.totalExpenses).toBe(0);
    expect(s.joao.committedPct).toBe(0);
    expect(s.upcoming).toEqual([]);
    expect(s.overdue).toEqual([]);
  });

  test("upcoming/overdue sort by due date and skip paid/no-date bills", () => {
    const expenses = [
      expense({ name: "Later", dueDate: "2026-11-28" }),
      expense({ name: "Past", dueDate: "2026-11-01" }),
      expense({ name: "PaidPast", dueDate: "2026-11-01", paid: true }),
      expense({ name: "NoDate" }),
    ];
    const s = computeSummary(expenses, []);
    expect(s.upcoming.map((e) => e.name)).toEqual(["Past", "Later"]);
    expect(s.overdue.map((e) => e.name)).toEqual(["Past"]);
  });
});
