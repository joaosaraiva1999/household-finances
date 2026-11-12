import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  currentMonthKey,
  normalizePaidSplit,
  sharePercentFromPaid,
} from "@/lib/finance";
import { expenseCreateSchema, firstIssue } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/expenses — create a new expense.
 * The body is validated by `expenseCreateSchema` (see src/lib/validation.ts):
 * unknown fields are stripped, strings cleaned and length-capped, enums and
 * amounts strictly checked — before anything reaches the database.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = expenseCreateSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const input = parsed.data;

    // Invalid or missing month falls back to the current month.
    const month = input.month || currentMonthKey();

    // Shared bills may store the exact amount each person paid. The value
    // provided (usually the one typed last) is kept and the other person
    // automatically covers the remainder, so both add up to the bill total.
    let joaoShare: number;
    let joaoPaid: number | null = null;
    let annaPaid: number | null = null;
    if (input.responsible !== "shared") {
      joaoShare = input.responsible === "joao" ? 100 : 0;
    } else if (input.kind === "expense") {
      const split = normalizePaidSplit(input.amount, input.joaoPaid, input.annaPaid);
      if (split) {
        joaoPaid = split.joaoPaid;
        annaPaid = split.annaPaid;
        joaoShare = sharePercentFromPaid(joaoPaid, input.amount);
      } else {
        joaoShare = input.joaoShare ?? 50;
      }
    } else {
      joaoShare = input.joaoShare ?? 50;
    }

    const expense = await db.expense.create({
      data: {
        name: input.name,
        amount: input.amount,
        kind: input.kind,
        category: input.category,
        responsible: input.responsible,
        joaoShare,
        joaoPaid,
        annaPaid,
        dueDate: input.dueDate ?? null,
        notes: input.notes ?? null,
        paid: input.paid,
        month,
      },
    });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    console.error("POST /api/expenses failed:", error);
    return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });
  }
}
