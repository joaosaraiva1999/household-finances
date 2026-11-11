"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MonthData } from "@/lib/finance";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface FinanceResponse extends MonthData {
  summary: import("@/lib/finance").HouseholdSummary;
  meta: { today: string };
}

/** Load all finance data for a given month. */
export function useFinance(month: string) {
  return useQuery<FinanceResponse>({
    queryKey: ["finance", month],
    queryFn: () => fetchJson(`/api/finance?month=${month}`),
  });
}

/** Create / update a person's monthly income fields (salary and/or meal card). */
export function useSetIncome(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      vars: { person: "joao" | "anna"; amount?: number; mealCard?: number },
    ) =>
      fetchJson<{ income: unknown }>("/api/income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...vars, month }),
      }),
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
      fetchJson<{ expense: unknown }>("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...vars, month }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance"] }),
  });
}

/** Update an existing expense (any field, incl. paid toggle). */
export function useUpdateExpense(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<ExpenseInput>) =>
      fetchJson<{ expense: unknown }>(`/api/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance"] }),
  });
}

/** Delete an expense. */
export function useDeleteExpense(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ ok: boolean }>(`/api/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance"] }),
  });
}
