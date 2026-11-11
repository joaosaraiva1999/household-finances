"use client";

import { motion } from "framer-motion";
import {
  Check,
  HandCoins,
  Pencil,
  Receipt,
  TrendingUp,
  UtensilsCrossed,
  User,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/components/providers/language-provider";
import {
  parseAmountInput,
  type Person,
  type PersonBreakdown,
} from "@/lib/finance";

interface PersonCardProps {
  person: Person;
  name: string;
  breakdown: PersonBreakdown | null;
  loading: boolean;
  saving: boolean;
  onSaveSalary: (person: Person, amount: number) => Promise<void>;
  onSaveMealCard: (person: Person, amount: number) => Promise<void>;
}

const ACCENTS: Record<
  Person,
  { avatar: string; avatarRing: string; bar: string; tint: string; inputRing: string }
> = {
  joao: {
    avatar: "bg-gradient-to-br from-sage-500 to-sage-700 text-white",
    avatarRing: "ring-4 ring-sage-500/10",
    bar: "[&_[data-slot=progress-indicator]]:bg-sage-500",
    tint: "text-sage-700 dark:text-sage-300",
    inputRing: "focus-visible:ring-sage-500/50",
  },
  anna: {
    avatar: "bg-gradient-to-br from-clay-500 to-clay-700 text-white",
    avatarRing: "ring-4 ring-clay-500/10",
    bar: "[&_[data-slot=progress-indicator]]:bg-clay-500",
    tint: "text-clay-700 dark:text-clay-300",
    inputRing: "focus-visible:ring-clay-500/50",
  },
};

export function PersonCard({
  person,
  name,
  breakdown,
  loading,
  saving,
  onSaveSalary,
  onSaveMealCard,
}: PersonCardProps) {
  const { toast } = useToast();
  const { t, fmt } = useLang();
  const accent = ACCENTS[person];
  const [salaryInput, setSalaryInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [mealInput, setMealInput] = useState("");
  const [editingMeal, setEditingMeal] = useState(false);

  const salary = breakdown?.salary ?? 0;
  const mealCard = breakdown?.mealCard ?? 0;

  // Initialize the inputs when the user enters edit mode (event-handler state
  // init instead of a state-syncing effect).
  const startEditing = () => {
    setSalaryInput(salary ? String(salary) : "");
    setEditing(true);
  };

  const startEditingMeal = () => {
    setMealInput(mealCard ? String(mealCard) : "");
    setEditingMeal(true);
  };

  const handleSave = async () => {
    const value = parseAmountInput(salaryInput);
    if (!Number.isFinite(value) || value < 0) {
      toast({
        title: t.invalidSalary,
        description: t.invalidSalaryDesc,
        variant: "destructive",
      });
      return;
    }
    await onSaveSalary(person, value);
    setEditing(false);
    toast({
      title: t.salaryUpdated(name),
      description: t.incomeSetTo(fmt.eur(value)),
    });
  };

  const handleSaveMeal = async () => {
    const value = parseAmountInput(mealInput);
    if (!Number.isFinite(value) || value < 0) {
      toast({
        title: t.invalidMealCard,
        description: t.invalidMealCardDesc,
        variant: "destructive",
      });
      return;
    }
    await onSaveMealCard(person, value);
    setEditingMeal(false);
    toast({
      title: t.mealCardUpdated(name),
      description: t.mealCardSetTo(fmt.eur(value)),
    });
  };

  if (loading || !breakdown) {
    return (
      <div className="glass space-y-5 rounded-3xl p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-36 rounded-full" />
          <Skeleton className="h-10 w-36 rounded-full" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const negative = breakdown.available < 0;
  const committedPct = Math.min(100, breakdown.committedPct);
  const overBudget = breakdown.committedPct > 100;
  const barClass = overBudget
    ? "[&_[data-slot=progress-indicator]]:bg-clay-500"
    : breakdown.committedPct > 70
      ? "[&_[data-slot=progress-indicator]]:bg-ochre-500"
      : accent.bar;
  const hasIncome = breakdown.income > 0;

  return (
    <motion.section
      aria-label={t.personFinancesAria(name)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="glass flex flex-col gap-5 rounded-3xl p-5 sm:p-6"
    >
      {/* Header: avatar + name */}
      <div className="flex items-center gap-4">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold shadow-soft-sm ${accent.avatar} ${accent.avatarRing}`}
          aria-hidden="true"
        >
          {name.charAt(0)}
        </div>
        <div>
          <h3 className="text-lg font-semibold leading-tight">{name}</h3>
          <p className="text-xs text-muted-foreground">{t.monthlyFinances}</p>
        </div>
      </div>

      {/* Editable income pills: salary + meal card */}
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                €
              </span>
              <input
                aria-label={t.salaryInputAria(name)}
                inputMode="decimal"
                autoFocus
                value={salaryInput}
                onChange={(e) => setSalaryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSave();
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="0.00"
                className={`h-10 w-32 rounded-full border border-input bg-card pl-8 pr-4 pt-1 pb-1 text-sm tabular-nums outline-none transition-shadow focus-visible:ring-2 ${accent.inputRing}`}
              />
            </div>
            <Button
              size="icon"
              aria-label={t.saveSalaryAria(name)}
              disabled={saving}
              onClick={() => void handleSave()}
              className="h-10 w-10 rounded-full"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t.cancelSalaryEdit}
              onClick={() => setEditing(false)}
              className="h-10 w-10 rounded-full text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            aria-label={t.editSalaryAria(name, fmt.eur(salary))}
            onClick={startEditing}
            className={`group flex h-10 items-center gap-1.5 rounded-full border border-dashed border-border bg-white/45 px-4 text-sm tabular-nums transition-colors hover:bg-white/75 dark:bg-white/[0.05] dark:hover:bg-white/[0.09] ${accent.tint}`}
          >
            <span className="font-semibold">{fmt.eur(salary)}</span>
            <span className="text-xs text-muted-foreground/80">{t.salaryPill}</span>
            <Pencil
              className="ml-0.5 h-3.5 w-3.5 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            />
          </button>
        )}

        {editingMeal ? (
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                €
              </span>
              <input
                aria-label={t.mealCardInputAria(name)}
                inputMode="decimal"
                autoFocus
                value={mealInput}
                onChange={(e) => setMealInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveMeal();
                  if (e.key === "Escape") setEditingMeal(false);
                }}
                placeholder="0.00"
                className="h-10 w-32 rounded-full border border-input bg-card pl-8 pr-4 pt-1 pb-1 text-sm tabular-nums outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-sage-500/50"
              />
            </div>
            <Button
              size="icon"
              aria-label={t.saveMealCardAria(name)}
              disabled={saving}
              onClick={() => void handleSaveMeal()}
              className="h-10 w-10 rounded-full"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t.cancelSalaryEdit}
              onClick={() => setEditingMeal(false)}
              className="h-10 w-10 rounded-full text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            aria-label={t.editMealCardAria(name, fmt.eur(mealCard))}
            onClick={startEditingMeal}
            className="group flex h-10 items-center gap-1.5 rounded-full border border-dashed border-border bg-white/45 px-4 text-sm tabular-nums transition-colors hover:bg-white/75 text-sage-700 dark:bg-white/[0.05] dark:hover:bg-white/[0.09] dark:text-sage-300"
          >
            <UtensilsCrossed
              className="h-3.5 w-3.5 text-muted-foreground/70"
              aria-hidden="true"
            />
            <span className="font-semibold">{fmt.eur(mealCard)}</span>
            <span className="text-xs text-muted-foreground/80">{t.mealCardPill}</span>
            <Pencil
              className="ml-0.5 h-3.5 w-3.5 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {/* Available money — the key number */}
      <div
        className={`rounded-2xl border p-5 ${
          negative
            ? "border-clay-500/30 bg-clay-500/5"
            : "border-sage-500/30 bg-sage-500/5"
        }`}
      >
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t.availableAfterExpenses}
        </p>
        <p
          className={`mt-1.5 text-4xl font-semibold tabular-nums ${
            negative ? "text-clay-600 dark:text-clay-400" : "text-sage-600 dark:text-sage-400"
          }`}
        >
          {fmt.eur(breakdown.available)}
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {negative
            ? t.overBudget(fmt.eur(Math.abs(breakdown.available)))
            : t.committedThisMonth(fmt.eur(breakdown.totalExpenses))}
        </p>
      </div>

      {/* Breakdown rows */}
      <dl className="grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
        <div className="glass-inset flex items-center gap-2.5 rounded-xl px-3.5 py-2.5">
          <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">{t.totalIncomeRow}</dt>
          <dd className="ml-auto font-semibold tabular-nums">
            {fmt.eur(breakdown.income)}
          </dd>
        </div>
        <div className="glass-inset flex items-center gap-2.5 rounded-xl px-3.5 py-2.5">
          <HandCoins className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">{t.creditsRow}</dt>
          <dd
            className={`ml-auto font-semibold tabular-nums ${
              breakdown.credits > 0
                ? "text-sage-600 dark:text-sage-400"
                : "text-muted-foreground"
            }`}
          >
            {breakdown.credits > 0 ? "+" : ""}
            {fmt.eur(breakdown.credits)}
          </dd>
        </div>
        <div className="glass-inset flex items-center gap-2.5 rounded-xl px-3.5 py-2.5">
          <User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">{t.personal}</dt>
          <dd className="ml-auto font-semibold tabular-nums">
            {fmt.eur(breakdown.personalExpenses)}
          </dd>
        </div>
        <div className="glass-inset flex items-center gap-2.5 rounded-xl px-3.5 py-2.5">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">{t.sharedShare}</dt>
          <dd className="ml-auto font-semibold tabular-nums">
            {fmt.eur(breakdown.sharedExpenses)}
          </dd>
        </div>
        <div className="glass-inset flex items-center gap-2.5 rounded-xl px-3.5 py-2.5">
          <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">{t.totalCommitted}</dt>
          <dd className="ml-auto font-semibold tabular-nums">
            {fmt.eur(breakdown.totalExpenses)}
          </dd>
        </div>
        <div className="glass-inset flex items-center gap-2.5 rounded-xl px-3.5 py-2.5">
          <Check className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">{t.paidUnpaid}</dt>
          <dd className="ml-auto font-semibold tabular-nums">
            <span className="text-sage-600 dark:text-sage-400">
              {fmt.eur(breakdown.paidAmount)}
            </span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-ochre-600 dark:text-ochre-400">
              {fmt.eur(breakdown.unpaidAmount)}
            </span>
          </dd>
        </div>
      </dl>

      {/* Progress: share of income committed */}
      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t.incomeCommitted}</span>
          <span className={`font-semibold tabular-nums ${overBudget ? "text-clay-600 dark:text-clay-400" : accent.tint}`}>
            {hasIncome ? `${breakdown.committedPct}%` : t.setSalary}
          </span>
        </div>
        <Progress
          value={hasIncome ? committedPct : 0}
          aria-label={t.committedPctAria(name, breakdown.committedPct)}
          className={`h-2.5 ${barClass}`}
        />
        {overBudget && hasIncome && (
          <p className="mt-1.5 text-xs font-medium text-clay-600 dark:text-clay-400">
            {t.expensesExceedBy(fmt.eur(Math.abs(breakdown.available)))}
          </p>
        )}
      </div>
    </motion.section>
  );
}
