import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Gide-on Eyebrow primitiva (Petr 2026-06-18 redesign · fáze C).
 *
 * Brand eyebrow tag = mono uppercase s `↳` glyf prefix.
 * Použití nad nadpisy (před h-title nebo h-display), v tag listech, breadcrumbs.
 *
 * Z brand booku (docs/05-TYPOGRAPHY.md):
 *   font: JetBrains Mono 500
 *   tracking: 0.18em–0.22em
 *   case: uppercase
 *   prefix: ↳ (vždy)
 *
 * Použití:
 *   <Eyebrow>téma</Eyebrow>          → ↳ TÉMA
 *   <Eyebrow noArrow>jen text</Eyebrow>  → JEN TEXT (bez šipky)
 *   <Eyebrow accent>signal</Eyebrow>     → ↳ SIGNAL (v signal coral)
 */

interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  /** Bez `↳` prefixu (pro inline tagy, breadcrumb separator atd.) */
  noArrow?: boolean;
  /** Signal Coral color (akcent — používej zřídka, max 1× per view) */
  accent?: boolean;
  /** Velikost — default xs (12px), sm (14px), md (16px) */
  size?: "xs" | "sm" | "md";
}

export const Eyebrow = forwardRef<HTMLSpanElement, EyebrowProps>(
  (
    { className, noArrow, accent, size = "xs", children, ...props },
    ref,
  ) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 font-mono font-medium uppercase",
        "tracking-[0.18em] leading-none",
        size === "xs" && "text-[10px]",
        size === "sm" && "text-xs",
        size === "md" && "text-sm tracking-[0.22em]",
        accent ? "text-[color:var(--c-signal)]" : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {!noArrow && (
        <span aria-hidden="true" className="font-mono">
          ↳
        </span>
      )}
      {children}
    </span>
  ),
);
Eyebrow.displayName = "Eyebrow";
