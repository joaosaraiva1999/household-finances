"use client";

import { useTheme } from "next-themes";
import {
  CalendarClock,
  Check,
  Globe,
  LayoutDashboard,
  Menu,
  Moon,
  Pencil,
  PieChart,
  Plus,
  Receipt,
  Search,
  Sun,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/components/providers/language-provider";
import { nameInitial, useNames } from "@/components/providers/names-provider";
import { NamesForm } from "@/components/finance/names-form";
import { LANGUAGES } from "@/lib/i18n";

interface SidebarProps {
  onAdd: () => void;
  search: string;
  onSearchChange: (value: string) => void;
}

type SectionId = "overview" | "people" | "bills" | "charts" | "upcoming";
type SectionKey =
  | "navOverview"
  | "navPeople"
  | "navBills"
  | "navCharts"
  | "navUpcoming";

const SECTIONS: { id: SectionId; key: SectionKey; icon: LucideIcon }[] = [
  { id: "overview", key: "navOverview", icon: LayoutDashboard },
  { id: "people", key: "navPeople", icon: Users },
  { id: "bills", key: "navBills", icon: Receipt },
  { id: "charts", key: "navCharts", icon: PieChart },
  { id: "upcoming", key: "navUpcoming", icon: CalendarClock },
];

const SECTION_IDS: Record<SectionId, string> = {
  overview: "sec-overview",
  people: "sec-people",
  bills: "sec-bills",
  charts: "sec-charts",
  upcoming: "sec-upcoming",
};

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useLang();

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={t.toggleDarkMode}
      className="glass-inset h-10 w-10 shrink-0 rounded-full border-transparent bg-white/45 shadow-none dark:bg-white/[0.06]"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* CSS-driven swap avoids hydration mismatch and effect-based mounting */}
      <Sun className="hidden h-[1.1rem] w-[1.1rem] dark:block" />
      <Moon className="block h-[1.1rem] w-[1.1rem] dark:hidden" />
    </Button>
  );
}

function LanguageToggle() {
  const { lang, setLang, t } = useLang();
  const current = LANGUAGES.find((l) => l.id === lang) ?? LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label={t.changeLanguage}
          title={t.changeLanguage}
          className="glass-inset h-10 shrink-0 rounded-full gap-1.5 border-transparent bg-white/45 px-2.5 shadow-none sm:px-3 dark:bg-white/[0.06]"
        >
          <Globe className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide">{current.short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {t.language}
        </p>
        {LANGUAGES.map((option) => (
          <DropdownMenuItem
            key={option.id}
            lang={option.id === "pt" ? "pt-PT" : "en"}
            aria-checked={option.id === lang}
            role="menuitemradio"
            className="gap-2"
            onClick={() => setLang(option.id)}
          >
            <span className="flex-1">{option.label}</span>
            {option.id === lang && (
              <Check className="h-4 w-4 text-sage-600 dark:text-sage-400" aria-hidden="true" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Round search field shared by the desktop rail and the mobile drawer. */
function SearchField({
  search,
  onSearchChange,
}: Pick<SidebarProps, "search" | "onSearchChange">) {
  const { t } = useLang();

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        aria-label={t.searchEntriesAria}
        placeholder={t.searchEntries}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="glass-inset h-10 w-full rounded-full border-transparent bg-white/40 pl-9 pr-9 text-sm shadow-none dark:bg-white/[0.06] [&::-webkit-search-cancel-button]:hidden"
      />
      {search && (
        <button
          type="button"
          aria-label={t.clearSearchAria}
          onClick={() => onSearchChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function Brand({ onEditNames }: { onEditNames: () => void }) {
  const { t } = useLang();
  const { joaoName, annaName } = useNames();

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sage-500 to-sage-700 text-white shadow-soft-sm"
      >
        <Wallet className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1 truncate text-[15px] font-semibold leading-tight">
          {joaoName} &amp; {annaName}
          <button
            type="button"
            aria-label={t.editNamesAria}
            title={t.editNames}
            onClick={onEditNames}
            className="rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
          </button>
        </p>
        <p className="truncate text-xs text-muted-foreground">{t.appTagline}</p>
      </div>
    </div>
  );
}

function NavList({
  activeSection,
  onNavigate,
}: {
  activeSection: SectionId;
  onNavigate?: () => void;
}) {
  const { t } = useLang();

  return (
    <ul className="space-y-1">
      {SECTIONS.map((s) => {
        const active = activeSection === s.id;
        const Icon = s.icon;
        return (
          <li key={s.id}>
            <a
              href={`#sec-${s.id}`}
              onClick={onNavigate}
              aria-current={active ? "true" : undefined}
              className={
                active
                  ? "flex items-center gap-2.5 rounded-xl bg-sage-500/10 px-3 py-2 text-sm font-medium text-sage-700 transition-colors dark:bg-sage-400/10 dark:text-sage-300"
                  : "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/60 hover:text-foreground dark:hover:bg-white/[0.08]"
              }
            >
              <Icon className="h-[1.1rem] w-[1.1rem] shrink-0" aria-hidden="true" />
              {t[s.key]}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Avatar stack for the two members (decorative). */
function MemberAvatars() {
  const { joaoName, annaName } = useNames();

  return (
    <div
      aria-hidden="true"
      title={`${joaoName} & ${annaName}`}
      className="flex items-center"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-sage-500 to-sage-700 text-xs font-bold text-white ring-2 ring-white/70 dark:ring-white/15">
        {nameInitial(joaoName)}
      </span>
      <span className="-ml-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-clay-500 to-clay-700 text-xs font-bold text-white ring-2 ring-white/70 dark:ring-white/15">
        {nameInitial(annaName)}
      </span>
    </div>
  );
}

export function FinanceSidebar({ onAdd, search, onSearchChange }: SidebarProps) {
  const { t } = useLang();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [editNamesOpen, setEditNamesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Scroll-spy: highlight the nav item of the section currently in view.
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY + 128;
      let current: SectionId = "overview";
      for (const s of SECTIONS) {
        const el = document.getElementById(SECTION_IDS[s.id]);
        if (el && el.getBoundingClientRect().top + window.scrollY <= y) {
          current = s.id;
        }
      }
      // At the very bottom of the page the last section is the one in view.
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 48
      ) {
        current = "upcoming";
      }
      setActiveSection(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const namesDialog = (
    <Dialog open={editNamesOpen} onOpenChange={setEditNamesOpen}>
      <DialogContent className="rounded-[1.5rem] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.editNames}</DialogTitle>
          <DialogDescription>{t.namesHint}</DialogDescription>
        </DialogHeader>
        <NamesForm
          requireBoth={false}
          submitLabel={t.saveChanges}
          onSaved={(j, a) => {
            setEditNamesOpen(false);
            toast({
              title: t.namesUpdated,
              description: t.namesUpdatedDesc(j, a),
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      {/* ── Mobile top bar (glass, sticky) ── */}
      <header className="glass sticky top-0 z-40 rounded-none md:hidden">
        <div className="flex h-16 w-full items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <Button
              variant="outline"
              size="icon"
              aria-label={t.openMenuAria}
              aria-expanded={menuOpen}
              className="glass-inset h-10 w-10 shrink-0 rounded-full border-transparent bg-white/45 shadow-none dark:bg-white/[0.06]"
              onClick={() => setMenuOpen(true)}
            >
              <Menu className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
            </Button>
            {/* Drawer navigation */}
            <SheetContent
              side="left"
              className="glass-strong w-72 border-r p-0 sm:w-80"
            >
              <SheetTitle className="sr-only">{t.navAria}</SheetTitle>
              <SheetDescription className="sr-only">
                {t.searchEntriesAria}
              </SheetDescription>
              <div className="flex h-full flex-col gap-5 overflow-y-auto p-5">
                <Brand onEditNames={() => setEditNamesOpen(true)} />
                <SearchField search={search} onSearchChange={onSearchChange} />
                <nav aria-label={t.navAria}>
                  <NavList
                    activeSection={activeSection}
                    onNavigate={() => setMenuOpen(false)}
                  />
                </nav>
                <div className="mt-auto flex flex-col gap-3 border-t border-border/60 pt-4">
                  <Button
                    onClick={() => {
                      setMenuOpen(false);
                      onAdd();
                    }}
                    className="w-full gap-1.5 rounded-full"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span className="truncate">{t.addEntry}</span>
                  </Button>
                  <div className="flex items-center justify-between">
                    <MemberAvatars />
                    <div className="flex items-center gap-2">
                      <LanguageToggle />
                      <ThemeToggle />
                    </div>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          <Brand onEditNames={() => setEditNamesOpen(true)} />

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <LanguageToggle />
            <ThemeToggle />
            <Button
              onClick={onAdd}
              aria-label={t.addEntry}
              className="h-10 rounded-full shadow-soft-sm max-sm:w-10 max-sm:p-0 sm:gap-1.5 sm:pl-4 sm:pr-5"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t.addEntry}</span>
              <span className="sr-only sm:hidden">{t.addEntry}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Desktop rail (fixed glass sidebar) ── */}
      <aside
        aria-label={t.navAria}
        className="glass fixed inset-y-0 left-0 z-40 hidden w-64 flex-col rounded-none md:flex"
      >
        <div className="px-5 pt-5">
          <Brand onEditNames={() => setEditNamesOpen(true)} />
        </div>

        <div className="mt-4 px-4">
          <SearchField search={search} onSearchChange={onSearchChange} />
        </div>

        <nav aria-label={t.navAria} className="mt-4 flex-1 overflow-y-auto px-3">
          <NavList activeSection={activeSection} />
        </nav>

        <div className="border-t border-border/60 px-5 pb-5 pt-4">
          <Button onClick={onAdd} className="w-full gap-1.5 rounded-full">
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t.addEntry}</span>
          </Button>
          <div className="mt-3 flex items-center justify-between">
            <MemberAvatars />
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>
      {namesDialog}
    </>
  );
}
