// ─── Category → Lucide icon mapping (replaces the old emoji map) ────────────

import {
  Car,
  Clapperboard,
  GraduationCap,
  Home,
  Lightbulb,
  Package,
  Pill,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/** Lucide icon component for each expense category. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Housing: Home,
  Utilities: Lightbulb,
  Groceries: ShoppingCart,
  Transport: Car,
  "Internet & Phone": Smartphone,
  Insurance: ShieldCheck,
  Health: Pill,
  Entertainment: Clapperboard,
  Personal: Sparkles,
  Education: GraduationCap,
  Other: Package,
};

/** Fallback icon for unknown categories. */
export const FALLBACK_CATEGORY_ICON: LucideIcon = Package;
