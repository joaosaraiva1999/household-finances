"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/components/providers/language-provider";
import { useNames } from "@/components/providers/names-provider";
import { CalendarClock, CheckCheck } from "lucide-react";
import { daysUntil, type HouseholdSummary } from "@/lib/finance";

interface UpcomingBillsProps {
  summary: HouseholdSummary | null;
  loading: boolean;
}

export function UpcomingBills({ summary, loading }: UpcomingBillsProps) {
  const { t, fmt } = useLang();
  const { personName } = useNames();

  if (loading || !summary) {
    return (
      <div className="glass rounded-3xl p-5 sm:p-6">
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const upcoming = summary.upcoming.slice(0, 6);
  const rest = summary.upcoming.length - upcoming.length;

  const dueMeta = (dueDate: string): { label: string; cls: string } => {
    const dayDiff = daysUntil(dueDate);
    const label = fmt.dateWeekday(dueDate);

    if (dayDiff < 0) return { label: t.overdueWithDate(label), cls: "bg-clay-500/10 text-clay-600 dark:text-clay-400" };
    if (dayDiff === 0) return { label: t.dueToday, cls: "bg-ochre-500/15 text-ochre-700 dark:text-ochre-400" };
    if (dayDiff <= 7)
      return { label: t.inDaysWithDate(dayDiff, label), cls: "bg-ochre-500/15 text-ochre-700 dark:text-ochre-400" };
    return { label, cls: "bg-muted text-muted-foreground" };
  };

  return (
    <div
      id="sec-upcoming"
      className="glass flex scroll-mt-24 flex-col rounded-3xl p-5 sm:p-6"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-tight">{t.upcomingBills}</h3>
        {summary.overdue.length > 0 && (
          <span className="inline-flex items-center rounded-full border border-clay-500/30 bg-clay-500/10 px-2.5 py-1 text-xs font-medium text-clay-600 dark:text-clay-400">
            {t.overdueCount(summary.overdue.length)}
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {summary.unpaidCount > 0
          ? t.stillToPay(fmt.eur(summary.unpaidExpenses))
          : t.nothingPending}
      </p>

      {summary.unpaidCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <CheckCheck className="h-8 w-8 text-sage-500" aria-hidden="true" />
          <p className="font-medium">{t.everyBillPaid}</p>
          <p className="text-sm text-muted-foreground">{t.noUpcomingPayments}</p>
        </div>
      ) : upcoming.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t.noDueDates}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {upcoming.map((e) => {
            const meta = e.dueDate ? dueMeta(e.dueDate) : null;
            const overdue = e.dueDate ? daysUntil(e.dueDate) < 0 : false;
            return (
              <li
                key={e.id}
                className={`flex items-center gap-3.5 rounded-2xl px-3.5 py-3 transition-colors ${
                  overdue
                    ? "bg-clay-500/[0.08] ring-1 ring-inset ring-clay-500/30 hover:bg-clay-500/[0.12]"
                    : "glass-inset hover:bg-white/70 dark:hover:bg-white/[0.1]"
                }`}
              >
                <div className="glass-inset flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  {meta ? (
                    <span className={`mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                  ) : (
                    <span className="mt-1 inline-block text-xs text-muted-foreground">{t.noDueDate}</span>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{fmt.eur(e.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.responsible === "shared"
                      ? t.shared
                      : personName(e.responsible)}
                  </p>
                </div>
              </li>
            );
          })}
          {rest > 0 && (
            <li className="pt-1 text-center text-xs text-muted-foreground">
              {t.moreUnpaid(rest)}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
