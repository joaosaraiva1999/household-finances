"use client";

import { PersonCard } from "@/components/finance/person-card";
import { FinanceSidebar } from "@/components/finance/sidebar";
import { PageHero } from "@/components/finance/page-hero";
import { SummaryCards } from "@/components/finance/summary-cards";
import { ChartsSection } from "@/components/finance/charts-section";
import { UpcomingBills } from "@/components/finance/upcoming-bills";
import { Onboarding } from "@/components/finance/onboarding";
import { AuroraBackdrop } from "@/components/finance/aurora-backdrop";
import { ExpenseDialog, type ExpenseFormValues } from "@/components/finance/expense-dialog";
import { ExpenseList, type ExpenseFilters } from "@/components/finance/expense-list";
import { useLang } from "@/components/providers/language-provider";
import { useNames } from "@/components/providers/names-provider";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateExpense,
  useDeleteExpense,
  useFinance,
  useSetIncome,
  useUpdateExpense,
} from "@/hooks/use-finance";
import { currentMonthKey, type ExpenseRecord, type Person } from "@/lib/finance";

export default function Home() {
  const [month, setMonth] = useState(() => currentMonthKey());
  const [filters, setFilters] = useState<ExpenseFilters>({
    person: "all",
    category: "all",
    status: "all",
    search: "",
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);

  const { toast } = useToast();
  const { t, fmt } = useLang();
  const { joaoName, annaName, onboarded } = useNames();
  const { data, isLoading, isError, refetch } = useFinance(month);

  const setIncome = useSetIncome(month);
  const createExpense = useCreateExpense(month);
  const updateExpense = useUpdateExpense(month);
  const deleteExpense = useDeleteExpense(month);

  const summary = data?.summary ?? null;
  const expenses = data?.expenses ?? [];

  const handleSaveSalary = async (person: Person, amount: number) => {
    try {
      await setIncome.mutateAsync({ person, amount });
    } catch (error) {
      toast({
        title: t.couldNotSaveSalary,
        description: error instanceof Error ? error.message : t.tryAgain,
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleSaveMealCard = async (person: Person, amount: number) => {
    try {
      await setIncome.mutateAsync({ person, mealCard: amount });
    } catch (error) {
      toast({
        title: t.couldNotSaveSalary,
        description: error instanceof Error ? error.message : t.tryAgain,
        variant: "destructive",
      });
      throw error;
    }
  };

  const openAddDialog = () => {
    setEditingExpense(null);
    setDialogOpen(true);
  };

  const openEditDialog = (expense: ExpenseRecord) => {
    setEditingExpense(expense);
    setDialogOpen(true);
  };

  const handleDialogSave = async (values: ExpenseFormValues) => {
    try {
      if (editingExpense) {
        await updateExpense.mutateAsync({ id: editingExpense.id, ...values });
        toast({
          title: t.expenseUpdated,
          description: t.savedForMonth(values.name, fmt.month(month)),
        });
      } else {
        await createExpense.mutateAsync(values);
        if (values.kind === "credit") {
          toast({
            title: t.creditAdded,
            description: t.addedCreditToMonth(
              values.name,
              fmt.eur(values.amount),
              fmt.month(month),
            ),
          });
        } else {
          toast({
            title: t.expenseAdded,
            description: t.addedToMonth(
              values.name,
              fmt.eur(values.amount),
              fmt.month(month),
            ),
          });
        }
      }
      setDialogOpen(false);
      setEditingExpense(null);
    } catch (error) {
      toast({
        title: t.couldNotSaveExpense,
        description: error instanceof Error ? error.message : t.tryAgain,
        variant: "destructive",
      });
    }
  };

  const handleTogglePaid = async (expense: ExpenseRecord) => {
    try {
      await updateExpense.mutateAsync({
        id: expense.id,
        paid: !expense.paid,
      });
      toast({
        title: expense.paid ? t.markedUnpaid : t.markedPaid,
        description: expense.paid ? t.reopened(expense.name) : t.settled(expense.name),
      });
    } catch (error) {
      toast({
        title: t.couldNotUpdateStatus,
        description: error instanceof Error ? error.message : t.tryAgain,
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (expense: ExpenseRecord) => {
    try {
      await deleteExpense.mutateAsync(expense.id);
      toast({
        title: t.expenseDeleted,
        description: t.removedFromMonth(expense.name, fmt.month(month)),
      });
    } catch (error) {
      toast({
        title: t.couldNotDelete,
        description: error instanceof Error ? error.message : t.tryAgain,
        variant: "destructive",
      });
    }
  };

  // First-run gate: until the two persons are named, show the welcome screen.
  if (!onboarded) {
    return <Onboarding />;
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Aurora backdrop — soft colour fields the glass surfaces diffuse */}
      <AuroraBackdrop />

      <FinanceSidebar
        onAdd={openAddDialog}
        search={filters.search}
        onSearchChange={(value) => setFilters((f) => ({ ...f, search: value }))}
      />

      {/* Content column — shifted right by the fixed sidebar on md+ */}
      <div className="flex min-h-screen flex-col md:pl-64">
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
        <PageHero
          month={month}
          availableMonths={data?.availableMonths ?? []}
          onMonthChange={setMonth}
        />

        {isError ? (
          <div className="glass mx-auto mt-16 flex max-w-md flex-col items-center gap-4 rounded-3xl p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-clay-500/10">
              <AlertCircle className="h-6 w-6 text-clay-500" aria-hidden="true" />
            </div>
            <p className="font-medium">{t.loadError}</p>
            <p className="text-sm text-muted-foreground">{t.loadErrorHint}</p>
            <Button onClick={() => refetch()} variant="outline" className="gap-1.5 rounded-full">
              <RefreshCw className="h-4 w-4" /> {t.retry}
            </Button>
          </div>
        ) : (
          <div className="mt-10 space-y-10">
            {/* Top: month totals */}
            <div id="sec-overview" className="scroll-mt-24">
              <SummaryCards summary={summary} loading={isLoading} />
            </div>

            {/* Per-person areas */}
            <section
              id="sec-people"
              aria-label={t.personalFinancesAria}
              className="scroll-mt-24 grid gap-4 lg:grid-cols-2"
            >
              <PersonCard
                person="joao"
                name={joaoName}
                breakdown={summary?.joao ?? null}
                loading={isLoading}
                saving={setIncome.isPending}
                onSaveSalary={handleSaveSalary}
                onSaveMealCard={handleSaveMealCard}
              />
              <PersonCard
                person="anna"
                name={annaName}
                breakdown={summary?.anna ?? null}
                loading={isLoading}
                saving={setIncome.isPending}
                onSaveSalary={handleSaveSalary}
                onSaveMealCard={handleSaveMealCard}
              />
            </section>

            {/* Expense manager */}
            <div id="sec-bills" className="scroll-mt-24">
              <ExpenseList
                expenses={data ? expenses : null}
                month={month}
                loading={isLoading}
                filters={filters}
                onFiltersChange={setFilters}
                onAdd={openAddDialog}
                onEdit={openEditDialog}
                onTogglePaid={handleTogglePaid}
                onDelete={handleDelete}
              />
            </div>

            {/* Visual overview */}
            <ChartsSection summary={summary} expenses={expenses} loading={isLoading} />

            {/* Upcoming bills */}
            <UpcomingBills summary={summary} loading={isLoading} />
          </div>
        )}
        </main>

        <footer className="glass mt-auto rounded-none py-4">
          <p className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground sm:px-6">
            {t.footerNote(joaoName, annaName)}
          </p>
        </footer>
      </div>

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editingExpense}
        month={month}
        saving={createExpense.isPending || updateExpense.isPending}
        onSave={handleDialogSave}
      />
    </div>
  );
}
