"use client";

import { motion } from "framer-motion";
import {
  AlertCircle,
  PiggyBank,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/components/providers/language-provider";
import { useNames } from "@/components/providers/names-provider";
import type { HouseholdSummary } from "@/lib/finance";

interface SummaryCardsProps {
  summary: HouseholdSummary | null;
  loading: boolean;
}

const cardBase =
  "glass relative overflow-hidden rounded-3xl p-5 sm:p-6";

export function SummaryCards({ summary, loading }: SummaryCardsProps) {
  const { t, fmt } = useLang();
  const { joaoName, annaName } = useNames();

  if (loading || !summary) {
    return (
      <section aria-label={t.householdIncome} className="grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${cardBase} space-y-3`}>
            <Skeleton className="h-11 w-11 rounded-2xl" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </section>
    );
  }

  const s = summary;
  const cards = [
    {
      id: "income",
      label: t.householdIncome,
      value: fmt.eur(s.totalIncome, s.totalIncome % 1 === 0),
      sub: `${joaoName} ${fmt.eur(s.joao.income)} · ${annaName} ${fmt.eur(s.anna.income)}`,
      icon: TrendingUp,
      iconBg: "bg-sage-500/10 text-sage-600 dark:text-sage-400",
      accent: "from-sage-500/15",
      color: "",
      highlight: false,
    },
    {
      id: "expenses",
      label: t.monthlyExpenses,
      value: fmt.eur(s.totalExpenses, s.totalExpenses % 1 === 0),
      sub: t.billsUnpaid(s.expenseCount, fmt.eur(s.unpaidExpenses)),
      icon: Receipt,
      iconBg: "bg-ochre-500/10 text-ochre-600 dark:text-ochre-400",
      accent: "from-ochre-500/15",
      color: "",
      highlight: false,
    },
    {
      id: "remaining",
      label: t.moneyRemaining,
      value: fmt.eur(s.totalAvailable, s.totalAvailable % 1 === 0),
      sub: `${joaoName} ${fmt.eur(s.joao.available)} · ${annaName} ${fmt.eur(s.anna.available)}`,
      icon: PiggyBank,
      iconBg:
        s.totalAvailable >= 0
          ? "bg-sage-500/10 text-sage-600 dark:text-sage-400"
          : "bg-clay-500/10 text-clay-600 dark:text-clay-400",
      accent: s.totalAvailable >= 0 ? "from-sage-500/15" : "from-clay-500/15",
      color:
        s.totalAvailable >= 0
          ? "text-sage-600 dark:text-sage-400"
          : "text-clay-600 dark:text-clay-400",
      highlight: true,
    },
    {
      id: "unpaid",
      label: t.unpaidBills,
      value: String(s.unpaidCount),
      sub:
        s.overdue.length > 0
          ? t.overduePaySoon(s.overdue.length)
          : t.stillToSettle(fmt.eur(s.unpaidExpenses)),
      icon: AlertCircle,
      iconBg:
        s.unpaidCount > 0
          ? "bg-clay-500/10 text-clay-600 dark:text-clay-400"
          : "bg-sage-500/10 text-sage-600 dark:text-sage-400",
      accent: s.unpaidCount > 0 ? "from-clay-500/15" : "from-sage-500/15",
      color:
        s.unpaidCount > 0
          ? "text-clay-600 dark:text-clay-400"
          : "text-sage-600 dark:text-sage-400",
      highlight: false,
    },
  ];

  return (
    <section aria-label={t.householdIncome} className="grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
      {cards.map((card, i) => (
        <motion.div
          key={card.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.05, ease: "easeOut" }}
          className={cardBase}
        >
          {/* Highlight halo on its own layer — a ring utility here would
              overwrite the glass inset-ring box-shadow. */}
          {card.highlight && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-sage-500/40"
            />
          )}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${card.accent} to-transparent`}
            aria-hidden="true"
          />
          <div className="relative flex flex-col gap-2.5">
            <div className={`glass-inset flex h-11 w-11 items-center justify-center rounded-2xl ${card.iconBg}`}>
              <card.icon className="h-[1.2rem] w-[1.2rem]" aria-hidden="true" />
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {card.label}
            </p>
            <p className={`text-2xl font-semibold tabular-nums sm:text-[1.7rem] ${card.color}`}>
              {card.value}
            </p>
            <p className="text-xs text-muted-foreground">{card.sub}</p>
          </div>
        </motion.div>
      ))}
    </section>
  );
}
