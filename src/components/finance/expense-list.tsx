"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/components/providers/language-provider";
import { nameInitial, useNames } from "@/components/providers/names-provider";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownLeft,
  CalendarDays,
  CheckCircle2,
  Circle,
  HandCoins,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  CATEGORIES,
  daysUntil,
  personShare,
  round2,
  type ExpenseRecord,
  type Person,
} from "@/lib/finance";
import { CATEGORY_ICONS, FALLBACK_CATEGORY_ICON } from "@/lib/category-icons";

export type ExpenseFilters = {
  person: "all" | "joao" | "anna" | "shared";
  category: "all" | string;
  status: "all" | "paid" | "unpaid";
  /** Free-text search over entry names, notes and categories. */
  search: string;
};

interface ExpenseListProps {
  expenses: ExpenseRecord[] | null;
  month: string;
  loading: boolean;
  filters: ExpenseFilters;
  onFiltersChange: (filters: ExpenseFilters) => void;
  onAdd: () => void;
  onEdit: (expense: ExpenseRecord) => void;
  onTogglePaid: (expense: ExpenseRecord) => void;
  onDelete: (expense: ExpenseRecord) => Promise<void>;
}

function DueChip({ expense }: { expense: ExpenseRecord }) {
  const { t, fmt } = useLang();
  // Only unpaid bills need a due-date warning; settled ones don't.
  if (!expense.dueDate || expense.paid) return null;
  const days = daysUntil(expense.dueDate);
  const label = fmt.dateShort(expense.dueDate);

  let cls = "bg-muted text-muted-foreground";
  let text = label;
  if (days < 0) {
    cls = "bg-clay-500/10 text-clay-600 dark:text-clay-400";
    text = t.overdueDays(-days);
  } else if (days === 0) {
    cls = "bg-ochre-500/15 text-ochre-700 dark:text-ochre-400";
    text = t.dueToday;
  } else if (days <= 7) {
    cls = "bg-ochre-500/15 text-ochre-700 dark:text-ochre-400";
    text = t.inDays(days);
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      <CalendarDays className="h-3 w-3" aria-hidden="true" />
      {text}
    </span>
  );
}

/** Who the entry belongs to — avatar chip in the reference design's style. */
function ResponsibleChip({ expense }: { expense: ExpenseRecord }) {
  const { t } = useLang();
  const { joaoName, annaName } = useNames();
  if (expense.responsible === "shared") {
    const split =
      expense.joaoShare === 50
        ? null
        : `${expense.joaoShare}/${100 - expense.joaoShare}`;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-ochre-500/30 bg-ochre-500/10 py-0.5 pl-0.5 pr-2.5">
        <span className="flex -space-x-1.5" aria-hidden="true">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-sage-500 to-sage-700 text-[10px] font-bold text-white ring-1 ring-card">
            {nameInitial(joaoName)}
          </span>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-clay-500 to-clay-700 text-[10px] font-bold text-white ring-1 ring-card">
            {nameInitial(annaName)}
          </span>
        </span>
        <span className="text-xs font-medium text-ochre-700 dark:text-ochre-300">
          {t.sharedSplit(split)}
        </span>
      </span>
    );
  }
  const isJoao = expense.responsible === "joao";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 ${
        isJoao
          ? "border-sage-500/30 bg-sage-500/10"
          : "border-clay-500/30 bg-clay-500/10"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
          isJoao
            ? "bg-gradient-to-br from-sage-500 to-sage-700"
            : "bg-gradient-to-br from-clay-500 to-clay-700"
        }`}
      >
        {nameInitial(isJoao ? joaoName : annaName)}
      </span>
      <span
        className={`text-xs font-medium ${
          isJoao
            ? "text-sage-700 dark:text-sage-300"
            : "text-clay-700 dark:text-clay-300"
        }`}
      >
        {isJoao ? joaoName : annaName}
      </span>
    </span>
  );
}

export function ExpenseList({
  expenses,
  month,
  loading,
  filters,
  onFiltersChange,
  onAdd,
  onEdit,
  onTogglePaid,
  onDelete,
}: ExpenseListProps) {
  const { t, fmt } = useLang();
  const { joaoName, annaName } = useNames();
  const [pendingDelete, setPendingDelete] = useState<ExpenseRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    if (!expenses) return null;
    const q = filters.search.trim().toLowerCase();
    return expenses.filter((e) => {
      // Free-text search matches names, notes and categories.
      if (q) {
        const haystack = `${e.name} ${e.notes ?? ""} ${e.category}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filters.person !== "all" && e.responsible !== filters.person) return false;
      // Credits (money in) have no category or payment status — hide them
      // while those filters are active so results stay predictable.
      if (e.kind === "credit") {
        return filters.category === "all" && filters.status === "all";
      }
      if (filters.category !== "all" && e.category !== filters.category) return false;
      if (filters.status !== "all" && (filters.status === "paid") !== e.paid) return false;
      return true;
    });
  }, [expenses, filters]);

  const { filteredExpenses, filteredCredits } = useMemo(() => {
    let expensesSum = 0;
    let creditsSum = 0;
    for (const e of filtered ?? []) {
      if (e.kind === "credit") creditsSum += e.amount;
      else expensesSum += e.amount;
    }
    return {
      filteredExpenses: round2(expensesSum),
      filteredCredits: round2(creditsSum),
    };
  }, [filtered]);

  const noExpensesAtAll = (expenses ?? []).length === 0;
  const searchActive = filters.search.trim() !== "";

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const hasActiveFilters =
    filters.person !== "all" || filters.category !== "all" || filters.status !== "all";

  return (
    <section aria-label={t.expensesForMonthAria(fmt.month(month))} className="space-y-4">
      {/* Section header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {t.billsExpenses}
            <span className="ml-2.5 text-sm font-normal text-muted-foreground">
              {fmt.month(month)}
            </span>
          </h2>
          {!loading && filtered && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {filteredCredits > 0
                ? t.itemsWithCredits(
                    filtered.length,
                    fmt.eur(filteredExpenses),
                    fmt.eur(filteredCredits),
                  )
                : t.itemsTotal(filtered.length, fmt.eur(filteredExpenses))}
            </p>
          )}
        </div>
        <Button
          onClick={onAdd}
          variant="outline"
          className="h-10 gap-1.5 rounded-full px-4 shadow-soft-sm"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t.addEntry}
        </Button>
      </div>

      {/* Filters */}
      <div
        role="search"
        aria-label={t.filterExpenses}
        className="glass flex flex-wrap items-center gap-2 rounded-2xl p-2"
      >
        <Select
          value={filters.person}
          onValueChange={(v) => onFiltersChange({ ...filters, person: v as ExpenseFilters["person"] })}
        >
          <SelectTrigger
            aria-label={t.filterByPerson}
            className="glass-inset h-9 w-[10.5rem] rounded-full border-transparent bg-white/45 text-sm shadow-none dark:bg-white/[0.06]"
          >
            <SelectValue placeholder={t.allPersons} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.allPersons}</SelectItem>
            <SelectItem value="joao">{joaoName}</SelectItem>
            <SelectItem value="anna">{annaName}</SelectItem>
            <SelectItem value="shared">{t.shared}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.category}
          onValueChange={(v) => onFiltersChange({ ...filters, category: v })}
        >
          <SelectTrigger
            aria-label={t.filterByCategory}
            className="glass-inset h-9 w-[12rem] rounded-full border-transparent bg-white/45 text-sm shadow-none dark:bg-white/[0.06]"
          >
            <SelectValue placeholder={t.allCategories} />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="all">{t.allCategories}</SelectItem>
            {CATEGORIES.map((cat) => {
              const Icon = CATEGORY_ICONS[cat] ?? FALLBACK_CATEGORY_ICON;
              return (
                <SelectItem key={cat} value={cat}>
                  <Icon className="mr-1.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {fmt.category(cat)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(v) => onFiltersChange({ ...filters, status: v as ExpenseFilters["status"] })}
        >
          <SelectTrigger
            aria-label={t.filterByStatus}
            className="glass-inset h-9 w-[10.5rem] rounded-full border-transparent bg-white/45 text-sm shadow-none dark:bg-white/[0.06]"
          >
            <SelectValue placeholder={t.allStatuses} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.allStatuses}</SelectItem>
            <SelectItem value="paid">{t.paid}</SelectItem>
            <SelectItem value="unpaid">{t.unpaid}</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-full px-3 text-muted-foreground"
            onClick={() => onFiltersChange({ ...filters, person: "all", category: "all", status: "all" })}
          >
            {t.clearFilters}
          </Button>
        )}
      </div>

      {/* List */}
      <div className="glass overflow-hidden rounded-3xl">
        {loading || !filtered ? (
          <div className="divide-y divide-border/60">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-4 sm:p-5">
                <Skeleton className="h-6 w-6 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-52" />
                </div>
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              {noExpensesAtAll ? (
                <Plus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Circle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <p className="font-medium">
              {noExpensesAtAll
                ? t.noExpensesYet(fmt.month(month))
                : searchActive
                  ? t.noMatchSearch
                  : t.noMatchFilters}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {noExpensesAtAll ? t.emptyHintNew(joaoName, annaName) : t.emptyHintFilters}
            </p>
            {noExpensesAtAll && (
              <Button
                onClick={onAdd}
                variant="outline"
                className="mt-1 gap-1.5 rounded-full shadow-soft-sm"
              >
                <Plus className="h-4 w-4" /> {t.addFirstExpense}
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            <AnimatePresence initial={false}>
              {filtered.map((expense) => {
                const joaoShare = personShare(expense, "joao" as Person);
                const annaShare = personShare(expense, "anna" as Person);
                const isCredit = expense.kind === "credit";
                return (
                  <motion.li
                    key={expense.id}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div
                      className={`flex flex-wrap items-center gap-x-3 gap-y-2 p-4 transition-colors sm:flex-nowrap sm:p-5 ${
                        isCredit
                          ? "bg-sage-500/[0.04] hover:bg-sage-500/[0.08]"
                          : expense.paid
                            ? "bg-muted/30"
                            : "hover:bg-muted/40"
                      }`}
                    >
                      {/* Paid toggle (expenses) / money-in marker (credits) */}
                      {isCredit ? (
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage-500/15"
                          aria-hidden="true"
                        >
                          <ArrowDownLeft className="h-4 w-4 text-sage-600 dark:text-sage-400" />
                        </span>
                      ) : (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={expense.paid}
                          aria-label={t.markPaidAria(expense.name, expense.paid)}
                          onClick={() => onTogglePaid(expense)}
                          className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {expense.paid ? (
                            <CheckCircle2
                              className="h-6 w-6 text-sage-500 transition-transform hover:scale-110"
                              aria-hidden="true"
                            />
                          ) : (
                            <Circle
                              className="h-6 w-6 text-muted-foreground/50 transition-transform hover:scale-110"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      )}

                      {/* Name + meta */}
                      <div className="min-w-0 flex-1 basis-48">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`font-medium ${
                              !isCredit && expense.paid
                                ? "text-muted-foreground line-through decoration-muted-foreground/40"
                                : ""
                            }`}
                          >
                            {expense.name}
                          </span>
                          {!isCredit && <DueChip expense={expense} />}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {isCredit ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-sage-500/30 bg-sage-500/10 px-2.5 py-1 text-xs font-medium text-sage-700 dark:text-sage-300">
                              <HandCoins className="h-3 w-3" aria-hidden="true" />
                              {t.creditBadge}
                            </span>
                          ) : (
                            <span className="glass-inset inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground">
                              {(() => {
                                const Icon = CATEGORY_ICONS[expense.category] ?? FALLBACK_CATEGORY_ICON;
                                return <Icon className="h-3 w-3" aria-hidden="true" />;
                              })()}
                              {fmt.category(expense.category)}
                            </span>
                          )}
                          <ResponsibleChip expense={expense} />
                          {expense.notes && (
                            <span className="max-w-full truncate text-xs text-muted-foreground" title={expense.notes}>
                              {expense.notes}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Amount + per-person split */}
                      <div className="ml-auto text-right">
                        <p
                          className={`font-semibold tabular-nums ${
                            isCredit
                              ? "text-sage-600 dark:text-sage-400"
                              : expense.paid
                                ? "text-muted-foreground"
                                : ""
                          }`}
                        >
                          {isCredit ? (
                            <>
                              <span aria-hidden="true">+</span>
                              <span className="sr-only">
                                {t.creditMoneyInAria(expense.name, fmt.eur(expense.amount))}
                              </span>
                              {fmt.eur(expense.amount)}
                            </>
                          ) : (
                            <>
                              <span aria-hidden="true" className="opacity-50">−</span>
                              {fmt.eur(expense.amount)}
                            </>
                          )}
                        </p>
                        {expense.responsible === "shared" && (
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            {nameInitial(joaoName)} {isCredit ? "+" : ""}{fmt.eur(joaoShare)} · {nameInitial(annaName)} {isCredit ? "+" : ""}{fmt.eur(annaShare)}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t.editExpenseAria(expense.name)}
                          className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                          onClick={() => onEdit(expense)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t.deleteExpenseAria(expense.name)}
                          className="h-9 w-9 rounded-full text-muted-foreground hover:text-clay-600"
                          onClick={() => setPendingDelete(expense)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteExpenseTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete &&
                t.deleteExpenseDesc(
                  pendingDelete.name,
                  fmt.eur(pendingDelete.amount),
                  fmt.month(month),
                )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="rounded-full">
              {t.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              className="rounded-full bg-clay-600 text-white hover:bg-clay-700 focus-visible:ring-clay-500"
              disabled={deleting}
            >
              {t.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
