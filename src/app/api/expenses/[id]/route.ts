import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  CATEGORIES,
  normalizePaidSplit,
  round2,
  sharePercentFromPaid,
} from "@/lib/finance";

export const dynamic = "force-dynamic";

const RESPONSIBLES = ["joao", "anna", "shared"];

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH /api/expenses/[id] — update any field of an expense. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const existing = await db.expense.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      data.name = name.slice(0, 120);
    }

    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
      }
      data.amount = Math.round(amount * 100) / 100;
    }

    if (body.kind !== undefined) {
      const kind = String(body.kind);
      if (!["expense", "credit"].includes(kind)) {
        return NextResponse.json({ error: "Invalid entry type" }, { status: 400 });
      }
      data.kind = kind;
    }

    if (body.responsible !== undefined) {
      const responsible = String(body.responsible);
      if (!RESPONSIBLES.includes(responsible)) {
        return NextResponse.json({ error: "Invalid responsible" }, { status: 400 });
      }
      data.responsible = responsible;
    }

    if (body.joaoShare !== undefined || data.responsible !== undefined) {
      const responsible = (data.responsible as string | undefined) ?? existing.responsible;
      if (responsible !== "shared") {
        data.joaoShare = responsible === "joao" ? 100 : 0;
      } else {
        const raw = Number(body.joaoShare ?? existing.joaoShare);
        const share = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 50;
        data.joaoShare = Math.round(share * 10) / 10;
      }
    }

    if (body.category !== undefined) {
      const category = String(body.category);
      data.category = (CATEGORIES as readonly string[]).includes(category)
        ? category
        : "Other";
    }

    if (body.dueDate !== undefined) {
      const due = body.dueDate;
      data.dueDate =
        typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
    }

    if (body.paid !== undefined) {
      data.paid = Boolean(body.paid);
    }

    if (body.notes !== undefined) {
      data.notes =
        typeof body.notes === "string" && body.notes.trim()
          ? body.notes.trim().slice(0, 500)
          : null;
    }

    // ─── Per-person paid amounts (shared bills, money out) ─────────────
    // Effective values after applying the patch above.
    const effAmount = (data.amount as number | undefined) ?? existing.amount;
    const effResponsible =
      (data.responsible as string | undefined) ?? existing.responsible;
    const effKind = (data.kind as string | undefined) ?? existing.kind;

    if (effResponsible === "shared" && effKind === "expense") {
      const rawJoao = body.joaoPaid == null ? null : Number(body.joaoPaid);
      const rawAnna = body.annaPaid == null ? null : Number(body.annaPaid);
      const split = normalizePaidSplit(effAmount, rawJoao, rawAnna);
      if (split) {
        // Explicit paid amounts: keep the provided value, the other person
        // automatically covers the remainder of the bill.
        data.joaoPaid = split.joaoPaid;
        data.annaPaid = split.annaPaid;
        data.joaoShare = sharePercentFromPaid(split.joaoPaid, effAmount);
      } else if (
        data.amount !== undefined &&
        existing.joaoPaid !== null &&
        existing.annaPaid !== null
      ) {
        // Amount changed without new paid values: rescale the stored split
        // proportionally so the two amounts still add up.
        const scaledJoao = round2((existing.joaoPaid / existing.amount) * effAmount);
        const rescaled = normalizePaidSplit(effAmount, scaledJoao, null);
        if (rescaled) {
          data.joaoPaid = rescaled.joaoPaid;
          data.annaPaid = rescaled.annaPaid;
          data.joaoShare = sharePercentFromPaid(rescaled.joaoPaid, effAmount);
        }
      }
    } else if (
      (data.responsible !== undefined || data.kind !== undefined) &&
      (existing.joaoPaid !== null || existing.annaPaid !== null)
    ) {
      // Attribution changed away from "shared" or the entry became a credit:
      // paid amounts no longer apply.
      data.joaoPaid = null;
      data.annaPaid = null;
    }

    const expense = await db.expense.update({ where: { id }, data });
    return NextResponse.json({ expense });
  } catch (error) {
    console.error("PATCH /api/expenses/[id] failed:", error);
    return NextResponse.json({ error: "Failed to update expense" }, { status: 500 });
  }
}

/** DELETE /api/expenses/[id] — remove an expense. */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const existing = await db.expense.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }
    await db.expense.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/expenses/[id] failed:", error);
    return NextResponse.json({ error: "Failed to delete expense" }, { status: 500 });
  }
}
