import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  computeSummary,
  currentMonthKey,
  isValidMonth,
  toMonthKey,
  type ExpenseRecord,
  type IncomeRecord,
  type Person,
  type Responsible,
} from "@/lib/finance";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance?month=YYYY-MM
 * Returns incomes, expenses, computed summary and the list of months
 * that already have data (so the month picker can extend dynamically).
 */
export async function GET(request: NextRequest) {
  const monthParam = request.nextUrl.searchParams.get("month");
  const month = monthParam && isValidMonth(monthParam) ? monthParam : currentMonthKey();

  try {
    const [incomes, expenses, incomeMonths, expenseMonths] = await Promise.all([
      db.income.findMany({ where: { month } }),
      db.expense.findMany({ where: { month } }),
      db.income.findMany({ distinct: ["month"], select: { month: true } }),
      db.expense.findMany({ distinct: ["month"], select: { month: true } }),
    ]);

    const incomeRecords: IncomeRecord[] = incomes.map((i) => ({
      id: i.id,
      person: i.person as Person,
      month: i.month,
      amount: i.amount,
      mealCard: i.mealCard,
    }));
    const expenseRecords: ExpenseRecord[] = expenses
      .map((e) => ({
        id: e.id,
        name: e.name,
        amount: e.amount,
        kind: (e.kind === "credit" ? "credit" : "expense") as ExpenseRecord["kind"],
        category: e.category,
        responsible: e.responsible as Responsible,
        joaoShare: e.joaoShare,
        joaoPaid: e.joaoPaid,
        annaPaid: e.annaPaid,
        dueDate: e.dueDate,
        paid: e.paid,
        notes: e.notes,
        month: e.month,
      }))
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return a.name.localeCompare(b.name);
      });

    const dataMonths = new Set<string>([
      ...incomeMonths.map((m) => m.month),
      ...expenseMonths.map((m) => m.month),
    ]);
    dataMonths.add(currentMonthKey());
    const availableMonths = Array.from(dataMonths).sort();

    return NextResponse.json({
      month,
      incomes: incomeRecords,
      expenses: expenseRecords,
      availableMonths,
      summary: computeSummary(expenseRecords, incomeRecords),
      meta: { today: toMonthKey(new Date()) },
    });
  } catch (error) {
    console.error("GET /api/finance failed:", error);
    return NextResponse.json({ error: "Failed to load finance data" }, { status: 500 });
  }
}
