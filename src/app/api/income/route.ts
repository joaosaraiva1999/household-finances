import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentMonthKey } from "@/lib/finance";
import { firstIssue, incomeUpsertSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/income — create or update a person's monthly income fields.
 * Body validated by `incomeUpsertSchema`: person is a closed enum, month a
 * real "YYYY-MM", amounts finite numbers in [0, 100M]. At least one of
 * amount/mealCard must be provided; omitted fields keep their current value.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = incomeUpsertSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const input = parsed.data;
    const person = input.person;
    const targetMonth = input.month || currentMonthKey();

    const existing = await db.income.findUnique({
      where: { person_month: { person, month: targetMonth } },
    });

    let amount = existing?.amount ?? 0;
    let mealCard = existing?.mealCard ?? 0;
    if (input.amount !== undefined && input.amount !== null) amount = input.amount;
    if (input.mealCard !== undefined && input.mealCard !== null) mealCard = input.mealCard;

    const income = await db.income.upsert({
      where: { person_month: { person, month: targetMonth } },
      create: { person, month: targetMonth, amount, mealCard },
      update: { amount, mealCard },
    });

    return NextResponse.json({ income });
  } catch (error) {
    console.error("POST /api/income failed:", error);
    return NextResponse.json({ error: "Failed to save income" }, { status: 500 });
  }
}
