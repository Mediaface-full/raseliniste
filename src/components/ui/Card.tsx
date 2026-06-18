import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Gide-on Card primitiva (Petr 2026-06-18 redesign · fáze C).
 *
 * Náhrada za legacy `glass` / `glass-strong` / `glass-subtle` utility.
 * Liquid Glass byl rušen — žádný backdrop-filter, žádný glow shadow.
 *
 * Varianty:
 *   default  — Cream/Ink surface s 1px border + subtle shadow (light mode only)
 *   elevated — větší stín, pro modální karty
 *   subtle   — surface-2 (vnořené sekce uvnitř default karty)
 *   tinted   — accent border (per-modul, použij přes style {borderColor: ...})
 *
 * Použití:
 *   <Card>
 *     <CardHeader>
 *       <Eyebrow>↳ téma</Eyebrow>
 *       <CardTitle>Nadpis karty</CardTitle>
 *       <CardDescription>Podtitulek</CardDescription>
 *     </CardHeader>
 *     <CardContent>...</CardContent>
 *   </Card>
 */

const cardVariants = cva(
  "rounded-lg border border-border bg-card text-card-foreground",
  {
    variants: {
      variant: {
        default: "shadow-sm",
        elevated: "shadow-md",
        subtle: "bg-secondary border-border/60 shadow-none",
        tinted: "shadow-sm", // border-color override přes inline style
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col gap-1 px-5 py-4", className)}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        "h-title text-xl font-bold leading-tight text-foreground",
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("px-5 pb-4", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center justify-between gap-2 px-5 py-3 border-t border-border",
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";
