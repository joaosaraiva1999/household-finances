import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentMonthKey, isValidMonth, type Person } from "@/lib/finance";

export const dynamic = "force-dynamic";

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * POST /api/income — create or update a person's monthly income fields.
 * Body: {
 *   person: "joao" | "anna",
 *   month: "YYYY-MM",
 *   amount?: number   // monthly salary
 *   mealCard?: number // meal card money (e.g. cartão-refeição)
 * }
 * At least one of amount/mealCard must be provided; omitted fields keep
 * their current value (or default to 0 on create).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { person, month } = body ?? {};

    if (person !== "joao" && person !== "anna") {
      return NextResponse.json({ error: "Invalid person" }, { status: 400 });
    }
    const targetMonth =
      typeof month === "string" && isValidMonth(month) ? month : currentMonthKey();

    const hasAmount = body.amount !== undefined && body.amount !== null;
    const hasMealCard = body.mealCard !== undefined && body.mealCard !== null;
    if (!hasAmount && !hasMealCard) {
      return NextResponse.json(
        { error: "Provide amount or mealCard" },
        { status: 400 },
      );
    }

    const parseField = (raw: unknown): number | null => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 100_000_000) return null;
      return round2(value);
    };

    const existing = await db.income.findUnique({
      where: { person_month: { person: person as Person, month: targetMonth } },
    });

    let amount = existing?.amount ?? 0;
    let mealCard = existing?.mealCard ?? 0;
    if (hasAmount) {
      const parsed = parseField(body.amount);
      if (parsed === null) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
      }
      amount = parsed;
    }
    if (hasMealCard) {
      const parsed = parseField(body.mealCard);
      if (parsed === null) {
        return NextResponse.json({ error: "Invalid mealCard" }, { status: 400 });
      }
      mealCard = parsed;
    }

    const income = await db.income.upsert({
      where: { person_month: { person: person as Person, month: targetMonth } },
      create: { person, month: targetMonth, amount, mealCard },
      update: { amount, mealCard },
    });

    return NextResponse.json({ income });
  } catch (error) {
    console.error("POST /api/income failed:", error);
    return NextResponse.json({ error: "Failed to save income" }, { status: 500 });
  }
}
