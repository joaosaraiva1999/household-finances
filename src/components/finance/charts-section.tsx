"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/components/providers/language-provider";
import { useNames } from "@/components/providers/names-provider";
import { compactEur } from "@/lib/i18n";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import { type ExpenseRecord, type HouseholdSummary } from "@/lib/finance";
import { CATEGORY_ICONS, FALLBACK_CATEGORY_ICON } from "@/lib/category-icons";

// Natural muted palette — sage, ochre, clay, moss and stone tones
const CAT_COLORS = [
  "#699070", // sage
  "#b98a3a", // ochre
  "#bb6c59", // clay
  "#a5c6ab", // light sage
  "#797f55", // moss
  "#80796f", // taupe
  "#cf8b79", // light clay
  "#dcbc8a", // light ochre
  "#6b6346", // sand
  "#365541", // forest
  "#928f88", // warm gray
];

const JOAO_COLOR = "#699070";
const ANNA_COLOR = "#bb6c59";

interface ChartsSectionProps {
  summary: HouseholdSummary | null;
  expenses: ExpenseRecord[];
  loading: boolean;
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  const { fmt } = useLang();
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl px-3 py-2 text-sm">
      {label != null && label !== "" && (
        <p className="mb-1 font-medium text-popover-foreground">{String(label)}</p>
      )}
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-center gap-2 text-popover-foreground">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span>{entry.name}:</span>
            <span className="ml-auto font-semibold tabular-nums">
              {fmt.eur(Number(entry.value ?? 0))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartsSection({ summary, expenses, loading }: ChartsSectionProps) {
  const { t, fmt, lang } = useLang();
  const { joaoName, annaName } = useNames();

  const comparison = useMemo(() => {
    if (!summary) return [];
    return [
      { group: t.groupIncome, [joaoName]: summary.joao.income, [annaName]: summary.anna.income },
      { group: t.groupExpenses, [joaoName]: summary.joao.totalExpenses, [annaName]: summary.anna.totalExpenses },
      { group: t.groupAvailable, [joaoName]: Math.max(0, summary.joao.available), [annaName]: Math.max(0, summary.anna.available) },
    ];
  }, [summary, t, joaoName, annaName]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      // Credits are money in — they don't belong in the expense breakdown.
      if (e.kind === "credit") continue;
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    const entries = Array.from(map.entries()).map(([name, value]) => ({
      name,
      value: Math.round(value * 100) / 100,
    }));
    const total = entries.reduce((s, c) => s + c.value, 0);
    return entries
      .sort((a, b) => b.value - a.value)
      .map((c) => ({
        name: fmt.category(c.name),
        key: c.name,
        value: c.value,
        pct: total > 0 ? Math.round((c.value / total) * 100) : 0,
      }));
  }, [expenses, fmt]);

  if (loading || !summary) {
    return (
      <section
        id="sec-charts"
        aria-label={t.atAGlance(joaoName, annaName)}
        className="grid scroll-mt-24 gap-4 lg:grid-cols-2"
      >
        <div className="glass rounded-3xl p-5 sm:p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-64 w-full" />
        </div>
        <div className="glass rounded-3xl p-5 sm:p-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-4 h-64 w-full" />
        </div>
      </section>
    );
  }

  return (
    <section
      id="sec-charts"
      aria-label={t.atAGlance(joaoName, annaName)}
      className="grid scroll-mt-24 gap-4 lg:grid-cols-2"
    >
      {/* Salary / expenses / available comparison */}
      <div className="glass rounded-3xl p-5 sm:p-6">
        <h3 className="text-lg font-semibold tracking-tight">{t.atAGlance(joaoName, annaName)}</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {t.chartSubtitle}
        </p>
        <div className="h-72 w-full" role="img" aria-label={t.barChartAria(joaoName, annaName)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparison} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
              <XAxis
                dataKey="group"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: "currentColor" }}
                className="text-muted-foreground"
              />
              <YAxis
                tickFormatter={(value: number) => compactEur(value, lang)}
                tickLine={false}
                axisLine={false}
                width={56}
                tick={{ fontSize: 11, fill: "currentColor" }}
                className="text-muted-foreground"
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(120,120,120,0.08)" }} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              <Bar dataKey={joaoName} fill={JOAO_COLOR} radius={[8, 8, 0, 0]} maxBarSize={56} />
              <Bar dataKey={annaName} fill={ANNA_COLOR} radius={[8, 8, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="glass rounded-3xl p-5 sm:p-6">
        <h3 className="text-lg font-semibold tracking-tight">{t.expensesByCategory}</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {t.categorySubtitle}
        </p>
        {byCategory.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            {t.noExpensesRecorded}
          </div>
        ) : (
          <div className="h-72 w-full" role="img" aria-label={t.pieChartAria}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byCategory}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="52%"
                  outerRadius="82%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {byCategory.map((entry, i) => (
                    <Cell key={entry.name} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value: string) => {
                    const entry = byCategory.find((c) => c.name === value);
                    const pct = entry?.pct ?? 0;
                    const Icon = CATEGORY_ICONS[entry?.key ?? ""] ?? FALLBACK_CATEGORY_ICON;
                    return (
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {value} ({pct}%)
                      </span>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}
