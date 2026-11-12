/**
 * First-run helper for the desktop app: when the local database is empty,
 * offer to import the data from the web version's custom.db file.
 * Dismissible — never blocks the app.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";

import { IS_DESKTOP } from "./fetch-shim";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "household-budget-import-dismissed";

interface DbStats {
  incomes: number;
  expenses: number;
  months: string[];
}

export function DesktopFirstRun() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!IS_DESKTOP) return;
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem(DISMISS_KEY)) return;
        const stats = await invoke<DbStats>("db_stats");
        if (!cancelled && stats.incomes + stats.expenses === 0) {
          setOpen(true);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const importData = async () => {
    setBusy(true);
    try {
      const report = await invoke<{ incomes: number; expenses: number; skipped: number } | null>(
        "import_legacy_dialog",
      );
      if (report) {
        toast({
          title: "Importação concluída",
          description: `${report.incomes} rendimentos e ${report.expenses} despesas importados`,
        });
        queryClient.invalidateQueries({ queryKey: ["finance"] });
      }
      dismiss();
    } catch (error) {
      toast({
        title: "Importação não concluída",
        description: typeof error === "string" ? error : "Erro inesperado",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!IS_DESKTOP) return null;

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? setOpen(true) : dismiss())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bem-vindo ao Finanças da Casa</DialogTitle>
          <DialogDescription>
            Quer importar os dados da versão web? Escolha o ficheiro{" "}
            <span className="font-mono text-xs">custom.db</span> da aplicação web
            (ou salte este passo — pode importar mais tarde no menu{" "}
            <span className="font-medium">Ficheiro</span>).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={dismiss} disabled={busy}>
            Começar do zero
          </Button>
          <Button onClick={importData} disabled={busy}>
            {busy ? "A importar…" : "Importar dados…"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
