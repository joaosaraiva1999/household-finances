"use client";

import { Wallet } from "lucide-react";
import { AuroraBackdrop } from "@/components/finance/aurora-backdrop";
import { NamesForm } from "@/components/finance/names-form";
import { useLang } from "@/components/providers/language-provider";
import { LANGUAGES } from "@/lib/i18n";

/** Compact EN | PT segmented switch for the welcome screen. */
function LanguageSwitch() {
  const { lang, setLang, t } = useLang();

  return (
    <div
      role="group"
      aria-label={t.language}
      className="glass-inset flex w-fit items-center gap-1 rounded-full p-1"
    >
      {LANGUAGES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={lang === option.id}
          onClick={() => setLang(option.id)}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-colors ${
            lang === option.id
              ? "bg-white/85 text-sage-700 shadow-soft-sm dark:bg-white/[0.14] dark:text-sage-300"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}

/**
 * First-run gate: shown until the user names the two persons. Choosing the
 * names writes them to the NamesProvider (localStorage), which flips
 * `onboarded` and swaps this screen for the dashboard.
 */
export function Onboarding() {
  const { t } = useLang();

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <AuroraBackdrop />

      <div className="glass w-full max-w-md rounded-3xl p-7 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sage-500 to-sage-700 text-white shadow-soft-sm"
          >
            <Wallet className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            {t.onboardingTitle}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t.onboardingSubtitle}
          </p>
          <div className="mt-4">
            <LanguageSwitch />
          </div>
        </div>

        <div className="mt-6">
          <NamesForm requireBoth submitLabel={t.startUsingApp} />
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t.namesHint}
        </p>
      </div>
    </div>
  );
}
