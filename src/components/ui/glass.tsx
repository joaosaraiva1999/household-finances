import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Glassmorphism surfaces — the app's signature containers.
 *
 * All borders/refraction edges are drawn with inset box-shadows inside the
 * `.glass*` classes (globals.css), so Tailwind `border-*` utilities stay
 * free for callers. Pair with the aurora backdrop on the page for the full
 * frosted effect.
 */

/** Frosted-glass panel for page content (cards, lists, toolbars). */
function GlassCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="glass-card"
      className={cn("glass rounded-3xl", className)}
      {...props}
    />
  );
}

/** Higher-opacity glass for floating overlays (dialogs, popovers, tooltips). */
function GlassSurface({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="glass-surface"
      className={cn("glass-strong rounded-2xl", className)}
      {...props}
    />
  );
}

/** Translucent inner row/chip that sits on top of a glass panel. */
function GlassInset({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="glass-inset"
      className={cn("glass-inset rounded-xl", className)}
      {...props}
    />
  );
}

export { GlassCard, GlassSurface, GlassInset };
