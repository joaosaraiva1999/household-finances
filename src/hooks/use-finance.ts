"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { read, write } from "@/lib/transport";
import type { MonthData } from "@/lib/finance";

/**
 * Data layer for the household finances app.
 *
 * Every hook transparently works in both builds: the browser talks to the
 * Next.js API routes (`/api/*`), the Tauri desktop build invokes the Rust
 * commands of `finances-core`. Both backends return identical JSON shapes
 * (pinned by the Rust golden tests in `crates/finances-core/src/view.rs`
 * and the cross-version parity suite in `tests/`), so components do not
 * need to know which one is active.
 */

export interface FinanceResponse extends MonthData {
  summary: import("@/lib/finance").HouseholdSummary;
  meta: { today: string };
}

/** Load all finance data for a given month. */
export function useFinance(month: string) {
  return useQuery<FinanceResponse>({
    queryKey: ["finance", month],
    queryFn: () => read<FinanceResponse>(`/api/finance?month=${month}`, "get_month_data", { month }),
  });
}

/** Create / update a person's monthly income fields (salary and/or meal card). */
export function useSetIncome(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      vars: { person: "joao" | "anna"; amount?: number; mealCard?: number },
    ) =>
      write<{ income: unknown }>(
        "/api/income",
        "POST",
        { ...vars, month },
        "save_income",
        { input: { ...vars, month } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance"] }),
  });
}

export interface ExpenseInput {
  name: string;
  amount: number;
  kind: "expense" | "credit";
  category: string;
  responsible: "joao" | "anna" | "shared";
  joaoShare: number;
  /** Exact amounts paid per person for shared bills (money out). */
  joaoPaid?: number | null;
  annaPaid?: number | null;
  dueDate: string | null;
  paid?: boolean;
  notes?: string | null;
}

/** Create an expense for the month. */
export function useCreateExpense(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: ExpenseInput) =>
      write<{ expense: unknown }>(
        "/api/expenses",
        "POST",
        { ...vars, month },
        "create_expense",
        { input: { ...vars, month } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance"] }),
  });
}

/** Update an existing expense (any field, incl. paid toggle). */
export function useUpdateExpense(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<ExpenseInput>) =>
      write<{ expense: unknown }>(
        `/api/expenses/${id}`,
        "PATCH",
        patch,
        "update_expense",
        { id, patch },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance"] }),
  });
}

/** Delete an expense. */
export function useDeleteExpense(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      write<{ ok: boolean }>(
        `/api/expenses/${id}`,
        "DELETE",
        undefined,
        "delete_expense",
        { id },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance"] }),
  });
}
