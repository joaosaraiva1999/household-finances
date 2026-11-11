"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLang } from "@/components/providers/language-provider";
import { isValidMonth, shiftMonth } from "@/lib/finance";

interface PageHeroProps {
  month: string;
  availableMonths: string[];
  onMonthChange: (month: string) => void;
}

/**
 * Big page title + month picker, in the style of the reference design's
 * panel headers ("Planned Absences" + "December 15, 2025 ⌄").
 */
export function PageHero({ month, availableMonths, onMonthChange }: PageHeroProps) {
  const { t, fmt } = useLang();

  // Build a sensible picker range: from one year before the earliest data
  // month up to one month after the current one.
  const options = useMemo(() => {
    const current = new Date();
    const currentKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
    const withData: string[] = availableMonths.filter(isValidMonth);
    const min = withData.length
      ? withData.reduce((a, b) => (a < b ? a : b))
      : currentKey;
    const max = [currentKey, ...withData].reduce((a, b) => (a > b ? a : b));

    const list: string[] = [];
    let cursor = shiftMonth(min, -12);
    const end = shiftMonth(max, 1);
    while (cursor <= end && list.length < 120) {
      list.push(cursor);
      cursor = shiftMonth(cursor, 1);
    }
    return list;
  }, [availableMonths]);

  const idx = options.indexOf(month);
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < options.length - 1;

  return (
    <section className="mt-7 sm:mt-9">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        {/* Big title — eyebrow shows the month context */}
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {fmt.month(month)}
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t.dashboardTitle}
          </h1>
        </div>

        {/* Month pill picker, like the reference's date control */}
        <nav aria-label={t.selectMonth} className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="hidden h-11 w-11 rounded-full sm:inline-flex"
            aria-label={t.previousMonth}
            disabled={!canPrev}
            onClick={() => onMonthChange(options[idx - 1])}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select value={month} onValueChange={onMonthChange}>
            <SelectTrigger
              aria-label={t.selectMonth}
              className="glass h-11 w-[12.5rem] rounded-full border-white/70 bg-white/55 text-sm font-medium shadow-none sm:w-[14rem] dark:border-white/15 dark:bg-white/[0.07]"
            >
              <SelectValue>{fmt.month(month)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {options.map((m) => (
                <SelectItem key={m} value={m}>
                  {fmt.month(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="hidden h-11 w-11 rounded-full sm:inline-flex"
            aria-label={t.nextMonth}
            disabled={!canNext}
            onClick={() => onMonthChange(options[idx + 1])}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      </div>
    </section>
  );
}
