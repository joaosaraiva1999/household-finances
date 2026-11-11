"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createFormatters,
  dictionaries,
  type Formatters,
  type Dictionary,
  type Lang,
} from "@/lib/i18n";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dictionary;
  fmt: Formatters;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "household-budget-lang";
const LANG_EVENT = "household-budget-lang-change";

/** localStorage is an external store: read it synchronously on the client. */
function readStoredLang(): Lang {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "pt" ? "pt" : "en";
  } catch {
    return "en";
  }
}

function getServerSnapshot(): Lang {
  return "en";
}

function subscribe(onStoreChange: () => void) {
  // Re-render when the preference changes in this tab or another one.
  window.addEventListener(LANG_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(LANG_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Renders "en" during SSR/hydration, then adopts the stored preference
  // without hydration mismatches (useSyncExternalStore handles the swap).
  const lang = useSyncExternalStore(subscribe, readStoredLang, getServerSnapshot);

  // Keep <html lang> in sync for screen readers and translation tools.
  useEffect(() => {
    document.documentElement.lang = lang === "pt" ? "pt-PT" : "en";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore persistence failures (private mode).
    }
    window.dispatchEvent(new Event(LANG_EVENT));
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, t: dictionaries[lang], fmt: createFormatters(lang) }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used inside <LanguageProvider>");
  return ctx;
}
