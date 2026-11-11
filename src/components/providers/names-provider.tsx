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
import type { Person } from "@/lib/finance";

export interface HouseholdNames {
  joao: string;
  anna: string;
}

const DEFAULT_NAMES: HouseholdNames = { joao: "João", anna: "Anna" };

const NAMES_KEY = "household-budget-names";
const NAMES_EVENT = "household-budget-names-change";

/** localStorage is an external store: read it synchronously on the client. */
function readStoredNames(): string | null {
  try {
    return window.localStorage.getItem(NAMES_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

function subscribe(onStoreChange: () => void) {
  // Re-render when the names change in this tab or another one.
  window.addEventListener(NAMES_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(NAMES_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/**
 * The stored key doubles as the onboarding flag: no key means the user has
 * not completed the first-run name setup yet (or cleared their storage).
 */
function parseNames(raw: string | null): { names: HouseholdNames; onboarded: boolean } {
  if (!raw) return { names: { ...DEFAULT_NAMES }, onboarded: false };
  try {
    const parsed = JSON.parse(raw) as Partial<HouseholdNames>;
    const joao =
      typeof parsed.joao === "string" && parsed.joao.trim()
        ? parsed.joao.trim()
        : DEFAULT_NAMES.joao;
    const anna =
      typeof parsed.anna === "string" && parsed.anna.trim()
        ? parsed.anna.trim()
        : DEFAULT_NAMES.anna;
    return { names: { joao, anna }, onboarded: true };
  } catch {
    return { names: { ...DEFAULT_NAMES }, onboarded: false };
  }
}

/** First-letter initial for avatar chips ("João" → "J"). */
export function nameInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

interface NamesContextValue {
  names: HouseholdNames;
  joaoName: string;
  annaName: string;
  /** True once the user completed the first-run name setup. */
  onboarded: boolean;
  setNames: (joao: string, anna: string) => void;
  /** Display name for a person key ("joao" | "anna"). */
  personName: (person: Person) => string;
}

const NamesContext = createContext<NamesContextValue | null>(null);

export function NamesProvider({ children }: { children: ReactNode }) {
  // Renders the defaults during SSR/hydration, then adopts the stored names
  // without hydration mismatches (useSyncExternalStore handles the swap).
  const raw = useSyncExternalStore(subscribe, readStoredNames, getServerSnapshot);
  const { names, onboarded } = useMemo(() => parseNames(raw), [raw]);

  // Keep the browser tab title in sync with the chosen names.
  useEffect(() => {
    document.title = `Household Budget — ${names.joao} & ${names.anna}`;
  }, [names]);

  const setNames = useCallback((joao: string, anna: string) => {
    const next: HouseholdNames = {
      joao: joao.trim() || DEFAULT_NAMES.joao,
      anna: anna.trim() || DEFAULT_NAMES.anna,
    };
    try {
      window.localStorage.setItem(NAMES_KEY, JSON.stringify(next));
    } catch {
      // Ignore persistence failures (private mode).
    }
    window.dispatchEvent(new Event(NAMES_EVENT));
  }, []);

  const value = useMemo<NamesContextValue>(
    () => ({
      names,
      joaoName: names.joao,
      annaName: names.anna,
      onboarded,
      setNames,
      personName: (person) => (person === "joao" ? names.joao : names.anna),
    }),
    [names, onboarded, setNames],
  );

  return <NamesContext.Provider value={value}>{children}</NamesContext.Provider>;
}

export function useNames(): NamesContextValue {
  const ctx = useContext(NamesContext);
  if (!ctx) throw new Error("useNames must be used inside <NamesProvider>");
  return ctx;
}
