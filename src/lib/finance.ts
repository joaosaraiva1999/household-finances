// ─── Shared types & calculation helpers for the household finance app ───────

export type Person = "joao" | "anna";
export type Responsible = "joao" | "anna" | "shared";

export const PEOPLE: { id: Person; name: string }[] = [
  { id: "joao", name: "João" },
  { id: "anna", name: "Anna" },
];

export const CATEGORIES = [
  "Housing",
  "Utilities",
  "Groceries",
  "Transport",
  "Internet & Phone",
  "Insurance",
  "Health",
  "Entertainment",
  "Personal",
  "Education",
  "Other",
] as const;

export interface IncomeRecord {
  id: string;
  person: Person;
  month: string;
  amount: number; // monthly salary
  mealCard: number; // meal card money (e.g. cartão-refeição) for the month
}

/** "expense" = money out · "credit" = positive value added (money in). */
export type EntryKind = "expense" | "credit";

export interface ExpenseRecord {
  id: string;
  name: string;
  amount: number;
  kind: EntryKind;
  category: string;
  responsible: Responsible;
  joaoShare: number; // 0-100, share of João for "shared" expenses
  /** Exact amount person 1 paid for a shared bill (null = percentage split). */
  joaoPaid: number | null;
  /** Exact amount person 2 paid for a shared bill (null = percentage split). */
  annaPaid: number | null;
  dueDate: string | null; // "YYYY-MM-DD"
  paid: boolean;
  notes: string | null;
  month: string;
}

export interface MonthData {
  month: string;
  incomes: IncomeRecord[];
  expenses: ExpenseRecord[];
  availableMonths: string[];
}

// ─── Month helpers ────────────────────────────────────────────────────────────

/** "2026-11" from a Date (UTC-safe). */
export function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isValidMonth(month: string): boolean {
  return /^(\d{4})-(0[1-9]|1[0-2])$/.test(month);
}

/** Shift a "YYYY-MM" key by n months (negative allowed). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return toMonthKey(d);
}

/** Human label, e.g. "November 2026" ("Novembro de 2026" in pt-PT). */
export function monthLabel(month: string, locale = "en-GB"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function shortMonthLabel(month: string, locale = "en-GB"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

/** e.g. "Nov 18, 2026" ("18/11/2026" in pt-PT) for a due date. */
export function dueDateLabel(dueDate: string, locale = "en-GB"): string {
  const [y, m, d] = dueDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Parse a user-typed monetary amount, tolerant of both English
 * ("1,234.56") and Portuguese ("1.234,56") conventions.
 *
 * Strict on purpose (mirrors `parse_amount_input` in the Rust core):
 * `parseFloat` alone silently accepts "12;5" → 12, "1e9" → 1e9 and
 * "1.2.3.4" → 1.2, storing an amount the user never typed.
 */
export function parseAmountInput(raw: string): number {
  let s = raw.replace(/[€\s]/g, "");
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Both separators present: the right-most one is the decimal point.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma !== -1) {
    // Comma only: thousands groups ("1,234,567") vs decimal ("1234,5").
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  // Only a plain (optionally signed) decimal number survives.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
  const value = Number.parseFloat(s);
  return Number.isFinite(value) ? value : NaN;
}

/** Days until a due date relative to today (negative = overdue). */
export function daysUntil(dueDate: string): number {
  const [y, m, d] = dueDate.split("-").map(Number);
  const due = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((due - today) / 86_400_000);
}

// ─── Money helpers ────────────────────────────────────────────────────────────

export function fmtEur(value: number, roundTo0 = false, locale = "en-IE"): string {
  if (!Number.isFinite(value)) return "€0.00";
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    ...(roundTo0 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  });
  return format.format(value);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * How much of an expense is borne by `person`. Shared bills honour the exact
 * amounts each person paid when present (e.g. a €900 bill where person 1
 * paid €400 puts €400 on person 1 and €500 on person 2), otherwise the
 * split percentage applies (default 50/50, customizable).
 *
 * The percentage path rounds in INTEGER CENTS (exactly like the Rust core):
 * `round2(amount * share / 100)` in pure floats silently drifts — e.g.
 * 45.90 × 25% is 11.474999… as a double, rounding to 11.47, while the
 * cent-exact value 1147.5 must round half-up to 11.48.
 */
export function personShare(expense: ExpenseRecord, person: Person): number {
  if (expense.responsible === person) return expense.amount;
  if (expense.responsible === "shared") {
    if (
      expense.kind === "expense" &&
      expense.joaoPaid !== null &&
      expense.annaPaid !== null
    ) {
      return person === "joao" ? expense.joaoPaid : expense.annaPaid;
    }
    const share = person === "joao" ? expense.joaoShare : 100 - expense.joaoShare;
    const cents = Math.round(expense.amount * 100);
    return Math.round((cents * share) / 100) / 100;
  }
  return 0;
}

/**
 * Normalize the paid split of a shared bill so the two amounts always add
 * up to the bill total: the primary value (whichever was provided — usually
 * the one the user typed last) is kept (clamped to [0, amount]) and the
 * other person automatically covers the remainder. Returns null when no
 * usable paid value was provided.
 */
export function normalizePaidSplit(
  amount: number,
  joaoPaid: number | null | undefined,
  annaPaid: number | null | undefined,
): { joaoPaid: number; annaPaid: number } | null {
  if (!(amount > 0)) return null;
  if (joaoPaid != null && Number.isFinite(joaoPaid)) {
    const joao = Math.min(amount, Math.max(0, round2(joaoPaid)));
    return { joaoPaid: joao, annaPaid: round2(amount - joao) };
  }
  if (annaPaid != null && Number.isFinite(annaPaid)) {
    const anna = Math.min(amount, Math.max(0, round2(annaPaid)));
    return { joaoPaid: round2(amount - anna), annaPaid: anna };
  }
  return null;
}

/** Percentage share implied by the paid amounts (kept in sync for display). */
export function sharePercentFromPaid(joaoPaid: number, amount: number): number {
  if (!(amount > 0)) return 50;
  return Math.min(100, Math.max(0, Math.round((joaoPaid / amount) * 1000) / 10));
}

export interface PersonBreakdown {
  salary: number;
  mealCard: number;
  credits: number; // their share of "money in" entries
  income: number; // salary + meal card + credits
  personalExpenses: number;
  sharedExpenses: number;
  totalExpenses: number;
  available: number;
  committedPct: number; // % of income committed to expenses
  paidAmount: number; // of their share, already marked paid
  unpaidAmount: number;
}

export interface HouseholdSummary {
  joao: PersonBreakdown;
  anna: PersonBreakdown;
  totalIncome: number;
  totalExpenses: number;
  totalAvailable: number;
  paidExpenses: number;
  unpaidExpenses: number;
  unpaidCount: number;
  paidCount: number;
  expenseCount: number;
  upcoming: ExpenseRecord[]; // unpaid, sorted by due date
  overdue: ExpenseRecord[];
}

function breakdownFor(
  expenses: ExpenseRecord[],
  person: Person,
  salary: number,
  mealCard: number,
): PersonBreakdown {
  let personal = 0;
  let shared = 0;
  let paid = 0;
  let unpaid = 0;
  let credits = 0;
  for (const e of expenses) {
    const share = personShare(e, person);
    if (e.kind === "credit") {
      // Money in: adds to this person's income (shared credits split by %).
      credits += share;
      continue;
    }
    if (e.responsible === person) personal += share;
    else if (e.responsible === "shared") shared += share;
    if (e.paid) paid += share;
    else unpaid += share;
  }
  const total = round2(personal + shared);
  const income = round2(salary + mealCard + credits);
  return {
    salary: round2(salary),
    mealCard: round2(mealCard),
    credits: round2(credits),
    income,
    personalExpenses: round2(personal),
    sharedExpenses: round2(shared),
    totalExpenses: total,
    available: round2(income - total),
    committedPct: income > 0 ? Math.min(200, Math.round((total / income) * 100)) : 0,
    paidAmount: round2(paid),
    unpaidAmount: round2(unpaid),
  };
}

/**
 * Compute the full household summary for a month.
 * NOTE: every expense counts towards the balance regardless of `paid`
 * — payment status only tracks whether the bill was settled.
 * Credit entries ("money in") add to income instead of expenses; bill
 * statistics (unpaid, upcoming, overdue) only consider real expenses.
 */
export function computeSummary(
  expenses: ExpenseRecord[],
  incomes: IncomeRecord[],
): HouseholdSummary {
  const forPerson = (p: Person) => {
    const income = incomes.find((i) => i.person === p);
    return {
      salary: income?.amount ?? 0,
      mealCard: income?.mealCard ?? 0,
    };
  };

  const joaoIn = forPerson("joao");
  const annaIn = forPerson("anna");
  const joao = breakdownFor(expenses, "joao", joaoIn.salary, joaoIn.mealCard);
  const anna = breakdownFor(expenses, "anna", annaIn.salary, annaIn.mealCard);

  const bills = expenses.filter((e) => e.kind === "expense");
  const unpaid = bills.filter((e) => !e.paid);
  const withDue = unpaid.filter((e) => e.dueDate).sort(compareExpenseOrder);

  return {
    joao,
    anna,
    totalIncome: round2(joao.income + anna.income),
    totalExpenses: round2(joao.totalExpenses + anna.totalExpenses),
    totalAvailable: round2(joao.available + anna.available),
    paidExpenses: round2(joao.paidAmount + anna.paidAmount),
    unpaidExpenses: round2(joao.unpaidAmount + anna.unpaidAmount),
    unpaidCount: unpaid.length,
    paidCount: bills.length - unpaid.length,
    expenseCount: bills.length,
    upcoming: withDue,
    overdue: withDue.filter((e) => daysUntil(e.dueDate!) < 0),
  };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

/**
 * Deterministic list ordering used everywhere expenses are displayed:
 * due date first (earliest first, missing last), then name case-insensitively.
 *
 * Total order on purpose — the previous comparators returned `1` for equal
 * values (both for (a,b) and (b,a)), leaving the result engine-dependent.
 * Mirrors the Rust core: `ORDER BY (due_date IS NULL), due_date, name COLLATE NOCASE`.
 */
export function compareExpenseOrder(a: ExpenseRecord, b: ExpenseRecord): number {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
