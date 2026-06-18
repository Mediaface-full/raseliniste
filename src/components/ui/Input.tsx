import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Gide-on Input primitiva (Petr 2026-06-18 redesign · fáze C).
 *
 * Clean form input:
 *   - Background: --input token (g-50 v light, g-800 v dark → subtle, ne syrový)
 *   - Border: --border token (g-200 v light, alpha cream v dark)
 *   - Focus: 2px Signal Coral ring (brand identity)
 *   - Placeholder: muted-foreground, ne italic, ne kurzíva
 *
 * Žádný hardcoded bg-black/N (134 výskytů v původním kódu) — postupně se
 * komponenty přepisují na <Input> místo plain <input>.
 */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-md border border-border bg-input px-3 py-2",
      "font-sans text-sm text-foreground",
      "placeholder:text-muted-foreground placeholder:font-normal",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "transition-colors",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
