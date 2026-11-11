import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  CATEGORIES,
  currentMonthKey,
  isValidMonth,
  normalizePaidSplit,
  sharePercentFromPaid,
} from "@/lib/finance";

export const dynamic = "force-dynamic";

const RESPONSIBLES = ["joao", "anna", "shared"];
const KINDS = ["expense", "credit"];

function sanitize(body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim();
  if (!name) return { error: "Expense name is required" as const };
  if (name.length > 120) return { error: "Name is too long" as const };

  const amountRaw = Number(body.amount);
  if (!Number.isFinite(amountRaw) || amountRaw <= 0 || amountRaw > 10_000_000) {
    return { error: "Amount must be a positive number" as const };
  }
  const amount = Math.round(amountRaw * 100) / 100;

  const kind = String(body.kind ?? "expense");
  if (!KINDS.includes(kind)) {
    return { error: "Invalid entry type" as const };
  }

  const responsible = String(body.responsible ?? "shared");
  if (!RESPONSIBLES.includes(responsible)) {
    return { error: "Invalid responsible person" as const };
  }

  let joaoShare = Number(body.joaoShare);
  if (!Number.isFinite(joaoShare)) joaoShare = 50;
  if (responsible !== "shared") joaoShare = responsible === "joao" ? 100 : 0;
  joaoShare = Math.min(100, Math.max(0, Math.round(joaoShare * 10) / 10));

  // Shared bills may store the exact amount each person paid. The value
  // provided (usually the one typed last) is kept and the other person
  // automatically covers the remainder, so both add up to the bill total.
  let joaoPaid: number | null = null;
  let annaPaid: number | null = null;
  if (responsible === "shared" && kind === "expense") {
    const rawJoao = body.joaoPaid == null ? null : Number(body.joaoPaid);
    const rawAnna = body.annaPaid == null ? null : Number(body.annaPaid);
    const split = normalizePaidSplit(amount, rawJoao, rawAnna);
    if (split) {
      joaoPaid = split.joaoPaid;
      annaPaid = split.annaPaid;
      joaoShare = sharePercentFromPaid(joaoPaid, amount);
    }
  }

  const category = String(body.category ?? "Other");
  const validCategory = (CATEGORIES as readonly string[]).includes(category)
    ? category
    : "Other";

  const month =
    typeof body.month === "string" && isValidMonth(body.month)
      ? body.month
      : currentMonthKey();

  let dueDate: string | null = null;
  if (typeof body.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
    dueDate = body.dueDate;
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim().slice(0, 500)
      : null;

  const paid = Boolean(body.paid);

  return {
    data: {
      name,
      amount,
      kind,
      category: validCategory,
      responsible,
      joaoShare,
      joaoPaid,
      annaPaid,
      dueDate,
      notes,
      paid,
      month,
    },
  };
}

/** POST /api/expenses — create a new expense. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = sanitize(body ?? {});
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const expense = await db.expense.create({ data: result.data });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    console.error("POST /api/expenses failed:", error);
    return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });
  }
}
