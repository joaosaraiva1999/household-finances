import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizePaidSplit, round2, sharePercentFromPaid } from "@/lib/finance";
import { expensePatchSchema, firstIssue, idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH /api/expenses/[id] — update any field of an expense. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const rawId = (await context.params).id;
    const id = idSchema.safeParse(rawId);
    if (!id.success) {
      return NextResponse.json({ error: "Invalid expense id" }, { status: 400 });
    }

    const existing = await db.expense.findUnique({ where: { id: id.data } });
    if (!existing) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = expensePatchSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const patch = parsed.data;

    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.amount !== undefined) data.amount = patch.amount;
    if (patch.kind !== undefined) data.kind = patch.kind;
    if (patch.responsible !== undefined) data.responsible = patch.responsible;

    if (patch.joaoShare !== undefined || data.responsible !== undefined) {
      const responsible =
        (data.responsible as string | undefined) ?? existing.responsible;
      if (responsible !== "shared") {
        data.joaoShare = responsible === "joao" ? 100 : 0;
      } else {
        data.joaoShare = patch.joaoShare ?? existing.joaoShare;
      }
    }

    if (patch.category !== undefined) data.category = patch.category;
    if (patch.dueDate !== undefined) data.dueDate = patch.dueDate ?? null;
    if (patch.paid !== undefined) data.paid = patch.paid;
    if (patch.notes !== undefined) data.notes = patch.notes ?? null;

    // ─── Per-person paid amounts (shared bills, money out) ─────────────
    // Effective values after applying the patch above.
    const effAmount = (data.amount as number | undefined) ?? existing.amount;
    const effResponsible =
      (data.responsible as string | undefined) ?? existing.responsible;
    const effKind = (data.kind as string | undefined) ?? existing.kind;

    if (effResponsible === "shared" && effKind === "expense") {
      const split = normalizePaidSplit(effAmount, patch.joaoPaid, patch.annaPaid);
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

    const expense = await db.expense.update({ where: { id: id.data }, data });
    return NextResponse.json({ expense });
  } catch (error) {
    console.error("PATCH /api/expenses/[id] failed:", error);
    return NextResponse.json({ error: "Failed to update expense" }, { status: 500 });
  }
}

/** DELETE /api/expenses/[id] — remove an expense. */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const rawId = (await context.params).id;
    const id = idSchema.safeParse(rawId);
    if (!id.success) {
      return NextResponse.json({ error: "Invalid expense id" }, { status: 400 });
    }

    const existing = await db.expense.findUnique({ where: { id: id.data } });
    if (!existing) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }
    await db.expense.delete({ where: { id: id.data } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/expenses/[id] failed:", error);
    return NextResponse.json({ error: "Failed to delete expense" }, { status: 500 });
  }
}
