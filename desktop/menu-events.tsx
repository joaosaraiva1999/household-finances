/**
 * Listens for native menu events and translates them into the same
 * mechanisms the web UI already uses (localStorage + window events,
 * next-themes). Rendered nowhere — pure side effects.
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { IS_DESKTOP } from "./fetch-shim";

/** Menu → theme toggle (uses next-themes so it matches the in-app toggle). */
export function MenuThemeBridge() {
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const un = listen("menu://toggle-theme", () => {
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, [resolvedTheme, setTheme]);

  return null;
}

/** Menu → language switch (reuses the web app's language change event). */
export function MenuLanguageBridge() {
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const un = listen<string>("menu://language", (event) => {
      const lang = event.payload === "pt" ? "pt" : "en";
      try {
        localStorage.setItem("household-budget-lang", lang);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event("household-budget-lang-change"));
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

  return null;
}

interface JobDonePayload {
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface ImportReportLike {
  incomes?: number;
  expenses?: number;
  skipped?: number;
}

/** Menu → backup/restore/CSV job results → toasts + data refresh. */
export function MenuJobBridge() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const un = listen<JobDonePayload>("menu://job-done", (event) => {
      const { ok, result, error } = event.payload;
      if (!ok) {
        toast({
          title: "Operação não concluída",
          description: error ?? "Erro desconhecido",
          variant: "destructive",
        });
        return;
      }
      // result shapes: string (export path) | DbStats (restore) | ImportReport
      const r = result as { incomes?: number; expenses?: number } | string | null;
      let description: string | undefined;
      if (typeof r === "string") {
        description = r;
      } else if (r && typeof r === "object" && r.incomes !== undefined) {
        description = `${r.incomes} rendimentos e ${r.expenses ?? 0} despesas`;
      }
      toast({
        title: "Operação concluída",
        description,
      });
      queryClient.invalidateQueries({ queryKey: ["finance"] });
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, [toast, queryClient]);

  return null;
}
