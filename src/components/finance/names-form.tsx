"use client";

import { Loader2, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLang } from "@/components/providers/language-provider";
import { nameInitial, useNames } from "@/components/providers/names-provider";

interface NamesFormProps {
  /** Label of the submit button (already translated by the caller). */
  submitLabel: string;
  /** Called after the names are persisted (e.g. to close a dialog / toast). */
  onSaved?: (joao: string, anna: string) => void;
  /**
   * Onboarding blocks empty fields with an inline error; the edit dialog
   * simply keeps the previous name when a field is left empty.
   */
  requireBoth: boolean;
}

/**
 * The two-person name fields, shared by the first-run onboarding screen and
 * the "Edit names" dialog in the header.
 */
export function NamesForm({ submitLabel, onSaved, requireBoth }: NamesFormProps) {
  const { t } = useLang();
  const { names, setNames } = useNames();
  const [joao, setJoao] = useState(names.joao);
  const [anna, setAnna] = useState(names.anna);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = () => {
    const j = joao.trim();
    const a = anna.trim();
    if (requireBoth && (!j || !a)) {
      setError(t.namesInvalid);
      return;
    }
    setError(null);
    setSaving(true);
    // Give the button its pressed state a frame — keeps the tap feedback
    // visible before the whole screen swaps to the app.
    requestAnimationFrame(() => {
      setNames(j || names.joao, a || names.anna);
      onSaved?.(j || names.joao, a || names.anna);
      setSaving(false);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className="grid gap-4"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="person-one-name" className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-sage-500 to-sage-700 text-[10px] font-bold text-white"
          >
            {nameInitial(joao.trim() || names.joao)}
          </span>
          {t.personOneLabel}
        </Label>
        <Input
          id="person-one-name"
          aria-label={t.namesInputAria(t.personOneLabel)}
          value={joao}
          onChange={(e) => setJoao(e.target.value)}
          maxLength={30}
          autoComplete="off"
          className="h-11 rounded-xl"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="person-two-name" className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-clay-500 to-clay-700 text-[10px] font-bold text-white"
          >
            {nameInitial(anna.trim() || names.anna)}
          </span>
          {t.personTwoLabel}
        </Label>
        <Input
          id="person-two-name"
          aria-label={t.namesInputAria(t.personTwoLabel)}
          value={anna}
          onChange={(e) => setAnna(e.target.value)}
          maxLength={30}
          autoComplete="off"
          className="h-11 rounded-xl"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600 dark:text-clay-400"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="h-11 rounded-full shadow-soft-sm"
        disabled={saving}
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Users className="h-4 w-4" aria-hidden="true" />
        )}
        {submitLabel}
      </Button>
    </form>
  );
}
