import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Gide-on Button primitiva (Petr 2026-06-18 redesign · fáze C).
 *
 * Varianty mapované na brand:
 *   default     — Signal Coral bg + Ink text (primární CTA)
 *   ink         — Ink bg + Cream text (silná akce v light theme)
 *   outline     — border + transparent (sekundární)
 *   ghost       — žádný border, jen hover surface (navigation, toolbar)
 *   secondary   — surface-2 bg (subtle secondary)
 *   destructive — destructive token
 *   glass       — legacy alias (původní glass utility), zachováno
 *
 * Brand pravidlo: Signal Coral max ~10% UI plochy → default jen pro hlavní
 * CTA (Uložit, Potvrdit, Vytvořit). Pro většinu akcí použij outline / ghost.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap",
    "font-sans text-sm font-medium tracking-tight",
    "transition-colors disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        ink: "bg-foreground text-background hover:opacity-90 active:opacity-80",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground border border-border hover:bg-accent",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        glass:
          "bg-card text-card-foreground border border-border hover:bg-accent shadow-sm",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-5 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
