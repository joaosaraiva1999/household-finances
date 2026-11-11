"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/components/providers/language-provider";
import { useNames } from "@/components/providers/names-provider";
import {
  CATEGORIES,
  normalizePaidSplit,
  parseAmountInput,
  round2,
  sharePercentFromPaid,
  type EntryKind,
  type ExpenseRecord,
  type Responsible,
} from "@/lib/finance";
import { CATEGORY_ICONS, FALLBACK_CATEGORY_ICON } from "@/lib/category-icons";

export interface ExpenseFormValues {
  name: string;
  amount: number;
  kind: EntryKind;
  category: string;
  responsible: Responsible;
  joaoShare: number;
  /** Exact amounts paid per person for shared bills (money out). */
  joaoPaid: number | null;
  annaPaid: number | null;
  dueDate: string | null;
  paid: boolean;
  notes: string | null;
}

interface ExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ExpenseRecord | null;
  month: string;
  saving: boolean;
  onSave: (values: ExpenseFormValues) => Promise<void>;
}

interface FormState {
  name: string;
  amount: string;
  kind: EntryKind;
  category: string;
  responsible: Responsible;
  joaoShare: number;
  /** Paid-amount inputs for shared bills (strings while typing). */
  joaoPaid: string;
  annaPaid: string;
  dueDate: string;
  paid: boolean;
  notes: string;
}

const emptyForm: FormState = {
  name: "",
  amount: "",
  kind: "expense",
  category: "Housing",
  responsible: "shared",
  joaoShare: 50,
  joaoPaid: "",
  annaPaid: "",
  dueDate: "",
  paid: false,
  notes: "",
};

function toFormState(expense: ExpenseRecord | null): FormState {
  if (!expense) return { ...emptyForm };
  // Prefill the paid amounts of shared bills so the inputs always show the
  // effective split (stored values, or the percentage-derived ones).
  let joaoPaid = "";
  let annaPaid = "";
  if (expense.responsible === "shared" && expense.kind === "expense") {
    if (expense.joaoPaid !== null && expense.annaPaid !== null) {
      joaoPaid = String(expense.joaoPaid);
      annaPaid = String(expense.annaPaid);
    } else {
      const joao = round2((expense.amount * expense.joaoShare) / 100);
      joaoPaid = String(joao);
      annaPaid = String(round2(expense.amount - joao));
    }
  }
  return {
    name: expense.name,
    amount: String(expense.amount),
    kind: expense.kind,
    category: expense.category,
    responsible: expense.responsible,
    joaoShare: expense.joaoShare,
    joaoPaid,
    annaPaid,
    dueDate: expense.dueDate ?? "",
    paid: expense.paid,
    notes: expense.notes ?? "",
  };
}

export function ExpenseDialog({
  open,
  onOpenChange,
  initial,
  month,
  saving,
  onSave,
}: ExpenseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[1.5rem] sm:max-w-lg">
        {/* Inner component so the form state resets on every open
            (Radix unmounts content when the dialog closes). */}
        <ExpenseForm
          initial={initial}
          month={month}
          saving={saving}
          onSave={onSave}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ExpenseForm({
  initial,
  month,
  saving,
  onSave,
  onCancel,
}: {
  initial: ExpenseRecord | null;
  month: string;
  saving: boolean;
  onSave: (values: ExpenseFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, fmt } = useLang();
  const { joaoName, annaName } = useNames();
  const [form, setForm] = useState<FormState>(() => toFormState(initial));
  const [error, setError] = useState<string | null>(null);
  // Which paid input the user typed last — its value is kept and the other
  // person's amount adjusts automatically (bill − typed value).
  const [lastPaidEdited, setLastPaidEdited] = useState<"joao" | "anna" | null>(
    null,
  );

  const personOptions: { id: Responsible; label: string }[] = [
    { id: "joao", label: joaoName },
    { id: "anna", label: annaName },
    { id: "shared", label: t.shared },
  ];

  const amountNum = useMemo(() => parseAmountInput(form.amount), [form.amount]);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const isCredit = form.kind === "credit";
  const isSharedExpense = form.responsible === "shared" && !isCredit;

  const splitPreview = useMemo(() => {
    if (!validAmount) return null;
    const joaoAmt = round2((amountNum * form.joaoShare) / 100);
    return { joaoAmt, annaAmt: round2(amountNum - joaoAmt) };
  }, [validAmount, amountNum, form.joaoShare]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // ─── Paid-amount auto-adjustment (shared bills) ─────────────────────────
  // Editing any of the three values (bill, person 1's amount, person 2's
  // amount) recalculates the others instantly — no reload, no round trip.

  const handleAmountChange = (value: string) => {
    const total = parseAmountInput(value);
    if (!isSharedExpense || !(total > 0)) {
      set("amount", value);
      return;
    }
    const joaoPaidNum = parseAmountInput(form.joaoPaid);
    const annaPaidNum = parseAmountInput(form.annaPaid);
    const joaoKnown = Number.isFinite(joaoPaidNum) && joaoPaidNum >= 0;
    const annaKnown = Number.isFinite(annaPaidNum) && annaPaidNum >= 0;
    let joaoStr = form.joaoPaid;
    let annaStr = form.annaPaid;
    let share = 50;
    if (lastPaidEdited === "joao" && joaoKnown) {
      // Person 1 keeps what they paid; person 2 covers the rest.
      annaStr = String(round2(Math.max(0, total - joaoPaidNum)));
      share = sharePercentFromPaid(joaoPaidNum, total);
    } else if (lastPaidEdited === "anna" && annaKnown) {
      // Person 2 keeps what they paid; person 1 covers the rest.
      const joao = Math.max(0, total - annaPaidNum);
      joaoStr = String(round2(joao));
      share = sharePercentFromPaid(joao, total);
    } else if (joaoKnown && annaKnown && amountNum > 0) {
      // Nobody typed a paid amount yet: keep the current ratio.
      const joao = round2((joaoPaidNum / amountNum) * total);
      joaoStr = String(joao);
      annaStr = String(round2(total - joao));
      share = sharePercentFromPaid(joao, total);
    } else if (joaoKnown) {
      annaStr = String(round2(Math.max(0, total - joaoPaidNum)));
      share = sharePercentFromPaid(joaoPaidNum, total);
    } else if (annaKnown) {
      const joao = Math.max(0, total - annaPaidNum);
      joaoStr = String(round2(joao));
      share = sharePercentFromPaid(joao, total);
    } else {
      // Fresh shared bill: start from the default 50/50.
      const joao = round2(total / 2);
      joaoStr = String(joao);
      annaStr = String(round2(total - joao));
    }
    setForm((f) => ({
      ...f,
      amount: value,
      joaoShare: share,
      joaoPaid: joaoStr,
      annaPaid: annaStr,
    }));
  };

  const handleJoaoPaidChange = (value: string) => {
    setLastPaidEdited("joao");
    setForm((f) => {
      const next = { ...f, joaoPaid: value };
      const total = parseAmountInput(f.amount);
      const paid = parseAmountInput(value);
      if (!(total > 0) || !Number.isFinite(paid) || paid < 0) return next;
      // Person 2 automatically pays the remainder of the bill.
      next.annaPaid = String(round2(Math.max(0, total - paid)));
      next.joaoShare = sharePercentFromPaid(paid, total);
      return next;
    });
  };

  const handleAnnaPaidChange = (value: string) => {
    setLastPaidEdited("anna");
    setForm((f) => {
      const next = { ...f, annaPaid: value };
      const total = parseAmountInput(f.amount);
      const paid = parseAmountInput(value);
      if (!(total > 0) || !Number.isFinite(paid) || paid < 0) return next;
      // Person 1 automatically pays the remainder of the bill.
      const joao = Math.max(0, total - paid);
      next.joaoPaid = String(round2(joao));
      next.joaoShare = sharePercentFromPaid(joao, total);
      return next;
    });
  };

  /** Slider drag: paid amounts follow the percentage. */
  const handleSliderChange = (share: number) => {
    setForm((f) => {
      const next = { ...f, joaoShare: share };
      const total = parseAmountInput(f.amount);
      if (f.responsible === "shared" && f.kind === "expense" && total > 0) {
        const joao = round2((total * share) / 100);
        next.joaoPaid = String(joao);
        next.annaPaid = String(round2(total - joao));
      }
      return next;
    });
    setLastPaidEdited(null);
  };

  const handleResponsibleChange = (id: Responsible) => {
    setForm((f) => {
      const next = { ...f, responsible: id };
      const total = parseAmountInput(f.amount);
      // Selecting "Shared" starts from the default 50/50 split.
      if (id === "shared" && f.kind === "expense" && total > 0) {
        const joao = round2(total / 2);
        next.joaoShare = 50;
        next.joaoPaid = String(joao);
        next.annaPaid = String(round2(total - joao));
      }
      return next;
    });
    if (id === "shared") setLastPaidEdited(null);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError(t.nameRequired);
      return;
    }
    if (!validAmount) {
      setError(t.amountRequired);
      return;
    }
    setError(null);
    // Shared bills: guarantee the two paid amounts add up to the bill total
    // (the value typed last wins, the other person covers the remainder).
    let joaoPaidOut: number | null = null;
    let annaPaidOut: number | null = null;
    if (isSharedExpense) {
      const split = normalizePaidSplit(
        round2(amountNum),
        parseAmountInput(form.joaoPaid),
        parseAmountInput(form.annaPaid),
      );
      if (split) {
        joaoPaidOut = split.joaoPaid;
        annaPaidOut = split.annaPaid;
      } else {
        // No usable paid input — derive concrete amounts from the split %.
        const joao = round2((amountNum * form.joaoShare) / 100);
        joaoPaidOut = joao;
        annaPaidOut = round2(amountNum - joao);
      }
    }
    await onSave({
      name: form.name.trim(),
      amount: round2(amountNum),
      kind: form.kind,
      category: isCredit ? "Other" : form.category,
      responsible: form.responsible,
      joaoShare: form.responsible === "shared" ? form.joaoShare : form.responsible === "joao" ? 100 : 0,
      joaoPaid: joaoPaidOut,
      annaPaid: annaPaidOut,
      dueDate: isCredit ? null : form.dueDate || null,
      paid: isCredit ? true : form.paid,
      notes: form.notes.trim() || null,
    });
  };

  const typeOptions: { id: EntryKind; sign: string; label: string; hint: string; cls: string }[] = [
    {
      id: "expense",
      sign: "−",
      label: t.typeExpense,
      hint: t.typeExpenseHint,
      cls: "border-ochre-500 bg-ochre-500/10 text-ochre-700 dark:text-ochre-300",
    },
    {
      id: "credit",
      sign: "+",
      label: t.typeCredit,
      hint: t.typeCreditHint,
      cls: "border-sage-500 bg-sage-500/10 text-sage-700 dark:text-sage-300",
    },
  ];

  return (
    <>
      <DialogHeader>
          <DialogTitle>
            {initial ? t.editExpense : isCredit ? t.addCredit : t.addExpense}
          </DialogTitle>
          <DialogDescription>
            {initial
              ? t.updateExpenseFor(initial.name, fmt.month(month))
              : isCredit
                ? t.trackNewCredit(fmt.month(month))
                : t.trackNewBill(fmt.month(month))}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          {/* Entry type — select − value (money out) or + value (money in) */}
          <div className="grid gap-1.5">
            <Label>{t.entryType}</Label>
            <div
              role="radiogroup"
              aria-label={t.entryTypeAria}
              className="grid grid-cols-2 gap-2"
            >
              {typeOptions.map((opt) => {
                const active = form.kind === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => set("kind", opt.id)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                      active
                        ? `${opt.cls} shadow-sm`
                        : "border-border bg-transparent text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg font-bold leading-none ${
                        active
                          ? opt.id === "expense"
                            ? "bg-ochre-500/20 text-ochre-700 dark:text-ochre-300"
                            : "bg-sage-500/20 text-sage-700 dark:text-sage-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {opt.sign}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold leading-tight">{opt.label}</span>
                      <span
                        className={`text-[11px] font-normal leading-tight ${
                          active ? "opacity-80" : "text-muted-foreground/70"
                        }`}
                      >
                        {opt.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name + amount */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-1.5">
              <Label htmlFor="expense-name">{t.nameLabel}</Label>
              <Input
                id="expense-name"
                placeholder={t.namePlaceholder}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="expense-amount">{t.amountLabel}</Label>
              <div className="relative">
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-base font-bold ${
                    isCredit
                      ? "text-sage-600 dark:text-sage-400"
                      : "text-ochre-600 dark:text-ochre-400"
                  }`}
                >
                  {isCredit ? "+" : "−"}
                </span>
                <Input
                  id="expense-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-full pl-7 sm:w-32"
                  value={form.amount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Responsible person — segment control */}
          <div className="grid gap-1.5">
            <Label>{t.responsible}</Label>
            <div
              role="radiogroup"
              aria-label={t.responsibleAria}
              className="grid grid-cols-3 gap-2"
            >
              {personOptions.map((opt) => {
                const active = form.responsible === opt.id;
                const color =
                  opt.id === "joao"
                    ? "border-sage-500 bg-sage-500/10 text-sage-700 dark:text-sage-300"
                    : opt.id === "anna"
                      ? "border-clay-500 bg-clay-500/10 text-clay-700 dark:text-clay-300"
                      : "border-ochre-500 bg-ochre-500/10 text-ochre-700 dark:text-ochre-300";
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => handleResponsibleChange(opt.id)}
                    className={`h-11 rounded-xl border text-sm font-medium transition-all ${
                      active
                        ? `${color} shadow-sm`
                        : "border-border bg-transparent text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Shared split — the percentage and each person's paid amount stay
              in sync. For bills, the paid amounts can be typed directly and
              the other adjusts automatically so both add up to the bill. */}
          {form.responsible === "shared" && (
            <div className="rounded-2xl border border-ochre-500/30 bg-ochre-500/5 p-5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="split-slider" className="text-sm">
                  {isSharedExpense ? t.sharedPaidTitle : t.splitLabel(joaoName, annaName)}
                </Label>
                <span className="text-sm font-semibold tabular-nums">
                  {form.joaoShare}% / {round2(100 - form.joaoShare)}%
                </span>
              </div>

              {/* Per-person paid amounts (bills only — credits split by %) */}
              {isSharedExpense && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="paid-joao" className="text-xs font-normal text-muted-foreground">
                      {t.paidLabel(joaoName)}
                    </Label>
                    <div className="relative">
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm font-bold text-sage-600 dark:text-sage-400"
                      >
                        €
                      </span>
                      <Input
                        id="paid-joao"
                        inputMode="decimal"
                        placeholder="0.00"
                        className="pl-8"
                        value={form.joaoPaid}
                        onChange={(e) => handleJoaoPaidChange(e.target.value)}
                        disabled={!validAmount}
                        aria-label={t.paidInputAria(joaoName)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="paid-anna" className="text-xs font-normal text-muted-foreground">
                      {t.paidLabel(annaName)}
                    </Label>
                    <div className="relative">
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm font-bold text-clay-600 dark:text-clay-400"
                      >
                        €
                      </span>
                      <Input
                        id="paid-anna"
                        inputMode="decimal"
                        placeholder="0.00"
                        className="pl-8"
                        value={form.annaPaid}
                        onChange={(e) => handleAnnaPaidChange(e.target.value)}
                        disabled={!validAmount}
                        aria-label={t.paidInputAria(annaName)}
                      />
                    </div>
                  </div>
                </div>
              )}

              <Slider
                id="split-slider"
                className={isSharedExpense ? "mt-4" : "mt-3"}
                min={0}
                max={100}
                step={5}
                value={[form.joaoShare]}
                onValueChange={([v]) => handleSliderChange(v)}
                aria-label={t.joaoShareAria(joaoName)}
              />

              {isSharedExpense ? (
                <p className="mt-2 text-xs text-muted-foreground">{t.paidAutoHint}</p>
              ) : (
                <>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-sage-700 dark:text-sage-300">
                      {joaoName}: <strong className="tabular-nums">{splitPreview ? "+" + fmt.eur(splitPreview.joaoAmt) : "—"}</strong>
                    </span>
                    <span className="text-clay-700 dark:text-clay-300">
                      {annaName}: <strong className="tabular-nums">{splitPreview ? "+" + fmt.eur(splitPreview.annaAmt) : "—"}</strong>
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {form.joaoShare !== 50 ? t.customSplitNote : t.splitSliderHint}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Category + due date (expenses only — credits are money in) */}
          {!isCredit && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{t.category}</Label>
                <Select value={form.category} onValueChange={(v) => set("category", v)}>
                  <SelectTrigger aria-label={t.categoryAria}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
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
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="expense-due">{t.dueDateOptional}</Label>
                <Input
                  id="expense-due"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => set("dueDate", e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Paid switch (expenses only) */}
          {!isCredit && (
            <div className="flex items-center justify-between rounded-2xl border border-border/70 px-4 py-3.5">
              <div>
                <Label htmlFor="expense-paid" className="text-sm font-medium">
                  {t.alreadyPaid}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t.alreadyPaidHint}
                </p>
              </div>
              <Switch
                id="expense-paid"
                checked={form.paid}
                onCheckedChange={(v) => set("paid", v)}
              />
            </div>
          )}

          {/* Notes */}
          <div className="grid gap-1.5">
            <Label htmlFor="expense-notes">{t.notesOptional}</Label>
            <Textarea
              id="expense-notes"
              placeholder={t.notesPlaceholder}
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              maxLength={500}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600 dark:text-clay-400">
              {error}
            </p>
          )}
        </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" className="rounded-full" onClick={onCancel} disabled={saving}>
          {t.cancel}
        </Button>
        <Button className="rounded-full" onClick={() => void handleSubmit()} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
          {initial ? t.saveChanges : isCredit ? t.addCredit : t.addExpense}
        </Button>
      </DialogFooter>
    </>
  );
}
